import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
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
  const secret = randomBytes(32).toString("hex"); const password = randomBytes(24).toString("base64url");
  let db; let auth; let access; let workspace;
  function services() {
    db = drizzle(platform.env.DB, { schema }); auth = createAuthService(db, { secret }); access = createAccessService(db, auth);
    // Keep future/past shift assertions independent of the wall clock.
    workspace = createWorkforceService(db, access, { secret, fieldKey, now: () => Date.parse("2026-11-10T20:00:00Z") });
  }
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
    const own = await snapshot(owner); assert.equal(own.primaryOwnerEmployeeId, f.b.id); assert.equal(own.state.employees.find(e => e.id === f.a.id).socialSecurityNumber, "•••-••-3456");
    const [seededProfile] = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, f.a.id));
    const seededPrivateFixture = decryptSsn(seededProfile.ssnEncrypted, f.a.id, fieldKey);
    assert.equal(JSON.stringify(own).includes(seededPrivateFixture), false);
    const restricted = await snapshot(manager); assert.equal(restricted.state.employees.some(e => e.id === f.b.id), false);
    assert.ok(restricted.state.employees.every(e => !e.wage && !e.socialSecurityNumber));
    assert.equal(restricted.state.conversations.some(c => c.id === f.conversationB.id), false);
    assert.equal(own.state.conversations.some(c => c.id === f.conversationA.id), false);
    const serialized = JSON.stringify(restricted); assert.equal(serialized.includes("never-return-this"), false); assert.equal(serialized.includes("pinHash"), false); assert.equal(serialized.includes("tokenHash"), false);
    assert.equal(decryptSsn(encryptSsn(seededPrivateFixture, 77, fieldKey), 77, fieldKey), seededPrivateFixture);
    assert.throws(() => decryptSsn(encryptSsn(seededPrivateFixture, 77, fieldKey), 78, fieldKey));
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
    const before = await snapshot(owner);
    assert.deepEqual([before.settings.breakPremiums, before.settings.mealPremiumLimit, before.settings.restPremiumLimit], [true, 1, 1]);
    assert.deepEqual([before.settings.overtimeDailyHours, before.settings.overtimeWeeklyHours, before.settings.overtimeDoubleHours, before.settings.overtimeSeventhDayEnabled], [8, 40, 12, true]);
    assert.equal(before.settings.roundClockPunches, false);
    const settings = { ...before.settings, noShowMinutes: 12, restPremiumLimit: 2, roundClockPunches: true, hoursRoundingMinutes: 10,
      overtimeDailyHours: 8.5, overtimeWeeklyHours: 38, overtimeDoubleEnabled: false, overtimeMultiplier: 1.75 };
    await ok(await call("commit", owner, saveBody(before, [{ entity: "settings", id: 1, before: { ...before.settings, hoursRoundingMinutes: before.state.hoursRoundingMinutes }, after: settings }], newToken())));
    const savedSettings = (await snapshot(second)).settings;
    assert.equal(savedSettings.roundClockPunches, true);
    assert.equal(savedSettings.noShowMinutes, 12);
    assert.equal(savedSettings.restPremiumLimit, 2);
    assert.equal(savedSettings.mealPremiumLimit, 1);
    assert.deepEqual([savedSettings.overtimeDailyHours, savedSettings.overtimeWeeklyHours, savedSettings.overtimeDoubleEnabled, savedSettings.overtimeMultiplier], [8.5, 38, false, 1.75]);
    const current = await snapshot(owner); const changed = { ...current.basicInfo, accountOwner: "Attacker" };
    const currentSettings = { ...current.settings, hoursRoundingMinutes: current.state.hoursRoundingMinutes };
    assert.equal(currentSettings.hoursRoundingMinutes, 10);
    const badIncrement = { ...currentSettings, hoursRoundingMinutes: 7 };
    assert.equal((await call("commit", owner, saveBody(current, [{ entity: "settings", id: 1, before: currentSettings, after: badIncrement }], newToken()))).status, 400);
    const invalid = { ...currentSettings, overtimeDoubleEnabled: true, overtimeDoubleHours: 7 };
    assert.equal((await call("commit", owner, saveBody(current, [{ entity: "settings", id: 1, before: currentSettings, after: invalid }], newToken()))).status, 400);
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
    const updatedPrivateFixture = [900, 10, 7654].join("-");
    await ok(await change(owner, state => { const employee = state.employees.find(e => e.id === createdId); employee.socialSecurityNumber = updatedPrivateFixture; employee.wage = "$25.50/hr"; }));
    const [profile] = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, createdId));
    assert.match(profile.ssnEncrypted, /^v1\./); assert.equal(profile.ssnEncrypted.includes(updatedPrivateFixture), false);
    assert.equal((await snapshot(second)).state.employees.find(e => e.id === createdId).socialSecurityNumber, "•••-••-7654");
    await ok(await change(owner, state => { state.employees.find(e => e.id === createdId).homeAddress = "Updated fictional address"; }));
    const [preserved] = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeId, createdId));
    assert.equal(preserved.ssnEncrypted, profile.ssnEncrypted);
    assert.equal(decryptSsn(preserved.ssnEncrypted, createdId, fieldKey), updatedPrivateFixture);
    assert.equal((await snapshot(manager)).state.employees.find(e => e.id === f.a.id).socialSecurityNumber, "");
    await ok(await change(owner, state => { state.employees.find(e => e.id === createdId).wage = "$26.00/hr"; }));
    const rates = await db.select().from(schema.wageRates).where(eq(schema.wageRates.employeeId, createdId)); assert.deepEqual(rates.map(rate => rate.amountCents), [2550, 2600]);
    await ok(await change(owner, state => { state.ptoPolicies.push({ id: 76001, name: "Local QA allowance", method: "fixed", fixedHours: 40, earnedHours: 0, workedHours: 0, employeeIds: [createdId], startingBalances: { [createdId]: { startDate: "2026-11-01", balance: 8 } } }); }));
    assert.equal((await snapshot(second)).state.ptoPolicies.find(p => p.id === 76001).startingBalances[createdId].balance, 8);
    await ok(await change(owner, state => { state.ptoPolicies = state.ptoPolicies.filter(p => p.id !== 76001); }));
    const [policy] = await db.select().from(schema.ptoPolicies).where(eq(schema.ptoPolicies.id, 76001)); assert.equal(policy.archived, true);
  });
  await t.test("time-card corrections retain immutable raw punches and attributed revisions", async () => {
    const collidingId = 81011;
    const [olderCard] = await db.insert(schema.timeCards).values({ id: collidingId, employeeId: createdId, workDate: "2026-10-25" }).returning();
    const raw = await db.insert(schema.clockEvents).values([
      { id: collidingId, employeeId: createdId, eventType: "in", occurredAt: "2026-10-31T16:00:00.000Z", roleName: "Shared job", source: "system" },
      { employeeId: createdId, eventType: "out", occurredAt: "2026-11-01T00:00:00.000Z", roleName: "Shared job", source: "system" },
    ]).returning();
    const before = await snapshot(owner); const ids = raw.map(event => event.id); const beforeEvents = before.state.clockEvents.filter(event => ids.includes(event.id));
    const events = [
      { id: 77001, employeeId: createdId, type: "in", at: "2026-10-31T16:30:00.000Z", role: "Shared job", clockDetails: { california: true } },
      { id: 77004, employeeId: createdId, type: "break", at: "2026-10-31T23:30:00.000Z", clockDetails: { breakKind: "meal" } },
      { id: 77005, employeeId: createdId, type: "break_end", at: "2026-11-01T00:00:00.000Z" },
      { id: 77006, employeeId: createdId, type: "out", at: "2026-11-01T00:00:00.000Z" },
    ];
    await ok(await call("commit", owner, saveBody(before, [{ entity: "timecard", id: 77003, before: { events: beforeEvents }, after: {
      employeeId: createdId, date: "2026-10-31", eventIds: ids, events, cardId: collidingId, reason: "Disposable correction test",
    } }], newToken())));
    const unchanged = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, createdId)); assert.deepEqual(unchanged, raw);
    const view = await snapshot(second); assert.equal(view.state.clockEvents.some(event => ids.includes(event.id)), false); assert.equal(view.state.clockEvents.find(event => event.id === 77001).at, events[0].at);
    assert.deepEqual(view.state.clockEvents.find(event => event.id === 77001).clockDetails, { california: true });
    const [edit] = await db.select().from(schema.timeCardEdits).where(eq(schema.timeCardEdits.id, 77003)); assert.equal(edit.actorAccountId, f.owner.id); assert.equal(edit.revision, 1); assert.deepEqual(edit.before.eventIds, ids);
    assert.notEqual(edit.cardId, collidingId);
    assert.deepEqual(await db.select().from(schema.timeCards).where(eq(schema.timeCards.id, collidingId)), [olderCard]);
  });
  await t.test("time-card role changes and confirmed deletions preserve punches, notes and scoped history", async () => {
    const employeeId = f.multi.id;
    const date = "2026-11-06";
    const [device] = await db.select().from(schema.kioskDevices).limit(1);
    const deviceReceipt = { deviceId: device.id, receivedAt: `${date}T19:00:00.000Z` };
    const raw = await db.insert(schema.clockEvents).values([
      { ...deviceReceipt, employeeId, eventType: "in", occurredAt: `${date}T17:00:00.000Z`, roleName: f.roleA.name, source: "kiosk", explanation: "Employee arrival explanation" },
      { ...deviceReceipt, employeeId, eventType: "out", occurredAt: `${date}T19:00:00.000Z`, roleName: f.roleA.name, source: "offline", explanation: "Employee departure explanation" },
    ]).returning();
    const ownEvents = view => view.state.clockEvents.filter(event => event.employeeId === employeeId);
    const save = (actor, view, events, changes) => call("commit", actor, saveBody(view, [{
      entity: "timecard", id: 820000 + view.revision, before: { events },
      after: { employeeId, date, eventIds: events.map(event => event.id), ...changes },
    }], newToken()));
    const deletion = { operation: "delete", events: [] };
    const original = await snapshot(owner);
    assert.equal((await save(owner, original, ownEvents(original).slice(0, 1), deletion)).status, 409);
    assert.equal((await save(owner, original, ownEvents(original), { ...deletion, cardId: raw[0].id + 9000 })).status, 403);
    const scoped = await snapshot(manager);
    assert.equal((await save(manager, scoped, ownEvents(scoped), deletion)).status, 403);
    const corrected = await ok(await save(owner, original, ownEvents(original), { cardId: raw[0].id, events: [
      { id: 823001, employeeId, type: "in", at: `${date}T17:10:00.000Z`, role: f.roleB.name, explanation: "Manager correction note" },
      { id: 823002, employeeId, type: "out", at: `${date}T19:00:00.000Z` },
    ] }));
    const [start] = ownEvents(corrected);
    assert.equal(start.role, f.roleB.name);
    assert.equal(start.noteAuthor, "manager");
    assert.deepEqual(start.carriedNotes, [
      { author: "employee", text: "Employee arrival explanation" },
      { author: "employee", text: "Employee departure explanation" },
    ]);
    assert.deepEqual(ownEvents(await snapshot(manager)), []);
    assert.equal((await save(owner, original, ownEvents(original), deletion)).status, 409);
    const removed = await ok(await save(owner, corrected, ownEvents(corrected), { ...deletion, cardId: start.cardId }));
    assert.deepEqual(ownEvents(removed), []);
    const history = removed.state.timeCardEdits.filter(edit => edit.cardId === start.cardId);
    assert.equal(history.length, 2);
    assert.match(history[0].after, /Job B/);
    assert.equal(history[1].after, "Time card deleted");
    assert.deepEqual(history[1].notes.map(note => note.text), ["Employee arrival explanation", "Employee departure explanation", "Manager correction note"]);
    assert.equal(history[1].actor, f.owner.displayName);
    assert.deepEqual(await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, employeeId)), raw);
    assert.deepEqual(ownEvents(await snapshot(second)), []);
  });
  await t.test("past schedule edits preserve raw punches; unsupported attachments still fail", async () => {
    const before = await snapshot(owner); const old = before.state.shifts.find(shift => shift.id === f.shifts[0].id);
    const draft = { upsertedShifts: [{ ...old, end: "18:00" }], deletedShiftIds: [], affectedEmployeeIds: [old.employeeId] };
    const rawPunches = await db.select().from(schema.clockEvents);
    await ok(await call("commit", owner, saveBody(before, [{ entity: "schedule-draft", id: 1, before: null, after: draft }], newToken())));
    const saved = await snapshot(owner);
    await ok(await call("commit", owner, saveBody(saved, [{ entity: "schedule-publish", id: 1, before: saved.state.scheduleDraftsByManager[f.b.id], after: { publish: true } }], newToken())));
    assert.equal((await snapshot(owner)).state.shifts.find(s => s.id === old.id).end, "18:00");
    assert.deepEqual(await db.select().from(schema.clockEvents), rawPunches);
    const revision = (await snapshot(owner)).revision;
    assert.equal((await change(owner, state => { state.employees.find(e => e.id === createdId).certificates.push({ id: 78001, name: "QA certificate", fileName: "unsafe-placeholder.pdf", fileId: "fake" }); })).status, 409);
    assert.equal((await snapshot(owner)).revision, revision);
  });

  await t.test("daily and period review approve current scoped cards, resolve issues in bulk and record no-shows", async () => {
    const date = "2026-11-07";
    const period = { start: date, end: "2026-11-08" };
    const day = { start: date, end: date };
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 190, publishedByAccountId: f.owner.id }).returning();
    await db.insert(schema.shifts).values([
      { employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "09:00", endTime: "10:00", publicationId: publication.id },
      { employeeId: f.b.id, roleId: f.roleB.id, date: period.end, startTime: "09:00", endTime: "12:00", publicationId: publication.id },
    ]);
    const raw = await db.insert(schema.clockEvents).values([
      ...[[17, 18], [19, 20], [21, 22]].flatMap(([start, end]) => [["in", start], ["out", end]].map(([eventType, hour]) => ({
        employeeId: f.a.id, roleName: f.roleA.name, eventType, occurredAt: `${date}T${hour}:00:00.000Z`, source: "system", clockDetails: { california: true },
      }))),
      { employeeId: f.multi.id, roleName: f.roleB.name, eventType: "in", occurredAt: `${date}T23:00:00.000Z`, source: "system", clockDetails: { california: true } },
    ]).returning();
    const read = (actor, range = period) => call("timesheet-review?" + new URLSearchParams(range), actor).then(ok);
    const make = (action, targets, range = period, details = {}) => ({ id: newToken(), period: range, action, targets: targets.map(({ key, version }) => ({ key, version })), ...details });
    const submit = (actor, body) => call("timesheet-review", actor, body);
    const before = (await read(owner)).items;
    const clean = before.find(item => item.firstEventId === raw[0].id);
    const missing = before.find(item => item.firstEventId === raw.at(-1).id);
    const issues = before.filter(item => item.allowedAction === "resolve");
    const noShow = before.find(item => item.kind === "no-show");
    assert.equal(clean.status, "ready");
    assert.equal(clean.department, f.deptA.name);
    assert.equal(missing.status, "needs-review");
    assert.equal(missing.allowedAction, undefined);
    assert.equal(issues.length, 2);
    assert.ok(issues.every(item => item.issues.includes("Unscheduled time")));
    assert.equal(noShow.employeeId, f.b.id);
    assert.equal((await submit(owner, make("approve", [clean, missing]))).status, 409);
    assert.equal((await db.select().from(schema.timesheetReviews)).length, 0);
    const scoped = (await read(manager)).items;
    assert.ok(scoped.some(item => item.key === clean.key));
    assert.ok(scoped.every(item => item.department === f.deptA.name && !item.allowedAction));
    assert.equal((await submit(manager, make("approve", [clean], day))).status, 403);
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "timesheets.manage", allowed: true });
    try {
      const daily = (await read(owner, day)).items.find(item => item.key === clean.key);
      assert.equal(daily.version, clean.version);
      const approval = make("approve", [daily], day);
      assert.equal((await submit(manager, make("no_show", [noShow], period, { reason: "Called out" }))).status, 409);
      await ok(await submit(manager, approval)); await ok(await submit(manager, approval));
      assert.equal((await read(owner)).items.find(item => item.key === clean.key).status, "approved");
      assert.equal((await read(manager)).items.find(item => item.key === clean.key).status, "approved");
      await ok(await submit(manager, make("resolve", issues)));
      let after = (await read(owner)).items;
      assert.ok(after.filter(item => issues.some(issue => issue.key === item.key)).every(item => item.status === "ready" && item.decision.actor === f.manager.displayName));
      assert.equal(after.find(item => item.key === missing.key).status, "needs-review");
      await ok(await submit(owner, make("approve", after.filter(item => item.allowedAction === "approve"))));
      assert.equal((await submit(owner, make("no_show", [noShow], period, { reason: "" }))).status, 400);
      await ok(await submit(owner, make("no_show", [noShow], period, { reason: "Called out", note: "Fictional absence note" })));
      after = (await read(owner)).items;
      assert.deepEqual(after.find(item => item.key === noShow.key).decision.reason, "Called out");
      assert.equal(after.find(item => item.key === noShow.key).status, "resolved-no-show");
      assert.ok(!(await read(manager)).items.some(item => item.key === noShow.key));
      const snapshotBefore = await snapshot(owner);
      const original = snapshotBefore.state.clockEvents.filter(event => [raw[0].id, raw[1].id].includes(event.id));
      await ok(await call("commit", owner, saveBody(snapshotBefore, [{ entity: "timecard", id: 834002, before: { events: original }, after: {
        employeeId: f.a.id, date, eventIds: original.map(event => event.id), events: [
          { id: 834010, employeeId: f.a.id, type: "in", role: f.roleA.name, at: `${date}T17:10:00.000Z`, clockDetails: { california: true } },
          { id: 834011, employeeId: f.a.id, type: "out", at: `${date}T18:00:00.000Z` },
        ],
      } }], newToken())));
      assert.equal((await submit(owner, make("approve", [clean]))).status, 409);
      assert.equal((await read(owner)).items.find(item => item.firstEventId === 834010).status, "ready");
      assert.equal((await db.select().from(schema.timesheetReviews)).length, 6);
      await assert.rejects(db.run(sql`DELETE FROM timesheet_reviews WHERE action='approve'`), /append-only|Failed query/);
      assert.deepEqual(await db.select().from(schema.clockEvents).where(sql`id IN (${sql.join(raw.map(event => sql`${event.id}`), sql`, `)})`).orderBy(schema.clockEvents.id), raw);
    } finally {
      await db.delete(schema.accountPermissions).where(sql`account_id = ${f.manager.id} AND permission = 'timesheets.manage'`);
    }
  });
  await t.test("schedule rounding receives only published scoped shifts and the original punch link", async () => {
    const date = "2026-11-06";
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 191, publishedByAccountId: f.owner.id }).returning();
    const [visible, other, draft] = await db.insert(schema.shifts).values([
      { employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "09:00", endTime: "10:00", publicationId: publication.id },
      { employeeId: f.b.id, roleId: f.roleB.id, date, startTime: "09:00", endTime: "10:00", publicationId: publication.id },
      { employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "11:00", endTime: "12:00" },
    ]).returning();
    const [punch] = await db.insert(schema.clockEvents).values([
      { employeeId: f.a.id, shiftId: visible.id, roleName: f.roleA.name, eventType: "in", occurredAt: `${date}T16:58:00.000Z`, source: "system" },
      { employeeId: f.a.id, shiftId: visible.id, roleName: f.roleA.name, eventType: "out", occurredAt: `${date}T18:00:00.000Z`, source: "system" },
    ]).returning();
    const full = await snapshot(owner);
    const scoped = await snapshot(manager);
    assert.ok(full.timesheetSchedule.some(shift => shift.id === other.id));
    assert.ok(!full.timesheetSchedule.some(shift => shift.id === draft.id));
    assert.deepEqual(scoped.timesheetSchedule.filter(shift => shift.date === date).map(shift => shift.id), [visible.id]);
    assert.equal(scoped.state.clockEvents.find(event => event.id === punch.id).shiftId, visible.id);
    assert.equal(scoped.state.clockEvents.find(event => event.id === punch.id).at, punch.occurredAt);
  });
  await t.test("card locks, bulk locks and pay-period locks protect hours and retain scoped history", async () => {
    const range = { start: "2026-10-26", end: "2026-11-01" };
    const day = { start: "2026-10-28", end: "2026-10-28" };
    const outside = { start: "2026-11-02", end: "2026-11-08" };
    const partial = { start: range.start, end: day.end };
    const sample = (employee, role, start, end) => [["in", start], ["out", end]].map(([eventType, occurredAt]) => ({
      employeeId: employee.id, roleName: role.name, eventType, occurredAt, source: "system", clockDetails: { california: true },
    }));
    const raw = await db.insert(schema.clockEvents).values([
      ...sample(f.a, f.roleA, "2026-10-26T06:30:00.000Z", "2026-10-26T08:30:00.000Z"),
      ...sample(f.a, f.roleA, `${day.start}T16:00:00.000Z`, `${day.start}T17:00:00.000Z`),
      ...sample(f.a, f.roleA, `${day.start}T18:00:00.000Z`, `${day.start}T19:00:00.000Z`),
      ...sample(f.b, f.roleB, `${day.start}T16:00:00.000Z`, `${day.start}T17:00:00.000Z`),
    ]).returning();
    const key = event => `punch:${event.employeeId}:${event.id}`;
    const read = (actor, dates = range) => call("timesheet-locks?" + new URLSearchParams(dates), actor).then(ok);
    const body = async (actor, action, targets = [], dates = range) => ({ id: newToken(), revision: (await read(actor, dates)).revision, action, targets, range: dates });
    const send = (actor, value) => call("timesheet-locks", actor, value);
    const changeCard = async ({ date = day.start, originals = raw.slice(2, 4), operation, start = `${day.start}T16:05:00.000Z`, end = `${day.start}T17:00:00.000Z` } = {}) => {
      const view = await snapshot(owner);
      const before = view.state.clockEvents.filter(event => originals.some(original => original.id === event.id));
      const events = operation ? [] : [
        { id: 835010, employeeId: f.a.id, type: "in", at: start, role: f.roleA.name, clockDetails: { california: true } },
        { id: 835011, employeeId: f.a.id, type: "out", at: end },
      ];
      return call("commit", owner, saveBody(view, [{ entity: "timecard", id: 835002, before: { events: before }, after: {
        employeeId: f.a.id, date, eventIds: before.map(event => event.id), events, ...(operation ? { operation } : {}),
      } }], newToken()));
    };
    assert.equal((await call("timesheet-locks?" + new URLSearchParams(range), "")).status, 401);
    assert.equal((await read(owner)).canLockPeriod, true);
    assert.equal((await send(owner, await body(owner, "lock", [], partial))).status, 409);
    assert.equal((await send(owner, await body(owner, "lock", [], outside))).status, 409);
    const firstLock = await body(owner, "lock", [key(raw[2])], day);
    await ok(await send(owner, firstLock));
    await ok(await send(owner, firstLock));
    assert.equal((await read(owner)).history.length, 1);
    assert.match((await (await changeCard()).json()).error, /time card is locked/i);
    assert.match((await (await changeCard({ operation: "delete" })).json()).error, /time card is locked/i);
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "timesheets.manage", allowed: true });
    try {
      assert.equal((await send(manager, await body(manager, "unlock", [key(raw[2])]))).status, 403);
      await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "timesheets.lock", allowed: true });
      assert.equal((await send(manager, await body(manager, "lock"))).status, 403);
      assert.equal((await send(manager, await body(manager, "lock", [key(raw[4]), key(raw[6])]))).status, 403);
      assert.equal((await read(owner)).active.length, 1);
      await ok(await send(manager, await body(manager, "unlock", [key(raw[2])])));
      await ok(await changeCard());
      const edited = (await snapshot(owner)).state.clockEvents.find(event => event.id === 835010);
      const anchored = `card:${f.a.id}:${edited.cardId}`;
      const bulk = await body(manager, "lock", [anchored, key(raw[4])]);
      assert.equal((await ok(await send(manager, bulk))).count, 2);
      assert.equal((await read(manager)).active.length, 2);
      assert.equal((await send(owner, { ...bulk, id: newToken(), action: "unlock" })).status, 409);
      const protectedEdit = await changeCard({ originals: [{ id: 835010 }, { id: 835011 }], start: `${day.start}T16:10:00.000Z` });
      assert.match((await protectedEdit.json()).error, /time card is locked/i);
      await ok(await send(owner, await body(owner, "lock", [key(raw[6])])));
      assert.ok(!(await read(manager)).history.some(entry => entry.employeeId === f.b.id));
      await ok(await send(owner, await body(owner, "lock")));
      const period = (await read(second)).active.find(entry => entry.employeeId === null);
      assert.equal(period.endDate, range.end);
      assert.match((await (await changeCard({ date: "2026-10-25", originals: raw.slice(0, 2), start: raw[0].occurredAt, end: raw[1].occurredAt })).json()).error, /pay period is locked/i);
      assert.match((await (await changeCard({ originals: [], start: `${day.start}T20:00:00.000Z`, end: `${day.start}T21:00:00.000Z` })).json()).error, /pay period is locked/i);
      const adjustment = await change(owner, state => state.hoursAdjustments.push({ id: 835012, employeeId: f.a.id, date: day.start, hours: 0.25 }));
      assert.equal(adjustment.status, 409);
      assert.match((await adjustment.json()).error, /pay period is locked/i);
      const leave = await change(owner, state => state.ptoRequests.push({ id: 835013, employeeId: f.b.id, compensation: "paid",
        startDate: day.start, endDate: day.end, reason: "vacation", explanation: "Fictional paid leave", status: "approved", requestedAt: `${day.start}T18:00:00.000Z` }));
      assert.equal(leave.status, 409);
      assert.match((await leave.json()).error, /pay period is locked/i);
      assert.equal((await send(manager, await body(manager, "unlock"))).status, 403);
      await ok(await send(second, await body(second, "unlock")));
      assert.equal((await read(owner)).active.length, 3);
      const history = (await read(owner)).history;
      assert.equal(history[0].actor, f.secondOwner.displayName);
      assert.equal(history[0].action, "unlock");
      assert.ok(history.some(entry => entry.actor === f.manager.displayName && entry.action === "unlock"));
      await assert.rejects(db.run(sql`UPDATE timesheet_lock_events SET action='unlock'`));
      await assert.rejects(db.run(sql`DELETE FROM timesheet_lock_events`));
      assert.deepEqual(await db.select().from(schema.clockEvents).where(sql`id BETWEEN ${raw[0].id} AND ${raw.at(-1).id}`).orderBy(schema.clockEvents.id), raw);
    } finally {
      await db.delete(schema.accountPermissions).where(sql`account_id = ${f.manager.id} AND permission IN ('timesheets.manage','timesheets.lock')`);
    }
  });
  await t.test("scoped managers can add, edit and cancel approved leave with atomic audit and original and proposed period locks", async () => {
    const endpoint = "time-off";
    const original = "2026-11-07", proposed = "2026-11-14";
    const details = { category: "pto", startDate: original, endDate: original, startTime: "09:00", endTime: "11:30", reason: "vacation" };
    const [allowance] = await db.insert(schema.ptoPolicies).values({ name: "Manager action test PTO", method: "fixed", fixedAllowanceSeconds: 144000 }).returning();
    await db.insert(schema.ptoAssignments).values({ employeeId: f.a.id, policyId: allowance.id, startDate: "2026-11-01" });
    const callBody = async (cookie, action) => ({ ...action, id: newToken(), revision: (await snapshot(cookie)).revision });
    const post = (cookie, body) => call(endpoint, cookie, body);
    const history = (cookie, id) => call(endpoint + "?request=" + id, cookie);
    const accountHours = async date => (await ok(await call("accountant-export?start=" + date + "&end=" + date, owner)))
      .rows.find(row => row.employeeId === f.a.id)?.pto ?? 0;
    const audit = async id => db.select().from(schema.auditLog).where(sql`entity_type = 'pto-request' AND entity_id = ${String(id)}`).orderBy(schema.auditLog.id);
    const lock = async (date, action) => db.insert(schema.timesheetLockEvents).values({
      targetKey: "leave-test:" + date, startDate: date, endDate: date, startsAt: date + "T00:00:00Z", endsAt: date + "T23:59:59Z",
      action, actorAccountId: f.owner.id,
    });
    const add = { action: "add", employeeId: f.a.id, details };
    assert.equal((await post("", {})).status, 401);
    assert.equal((await post(manager, await callBody(manager, add))).status, 403);
    const crossDept = (await snapshot(owner)).state.ptoRequests.find(row => row.employeeId === f.b.id);
    assert.ok(crossDept);
    assert.equal((await history(manager, crossDept.id)).status, 404);
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "time_off.approve", allowed: true });
    try {
      assert.equal((await post(manager, await callBody(manager, { ...add, employeeId: f.b.id }))).status, 404);
      assert.equal((await post(manager, await callBody(manager, { ...add, employeeId: f.managerEmployee.id }))).status, 403);
      assert.equal((await post(manager, await callBody(manager, { ...add, details: { ...details, endTime: "08:00" } }))).status, 400);
      await lock(original, "lock");
      const lockedAdd = await post(manager, await callBody(manager, add));
      assert.equal(lockedAdd.status, 409);
      assert.match((await lockedAdd.json()).error, /pay period is locked/i);
      await lock(original, "unlock");
      const create = await callBody(owner, { ...add, details: { ...details, explanation: "Synthetic private employee note" } });
      const retries = await Promise.all([post(owner, create), post(owner, create)]);
      assert.deepEqual(retries.map(reply => reply.status), [200, 200]);
      assert.equal((await post(owner, { ...create, employeeId: f.multi.id })).status, 409);
      const booked = (await snapshot(owner)).state.ptoRequests.filter(row => row.employeeId === f.a.id && row.startDate === original);
      assert.equal(booked.length, 1);
      const [initial] = booked;
      assert.deepEqual([initial.status, initial.category], ["approved", "pto"]);
      assert.equal(await accountHours(original), 2.5);
      const initialHistory = await ok(await history(manager, initial.id));
      assert.equal(initialHistory.history.length, 1);
      assert.equal(initialHistory.history[0].actor, f.owner.displayName);
      assert.equal(initialHistory.history[0].action, "added");
      assert.doesNotMatch(JSON.stringify(initialHistory), /Synthetic private employee note/);

      const edit = { action: "edit", requestId: initial.id, version: initialHistory.record.version,
        details: { ...details, startDate: proposed, endDate: proposed, endTime: "10:30" } };
      assert.equal((await post(manager, await callBody(manager, { ...edit, details: { ...edit.details, explanation: "" } }))).status, 403);
      assert.equal((await post(manager, await callBody(manager, { ...edit, employeeId: f.b.id }))).status, 400);
      for (const date of [original, proposed]) {
        await lock(date, "lock");
        const lockedEdit = await post(manager, await callBody(manager, edit));
        assert.equal(lockedEdit.status, 409);
        assert.match((await lockedEdit.json()).error, /pay period is locked/i);
        await lock(date, "unlock");
      }
      const same = await ok(await history(manager, initial.id));
      assert.deepEqual(same, initialHistory);
      await db.run(sql`CREATE TRIGGER fixture_leave_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action = 'time_off.edited' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`);
      try {
        const attempt = await callBody(manager, edit);
        assert.equal((await post(manager, attempt)).status, 503);
        assert.deepEqual(await ok(await history(manager, initial.id)), initialHistory);
      } finally { await db.run(sql`DROP TRIGGER fixture_leave_audit_failure`); }
      await ok(await post(manager, await callBody(manager, edit)));
      const updated = await ok(await history(owner, initial.id));
      assert.equal(updated.record.status, "approved");
      assert.equal(updated.record.explanation, "Synthetic private employee note");
      assert.equal(updated.record.version, edit.version + 1);
      assert.deepEqual(updated.history.map(entry => [entry.action, entry.actor]), [["edited", f.manager.displayName], ["added", f.owner.displayName]]);
      const [edited] = updated.history;
      assert.deepEqual([edited.before.startDate, edited.after.startDate, edited.before.endTime, edited.after.endTime], [original, proposed, "11:30", "10:30"]);
      assert.doesNotMatch(JSON.stringify(await audit(initial.id)), /Synthetic private employee note/);
      assert.equal((await post(manager, await callBody(manager, edit))).status, 409);
      assert.equal(await accountHours(original), 0);
      assert.equal(await accountHours(proposed), 1.5);

      const cancel = { action: "cancel", requestId: initial.id, version: updated.record.version };
      await lock(proposed, "lock");
      assert.equal((await post(manager, await callBody(manager, cancel))).status, 409);
      const changeToUnpaid = { ...edit, details: { ...edit.details, category: "unpaid", startDate: original, endDate: original }, version: updated.record.version };
      assert.equal((await post(manager, await callBody(manager, changeToUnpaid))).status, 409);
      await lock(proposed, "unlock");
      await ok(await post(manager, await callBody(manager, cancel)));
      const removed = await ok(await history(manager, initial.id));
      assert.equal(removed.record.status, "cancelled");
      assert.deepEqual(removed.history.map(entry => entry.action), ["cancelled", "edited", "added"]);
      assert.equal(await accountHours(proposed), 0);
      assert.equal((await audit(initial.id)).length, 3);
      await assert.rejects(db.run(sql`UPDATE audit_log SET action = 'redacted' WHERE entity_type = 'pto-request'`));
    } finally {
      await db.delete(schema.accountPermissions).where(sql`account_id = ${f.manager.id} AND permission = 'time_off.approve'`);
    }
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
  await t.test("accountant report uses full workweeks and paid PTO with company and export grants", async () => {
    const period = { start: "2026-10-12", end: "2026-10-18" };
    const saturday = { start: "2026-10-17", end: "2026-10-17" };
    await db.update(schema.locationSettings).set({ workWeekStart: 1, overtimeDailyHours: 8, overtimeWeeklyHours: 40,
      overtimeDoubleEnabled: true, overtimeDoubleHours: 12 }).where(eq(schema.locationSettings.businessId, 1));
    const baseAt = date => Date.parse(`${date}T16:00:00.000Z`);
    const punches = (employeeId, roleName, date, duration, automatic = false) => [
      { employeeId, roleName, eventType: "in", occurredAt: new Date(baseAt(date)).toISOString(), source: "system", clockDetails: { california: true } },
      { employeeId, roleName, eventType: "out", occurredAt: new Date(baseAt(date) + duration * 3600000).toISOString(), source: "system", automatic },
    ];
    await db.update(schema.employees).set({ payrollId: "00127" }).where(eq(schema.employees.id, f.a.id));
    await db.insert(schema.wageRates).values({ employeeId: f.b.id, roleId: f.roleB.id, amountCents: 7800000, basis: "annual_salary",
      overtimeExempt: true, effectiveDate: period.start, recordedByAccountId: f.owner.id });
    for (const date of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      await db.insert(schema.clockEvents).values(punches(f.a.id, f.roleA.name, date, 8));
    }
    await db.insert(schema.clockEvents).values([
      ...punches(f.a.id, f.roleA.name, saturday.start, 10),
      ...punches(f.b.id, f.roleB.name, saturday.start, 14),
      ...punches(f.multi.id, f.roleB.name, saturday.start, 14),
      ...punches(f.managerEmployee.id, f.roleA.name, saturday.start, 2, true),
    ]);
    const leave = { employeeId: f.a.id, compensation: "paid", startDate: saturday.start, endDate: saturday.end, reason: "vacation", explanation: "Private test explanation" };
    await db.insert(schema.ptoRequests).values([
      { ...leave, status: "approved", startTime: "17:00", endTime: "19:00" },
      { ...leave, status: "approved", startTime: "18:00", endTime: "20:00" },
      { ...leave, status: "approved", compensation: "unpaid" },
      { ...leave, status: "pending" },
    ]);
    const route = "accountant-export?" + new URLSearchParams(period);
    assert.equal((await call(route, "")).status, 401);
    assert.equal((await call(route, manager)).status, 403);
    const accountant = await login(f.generalManager.email);
    assert.equal((await call(route, accountant)).status, 403);
    await db.insert(schema.accountPermissions).values([
      { accountId: f.manager.id, permission: "exports.timesheets", allowed: true },
      { accountId: f.generalManager.id, permission: "exports.timesheets", allowed: true },
      { accountId: f.generalManager.id, permission: "time_off.read", allowed: false },
    ]);
    try {
      assert.equal((await call(route, manager)).status, 403);
      assert.equal((await call(route + "&employee=1", owner)).status, 400);
      const response = await call(route, accountant);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const report = await ok(response);
      assert.deepEqual(report, await ok(await call(route, owner)));
      assert.equal(report.periodsPerYear, 52);
      const rowFor = (data, employee) => data.rows.find(row => row.employeeId === employee.id);
      const hours = row => [row.regular, row.overtime, row.doubleTime, row.pto, row.total];
      assert.deepEqual(hours(rowFor(report, f.a)), [40, 10, 0, 3, 53]);
      assert.equal(rowFor(report, f.a).payrollId, "00127");
      assert.deepEqual(hours(rowFor(report, f.b)), [14, 0, 0, 0, 14]);
      assert.equal(rowFor(report, f.b).salaryEligible, true);
      assert.deepEqual(hours(rowFor(report, f.multi)), [8, 4, 2, 0, 14]);
      assert.deepEqual(hours(rowFor(report, f.managerEmployee)), [null, null, null, 0, null]);
      const day = await ok(await call("accountant-export?" + new URLSearchParams(saturday), accountant));
      assert.equal(day.periodsPerYear, null);
      assert.deepEqual(hours(rowFor(day, f.a)), [0, 10, 0, 3, 13]);
      assert.equal(rowFor(day, f.b).salaryEligible, false);
      assert.doesNotMatch(JSON.stringify(report), /7800000|Private test explanation|wageRates|shiftId|\btips\b/i);
    } finally {
      await db.delete(schema.accountPermissions).where(sql`(account_id = ${f.manager.id} AND permission = 'exports.timesheets')
        OR (account_id = ${f.generalManager.id} AND permission IN ('exports.timesheets', 'time_off.read'))`);
    }
  });
  await t.test("restarting the local runtime preserves records and FK integrity", async () => {
    await platform.dispose(); platform = await open(); services(); owner = await login(f.owner.email); second = await login(f.secondOwner.email); manager = await login(f.manager.email);
    const view = await snapshot(second); assert.ok(view.state.employees.some(e => e.id === createdId)); assert.ok(view.state.shifts.some(s => s.id === 72001));
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
    assert.equal((await call("commit", owner, {}, { Origin: "https://attacker.test" })).status, 403);
  });
  await t.test("automatic clock-out is server-owned, location-timed and idempotent", async () => {
    await db.update(schema.locationSettings).set({ automaticClockOut: true, automaticClockOutMinutes: 120, breakWaivers: true }).where(eq(schema.locationSettings.businessId, 1));
    const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, 72001));
    const [clockIn, meal] = await db.insert(schema.clockEvents).values([
      { employeeId: createdId, eventType: "in", occurredAt: "2026-11-10T17:00:00.000Z", shiftId: shift.id, roleName: "Shared job", source: "system", clockDetails: { california: true } },
      { employeeId: createdId, eventType: "break", occurredAt: "2026-11-10T21:30:00.000Z", shiftId: shift.id, roleName: "Shared job", source: "system", clockDetails: { breakKind: "meal" } },
    ]).returning();
    const now = Date.parse("2026-11-11T04:00:00.000Z");
    const readCard = () => db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, shift.id)).orderBy(schema.clockEvents.id);
    assert.equal(await runClockMaintenance(db, now), 0);
    assert.deepEqual(await readCard(), [clockIn, meal]);
    await db.update(schema.locationSettings).set({ breakWaivers: false }).where(eq(schema.locationSettings.businessId, 1));
    const threshold = Date.parse("2026-11-11T03:00:00.000Z");
    assert.equal(await runClockMaintenance(db, threshold - 1), 0);
    const results = await Promise.all([runClockMaintenance(db, threshold), runClockMaintenance(db, threshold)]);
    assert.deepEqual(results.sort(), [0, 1]);
    assert.equal(await runClockMaintenance(db, now), 0);
    const events = await readCard();
    assert.deepEqual(events.slice(0, 2), [clockIn, meal]);
    assert.equal(events.length, 3);
    const last = events.at(-1);
    assert.equal(last.eventType, "out");
    assert.equal(last.automatic, true);
    assert.equal(last.occurredAt, "2026-11-11T03:00:00.000Z");
    assert.equal(last.clockDetails, null);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "clock.automatic_out"));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entityId, String(last.id));
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
