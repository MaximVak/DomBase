import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("review fixes bound history and block self compensation changes against real isolated D1", { timeout: 180000 }, async t => {
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/review-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createWorkforceService, createTeamService, createTeamInsights, newToken, saveBody, encryptSsn } = await loadServerModule("tests/support/workforce-runtime.ts");
  const db = drizzle(platform.env.DB, { schema }); const password = "Isolated review regression passphrase!";
  const secret = "isolated-review-secret-at-least-32-characters";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  await db.update(schema.accounts).set({ employeeId: f.multi.id }).where(eq(schema.accounts.id, f.generalManager.id));
  for (const accountId of [f.manager.id, f.generalManager.id]) for (const permission of ["wages.manage", "wages.read", "team.manage", "timesheets.manage"]) await db.insert(schema.accountPermissions).values({ accountId, permission, allowed: true });
  await db.insert(schema.employeeProfiles).values({ employeeId: f.managerEmployee.id, ssnEncrypted: encryptSsn("000-98-1234", f.managerEmployee.id, fieldKey) });
  const auth = createAuthService(db, { secret }); const access = createAccessService(db, auth);
  const now = () => Date.parse("2026-11-10T20:00:00Z");
  const workspace = createWorkforceService(db, access, { secret, fieldKey, now });
  const team = createTeamService(db, access, { secret, fieldKey, now });
  const reports = createTeamInsights(db, access, fieldKey, now);
  const origin = "http://localhost:3000";
  const request = (service, path, cookie = "", body) => service.handle(new Request(origin + path, {
    method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const ok = async response => { const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; };
  const login = async email => { const response = await request(auth, "/api/auth/login", "", { email, password }); await ok(response); return response.headers.getSetCookie()[0].split(";")[0]; };
  const owner = await login(f.owner.email), manager = await login(f.manager.email), general = await login(f.generalManager.email);
  const snapshot = (cookie = owner, query = "") => request(workspace, "/api/workspace/state" + query, cookie).then(ok);
  const commit = async (cookie, change, base) => request(workspace, "/api/workspace/commit", cookie, saveBody(base ?? await snapshot(cookie), [change], newToken()));
  const wage = async (cookie, employeeId) => {
    const view = await snapshot(cookie);
    assert.ok(Number.isSafeInteger(view.employeeVersions[employeeId]), `Missing version for ${employeeId}: ${JSON.stringify({ versions: view.employeeVersions, employees: view.state.employees.map(e => ({ id: e.id, name: e.name })) })}`);
    return request(team, "/api/team/commit", cookie, { id: newToken(), revision: view.revision, operation: "wage", data: { employeeId, version: view.employeeVersions[employeeId], roleId: employeeId === f.b.id ? f.roleB.id : f.roleA.id, amountCents: 2500, basis: "hourly", effectiveDate: "2026-11-01", overtimeExempt: false } });
  };
  const card = employeeId => ({ entity: "timecard", id: 880000 + employeeId, before: { events: [] }, after: { employeeId, date: "2026-11-03", eventIds: [], events: [
    { id: 890000 + employeeId * 2, employeeId, type: "in", at: "2026-11-03T17:00:00.000Z", role: employeeId === f.b.id ? f.roleB.name : f.roleA.name },
    { id: 890001 + employeeId * 2, employeeId, type: "out", at: "2026-11-04T01:00:00.000Z", role: employeeId === f.b.id ? f.roleB.name : f.roleA.name },
  ] } });

  await t.test("large historical datasets and more than 2,001 visible punches load completely in a chosen period", async () => {
    await db.run(sql`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 2402)
      INSERT INTO shifts (id, employee_id, role_id, role_name, date, start_time, end_time)
      SELECT 1000000+x, ${f.a.id}, ${f.roleA.id}, ${f.roleA.name}, date('2000-01-01', '+' || x || ' days'), '09:00', '17:00' FROM n`);
    await db.run(sql`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 2402)
      INSERT INTO clock_events (id, employee_id, role_name, event_type, occurred_at)
      SELECT 2000000+x, ${f.a.id}, ${f.roleA.name}, CASE WHEN x % 2 = 1 THEN 'in' ELSE 'out' END, datetime('2005-01-01', '+' || x || ' minutes') FROM n`);
    await db.run(sql`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 2402)
      INSERT INTO clock_events (id, employee_id, role_name, event_type, occurred_at)
      SELECT 3000000+x, ${f.a.id}, ${f.roleA.name}, CASE WHEN x % 2 = 1 THEN 'in' ELSE 'out' END, datetime('2026-11-01', '+' || x || ' minutes') FROM n`);
    const current = await snapshot(owner, "?start=2026-11-01&end=2026-11-03");
    assert.deepEqual(current.period, { start: "2026-11-01", end: "2026-11-03" });
    assert.equal(current.state.clockEvents.filter(e => e.id > 3000000).length, 2402);
    assert.equal(current.state.clockEvents.some(e => e.at.startsWith("2005")), false);
    assert.equal(current.state.shifts.some(s => s.date.startsWith("200")), false);
    const historical = await snapshot(owner, "?start=2000-01-01&end=2000-12-31"); assert.equal(historical.state.shifts.length, 365);
    assert.equal((await snapshot(owner)).state.clockEvents.filter(e => e.id > 3000000).length, 2402);
    for (const query of ["?start=2026-11-03&end=2026-11-01", "?start=2000-01-01&end=2026-11-01", "?start=2026-02-30&end=2026-03-02", "?start=2026-11-01"]) assert.equal((await request(workspace, "/api/workspace/state" + query, owner)).status, 400);
    const scoped = await snapshot(manager, "?start=2026-10-01&end=2026-11-30");
    assert.equal(scoped.state.shifts.some(s => s.employeeId === f.b.id), false);
    const report = await ok(await request(reports, "/api/team/insights?start=2026-11-01&end=2026-11-03", owner)); assert.equal(report.start, "2026-11-01");
    const base = await snapshot(owner, "?start=2026-11-01&end=2026-11-03");
    const before = base.state.employees.find(e => e.id === f.a.id);
    const saved = await ok(await commit(owner, { entity: "employee", id: before.id, before, after: { ...before, phone: "555-0100" } }, base));
    assert.deepEqual(saved.period, base.period); assert.equal(saved.state.clockEvents.filter(e => e.id > 3000000).length, 2402);
  });
  await t.test("overnight immutable punches and corrections are retained at the selected range boundary", async () => {
    await db.insert(schema.clockEvents).values([
      { id: 810001, employeeId: f.multi.id, eventType: "in", roleName: f.roleA.name, occurredAt: "2026-10-31T23:00:00.000Z" },
      { id: 810002, employeeId: f.multi.id, eventType: "out", roleName: f.roleA.name, occurredAt: "2026-11-01T09:00:00.000Z" },
    ]);
    const boundary = await snapshot(owner, "?start=2026-11-01&end=2026-11-01");
    assert.equal(boundary.state.clockEvents.filter(e => [810001, 810002].includes(e.id)).length, 2);
    await ok(await commit(owner, card(f.b.id), await snapshot(owner, "?start=2026-11-03&end=2026-11-03")));
    const corrected = await snapshot(owner, "?start=2026-11-03&end=2026-11-03");
    assert.equal(corrected.state.clockEvents.filter(e => e.employeeId === f.b.id).length, 2);
    assert.equal(corrected.state.timeCardEdits.some(e => e.employeeId === f.b.id && e.date === "2026-11-03"), true);
    assert.equal((await snapshot(owner, "?start=2025-11-01&end=2025-11-01")).state.timeCardEdits.some(e => e.employeeId === f.b.id), false);
  });
  await t.test("an older open session carries only its work and break state into the window", async () => {
    await db.insert(schema.clockEvents).values([
      { id: 820001, employeeId: f.managerEmployee.id, eventType: "in", roleName: f.roleA.name, occurredAt: "2026-10-01T16:00:00.000Z" },
      { id: 820002, employeeId: f.managerEmployee.id, eventType: "break", roleName: f.roleA.name, occurredAt: "2026-10-01T20:00:00.000Z" },
      { id: 820003, employeeId: f.managerEmployee.id, eventType: "break_end", roleName: f.roleA.name, occurredAt: "2026-10-01T20:30:00.000Z" },
      { id: 820004, employeeId: f.managerEmployee.id, eventType: "break", roleName: f.roleA.name, occurredAt: "2026-10-02T20:00:00.000Z" },
    ]);
    const view = await snapshot(manager, "?start=2026-11-03&end=2026-11-03");
    assert.deepEqual(view.state.clockEvents.filter(e => e.employeeId === f.managerEmployee.id).map(e => e.id), [820001, 820004]);
    await db.insert(schema.clockEvents).values({ id: 820005, employeeId: f.managerEmployee.id, eventType: "out", roleName: f.roleA.name, occurredAt: "2026-10-03T20:00:00.000Z" });
    assert.equal((await snapshot(manager, "?start=2026-11-03&end=2026-11-03")).state.clockEvents.some(e => e.employeeId === f.managerEmployee.id), false);
  });
  await t.test("Owner, private-profile and linked-self projections never expose a complete SSN", async () => {
    for (const cookie of [owner, manager, general]) {
      const view = await snapshot(cookie); const body = JSON.stringify(view);
      assert.equal(body.includes("000-12-3456"), false); assert.equal(body.includes("000-98-1234"), false);
    }
    const own = (await snapshot(manager)).state.employees.find(e => e.id === f.managerEmployee.id);
    assert.equal(own.socialSecurityNumber, "•••-••-1234");
    const before = (await snapshot(owner)).state.employees.find(e => e.id === f.a.id);
    const forged = await commit(owner, { entity: "employee", id: before.id, before, after: { ...before, socialSecurityNumber: "•••-••-9999" } });
    assert.equal(forged.status, 400);
  });
  await t.test("Manager and General Manager self edits fail in both wage APIs, corrections and adjustments without writes", async () => {
    for (const [cookie, employeeId] of [[manager, f.managerEmployee.id], [general, f.multi.id]]) {
      const initial = await snapshot(cookie);
      const [countsBefore] = await db.all(sql`SELECT (SELECT COUNT(*) FROM wage_rates) AS wages, (SELECT COUNT(*) FROM time_card_edits) AS edits, (SELECT COUNT(*) FROM hours_adjustments) AS adjustments, (SELECT COUNT(*) FROM audit_log) AS audits`);
      const deniedWage = await wage(cookie, employeeId); assert.equal(deniedWage.status, 403, `${employeeId}: ${JSON.stringify(await deniedWage.json())}`);
      const before = initial.state.employees.find(e => e.id === employeeId);
      assert.equal((await commit(cookie, { entity: "employee", id: employeeId, before, after: { ...before, wage: "$99.00/hr" } })).status, 403);
      assert.equal((await commit(cookie, card(employeeId))).status, 403);
      assert.equal((await commit(cookie, { entity: "hours-adjustment", id: 900000 + employeeId, before: null, after: { id: 900000 + employeeId, employeeId, date: "2026-11-03", hours: 2 } })).status, 403);
      assert.equal((await snapshot(cookie)).revision, initial.revision);
      const [countsAfter] = await db.all(sql`SELECT (SELECT COUNT(*) FROM wage_rates) AS wages, (SELECT COUNT(*) FROM time_card_edits) AS edits, (SELECT COUNT(*) FROM hours_adjustments) AS adjustments, (SELECT COUNT(*) FROM audit_log) AS audits`);
      assert.deepEqual(countsAfter, countsBefore);
    }
    await ok(await wage(owner, f.b.id));
    const before = (await snapshot(owner)).state.employees.find(e => e.id === f.b.id);
    await ok(await commit(owner, { entity: "employee", id: before.id, before, after: { ...before, wage: "$27.00/hr" } }));
    await ok(await commit(owner, { entity: "hours-adjustment", id: 900010, before: null, after: { id: 900010, employeeId: f.b.id, date: "2026-11-03", hours: 1 } }));
    await ok(await wage(manager, f.a.id));
    await ok(await commit(manager, card(f.a.id)));
  });
});
