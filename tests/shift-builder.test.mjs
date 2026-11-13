import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("shift builder persists split shifts, colors, days off, moves and past edits with server safeguards", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/shift-builder-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const s = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createWorkforceService, createSelfService, newToken, saveBody } = await loadServerModule("tests/support/workforce-runtime.ts");
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const db = drizzle(platform.env.DB, { schema: s }), secret = "isolated-shift-builder-test-secret-at-least-32-characters";
  const auth = createAuthService(db, { secret }), access = createAccessService(db, auth);
  const workspace = createWorkforceService(db, access, { secret, fieldKey });
  const self = createSelfService(db, auth, secret), password = "Fictional shift builder test passphrase!";
  const f = await seedWorkforceFixture(db, s, loadServerModule, password), origin = "http://localhost:3000";
  const request = (path, cookie = "", body) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = async response => { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const login = async account => { const r = await auth.handle(request("/api/auth/login", "", { email: account.email, password })); await ok(r); return r.headers.get("set-cookie").split(";")[0]; };
  const owner = await login(f.owner), manager = await login(f.manager), employee = await login(f.employeeAccount);
  const call = (action, cookie = owner, body) => workspace.handle(request("/api/workspace/" + action, cookie, body));
  const snapshot = (cookie = owner) => call("state", cookie).then(ok);
  const draft = async (upserts, deleted = [], cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-draft", id: 1, before: view.state.scheduleDraftsByManager[key] ?? null,
      after: { upsertedShifts: upserts, deletedShiftIds: deleted, affectedEmployeeIds: upserts.map(s => s.employeeId) } }], newToken()));
  };
  const publish = async (cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[key], after: { publish: true } }], newToken()));
  };
  const shift = (id, patch = {}) => ({ id, employeeId: f.a.id, date: "2026-11-09", start: "09:00", end: "12:00", role: f.roleA.name, station: "Floor", notes: "", shiftType: "work", color: "green", ...patch });
  await t.test("split shifts and colors survive draft/publication; overlap and day-off collisions are refused", async () => {
    await ok(await draft([shift(81001), shift(81002, { start: "13:00", end: "17:00", color: "amber" })]));
    assert.equal((await ok(await self.handle(request("/api/self/schedule?date=2026-11-09", employee)))).shifts.length, 0);
    await ok(await publish());
    const rows = (await snapshot()).state.shifts.filter(s => s.date === "2026-11-09");
    assert.equal(rows.length, 2); assert.deepEqual(rows.map(s => s.color), ["green", "amber"]);
    assert.equal((await draft([shift(81003, { start: "11:00", end: "14:00" })])).status, 409);
    assert.equal((await draft([shift(81003, { shiftType: "day_off", start: "00:00", end: "00:00" })])).status, 409);
    assert.equal((await draft([shift(81003, { date: "2026-11-11", color: "forged" })])).status, 400);
  });
  await t.test("past edits and reassignment change only the plan, retain punch bytes and append attributed before/after audit", async () => {
    await db.insert(s.clockEvents).values({ employeeId: f.a.id, eventType: "in", occurredAt: "2026-11-09T17:00:00Z", shiftId: 81001, roleName: f.roleA.name, source: "system" });
    const raw = await db.select().from(s.clockEvents);
    const first = (await snapshot()).state.shifts.find(s => s.id === 81001);
    await ok(await draft([{ ...first, start: "08:30", color: "red" }])); await ok(await publish());
    await ok(await draft([{ ...first, employeeId: f.multi.id, date: "2026-11-10", color: "violet" }])); await ok(await publish());
    assert.deepEqual(await db.select().from(s.clockEvents), raw);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "schedule.shift_changed"));
    assert.ok(audit.some(a => a.actorAccountId === f.owner.id && a.metadata.before?.color === "green" && a.metadata.after?.color === "red"));
    assert.doesNotMatch(JSON.stringify(audit), /notes|password|pinHash/);
    const moved = (await snapshot()).state.shifts.find(s => s.id === 81001);
    await ok(await draft([{ ...moved, id: 81004, date: "2026-11-11" }])); await ok(await publish());
    assert.equal((await snapshot()).state.shifts.find(s => s.id === 81004).color, "violet");
  });
  await t.test("day off is visible to the employee but has no scheduled hours, attendance score or clock eligibility", async () => {
    const off = shift(81005, { date: "2026-11-12", shiftType: "day_off", start: "00:00", end: "00:00", color: "gray" });
    assert.equal((await draft([{ ...off, start: "09:00" }])).status, 400);
    await ok(await draft([off])); await ok(await publish());
    const own = await ok(await self.handle(request("/api/self/schedule?date=2026-11-12", employee)));
    assert.equal(own.shifts.find(s => s.id === off.id).shiftType, "day_off");
    const { buildTimeCards } = await loadServerModule("app/timesheets-model.ts");
    const cards = buildTimeCards({ employees: [{ ...f.a, role: f.roleA.name, wage: "" }], events: [], shifts: [off], adjustments: [], pto: [], start: off.date, end: off.date, now: Date.parse("2026-11-20T00:00Z"), rounding: "actual", weekStart: 1, mandatoryMealBreak: true, mealBreakAfterHours: 5 });
    assert.equal(cards.reduce((sum, c) => sum + (c.metrics.scheduled ?? 0), 0), 0);
    const { reliabilityFor } = await loadServerModule("team/insights-rules.ts");
    assert.deepEqual(reliabilityFor({ employees: [f.a], shifts: [off], clockEvents: [], ptoRequests: [] }, off.date, off.date, Date.now(), { lateMinutes: 1, mandatoryMealBreak: true, mealBreakAfterHours: 5 }), []);
  });
  await t.test("frequent suggestions use scoped past work, not drafts/day-off entries/another employee's data", async () => {
    const suggestions = await ok(await call(`frequent-shifts?employeeId=${f.a.id}&date=2026-11-15`, manager));
    assert.ok(suggestions.suggestions.some(s => s.start === "13:00" && s.color === "amber"));
    assert.ok(suggestions.suggestions.every(s => s.start !== "00:00"));
    assert.doesNotMatch(JSON.stringify(suggestions), /notes|employeeId|Private/);
    assert.equal((await call(`frequent-shifts?employeeId=${f.b.id}&date=2026-11-15`, manager)).status, 404);
    assert.equal((await call(`frequent-shifts?employeeId=${f.a.id}&date=2026-11-15`, employee)).status, 401);
    assert.equal((await draft([shift(81006, { employeeId: f.b.id, role: f.roleB.name })], [], manager, f.managerEmployee.id)).status, 404);
  });
  await t.test("publication audit failure rolls back the shifts and retains the draft", async () => {
    await ok(await draft([shift(81007, { date: "2026-11-16" })]));
    await db.run(sql`CREATE TRIGGER fail_shift_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'schedule.shift_changed' BEGIN SELECT RAISE(ABORT, 'isolated audit rollback'); END`);
    try { assert.equal((await publish()).status, 503); assert.equal((await snapshot()).state.shifts.some(s => s.id === 81007), false); }
    finally { await db.run(sql`DROP TRIGGER fail_shift_audit`); }
    await ok(await publish()); assert.ok((await snapshot()).state.shifts.some(s => s.id === 81007));
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
  await t.test("meal duration settings persist with revision, permission and validation guards, without changing punches", async () => {
    const view = await snapshot(), punches = await db.select().from(s.clockEvents);
    assert.equal(view.settings.mealBreakMinutes, 30);
    const save = (base, minutes, cookie = owner) => call("commit", cookie, saveBody(base, [{ entity: "settings", id: 1, before: { ...base.settings, hoursRoundingMinutes: base.state.hoursRoundingMinutes }, after: { ...base.settings, hoursRoundingMinutes: base.state.hoursRoundingMinutes, mealBreakMinutes: minutes } }], newToken()));
    assert.equal((await save(view, 0)).status, 400);
    await ok(await save(view, 60));
    assert.equal((await snapshot()).settings.mealBreakMinutes, 60);
    assert.equal((await save(view, 30)).status, 409);
    assert.equal((await save(await snapshot(manager), 45, manager)).status, 403);
    await ok(await save(await snapshot(), 30));
    assert.deepEqual(await db.select().from(s.clockEvents), punches);
  });
  await t.test("wage access retains parent-read and department scope guards; Employee and revoked wage access expose no rates", async () => {
    await db.insert(s.accountPermissions).values([
      { accountId: f.generalManager.id, permission: "wages.read", allowed: true },
      { accountId: f.generalManager.id, permission: "team.read", allowed: false },
      { accountId: f.generalManager.id, permission: "timesheets.read", allowed: false },
      { accountId: f.manager.id, permission: "wages.read", allowed: true },
    ]);
    const gm = await login(f.generalManager), full = await snapshot(gm);
    assert.equal(full.scheduleEstimateScopeComplete, true);
    assert.ok(full.state.employees.every(e => e.wageRates.length === 0));
    const scoped = await snapshot(manager);
    assert.equal(scoped.scheduleEstimateScopeComplete, false);
    assert.ok(scoped.state.employees.find(e => e.id === f.multi.id).wageRates.every(rate => rate.roleId === f.roleA.id));
    await db.insert(s.accountPermissions).values({ accountId: f.generalManager.id, permission: "wages.read", allowed: false }).onConflictDoUpdate({ target: [s.accountPermissions.accountId, s.accountPermissions.permission], set: { allowed: false } });
    assert.ok((await snapshot(gm)).state.employees.every(e => e.wageRates.length === 0));
    const own = await ok(await self.handle(request("/api/self/schedule?date=2026-11-12", employee)));
    assert.doesNotMatch(JSON.stringify(own), /wageRates|amountCents|wagesCents|salary|wages/);
  });
});
