import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedAccessFixture } from "./support/access-fixture.mjs";

test("Owner account lifecycle is transactional, versioned and separate from jobs", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/account-lifecycle-"));
  let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService } = await loadServerModule("auth/service.ts");
  const { createAccessService } = await loadServerModule("access/service.ts");
  const { getPlatformProxy } = await import("wrangler");
  async function connect() {
    platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
    const db = drizzle(platform.env.DB, { schema });
    const auth = createAuthService(db, { secret: "isolated-account-lifecycle-secret-at-least-32-characters" });
    return { db, auth, access: createAccessService(db, auth) };
  }
  let { db, auth, access } = await connect();
  const password = "Isolated account lifecycle passphrase!";
  const f = await seedAccessFixture(db, schema, loadServerModule, password);
  const origin = "http://localhost:3000";
  function request(path, cookie = "", body, extra = {}) { return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie,
      ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }); }
  const call = (path, body, cookie = ownerCookie, extra) => access.handle(request(`/api/access/${path}`, cookie, body, extra));
  const data = async response => { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const login = async email => {
    const response = await auth.handle(request("/api/auth/login", "", { email, password }));
    assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0];
  };
  const ownerCookie = await login(f.owner.email);
  const otherOwnerCookie = await login(f.secondOwner.email);
  const managerCookie = await login(f.manager.email);
  const gmCookie = await login(f.generalManager.email);
  const body = overrides => ({ email: "new-manager@example.test", displayName: "New department manager", employeeId: null,
    accessLevel: "manager", departmentIds: [f.deptA.id], ...overrides });
  const edit = (target, overrides = {}) => ({ version: target.account.version, email: target.account.email, displayName: target.account.displayName,
    employeeId: target.account.employeeId, accessLevel: target.account.accessLevel, departmentIds: target.departmentIds, disabled: Boolean(target.account.disabledAt), ...overrides });
  let account;
  const current = async () => data(await call(`accounts/${account.account.id}`));
  const authCall = (path, body, cookie = "") => auth.handle(request(`/api/auth/${path}`, cookie, body));

  await t.test("only Owners can provision or change accounts, with same-origin allowlisted inputs", async () => {
    for (const cookie of [managerCookie, gmCookie]) {
      assert.equal((await call("accounts", body(), cookie)).status, 403);
      assert.equal((await call(`accounts/${f.manager.id}/lifecycle`, {}, cookie)).status, 403);
      assert.equal((await call(`accounts/${f.manager.id}/setup`, {}, cookie)).status, 403);
    }
    assert.equal((await call("accounts", body(), "")).status, 401);
    assert.equal((await call("accounts", body(), `dombase-kiosk-device=${f.deviceToken}; ${ownerCookie}`)).status, 403);
    assert.equal((await call("accounts", body(), ownerCookie, { Origin: "https://untrusted.example" })).status, 403);
    for (const invalid of [{ accessLevel: "owner" }, { passwordHash: "forged" }, { employeeId: -1 }, { departmentIds: [f.deptA.id, f.deptA.id] }, { accessLevel: "employee" }, { email: "bad" }]) {
      assert.equal((await call("accounts", body(invalid))).status, 400);
    }
    assert.equal((await call("accounts", body({ departmentIds: [999999] }))).status, 409);
  });
  await t.test("creation links a real employee, assigns scope, sanitizes output and does not change jobs", async () => {
    const jobs = await db.select().from(schema.employeeRoles).where(eq(schema.employeeRoles.employeeId, f.multi.id));
    account = await data(await call("accounts", body({ employeeId: f.multi.id, email: "  New-Manager@Example.test " })));
    assert.equal(account.account.email, "New-Manager@Example.test");
    assert.equal(account.account.employeeId, f.multi.id); assert.equal(account.account.loginEnabled, false);
    assert.deepEqual(account.departmentIds, [f.deptA.id]); assert.equal(account.permissions["wages.read"], false);
    assert.equal("passwordHash" in account.account, false); assert.equal("accessRevision" in account.account, false);
    assert.deepEqual(await db.select().from(schema.employeeRoles).where(eq(schema.employeeRoles.employeeId, f.multi.id)), jobs);
    assert.equal((await call("accounts", body({ email: "new-manager@example.test" }))).status, 409);
    assert.equal((await call("accounts", body({ email: "duplicate-link@example.test", employeeId: f.multi.id }))).status, 409);
  });
  await t.test("only one concurrent create wins for the same normalized email", async () => {
    const responses = await Promise.all([call("accounts", body({ email: "race@example.test" })), call("accounts", body({ email: "race@example.test" }))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  });
  let oldSetup; let setup;
  await t.test("Owner issues one-hour setup links, superseding old links and requiring a current version", async () => {
    oldSetup = await data(await call(`accounts/${account.account.id}/setup`, { version: account.account.version }));
    assert.match(oldSetup.token, /^[\w-]{43}$/);
    assert.ok(Date.parse(oldSetup.expiresAt) > Date.now() + 59 * 60000);
    assert.equal((await call(`accounts/${account.account.id}/setup`, { version: account.account.version })).status, 409);
    setup = await data(await call(`accounts/${account.account.id}/setup`, { version: oldSetup.access.account.version }));
    assert.equal((await authCall("setup/inspect", { token: oldSetup.token })).status, 401);
    assert.equal((await authCall("setup/inspect", { token: setup.token })).status, 200);
    const [grant] = await db.select().from(schema.accountSetupTokens).where(eq(schema.accountSetupTokens.tokenHash, (await loadServerModule("auth/crypto.ts")).tokenHash(setup.token)));
    assert.notEqual(grant.tokenHash, setup.token);
  });
  let newCookie;
  await t.test("the person chooses a password, signs in and sees only the assigned department", async () => {
    assert.equal((await authCall("setup", { token: setup.token, password })).status, 200);
    assert.equal((await authCall("setup", { token: setup.token, password })).status, 401);
    newCookie = await login(account.account.email);
    const roster = await data(await access.handle(request("/api/workforce/employees", newCookie)));
    assert.equal(roster.employees.some(e => e.id === f.b.id), false);
    assert.equal((await call("accounts", undefined, newCookie)).status, 403);
    const before = await current();
    assert.equal((await call(`accounts/${account.account.id}/setup`, { version: before.account.version })).status, 409);
  });
  await t.test("access-level changes revoke sessions, clear grants and replace department assignments", async () => {
    let before = await current();
    before = await data(await call(`accounts/${account.account.id}`, { version: before.account.version, permissions: { "wages.read": true }, departmentIds: [f.deptA.id] }));
    newCookie = await login(account.account.email);
    const updated = await data(await call(`accounts/${account.account.id}/lifecycle`, edit(before, { accessLevel: "general_manager", departmentIds: [] })));
    assert.equal(updated.permissions["wages.read"], false); assert.deepEqual(updated.departmentIds, []);
    assert.equal((await authCall("session", undefined, newCookie)).status, 401);
    assert.equal((await db.select().from(schema.accountPermissions).where(eq(schema.accountPermissions.accountId, account.account.id))).length, 0);
    newCookie = await login(account.account.email);
    assert.equal((await data(await call("me", undefined, newCookie))).allDepartments, true);
    assert.equal((await call(`accounts/${account.account.id}/lifecycle`, edit(before))).status, 409);
  });
  await t.test("disable and explicit re-enable preserve passwords but never revive old sessions", async () => {
    let before = await current();
    const disabled = await data(await call(`accounts/${account.account.id}/lifecycle`, edit(before, { disabled: true })));
    assert.ok(disabled.account.disabledAt); assert.equal((await authCall("session", undefined, newCookie)).status, 401);
    assert.equal((await authCall("login", { email: account.account.email, password })).status, 401);
    before = await data(await call(`accounts/${account.account.id}/lifecycle`, edit(disabled, { disabled: false })));
    assert.equal(before.account.disabledAt, null); assert.equal((await authCall("session", undefined, newCookie)).status, 401);
    newCookie = await login(account.account.email);
  });
  await t.test("Owner identities cannot be demoted, disabled, relinked or reset through this workflow", async () => {
    const owner = await data(await call(`accounts/${f.owner.id}`));
    for (const overrides of [{ disabled: true }, { accessLevel: "manager" }, { employeeId: null }]) {
      assert.equal((await call(`accounts/${f.owner.id}/lifecycle`, edit(owner, overrides))).status, 403);
    }
    assert.equal((await call(`accounts/${f.secondOwner.id}/setup`, { version: 1 })).status, 403);
    assert.equal((await call("me", undefined, otherOwnerCookie)).status, 200);
    assert.equal((await call(`accounts/${account.account.id}/lifecycle`, edit(await current(), { employeeId: f.a.id }))).status, 400);
  });
  await t.test("concurrent lifecycle saves have one winner and a consistent audit", async () => {
    const before = await current();
    const responses = await Promise.all([call(`accounts/${account.account.id}/lifecycle`, edit(before, { displayName: "Winner A" })), call(`accounts/${account.account.id}/lifecycle`, edit(before, { displayName: "Winner B" }))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await current()).account.version, before.account.version + 1);
  });
  await t.test("failed audit rolls back account creation, lifecycle revocation and setup issuance", async () => {
    const before = await current(); const cookie = await login(before.account.email);
    const pending = await data(await call("accounts", body({ email: "rollback-setup@example.test" })));
    const initial = await data(await call(`accounts/${pending.account.id}/setup`, { version: pending.account.version }));
    await db.run(sql`CREATE TRIGGER account_lifecycle_fail BEFORE INSERT ON audit_log WHEN NEW.action IN ('account.created', 'account.lifecycle_changed', 'account.setup_issued') BEGIN SELECT RAISE(ABORT, 'forced fixture rollback'); END`);
    try {
      assert.equal((await call("accounts", body({ email: "rollback-create@example.test" }))).status, 503);
      assert.equal((await call(`accounts/${account.account.id}/lifecycle`, edit(before, { disabled: true }))).status, 503);
      assert.equal((await call(`accounts/${pending.account.id}/setup`, { version: initial.access.account.version })).status, 503);
      assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.normalizedEmail, "rollback-create@example.test"))).length, 0);
      assert.deepEqual(await current(), before);
      assert.equal((await authCall("session", undefined, cookie)).status, 200);
      assert.equal((await authCall("setup/inspect", { token: initial.token })).status, 200);
    } finally { await db.run(sql`DROP TRIGGER account_lifecycle_fail`); }
  });
  await t.test("inactive employees cannot be enabled and demotion to Employee removes dashboard authority", async () => {
    const before = await current();
    await db.update(schema.employees).set({ active: false }).where(eq(schema.employees.id, f.multi.id));
    assert.equal((await call(`accounts/${account.account.id}/lifecycle`, edit(before))).status, 409);
    const disabled = await data(await call(`accounts/${account.account.id}/lifecycle`, edit(before, { disabled: true })));
    await db.update(schema.employees).set({ active: true }).where(eq(schema.employees.id, f.multi.id));
    const employee = await data(await call(`accounts/${account.account.id}/lifecycle`, edit(disabled, { disabled: false, accessLevel: "employee", departmentIds: [] })));
    assert.equal(employee.account.accessLevel, "employee"); assert.ok(Object.values(employee.permissions).every(v => !v));
    const employeeCookie = await login(account.account.email);
    assert.equal((await call("accounts", undefined, employeeCookie)).status, 401);
    assert.equal((await call(`accounts/${account.account.id}/setup`, { version: employee.account.version })).status, 409);
  });
  await t.test("a captured Owner context cannot mutate after revocation", async () => {
    const ctx = await access.workspaceContext(request("/api/access/me", otherOwnerCookie));
    const { createAccountLifecycle } = await loadServerModule("access/accounts.ts");
    const lifecycle = createAccountLifecycle(db, { activeActor: () => ctx.activeActor(), accountAccess: async () => ({}) });
    await db.update(schema.accounts).set({ sessionVersion: sql`session_version + 1` }).where(eq(schema.accounts.id, f.secondOwner.id));
    await assert.rejects(lifecycle.create(ctx, body({ email: "revoked-owner@example.test" })), error => error.status === 409);
    await assert.rejects(lifecycle.update(ctx, account.account.id, edit(await current())), error => error.status === 409);
  });
  await t.test("account identity, assignments and audit survive a runtime restart", async () => {
    const before = await current();
    await platform.dispose(); ({ db, auth, access } = await connect());
    assert.deepEqual(await current(), before);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "account.created"));
    assert.ok(audit.length >= 2);
    assert.doesNotMatch(JSON.stringify(audit), /new-manager@example|token|password|Private address/i);
    assert.equal((await db.all(sql`PRAGMA foreign_key_check`)).length, 0);
  });
});
