import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("employee password self-service enforces person, field, session and transaction boundaries", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/self-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createSelfService, createWorkforceService, newToken } = await loadServerModule("tests/support/workforce-runtime.ts");
  const secret = "isolated-self-profile-secret-with-at-least-32-characters";
  async function connect() {
    platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
    const db = drizzle(platform.env.DB, { schema }); const auth = createAuthService(db, { secret });
    const access = createAccessService(db, auth);
    return { db, auth, access, self: createSelfService(db, auth, secret), workforce: createWorkforceService(db, access, { secret, fieldKey }) };
  }
  let { db, auth, access, self, workforce } = await connect();
  const password = "Isolated personal profile test passphrase!";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const origin = "http://localhost:3000";
  const request = (path, cookie = "", body, extra = {}) => new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = async r => { const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body; };
  const cookieOf = r => r.headers.get("set-cookie").split(";")[0];
  const login = async account => { const r = await auth.handle(request("/api/auth/login", "", { email: account.email, password })); assert.equal(r.status, 200); return cookieOf(r); };
  const owner = await login(f.owner); let employee = await login(f.employeeAccount);
  const call = (body, cookie = employee, path = "/api/self/profile", extra) => self.handle(request(path, cookie, body, extra));
  const current = async () => data(await call());
  const saveBody = (profile, values = {}, id = newToken()) => ({ id, contextToken: profile.contextToken, employeeVersion: profile.employeeVersion, profileVersion: profile.profileVersion, values: { ...profile.values, ...values } });
  const audit = async () => db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "employee.self_profile_changed"));
  const rawEmployee = async () => (await db.select().from(schema.employees).where(eq(schema.employees.id, f.a.id)))[0];
  const rawProfile = async () => (await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, f.a.id)))[0];
  const rawAccount = async () => (await db.select().from(schema.accounts).where(eq(schema.accounts.id, f.employeeAccount.id)))[0];
  const revision = async () => (await db.select().from(schema.workforceState))[0].revision;

  await t.test("only a password-authenticated employee enters their own profile; other contexts fail closed", async () => {
    for (const cookie of ["", "dombase-session=0000", `dombase-session=${f.deviceToken}`, `dombase-session=${f.legacyToken}`]) assert.equal((await call(undefined, cookie)).status, 401);
    assert.equal((await call(undefined, owner)).status, 403);
    assert.equal((await call(undefined, `dombase-kiosk-device=${f.deviceToken}; ${employee}`)).status, 403);
    assert.equal((await call(undefined, employee, "/api/self/profile/999")).status, 404);
    assert.equal((await call(undefined, employee, `/api/self/profile?employeeId=${f.b.id}`)).status, 400);
    for (const path of ["/api/access/accounts", "/api/workforce/employees"]) assert.equal((await access.handle(request(path, employee))).status, 401);
    assert.equal((await workforce.handle(request("/api/workspace/state", employee))).status, 401);
  });
  await t.test("the projection contains only own editable fields and no payroll, SSN, manager notes or credentials", async () => {
    const r = await call(); assert.match(r.headers.get("cache-control"), /no-store/);
    const p = await data(r); assert.equal(p.accountEmail, f.employeeAccount.email);
    assert.equal(p.values.legalFirstName, "Private legal name");
    assert.doesNotMatch(JSON.stringify(p), /ssn|password|pin|wage|payroll|terminated|certificate|private-file|Other department|Private manager note/i);
    assert.deepEqual(Object.keys(p).sort(), ["accountEmail", "contextToken", "employeeId", "employeeVersion", "profileVersion", "values"]);
  });
  await t.test("selectors and administrative fields are rejected before changing any data", async () => {
    const before = await rawEmployee(); const p = await current();
    for (const field of ["employeeId", "accessLevel", "wage", "active", "terminated", "payrollId", "socialSecurityNumber", "ssnEncrypted", "startDate", "permissions"]) {
      assert.equal((await call({ ...saveBody(p), [field]: "forged" })).status, 400);
      assert.equal((await call(saveBody(p, { [field]: "forged" }))).status, 400);
    }
    assert.deepEqual(await rawEmployee(), before);
  });
  await t.test("real personal edits update own rows atomically while keeping sign-in identity, SSN and job data intact", async () => {
    const before = await current(); const ssn = (await rawProfile()).ssnEncrypted; const accountBefore = await rawAccount();
    const other = await db.select().from(schema.employees).where(eq(schema.employees.id, f.b.id));
    const jobs = await db.select().from(schema.employeeRoles).where(eq(schema.employeeRoles.employeeId, f.a.id));
    const rev = await revision();
    assert.equal((await call(saveBody(before, { name: "Self Updated", email: "personal@example.test", phone: "202-555-0117", homeCity: "Sacramento", homePostalCode: "95814", dateOfBirth: "1992-03-04" }))).status, 200);
    const p = await current(); assert.equal(p.values.name, "Self Updated"); assert.equal(p.values.email, "personal@example.test");
    assert.equal(p.accountEmail, f.employeeAccount.email); assert.equal(p.employeeVersion, before.employeeVersion + 1); assert.equal(p.profileVersion, before.profileVersion + 1);
    assert.equal(await revision(), rev + 1); assert.equal((await rawProfile()).ssnEncrypted, ssn);
    assert.deepEqual(await rawAccount(), accountBefore); assert.deepEqual(await db.select().from(schema.employeeRoles).where(eq(schema.employeeRoles.employeeId, f.a.id)), jobs);
    assert.deepEqual(await db.select().from(schema.employees).where(eq(schema.employees.id, f.b.id)), other);
    assert.doesNotMatch(JSON.stringify(await audit()), /personal@example|Sacramento|1992|password|ssn|202-555/i);
  });
  await t.test("stale employee/profile versions and stale manager workspace writes cannot overwrite changes", async () => {
    const old = await current();
    const workspaceBefore = await data(await workforce.handle(request("/api/workspace/state", owner)));
    await data(await call(saveBody(old, { phone: "202-555-0118" })));
    assert.equal((await call(saveBody(old, { phone: "202-555-0119" }))).status, 409);
    const target = workspaceBefore.state.employees.find(e => e.id === f.a.id);
    const managerWrite = { id: newToken(), revision: workspaceBefore.revision, employeeVersions: workspaceBefore.employeeVersions, changes: [{ entity: "employee", id: f.a.id, before: target, after: { ...target, phone: "stale-manager" } }] };
    assert.equal((await workforce.handle(request("/api/workspace/commit", owner, managerWrite))).status, 409);
    const p = await current(); await db.update(schema.employeeProfiles).set({ version: sql`version + 1` }).where(eq(schema.employeeProfiles.employeeId, f.a.id));
    assert.equal((await call(saveBody(p, { phone: "stale-profile" }))).status, 409);
  });
  await t.test("validation, CSRF and bounded JSON reject malformed profile edits", async () => {
    const p = await current();
    for (const values of [{ name: "" }, { dateOfBirth: "2026-02-30" }, { dateOfBirth: "2099-01-01" }, { email: "bad" }, { homePostalCode: "invalid" }, { phone: "x".repeat(51) }]) assert.equal((await call(saveBody(p, values))).status, 400);
    assert.equal((await call(saveBody(p), employee, "/api/self/profile", { Origin: "https://other.example" })).status, 403);
    assert.equal((await call(saveBody(p), employee, "/api/self/profile", { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await call({ ...saveBody(p), padding: "x".repeat(17000) })).status, 413);
  });
  await t.test("identical retries, including concurrent retries, commit once; conflicting save identifiers fail", async () => {
    const p = await current(); const body = saveBody(p, { homeCity: "Retry city" }); const count = (await audit()).length; const rev = await revision();
    const replies = await Promise.all([call(body), call(body)]); assert.deepEqual(replies.map(r => r.status), [200, 200]);
    assert.deepEqual(await replies[0].json(), await replies[1].json());
    assert.equal((await call(body)).status, 200); assert.equal((await audit()).length, count + 1); assert.equal(await revision(), rev + 1);
    assert.equal((await call({ ...body, values: { ...body.values, homeCity: "Different" } })).status, 409);
    const next = await current(); const races = await Promise.all([call(saveBody(next, { phone: "race-a" })), call(saveBody(next, { phone: "race-b" }))]);
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  });
  await t.test("audit failure rolls back contact/profile edits, versions, revision and save receipts", async () => {
    const before = await current(); const raw = await rawProfile(); const rev = await revision(); const body = saveBody(before, { phone: "rollback" });
    await db.run(sql`CREATE TRIGGER self_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action = 'employee.self_profile_changed' BEGIN SELECT RAISE(ABORT, 'forced fixture failure'); END`);
    try {
      assert.equal((await call(body)).status, 503); assert.deepEqual(await current(), before); assert.deepEqual(await rawProfile(), raw); assert.equal(await revision(), rev);
      assert.equal((await db.select().from(schema.workforceCommits).where(eq(schema.workforceCommits.id, body.id))).length, 0);
      assert.equal((await db.select().from(schema.workforceWriteChecks)).length, 0);
    } finally { await db.run(sql`DROP TRIGGER self_audit_failure`); }
  });
  await t.test("a first profile save creates only that person's private row", async () => {
    await db.delete(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, f.a.id));
    const p = await current(); assert.equal(p.profileVersion, 0);
    await data(await call(saveBody(p, { legalFirstName: "New private row" })));
    assert.equal((await current()).profileVersion, 1);
  });
  await t.test("Owner-issued Employee setup requires an active linked person and cannot enable unlinked system accounts", async () => {
    const [person] = await db.insert(schema.employees).values({ name: "Setup employee", pinHash: "self-setup-unenrolled", email: "setup-contact@example.test" }).returning();
    const created = await data(await access.handle(request("/api/access/accounts", owner, { displayName: "Setup employee", email: "setup-person@example.test", employeeId: person.id, accessLevel: "employee", departmentIds: [] })));
    const grant = await data(await access.handle(request(`/api/access/accounts/${created.account.id}/setup`, owner, { version: created.account.version })));
    assert.equal((await auth.handle(request("/api/auth/setup/inspect", "", { token: grant.token }))).status, 200);
    await db.update(schema.employees).set({ active: false }).where(eq(schema.employees.id, person.id));
    assert.equal((await auth.handle(request("/api/auth/setup", "", { token: grant.token, password }))).status, 401);
    await db.update(schema.employees).set({ active: true }).where(eq(schema.employees.id, person.id));
    const attempts = await Promise.all([auth.handle(request("/api/auth/setup", "", { token: grant.token, password })), auth.handle(request("/api/auth/setup", "", { token: grant.token, password }))]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 401]);
    const signedIn = await login({ email: created.account.email }); assert.equal((await call(undefined, signedIn)).status, 200);
    const unlinked = await data(await access.handle(request("/api/access/accounts", owner, { displayName: "System employee", email: "system-person@example.test", employeeId: null, accessLevel: "employee", departmentIds: [] })));
    assert.equal((await access.handle(request(`/api/access/accounts/${unlinked.account.id}/setup`, owner, { version: unlinked.account.version }))).status, 409);
    const { hashPassword } = await loadServerModule("auth/crypto.ts");
    await db.update(schema.accounts).set({ passwordHash: await hashPassword(password), loginEnabled: true }).where(eq(schema.accounts.id, unlinked.account.id));
    assert.equal((await auth.handle(request("/api/auth/login", "", { email: unlinked.account.email, password }))).status, 401);
  });
  await t.test("an old form cannot save after switching person or replacing the password session, even with matching versions", async () => {
    const before = await current();
    const otherAccount = await data(await access.handle(request("/api/access/accounts", owner, { displayName: "Second self-service person", email: "second-self@example.test", employeeId: f.multi.id, accessLevel: "employee", departmentIds: [] })));
    const setup = await data(await access.handle(request(`/api/access/accounts/${otherAccount.account.id}/setup`, owner, { version: otherAccount.account.version })));
    assert.equal((await auth.handle(request("/api/auth/setup", "", { token: setup.token, password }))).status, 200);
    const otherCookie = await login(otherAccount.account); const otherProfile = await data(await call(undefined, otherCookie));
    const mixed = { ...saveBody(before), employeeVersion: otherProfile.employeeVersion, profileVersion: otherProfile.profileVersion };
    assert.equal((await call(mixed, otherCookie)).status, 409);
    assert.deepEqual(await data(await call(undefined, otherCookie)), otherProfile);
    const freshCookie = await login(f.employeeAccount);
    assert.equal((await call(saveBody(before), freshCookie)).status, 409);
    employee = freshCookie;
  });
  await t.test("disabled, inactive, terminated and unlinked employees lose password access and existing sessions", async () => {
    for (const [table, idColumn, id, invalid, restored] of [
      [schema.accounts, schema.accounts.id, f.employeeAccount.id, { disabledAt: new Date().toISOString() }, { disabledAt: null }],
      [schema.employees, schema.employees.id, f.a.id, { active: false }, { active: true }],
      [schema.employees, schema.employees.id, f.a.id, { terminated: true }, { terminated: false }],
      [schema.accounts, schema.accounts.id, f.employeeAccount.id, { employeeId: null }, { employeeId: f.a.id }],
    ]) {
      employee = await login(f.employeeAccount); const old = employee;
      await db.update(table).set(invalid).where(eq(idColumn, id));
      assert.equal((await call()).status, 401);
      assert.equal((await auth.handle(request("/api/auth/login", "", { email: f.employeeAccount.email, password }))).status, 401);
      await db.update(table).set(restored).where(eq(idColumn, id));
      assert.equal((await call(undefined, old)).status, 401);
    }
    employee = await login(f.employeeAccount);
  });
  await t.test("revocation after authentication still rejects the guarded write", async () => {
    const before = await current();
    const staleAuth = { getSession: async token => {
      const session = await auth.getSession(token);
      await db.update(schema.accounts).set({ sessionVersion: sql`session_version + 1` }).where(eq(schema.accounts.id, f.employeeAccount.id));
      return session;
    } };
    const guarded = createSelfService(db, staleAuth, secret);
    assert.equal((await guarded.handle(request("/api/self/profile", employee, saveBody(before, { phone: "revoked" })))).status, 409);
    employee = await login(f.employeeAccount);
    const after = await current(); assert.deepEqual(after.values, before.values); assert.equal(after.employeeVersion, before.employeeVersion); assert.equal(after.profileVersion, before.profileVersion);
  });
  await t.test("saved profiles survive restart; logout and logout-everywhere revoke password sessions", async () => {
    const before = await current(); await platform.dispose(); ({ db, auth, access, self, workforce } = await connect());
    assert.deepEqual(await current(), before);
    assert.equal((await auth.handle(request("/api/auth/logout", employee, {}))).status, 200); assert.equal((await call()).status, 401);
    employee = await login(f.employeeAccount); const second = await login(f.employeeAccount);
    assert.equal((await auth.handle(request("/api/auth/logout-all", employee, {}))).status, 200);
    assert.equal((await call()).status, 401); assert.equal((await call(undefined, second)).status, 401);
    assert.equal((await db.all(sql`PRAGMA foreign_key_check`)).length, 0);
  });
});
