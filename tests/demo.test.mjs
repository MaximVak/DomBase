import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";

async function fixture(t) {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const state = await mkdtemp(join(projectRoot, ".wrangler/demo-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], state); const { getPlatformProxy } = await import("wrangler");
  const schema = await loadServerModule("db/schema.ts");
  const open = async () => { platform = await getPlatformProxy({ configPath, persist: { path: join(state, "v3") }, remoteBindings: false, envFiles: [] }); return drizzle(platform.env.DB, { schema }); };
  return { db: await open(), schema, reopen: async () => { await platform.dispose(); return open(); } };
}
const { demoDataset, demoWeek, seedDemo, demoKey } = await loadServerModule("demo/seed.ts");
const weekStart = "2026-11-02";

test("local demo command rejects remote and configuration overrides before opening a database", () => {
  for (const args of [["--remote"], ["--config", "wrangler.staging.jsonc"], ["--week", weekStart, "--remote"]]) {
    const result = spawnSync(process.execPath, [join(projectRoot, "scripts/demo-local.mjs"), ...args], { encoding: "utf8", cwd: projectRoot });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /overrides are not allowed/);
  }
});

test("demo seed creates a published, fictional workforce and preserves later edits", { timeout: 120000 }, async t => {
  const f = await fixture(t); let db = f.db; const s = f.schema;
  await t.test("ten employees, three job roles, two departments and fifty relational shifts", async () => {
    assert.equal(demoWeek(new Date("2026-11-03T01:00:00Z")), weekStart);
    const result = await seedDemo(db, { weekStart });
    assert.deepEqual(result, { created: true, weekStart, weekEnd: "2026-11-08", employees: 10, jobRoles: 3, departments: 2, shifts: 50 });
    const data = demoDataset(weekStart); const rows = await db.select().from(s.shifts);
    assert.equal(new Set(rows.map(row => row.date)).size, 7);
    assert.ok(data.employees.every(employee => rows.filter(row => row.employeeId === employee.id).length === 5));
    assert.ok(rows.every(row => data.roles.some(role => role.id === row.roleId) && row.publicationId === data.publicationId));
    const employees = await db.select().from(s.employees); assert.ok(employees.every(row => row.name.startsWith("Demo ") && row.email.endsWith("@example.test") && row.pinLookup === null && row.pinHash.startsWith("demo-unenrolled:")));
    const accounts = await db.select().from(s.accounts); assert.equal(accounts.length, 1); assert.equal(accounts[0].loginEnabled, false); assert.equal(accounts[0].passwordHash, null); assert.ok(accounts[0].disabledAt); assert.equal(accounts[0].accessLevel, "employee");
    assert.equal((await db.select().from(s.clockEvents)).length, 0); assert.equal((await db.select().from(s.files)).length, 0);
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
  await t.test("an independent password-authenticated Owner sees the demo through the real workspace API", async () => {
    const { createAuthService, issueSetupToken } = await loadServerModule("auth/service.ts");
    const { createAccessService } = await loadServerModule("access/service.ts"); const { createWorkforceService } = await loadServerModule("workforce/service.ts");
    const grant = await issueSetupToken(db, { email: "demo-verification@example.test", displayName: "Demo verification", accessLevel: "owner" });
    const secret = "local-demo-verification-secret-at-least-32-characters"; const auth = createAuthService(db, { secret });
    const request = (path, body, cookie = "") => new Request("http://localhost:3000" + path, { method: body ? "POST" : "GET", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const password = "Only an isolated demo verification passphrase!";
    assert.equal((await auth.handle(request("/api/auth/setup", { token: grant.token, password }))).status, 200);
    const login = await auth.handle(request("/api/auth/login", { email: grant.email, password })); assert.equal(login.status, 200);
    const service = createWorkforceService(db, createAccessService(db, auth), { secret, fieldKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const response = await service.handle(request("/api/workspace/state", undefined, login.headers.get("set-cookie").split(";")[0])); assert.equal(response.status, 200);
    const view = await response.json(); assert.equal(view.state.employees.length, 10); assert.equal(view.state.departments.length, 2); assert.equal(view.state.departments.flatMap(row => row.roles).length, 3); assert.equal(view.state.shifts.length, 50); assert.equal(view.state.scheduleHasBeenPublished, true); assert.equal(view.primaryOwnerEmployeeId, null);
    assert.ok(view.state.employees.every(row => row.pin === "" && row.socialSecurityNumber === "" && row.wage));
  });
  await t.test("repeating a seed preserves phone, shift and company edits without duplicate audit or publication", async () => {
    await db.update(s.employees).set({ phone: "202-555-0199" }).where(eq(s.employees.id, 900001));
    await db.update(s.shifts).set({ endTime: "16:00" }).where(eq(s.shifts.id, 905001));
    await db.update(s.business).set({ locationName: "Edited demo location" }).where(eq(s.business.id, 1));
    const before = await db.select().from(s.workforceState); assert.equal((await seedDemo(db)).created, false);
    assert.equal((await db.select().from(s.employees).where(eq(s.employees.id, 900001)))[0].phone, "202-555-0199"); assert.equal((await db.select().from(s.shifts).where(eq(s.shifts.id, 905001)))[0].endTime, "16:00");
    assert.equal((await db.select().from(s.business))[0].locationName, "Edited demo location"); assert.deepEqual(await db.select().from(s.workforceState), before);
    assert.equal((await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, demoKey))).length, 1); assert.equal((await db.select().from(s.schedulePublications)).length, 1);
  });
  await t.test("changing weeks and invalid dates cannot reset an existing demo", async () => {
    for (const invalid of ["2026-11-03", "2026-02-30", "", "not-a-date"]) assert.throws(() => demoDataset(invalid), /valid Monday/);
    await assert.rejects(seedDemo(db, { weekStart: "2026-11-09" }), /different week/); assert.equal((await db.select().from(s.shifts)).length, 50);
  });
  await t.test("a new runtime retains demo records and edits", async () => {
    db = await f.reopen(); assert.equal((await seedDemo(db)).created, false); assert.equal((await db.select().from(s.employees)).length, 10); assert.equal((await db.select().from(s.employees).where(eq(s.employees.id, 900001)))[0].phone, "202-555-0199"); assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
});

test("demo seed refuses existing workforce data without modifying it", { timeout: 120000 }, async t => {
  const { db, schema: s } = await fixture(t);
  await db.insert(s.employees).values({ name: "Existing local record", pinHash: "test-unenrolled" });
  await assert.rejects(seedDemo(db, { weekStart }), /will not overwrite/);
  assert.equal((await db.select().from(s.employees)).length, 1); assert.equal((await db.select().from(s.departments)).length, 0); assert.equal((await db.select().from(s.accounts)).length, 0); assert.equal((await db.select().from(s.auditLog)).length, 0);
});

test("a failed demo audit rolls back the entire seed and simultaneous retries create one dataset", { timeout: 120000 }, async t => {
  const { db, schema: s } = await fixture(t);
  await db.run(sql`CREATE TRIGGER reject_demo_seed BEFORE INSERT ON audit_log WHEN NEW.action = 'demo.seeded' BEGIN SELECT RAISE(ABORT, 'isolated seed rollback'); END`);
  await assert.rejects(seedDemo(db, { weekStart }));
  for (const table of [s.accounts, s.business, s.locationSettings, s.departments, s.roles, s.employees, s.employeeRoles, s.wageRates, s.shifts, s.schedulePublications, s.workforceWriteChecks]) assert.equal((await db.select().from(table)).length, 0);
  assert.equal((await db.select().from(s.workforceState))[0].revision, 0);
  await db.run(sql`DROP TRIGGER reject_demo_seed`);
  const results = await Promise.all([seedDemo(db, { weekStart }), seedDemo(db, { weekStart })]); assert.deepEqual(results.map(result => result.created).sort(), [false, true]); assert.equal((await db.select().from(s.employees)).length, 10); assert.equal((await db.select().from(s.shifts)).length, 50); assert.equal((await db.select().from(s.auditLog)).length, 1); assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
});
