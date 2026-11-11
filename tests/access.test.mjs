import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedAccessFixture } from "./support/access-fixture.mjs";

const password = "Isolated authorization test passphrase!";

test("authorization defaults deny sensitive access and ignore unknown grants", async () => {
  const { permissionsFor } = await loadServerModule("access/policy.ts");
  const manager = permissionsFor("manager", [{ permission: "owner", allowed: true }]);
  assert.equal(manager["team.read"], true);
  assert.equal(manager["wages.read"], false);
  assert.equal(manager["team.private.read"], false);
  assert.equal(manager["documents.read"], false);
  assert.equal(manager.owner, undefined);
  assert.ok(Object.values(permissionsFor("owner", [{ permission: "wages.read", allowed: false }])).every(Boolean));
  assert.ok(Object.values(permissionsFor("employee", [{ permission: "wages.read", allowed: true }])).every(value => !value));
  assert.ok(Object.values(permissionsFor("unexpected-role", [{ permission: "wages.read", allowed: true }])).every(value => !value));
});

test("server permissions protect records, fields, writes and account grants in real D1", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/access-check-"));
  const { getPlatformProxy } = await import("wrangler");
  let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService } = await loadServerModule("auth/service.ts");
  const { createAccessService } = await loadServerModule("access/service.ts");
  const connect = async () => {
    platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
    const db = drizzle(platform.env.DB, { schema });
    const auth = createAuthService(db, { secret: "isolated-access-test-secret-at-least-32-characters" });
    return { db, auth, access: createAccessService(db, auth) };
  };
  let { db, auth, access } = await connect();
  const f = await seedAccessFixture(db, schema, loadServerModule, password);
  const origin = "http://localhost:3000";
  function request(path, cookie = "", body, headers = {}) {
    return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, ...(body !== undefined ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const call = (path, cookie = "", body, headers) => access.handle(request(path, cookie, body, headers));
  const login = async account => {
    const response = await auth.handle(request("/api/auth/login", "", { email: account.email, password }));
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const data = async response => { assert.equal(response.status, 200); return response.json(); };
  let managerCookie = await login(f.manager);
  const ownerCookie = await login(f.owner);
  const secondOwnerCookie = await login(f.secondOwner);
  const gmCookie = await login(f.generalManager);
  const unassignedCookie = await login(f.unassigned);
  const target = async () => data(await call(`/api/access/accounts/${f.manager.id}`, ownerCookie));
  const save = async (permissions, departments = [f.deptA.id], version) => call(`/api/access/accounts/${f.manager.id}`, ownerCookie,
    { version: version ?? (await target()).account.version, permissions, departmentIds: departments });
  const auditCount = async action => (await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action))).length;

  await t.test("only dashboard sessions enter: anonymous, employee, legacy PIN and device contexts fail", async () => {
    for (const cookie of ["", "dombase-session=0000", `dombase-session=${f.employeeToken}`, `dombase-session=${f.deviceToken}`, `dombase-session=${f.legacyToken}`, `device-session=${f.deviceToken}`]) {
      assert.equal((await call("/api/workforce/employees", cookie)).status, 401);
      assert.equal((await call("/api/access/accounts", cookie)).status, 401);
    }
    const selfLogin = await auth.handle(request("/api/auth/login", "", { email: f.employeeAccount.email, password }));
    assert.equal(selfLogin.status, 200);
    assert.equal((await call("/api/access/accounts", selfLogin.headers.get("set-cookie").split(";")[0])).status, 401);
    const mine = await data(await call("/api/access/me", managerCookie, undefined, { "X-Role": "owner", "X-Employee-Id": String(f.b.id) }));
    assert.equal(mine.account.id, 1);
    assert.equal(mine.account.accessLevel, "manager");
    assert.equal(mine.canManageAccess, false);
    assert.equal(mine.allDepartments, false);
  });

  await t.test("both independent Owners have full control; GM and manager cannot grant access", async () => {
    for (const cookie of [ownerCookie, secondOwnerCookie]) {
      const mine = await data(await call("/api/access/me", cookie));
      assert.ok(Object.values(mine.permissions).every(Boolean));
      assert.equal((await call("/api/access/accounts", cookie)).status, 200);
    }
    for (const cookie of [managerCookie, gmCookie]) {
      assert.equal((await call("/api/access/accounts", cookie)).status, 403);
      assert.equal((await call(`/api/access/accounts/${f.manager.id}`, cookie, { version: 1, permissions: { "wages.read": true }, departmentIds: [f.deptB.id] })).status, 403);
    }
  });

  await t.test("department scope covers list, guessed IDs, schedules, time cards and leave", async () => {
    const { employees } = await data(await call(`/api/workforce/employees?employeeId=${f.b.id}&role=owner`, managerCookie));
    assert.deepEqual(employees.map(row => row.id), [f.a.id, f.managerEmployee.id, f.multi.id]);
    assert.equal((await call(`/api/workforce/employees/${f.b.id}`, managerCookie)).status, 404);
    assert.equal((await call(`/api/workforce/employees/999999`, managerCookie)).status, 404);
    assert.deepEqual((await data(await call("/api/workforce/employees", unassignedCookie))).employees, []);
    assert.equal((await call(`/api/workforce/employees/${f.a.id}`, unassignedCookie)).status, 404);
    assert.equal((await data(await call("/api/workforce/employees", gmCookie))).employees.length, 4);
    assert.equal((await data(await call("/api/workforce/employees", ownerCookie))).employees.length, 4);
    const shifts = (await data(await call("/api/workforce/shifts", managerCookie))).shifts;
    assert.deepEqual(shifts.map(row => row.employeeId), [f.a.id]);
    assert.equal("notes" in shifts[0], false);
    assert.deepEqual((await data(await call("/api/workforce/time-cards", managerCookie))).timeCards.map(row => row.employeeId), [f.a.id]);
    const requests = (await data(await call("/api/workforce/time-off", managerCookie))).requests;
    assert.deepEqual(requests.map(row => row.employeeId), [f.a.id]);
    assert.equal("explanation" in requests[0], false);
  });

  await t.test("field projections never leak credential, wage, private-profile or storage-key data", async () => {
    const { employee } = await data(await call(`/api/workforce/employees/${f.a.id}`, managerCookie));
    assert.deepEqual(Object.keys(employee).sort(), ["active", "id", "name", "terminated", "version"]);
    for (const section of ["wages", "profile", "notes", "files"]) assert.equal((await call(`/api/workforce/employees/${f.a.id}/${section}`, managerCookie)).status, 403);
    const profile = await data(await call(`/api/workforce/employees/${f.a.id}/profile`, ownerCookie));
    assert.equal(profile.profile.homeAddress, "Private address");
    assert.equal("ssnEncrypted" in profile.profile, false);
    const files = await data(await call(`/api/workforce/employees/${f.a.id}/files`, ownerCookie));
    assert.equal(files.files[0].fileName, "private-certificate.pdf");
    const account = await target();
    const serialized = JSON.stringify({ profile, files, account, employee });
    assert.doesNotMatch(serialized, /passwordHash|tokenHash|pinHash|pinLookup|ssnEncrypted|objectKey|accessRevision|never-return/);
  });

  await t.test("conversation membership and notification ownership apply even to Owners", async () => {
    const messages = (await data(await call(`/api/workforce/conversations/${f.conversationA.id}/messages`, managerCookie))).messages;
    assert.equal(messages[0].body, "Local member message");
    assert.equal((await call(`/api/workforce/conversations/${f.conversationB.id}/messages?employeeId=${f.b.id}`, managerCookie)).status, 404);
    assert.equal((await call(`/api/workforce/conversations/${f.conversationA.id}/messages`, ownerCookie)).status, 404);
    assert.equal((await call(`/api/workforce/conversations/${f.conversationA.id}/messages`, secondOwnerCookie)).status, 404);
    await db.update(schema.conversationMembers).set({ leftAt: new Date().toISOString() }).where(and(eq(schema.conversationMembers.conversationId, f.conversationA.id), eq(schema.conversationMembers.employeeId, f.managerEmployee.id)));
    assert.equal((await call(`/api/workforce/conversations/${f.conversationA.id}/messages`, managerCookie)).status, 404);
    await db.update(schema.conversationMembers).set({ leftAt: null }).where(eq(schema.conversationMembers.employeeId, f.managerEmployee.id));
    const notifications = (await data(await call(`/api/workforce/notifications?employeeId=${f.b.id}`, managerCookie))).notifications;
    assert.deepEqual(notifications.map(row => row.id), ["manager-notice"]);
    assert.deepEqual((await data(await call("/api/workforce/notifications", secondOwnerCookie))).notifications, []);
  });

  await t.test("permission writes reject forged roles, unknown grants, invalid departments and cross-origin requests", async () => {
    const original = await target();
    const base = { version: original.account.version, permissions: {}, departmentIds: [f.deptA.id] };
    for (const bad of [{ ...base, accessLevel: "owner" }, { ...base, employeeId: f.b.id },
      { ...base, permissions: { "accounts.manage": true } }, { ...base, permissions: { "wages.read": "true" } },
      { ...base, departmentIds: [9999] }, { ...base, departmentIds: [f.deptA.id, f.deptA.id] }]) {
      assert.equal((await call(`/api/access/accounts/${f.manager.id}`, ownerCookie, bad)).status, 400);
    }
    assert.equal((await call(`/api/access/accounts/${f.manager.id}`, ownerCookie, base, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await call(`/api/access/accounts/${f.owner.id}`, ownerCookie, base)).status, 403);
    assert.equal((await target()).account.version, original.account.version);
    assert.equal(await auditCount("account.access_changed"), 0);
  });

  await t.test("saved grants revoke every old session and expose only permitted fields/department wage rates", async () => {
    const secondManagerCookie = await login(f.manager);
    const before = (await target()).account.version;
    const updated = await data(await save({ "wages.read": true, "team.contact.read": true, "documents.read": true, "schedule.notes.read": true }));
    assert.equal(updated.account.version, before + 1);
    for (const cookie of [managerCookie, secondManagerCookie]) assert.equal((await call("/api/access/me", cookie)).status, 401);
    managerCookie = await login(f.manager);
    assert.equal((await data(await call(`/api/workforce/employees/${f.a.id}`, managerCookie))).employee.email, "a@example.test");
    const ownWages = (await data(await call(`/api/workforce/employees/${f.a.id}/wages`, managerCookie))).wages;
    assert.deepEqual(ownWages.map(row => row.amountCents), [2200]);
    assert.deepEqual((await data(await call(`/api/workforce/employees/${f.multi.id}/wages`, managerCookie))).wages.map(row => row.amountCents), [2300]);
    assert.equal((await call(`/api/workforce/employees/${f.b.id}/wages`, managerCookie)).status, 404);
    assert.equal((await data(await call(`/api/workforce/employees/${f.a.id}/files`, managerCookie))).files[0].objectKey, undefined);
    assert.equal((await data(await call("/api/workforce/shifts", managerCookie))).shifts[0].notes, "Private shift A");
    assert.equal((await call(`/api/workforce/employees/${f.a.id}/profile`, managerCookie)).status, 403);
  });

  await t.test("direct writes require grants, version, scope and field allowlists; actor/audit are server-owned", async () => {
    const path = `/api/workforce/employees/${f.a.id}/contact`;
    const contact = { version: 1, email: "changed@example.test", phone: "555-0101" };
    assert.equal((await call(path, managerCookie, contact)).status, 403);
    await data(await save({ "team.manage": true }));
    managerCookie = await login(f.manager);
    assert.equal((await call(path, managerCookie, { ...contact, accessLevel: "owner" })).status, 400);
    assert.equal((await call(path, managerCookie, { ...contact, actorAccountId: f.owner.id })).status, 400);
    assert.equal((await call(path, managerCookie, contact, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await call(`/api/workforce/employees/${f.b.id}/contact`, managerCookie, contact)).status, 404);
    assert.equal((await call(path, managerCookie, contact)).status, 200);
    assert.equal((await call(path, managerCookie, contact)).status, 409);
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, f.a.id));
    assert.equal(employee.email, contact.email);
    assert.equal(employee.version, 2);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "employee.contact_changed"));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorAccountId, f.manager.id);
    assert.equal(JSON.stringify(audit).includes(contact.email), false);
  });

  await t.test("concurrent access saves have one winner with matching grants, departments and audit", async () => {
    const version = (await target()).account.version;
    const beforeCount = await auditCount("account.access_changed");
    const bodies = [
      { version, permissions: { "wages.read": true }, departmentIds: [f.deptA.id] },
      { version, permissions: { "wages.read": false, "team.private.read": true }, departmentIds: [f.deptB.id] },
    ];
    const responses = await Promise.all(bodies.map(body => call(`/api/access/accounts/${f.manager.id}`, ownerCookie, body)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = bodies[responses.findIndex(response => response.status === 200)];
    const actual = await target();
    assert.deepEqual(actual.departmentIds, winner.departmentIds);
    assert.equal(actual.permissions["wages.read"], winner.permissions["wages.read"]);
    assert.equal(actual.permissions["team.private.read"], winner.permissions["team.private.read"] ?? false);
    assert.equal(actual.account.version, version + 1);
    assert.equal(await auditCount("account.access_changed"), beforeCount + 1);
  });

  await t.test("a failed audit rolls back access, department, session and contact changes together", async () => {
    await data(await save({ "team.manage": true }));
    managerCookie = await login(f.manager);
    const before = await target();
    const audits = await auditCount("account.access_changed");
    await db.run(sql`CREATE TRIGGER access_fixture_fail BEFORE INSERT ON audit_log WHEN NEW.action = 'account.access_changed'
      BEGIN SELECT RAISE(ABORT, 'isolated forced audit failure'); END`);
    try {
      const response = await save({ "wages.read": true }, [f.deptB.id]);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /SQL|TRIGGER|audit failure|token/i);
    } finally { await db.run(sql`DROP TRIGGER access_fixture_fail`); }
    assert.deepEqual(await target(), before);
    assert.equal(await auditCount("account.access_changed"), audits);
    assert.equal((await call("/api/access/me", managerCookie)).status, 200);
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, f.a.id));
    await db.run(sql`CREATE TRIGGER contact_fixture_fail BEFORE INSERT ON audit_log WHEN NEW.action = 'employee.contact_changed'
      BEGIN SELECT RAISE(ABORT, 'isolated forced contact failure'); END`);
    try {
      assert.equal((await call(`/api/workforce/employees/${f.a.id}/contact`, managerCookie,
        { version: employee.version, email: "rollback@example.test", phone: "555-0199" })).status, 503);
    } finally { await db.run(sql`DROP TRIGGER contact_fixture_fail`); }
    const [unchanged] = await db.select().from(schema.employees).where(eq(schema.employees.id, f.a.id));
    assert.equal(unchanged.email, employee.email);
    assert.equal(unchanged.version, employee.version);
    const guard = await access.authorize(request("/api/workforce/employees", managerCookie), "team.manage");
    await data(await save({ "team.manage": false }));
    const late = await db.update(schema.employees).set({ email: "must-not-write@example.test" })
      .where(and(eq(schema.employees.id, f.a.id), guard.activeActor()));
    assert.equal(late.meta.changes, 0);
  });

  await t.test("removing all assignments fails closed and grants survive a local runtime restart", async () => {
    await data(await save({ "wages.read": true }, []));
    managerCookie = await login(f.manager);
    assert.deepEqual((await data(await call("/api/workforce/employees", managerCookie))).employees, []);
    assert.deepEqual((await data(await call("/api/workforce/shifts", managerCookie))).shifts, []);
    await assert.rejects(access.authorize(request("/api/workforce/employees", managerCookie), "unknown.permission"), error => error.status === 403);
    await assert.rejects(access.authorize(request("/api/workforce/employees", managerCookie), "exports.timesheets"), error => error.status === 403);
    await platform.dispose();
    ({ db, auth, access } = await connect());
    assert.equal((await target()).permissions["wages.read"], true);
    assert.deepEqual((await target()).departmentIds, []);
    assert.equal((await call("/api/access/me", managerCookie)).status, 200);
    await db.update(schema.accounts).set({ disabledAt: new Date().toISOString() }).where(eq(schema.accounts.id, f.manager.id));
    assert.equal((await call("/api/workforce/employees", managerCookie)).status, 401);
  });
});
