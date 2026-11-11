import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, newEmployee, fieldKey } from "./support/workforce-fixture.mjs";
import { cookiesOf } from "./support/kiosk-fixture.mjs";

test("shared workforce operations persist, scope, audit and serialize actual D1 records", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true }); const statePath = await mkdtemp(join(projectRoot, ".wrangler/workforce-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath); const { getPlatformProxy } = await import("wrangler");
  const open = () => getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const runtime = await loadServerModule("tests/support/workforce-runtime.ts");
  const { createAuthService, createAccessService, createWorkforceService, newToken, stateChanges, saveBody, encryptSsn, decryptSsn, runClockMaintenance, runScheduledMaintenance } = runtime;
  const secret = "isolated-workforce-test-secret-with-32-characters"; const password = "Shared workforce test password only!";
  let db; let auth; let access; let workspace;
  function services() { db = drizzle(platform.env.DB, { schema }); auth = createAuthService(db, { secret }); access = createAccessService(db, auth); workspace = createWorkforceService(db, access, { secret, fieldKey }); }
  platform = await open(); services(); const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const origin = "http://localhost:3000";
  const request = (service, path, cookie = "", body, headers = {}) => service.handle(new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const call = (action, cookie, body, headers) => request(workspace, "/api/workspace/" + action, cookie, body, headers);
  async function ok(response) { assert.equal(response.status, 200); return response.json(); }
  async function login(email) { const response = await request(auth, "/api/auth/login", "", { email, password }); await ok(response); return cookiesOf(response)[0]; }
  async function snapshot(cookie) { return ok(await call("state", cookie)); }
  async function change(cookie, update, employeeKey = f.b.id) { const before = await snapshot(cookie); const next = structuredClone(before.state); update(next); return call("commit", cookie, saveBody(before, stateChanges(before.state, next, employeeKey), newToken())); }
  let owner = await login(f.owner.email); let second = await login(f.secondOwner.email); let manager = await login(f.manager.email);
  let createdId = 70001;
  await t.test("snapshots use permissions, explicit Owner links and conversation membership", async () => {
    assert.equal((await call("state", "")).status, 401);
    const own = await snapshot(owner); assert.equal(own.primaryOwnerEmployeeId, f.b.id); assert.equal(own.state.employees.find(e => e.id === f.a.id).socialSecurityNumber, "000-12-3456");
    const restricted = await snapshot(manager); assert.equal(restricted.state.employees.some(e => e.id === f.b.id), false);
    assert.ok(restricted.state.employees.every(e => !e.wage && !e.socialSecurityNumber));
    assert.equal(restricted.state.conversations.some(c => c.id === f.conversationB.id), false);
    assert.equal(own.state.conversations.some(c => c.id === f.conversationA.id), false);
    const serialized = JSON.stringify(restricted); assert.equal(serialized.includes("never-return-this"), false); assert.equal(serialized.includes("pinHash"), false); assert.equal(serialized.includes("tokenHash"), false);
    assert.equal(decryptSsn(encryptSsn("000-12-3456", 77, fieldKey), 77, fieldKey), "000-12-3456");
    assert.throws(() => decryptSsn(encryptSsn("000-12-3456", 77, fieldKey), 78, fieldKey));
  });
  await t.test("team create/update persist across sessions, with version checks and one-use save receipts", async () => {
    const before = await snapshot(owner); const next = structuredClone(before.state); next.employees.push(newEmployee(createdId, f.roleA.name, before.basicInfo.locationName));
    const body = saveBody(before, stateChanges(before.state, next, f.b.id), newToken());
    await ok(await call("commit", owner, body)); await ok(await call("commit", owner, body));
    assert.equal((await db.select().from(schema.employees).where(eq(schema.employees.id, createdId))).length, 1);
    let other = await snapshot(second); assert.ok(other.state.employees.some(e => e.id === createdId));
    const result = await change(owner, state => { state.employees.find(e => e.id === createdId).phone = "555-0123"; }); await ok(result);
    other = await snapshot(second); assert.equal(other.state.employees.find(e => e.id === createdId).phone, "555-0123");
    const forged = structuredClone(body); forged.id = newToken(); forged.revision = other.revision; forged.changes[0].after.accessLevel = "Admin"; assert.notEqual((await call("commit", owner, forged)).status, 200);
  });
  await t.test("department job roles and employee assignment are relational and archived without history loss", async () => {
    await ok(await change(owner, state => { state.departments.push({ id: 71001, name: "Shared department", roles: ["Shared job"], managerIds: [] }); }));
    await ok(await change(owner, state => { state.employees.find(e => e.id === createdId).role = "Shared job"; }));
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "Shared job")); assert.ok(role);
    const links = await db.select().from(schema.employeeRoles).where(andSql(createdId, role.id)); assert.equal(links[0].active, true);
    assert.equal((await change(manager, state => { state.employees.find(e => e.id === f.a.id).wage = "$99.00/hr"; }, f.managerEmployee.id)).status, 403);
    function andSql(employeeId, roleId) { return sql`employee_id = ${employeeId} AND role_id = ${roleId}`; }
  });
  await t.test("an unlinked independent Owner can save and publish a schedule visible in another session", async () => {
    const before = await snapshot(second); const next = structuredClone(before.state); const key = -f.secondOwner.id;
    next.scheduleDraftsByManager[key] = { upsertedShifts: [{ id: 72001, employeeId: createdId, date: "2026-11-10", start: "09:00", end: "17:00", role: "Shared job", station: "Floor", notes: "Shared shift" }], deletedShiftIds: [], affectedEmployeeIds: [createdId] };
    await ok(await call("commit", second, saveBody(before, stateChanges(before.state, next, key), newToken())));
    const saved = await snapshot(second); assert.equal(saved.state.scheduleDraftsByManager[key].upsertedShifts.length, 1); assert.equal((await snapshot(owner)).state.shifts.some(s => s.id === 72001), false);
    const published = await call("commit", second, saveBody(saved, [{ entity: "schedule-publish", id: 1, before: saved.state.scheduleDraftsByManager[key], after: { publish: true } }], newToken()));
    await ok(published); assert.ok((await snapshot(owner)).state.shifts.some(s => s.id === 72001));
    const [stored] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, 72001)); assert.ok(stored.publicationId);
  });
  await t.test("stale and concurrent writes cannot overwrite the winner, and audit failure rolls everything back", async () => {
    const before = await snapshot(owner);
    const payload = value => saveBody(before, [{ entity: "employee", id: createdId, before: before.state.employees.find(e => e.id === createdId), after: { ...before.state.employees.find(e => e.id === createdId), phone: value } }], newToken());
    const results = await Promise.all([call("commit", owner, payload("555-0201")), call("commit", second, payload("555-0202"))]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const [original] = await db.select().from(schema.employees).where(eq(schema.employees.id, createdId));
    await db.run(sql`CREATE TRIGGER reject_workforce_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'workforce.changed' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`);
    assert.equal((await change(owner, state => { state.employees.find(e => e.id === createdId).phone = "555-rollback"; })).status, 503);
    const [after] = await db.select().from(schema.employees).where(eq(schema.employees.id, createdId)); assert.equal(after.phone, original.phone);
    assert.equal((await db.select().from(schema.workforceWriteChecks)).length, 0);
    await db.run(sql`DROP TRIGGER reject_workforce_audit`);
  });
  await t.test("settings and notification receipts are server-backed and owner identities cannot be changed through contact fields", async () => {
    const before = await snapshot(owner); const settings = { ...before.settings, noShowMinutes: 12, hoursRoundingMinutes: 10 };
    await ok(await call("commit", owner, saveBody(before, [{ entity: "settings", id: 1, before: { ...before.settings, hoursRoundingMinutes: before.state.hoursRoundingMinutes }, after: settings }], newToken())));
    assert.equal((await snapshot(second)).settings.noShowMinutes, 12);
    const current = await snapshot(owner); const changed = { ...current.basicInfo, accountOwner: "Attacker" };
    assert.equal((await call("commit", owner, saveBody(current, [{ entity: "business", id: 1, before: current.basicInfo, after: changed }], newToken()))).status, 403);
    const receipts = { opened: current.opened[f.b.id] ?? [], dismissed: current.dismissed[f.b.id] ?? [] };
    await ok(await call("commit", owner, saveBody(current, [{ entity: "notifications", id: 1, before: receipts, after: { opened: ["request-123"], dismissed: ["request-123"] } }], newToken())));
    assert.ok((await snapshot(owner)).dismissed[f.b.id].includes("request-123")); assert.equal((await snapshot(second)).dismissed[-f.secondOwner.id].length, 0);
  });
  await t.test("time off and availability decisions use the authenticated actor, with preserved history", async () => {
    const base = await snapshot(owner); const next = structuredClone(base.state);
    next.ptoRequests.push({ id: 73001, employeeId: f.b.id, compensation: "unpaid", startDate: "2026-11-15", endDate: "2026-11-15", reason: "vacation", explanation: "Local QA request", status: "approved", requestedAt: new Date().toISOString() });
    await ok(await call("commit", owner, saveBody(base, stateChanges(base.state, next, f.b.id), newToken())));
    const own = await snapshot(owner); const request = own.state.ptoRequests.find(r => r.id === 73001); assert.equal(request.status, "approved");
    const [decision] = await db.select().from(schema.ptoDecisions).where(eq(schema.ptoDecisions.requestId, 73001)); assert.equal(decision.actorAccountId, f.owner.id);
    const av = await snapshot(manager); const after = structuredClone(av.state); after.availabilityRequests.push({ id: 74001, employeeId: f.managerEmployee.id, effectiveDate: "2026-11-16", status: "pending", slots: [{ day: "Monday", preference: "preferred", startHour: 9, endHour: 17, location: av.basicInfo.locationName }], submittedAt: new Date().toISOString(), requestNote: "Local QA" });
    await ok(await call("commit", manager, saveBody(av, stateChanges(av.state, after, f.managerEmployee.id), newToken())));
    const decisionView = await snapshot(owner); const a = decisionView.state.availabilityRequests.find(a => a.id === 74001);
    await ok(await call("commit", owner, saveBody(decisionView, [{ entity: "availability", id: 74001, before: a, after: { ...a, status: "approved", decidedAt: new Date().toISOString(), decidedByEmployeeId: f.b.id } }], newToken())));
    assert.equal((await snapshot(manager)).state.availabilityRequests.find(a => a.id === 74001).status, "approved");
  });
  await t.test("messages persist with member-only reads, sender identity and own receipts", async () => {
    const before = await snapshot(manager); const next = structuredClone(before.state); const conversation = next.conversations.find(c => c.id === f.conversationA.id);
    conversation.messages.push({ id: 75001, senderEmployeeId: f.managerEmployee.id, body: "Shared server message", sentAt: new Date().toISOString(), readByEmployeeIds: [f.managerEmployee.id] });
    await ok(await call("commit", manager, saveBody(before, stateChanges(before.state, next, f.managerEmployee.id), newToken())));
    assert.ok((await snapshot(manager)).state.conversations.find(c => c.id === f.conversationA.id).messages.some(m => m.id === 75001));
    assert.equal((await snapshot(owner)).state.conversations.some(c => c.id === f.conversationA.id), false);
    const current = await snapshot(manager); const forged = structuredClone(current.state); forged.conversations.find(c => c.id === f.conversationA.id).messages.push({ id: 75002, senderEmployeeId: f.b.id, body: "forged", sentAt: new Date().toISOString(), readByEmployeeIds: [f.b.id] });
    assert.equal((await call("commit", manager, saveBody(current, stateChanges(current.state, forged, f.managerEmployee.id), newToken()))).status, 403);
  });
  await t.test("private profile writes are encrypted, wage changes append history, and policies archive safely", async () => {
    await ok(await change(owner, state => { const employee = state.employees.find(e => e.id === createdId); employee.socialSecurityNumber = "000-98-7654"; employee.wage = "$25.50/hr"; }));
    const [profile] = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, createdId));
    assert.match(profile.ssnEncrypted, /^v1\./); assert.equal(profile.ssnEncrypted.includes("000-98-7654"), false);
    assert.equal((await snapshot(second)).state.employees.find(e => e.id === createdId).socialSecurityNumber, "000-98-7654");
    assert.equal((await snapshot(manager)).state.employees.find(e => e.id === f.a.id).socialSecurityNumber, "");
    await ok(await change(owner, state => { state.employees.find(e => e.id === createdId).wage = "$26.00/hr"; }));
    const rates = await db.select().from(schema.wageRates).where(eq(schema.wageRates.employeeId, createdId)); assert.deepEqual(rates.map(rate => rate.amountCents), [2550, 2600]);
    await ok(await change(owner, state => { state.ptoPolicies.push({ id: 76001, name: "Local QA allowance", method: "fixed", fixedHours: 40, earnedHours: 0, workedHours: 0, employeeIds: [createdId], startingBalances: { [createdId]: { startDate: "2026-11-01", balance: 8 } } }); }));
    assert.equal((await snapshot(second)).state.ptoPolicies.find(p => p.id === 76001).startingBalances[createdId].balance, 8);
    await ok(await change(owner, state => { state.ptoPolicies = state.ptoPolicies.filter(p => p.id !== 76001); }));
    const [policy] = await db.select().from(schema.ptoPolicies).where(eq(schema.ptoPolicies.id, 76001)); assert.equal(policy.archived, true);
  });
  await t.test("time-card corrections retain immutable raw punches and attributed revisions", async () => {
    const raw = await db.insert(schema.clockEvents).values([
      { employeeId: createdId, eventType: "in", occurredAt: "2026-10-31T16:00:00.000Z", roleName: "Shared job", source: "system" },
      { employeeId: createdId, eventType: "out", occurredAt: "2026-11-01T00:00:00.000Z", roleName: "Shared job", source: "system" },
    ]).returning();
    const before = await snapshot(owner); const ids = raw.map(event => event.id); const beforeEvents = before.state.clockEvents.filter(event => ids.includes(event.id));
    const events = [{ id: 77001, employeeId: createdId, type: "in", at: "2026-10-31T16:30:00.000Z", role: "Shared job" }, { id: 77002, employeeId: createdId, type: "out", at: "2026-11-01T00:00:00.000Z", role: "Shared job" }];
    await ok(await call("commit", owner, saveBody(before, [{ entity: "timecard", id: 77003, before: { events: beforeEvents }, after: { employeeId: createdId, date: "2026-10-31", eventIds: ids, events, reason: "Disposable correction test" } }], newToken())));
    const unchanged = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, createdId)); assert.deepEqual(unchanged, raw);
    const view = await snapshot(second); assert.equal(view.state.clockEvents.some(event => ids.includes(event.id)), false); assert.equal(view.state.clockEvents.find(event => event.id === 77001).at, events[0].at);
    const [edit] = await db.select().from(schema.timeCardEdits).where(eq(schema.timeCardEdits.id, 77003)); assert.equal(edit.actorAccountId, f.owner.id); assert.equal(edit.revision, 1); assert.deepEqual(edit.before.eventIds, ids);
  });
  await t.test("past-shift changes and unsupported attachment storage fail without committing", async () => {
    const before = await snapshot(owner); const old = before.state.shifts.find(shift => shift.id === f.shifts[0].id);
    const draft = { upsertedShifts: [{ ...old, end: "18:00" }], deletedShiftIds: [], affectedEmployeeIds: [old.employeeId] };
    assert.equal((await call("commit", owner, saveBody(before, [{ entity: "schedule-draft", id: 1, before: null, after: draft }], newToken()))).status, 409);
    const revision = (await snapshot(owner)).revision;
    assert.equal((await change(owner, state => { state.employees.find(e => e.id === createdId).certificates.push({ id: 78001, name: "QA certificate", fileName: "unsafe-placeholder.pdf", fileId: "fake" }); })).status, 409);
    assert.equal((await snapshot(owner)).revision, revision);
  });
  await t.test("a scoped Manager can change a future shift without erasing notes they cannot read", async () => {
    const before = await snapshot(owner); const ownKey = f.b.id;
    const draft = { upsertedShifts: [{ id: 79001, employeeId: f.a.id, date: "2026-11-12", start: "09:00", end: "17:00", role: f.roleA.name, station: "Floor", notes: "Preserve this private shift note" }], deletedShiftIds: [], affectedEmployeeIds: [f.a.id] };
    await ok(await call("commit", owner, saveBody(before, [{ entity: "schedule-draft", id: 1, before: null, after: draft }], newToken())));
    let view = await snapshot(owner);
    await ok(await call("commit", owner, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[ownKey], after: { publish: true } }], newToken())));
    view = await snapshot(manager); const shift = view.state.shifts.find(shift => shift.id === 79001); assert.equal(shift.notes, undefined);
    const managerDraft = { upsertedShifts: [{ ...shift, end: "18:00" }], deletedShiftIds: [], affectedEmployeeIds: [f.a.id] };
    await ok(await call("commit", manager, saveBody(view, [{ entity: "schedule-draft", id: 1, before: null, after: managerDraft }], newToken())));
    view = await snapshot(manager);
    await ok(await call("commit", manager, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[f.managerEmployee.id], after: { publish: true } }], newToken())));
    const saved = (await snapshot(owner)).state.shifts.find(shift => shift.id === 79001); assert.equal(saved.end, "18:00"); assert.equal(saved.notes, "Preserve this private shift note");
  });
  await t.test("restarting the local runtime preserves records and FK integrity", async () => {
    await platform.dispose(); platform = await open(); services(); owner = await login(f.owner.email); second = await login(f.secondOwner.email); manager = await login(f.manager.email);
    const view = await snapshot(second); assert.ok(view.state.employees.some(e => e.id === createdId)); assert.ok(view.state.shifts.some(s => s.id === 72001));
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
    assert.equal((await call("commit", owner, {}, { Origin: "https://attacker.test" })).status, 403);
  });
  await t.test("automatic clock-out is server-owned, location-timed and idempotent", async () => {
    await db.update(schema.locationSettings).set({ automaticClockOut: true, automaticClockOutMinutes: 120 }).where(eq(schema.locationSettings.businessId, 1));
    const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, 72001));
    await db.insert(schema.clockEvents).values({ employeeId: createdId, eventType: "in", occurredAt: "2026-11-10T17:00:00.000Z", shiftId: shift.id, roleName: "Shared job", source: "system" });
    const now = Date.parse("2026-11-11T04:00:00.000Z");
    assert.equal(await runClockMaintenance(db, now), 1); assert.equal(await runClockMaintenance(db, now), 0);
    const events = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, createdId)); const last = events.at(-1); assert.equal(last.eventType, "out"); assert.equal(last.automatic, true); assert.equal(last.occurredAt, "2026-11-11T03:00:00.000Z");
  });
  await t.test("scheduled maintenance records a bounded, non-personal execution receipt", async () => {
    const now = Date.parse("2026-11-11T05:01:00.000Z");
    assert.equal(await runScheduledMaintenance(db, now), 0);
    assert.equal(await runScheduledMaintenance(db, now + 60000), 0);
    let rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "maintenance.scheduled"));
    assert.equal(rows.length, 1); assert.equal(rows[0].actorAccountId, null); assert.equal(rows[0].employeeId, null); assert.deepEqual(rows[0].metadata, { recorded: 0 });
    await runScheduledMaintenance(db, now + 3600000);
    rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "maintenance.scheduled")); assert.equal(rows.length, 2);
  });
});
