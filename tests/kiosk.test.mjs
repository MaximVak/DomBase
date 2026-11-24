import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedKioskFixture, employeePin, otherEmployeePin, cookiesOf } from "./support/kiosk-fixture.mjs";

test("registered tablets, PIN sessions and action-scoped approvals use isolated D1", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const state = await mkdtemp(join(projectRoot, ".wrangler/kiosk-check-"));
  let platform; t.after(async () => { try { await platform?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], state);
  const { getPlatformProxy } = await import("wrangler");
  const open = () => getPlatformProxy({ configPath, persist: { path: join(state, "v3") }, remoteBindings: false, envFiles: [] });
  platform = await open();
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createKioskAdmin, createKioskService, pinLookup, verifyPin, tokenHash,
    createWorkforceService, runScheduledMaintenance, createSelfService, dispatchClockReminderEmails } = await loadServerModule("tests/support/kiosk-runtime.ts");
  const secret = randomBytes(32).toString("hex");
  const password = randomBytes(24).toString("base64url");
  let fixturePin1;
  do { fixturePin1 = String(randomInt(100000, 810000)); } while ([employeePin, otherEmployeePin].includes(fixturePin1));
  let fixturePin2;
  do { fixturePin2 = String(randomInt(100000, 810000)); } while ([employeePin, otherEmployeePin, fixturePin1].includes(fixturePin2));
  const origin = "http://localhost:3000";
  let time = Date.now(); let db; let auth; let access; let admin; let kiosk;
  function services() {
    db = drizzle(platform.env.DB, { schema }); auth = createAuthService(db, { secret, now: () => time });
    access = createAccessService(db, auth); admin = createKioskAdmin(db, access, secret); kiosk = createKioskService(db, { secret, now: () => time, bucket: platform.env.FILES });
  }
  services(); const f = await seedKioskFixture(db, schema, loadServerModule, password);
  const request = (service, path, cookie = "", body, headers = {}) => service.handle(new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const adm = (action, cookie, body, headers) => request(admin, `/api/kiosk-admin/${action}`, cookie, body, headers);
  const clock = (action, cookie, body, headers) => request(kiosk, `/api/kiosk/${action}`, cookie, body, headers);
  async function login(email) { const response = await request(auth, "/api/auth/login", "", { email, password }); assert.equal(response.status, 200); return cookiesOf(response)[0]; }
  async function ok(response) { assert.equal(response.status, 200); return response.json(); }
  async function person(pin = employeePin, device = deviceCookie) {
    const response = await clock("pin", device, { pin }); assert.equal(response.status, 200);
    return { cookie: `${device}; ${cookiesOf(response)[0]}`, data: await response.json() };
  }
  let ownerCookie = await login(f.owner.email); const managerCookie = await login(f.manager.email);
  let managerPin; let ownerPin;
  let deviceCookie; let device2; let deviceId;

  await t.test("enrollment requires dashboard permissions/password and unique separate PINs", async () => {
    assert.equal((await adm("register", "", { name: "Tablet", password })).status, 401);
    assert.equal((await adm("register", managerCookie, { name: "Tablet", password })).status, 403);
    assert.equal((await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: "0000", password })).status, 400);
    assert.equal((await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: employeePin, password: "wrong" })).status, 401);
    await ok(await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: employeePin, password }));
    await ok(await adm("employee-pin", ownerCookie, { employeeId: f.b.id, pin: otherEmployeePin, password }));
    managerPin = (await ok(await adm("approval-pin", managerCookie, { password }))).pin;
    ownerPin = (await ok(await adm("approval-pin", ownerCookie, { password }))).pin;
    const taken = await adm("approval-pin", managerCookie, { pin: employeePin, password });
    const unused = await adm("approval-pin", managerCookie, { pin: "12345678", password });
    assert.equal(taken.status, 400); assert.equal(unused.status, taken.status);
    assert.deepEqual(await taken.json(), await unused.json());
    assert.match(managerPin, /^\d{8}$/); assert.notEqual(managerPin, employeePin);
    assert.equal((await ok(await adm("approval-pin", managerCookie))).pin, undefined);
    assert.equal((await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: managerPin, password })).status, 409);
    const [stored] = await db.select().from(schema.employees).where(eq(schema.employees.id, f.a.id));
    assert.equal(stored.pinLookup, pinLookup(secret, employeePin));
    assert.equal(await verifyPin(secret, employeePin, stored.pinHash), true);
    assert.equal(await verifyPin(randomBytes(32).toString("hex"), employeePin, stored.pinHash), false);
    assert.equal(JSON.stringify(stored).includes(employeePin), false);
    assert.equal((await adm("approval-pin", managerCookie, { pin: "1234", password, accountId: f.owner.id })).status, 400);
  });
  await t.test("registration persists a separate device cookie and ends the registering dashboard session", async () => {
    const response = await adm("register", ownerCookie, { name: "Isolated tablet", password });
    await ok(response); const cookies = cookiesOf(response); deviceCookie = cookies.find(cookie => cookie.startsWith("dombase-kiosk-device="));
    assert.ok(deviceCookie); assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith("dombase-kiosk-device=") && /Max-Age=31536000/.test(cookie) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie)));
    assert.equal((await request(auth, "/api/auth/session", ownerCookie)).status, 401);
    ownerCookie = await login(f.owner.email);
    assert.equal((await request(auth, "/api/auth/session", `${ownerCookie}; ${deviceCookie}`)).status, 403);
    assert.equal((await request(access, "/api/access/me", `${ownerCookie}; ${deviceCookie}`)).status, 403);
    assert.equal((await request(auth, "/api/auth/login", deviceCookie, { email: f.owner.email, password })).status, 403);
    assert.equal((await request(auth, "/api/auth/session", `dombase-session=${deviceCookie.split("=")[1]}`)).status, 401);
    assert.equal((await clock("pin", "", { pin: employeePin })).status, 401);
    deviceId = (await db.select().from(schema.deviceSessions).where(eq(schema.deviceSessions.tokenHash, tokenHash(deviceCookie.split("=")[1]))))[0].deviceId;
    const second = await adm("register", ownerCookie, { name: "Second isolated tablet", password }); await ok(second);
    device2 = cookiesOf(second).find(cookie => cookie.startsWith("dombase-kiosk-device="));
    ownerCookie = await login(f.owner.email);
    const token = deviceCookie.split("=")[1]; const [stored] = await db.select().from(schema.deviceSessions).where(eq(schema.deviceSessions.deviceId, deviceId));
    assert.equal(stored.tokenHash, tokenHash(token)); assert.equal(JSON.stringify(stored).includes(token), false);
  });
  await t.test("authorized admins can adjust the saved PIN timeout without changing other settings", async () => {
    assert.deepEqual(await ok(await adm("clock-options", ownerCookie)), { idleSeconds: 30 });
    assert.equal((await adm("clock-options", managerCookie, { idleSeconds: 10, expectedSeconds: 30 })).status, 403);
    assert.equal((await adm("clock-options", deviceCookie)).status, 403);
    assert.equal((await adm("clock-options", ownerCookie, { idleSeconds: 121, expectedSeconds: 30 })).status, 400);
    assert.deepEqual(await ok(await adm("clock-options", ownerCookie, { idleSeconds: 10, expectedSeconds: 30 })), { idleSeconds: 10 });
    assert.equal((await adm("clock-options", ownerCookie, { idleSeconds: 50, expectedSeconds: 30 })).status, 409);
    const p = await person(); assert.equal(Date.parse(p.data.expiresAt), time + 10000);
    await ok(await adm("clock-options", ownerCookie, { idleSeconds: 30, expectedSeconds: 10 }));
  });
  await t.test("employee PINs expose only that person, bind to one tablet and expire server-side", async () => {
    for (const pin of ["0000", "000000", "not-a-pin", managerPin]) assert.equal((await clock("pin", deviceCookie, { pin })).status, 401);
    const p = await person();
    assert.deepEqual(Object.keys(p.data).sort(), ["employee", "expiresAt", "roles", "state"]);
    assert.deepEqual(p.data.employee, { id: f.a.id, name: f.a.name });
    assert.deepEqual(p.data.roles, [{ id: f.roleA.id, name: f.roleA.name }]);
    assert.equal((await clock("clock", `${device2}; ${p.cookie.split("; ")[1]}`, { eventType: "in", roleId: f.roleA.id, explanation: "" })).status, 401);
    assert.equal((await request(auth, "/api/auth/session", `dombase-session=${p.cookie.split("; ")[1].split("=")[1]}`)).status, 401);
    time += 31000;
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" })).status, 401);
    assert.equal((await clock("status", deviceCookie)).status, 200);
    assert.equal((await clock("pin", deviceCookie, { pin: employeePin, employeeId: f.b.id, accessLevel: "owner" })).status, 400);
  });
  await t.test("a manager PIN approves exactly one bound clock request then ends the person session", async () => {
    await db.insert(schema.business).values({ id: 1, companyName: "Fictional kiosk test", locationName: "Test only" }).onConflictDoNothing();
    await db.insert(schema.locationSettings).values({ businessId: 1, clockInPhotos: true }).onConflictDoUpdate({ target: schema.locationSettings.businessId, set: { clockInPhotos: true } });
    const cameraPin = await ok(await clock("pin", deviceCookie, { pin: employeePin, breaks: true }));
    assert.equal(cameraPin.clockInPhotos, true);
    const p = await person(); const response = await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "Approved test clock-in" });
    assert.equal(response.status, 202); const pending = await response.json(); assert.equal(pending.approvalRequired, true);
    assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: employeePin })).status, 401);
    const wrongDevicePerson = await person(employeePin, device2);
    assert.equal((await clock("approve", wrongDevicePerson.cookie, { requestId: pending.requestId, pin: managerPin })).status, 409);
    const success = await clock("approve", p.cookie, { requestId: pending.requestId, pin: managerPin, photo: true });
    const { photoGrant } = await ok(success);
    assert.ok(cookiesOf(success).some(cookie => cookie === "dombase-kiosk-person="));
    assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: managerPin })).status, 401);
    const [event] = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.idempotencyKey, pending.requestId));
    assert.equal(event.employeeId, f.a.id); assert.equal(event.recordedByAccountId, f.manager.id); assert.equal(event.deviceId, deviceId); assert.equal(event.source, "kiosk"); assert.equal(event.occurredAt, new Date(time).toISOString());
    assert.ok(photoGrant.startsWith(`${event.id}.`));
    const image = Uint8Array.of(255, 216, 255, 224, 0, 2, 255, 217);
    const upload = (cookie, bytes = image, requestOrigin = origin) => kiosk.handle(new Request(`${origin}/api/kiosk/clock-photo`, {
      method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "image/jpeg", "X-Clock-Photo-Grant": photoGrant }, body: bytes,
    }));
    assert.equal((await upload(device2)).status, 403);
    assert.equal((await upload(deviceCookie, image, "https://elsewhere.test")).status, 403);
    assert.equal((await upload(deviceCookie)).status, 200);
    assert.equal((await upload(deviceCookie)).status, 200);
    assert.equal((await upload(deviceCookie, Uint8Array.of(255, 216, 255, 225, 0, 2, 255, 217))).status, 409);
    const workforce = createWorkforceService(db, access, { secret, fieldKey: randomBytes(32).toString("base64url"), now: () => time, bucket: platform.env.FILES });
    const path = `/api/workspace/clock-photo?event=${event.id}`;
    assert.equal((await request(workforce, path)).status, 401);
    assert.equal((await request(workforce, path, deviceCookie)).status, 403);
    const imageResponse = await request(workforce, path, managerCookie);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), image);
    const photoState = await ok(await request(workforce, "/api/workspace/state", managerCookie));
    assert.equal(photoState.state.clockEvents.find(row => row.id === event.id)?.photoEventId, event.id);
    await db.update(schema.locationSettings).set({ clockInPhotos: false }).where(eq(schema.locationSettings.businessId, 1));
    const grants = await db.select().from(schema.kioskApprovalSessions); assert.equal(grants.length, 1); assert.ok(grants[0].usedAt); assert.equal(grants[0].targetId, pending.requestId);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "kiosk.clock_approved")); assert.equal(audits.length, 1);
    await assert.rejects(db.update(schema.clockEvents).set({ occurredAt: "2020-01-01" }).where(eq(schema.clockEvents.id, event.id)));
  });
  await t.test("department scope and current permissions also apply to manager PIN approvals", async () => {
    const p = await person(otherEmployeePin); const response = await clock("clock", p.cookie, { eventType: "in", roleId: f.roleB.id, explanation: "" }); assert.equal(response.status, 202); const pending = await response.json();
    assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: managerPin })).status, 403);
    await db.insert(schema.accountPermissions).values({ accountId: f.owner.id, permission: "kiosk.approve", allowed: false });
    // Explicit Owner remains Owner; configurable manager grants cannot revoke that identity.
    await ok(await clock("approve", p.cookie, { requestId: pending.requestId, pin: ownerPin }));
    const again = await person(); await ok(await clock("clock", again.cookie, { eventType: "out", explanation: "" }));
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "kiosk.approve", allowed: false });
    const deniedPerson = await person(); const denied = await clock("clock", deniedPerson.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" }); const d = await denied.json();
    assert.equal((await clock("approve", deniedPerson.cookie, { requestId: d.requestId, pin: managerPin })).status, 403);
    await db.delete(schema.accountPermissions).where(eq(schema.accountPermissions.accountId, f.manager.id));
    await clock("lock", deviceCookie, {});
  });
  await t.test("scheduled punches, breaks and duplicate actions are serialized without a dashboard session", async () => {
    time += 900001;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    const [pub] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: f.owner.id }).returning();
    const [off] = await db.insert(schema.shifts).values({ employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "00:00", endTime: "00:00", shiftType: "day_off", publicationId: pub.id }).returning();
    const offPerson = await person();
    const offResponse = await clock("clock", offPerson.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "Day-off test" });
    assert.equal(offResponse.status, 202);
    assert.equal((await offResponse.json()).approvalRequired, true, "A day off must never authorize a scheduled clock-in");
    await clock("lock", deviceCookie, {});
    await db.update(schema.shifts).set({ archivedAt: new Date(time).toISOString() }).where(eq(schema.shifts.id, off.id));
    await db.insert(schema.shifts).values({ employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "00:00", endTime: "23:59", publicationId: pub.id });
    const p = await person();
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleB.id, explanation: "" })).status, 403);
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "", occurredAt: "2020-01-01", employeeId: f.b.id })).status, 400);
    const before = (await db.select().from(schema.clockEvents)).length;
    const concurrent = await Promise.all([clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" }), clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" })]);
    assert.equal(concurrent.filter(r => r.status === 200).length, 1); assert.equal((await db.select().from(schema.clockEvents)).length, before + 1);
    const rest = await person();
    await ok(await clock("clock", rest.cookie, { eventType: "break", explanation: "", details: { breakKind: "rest" } }));
    const returning = await person();
    assert.equal((await clock("clock", returning.cookie, { eventType: "break_end", explanation: "" })).status, 422);
    await ok(await clock("clock", returning.cookie, { eventType: "break_end", explanation: "", details: { worked: true } }));
    const endOfShift = await person();
    await ok(await clock("clock", endOfShift.cookie, { eventType: "out", explanation: "" }));
    const recent = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, f.a.id));
    assert.deepEqual(recent.at(-3).clockDetails, { breakKind: "rest", minimumMinutes: 10 });
    assert.deepEqual(recent.at(-2).clockDetails, { earlyWork: true });
    const out = await person(); assert.equal((await clock("clock", out.cookie, { eventType: "out", explanation: "" })).status, 409);
    await clock("lock", deviceCookie, {});
  });
  await t.test("an audit failure rolls back the punch, approval and session changes together", async () => {
    const p = await person(); const before = (await db.select().from(schema.clockEvents)).length;
    await db.run(sql`CREATE TRIGGER reject_kiosk_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'kiosk.clock_recorded' BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" })).status, 503);
    assert.equal((await db.select().from(schema.clockEvents)).length, before);
    const interactions = await db.select().from(schema.kioskInteractions).where(eq(schema.kioskInteractions.employeeId, f.a.id)); assert.ok(interactions.some(i => !i.endedAt));
    await db.run(sql`DROP TRIGGER reject_kiosk_audit`);
    await ok(await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" }));
  });
  await t.test("queued actions survive PIN expiry, deduplicate online replies and report conflicts to scoped review", async () => {
    const issue = async () => {
      const response = await clock("pin", deviceCookie, { pin: employeePin, queue: true });
      const { replay } = await ok(response);
      return { replay, cookie: `${deviceCookie}; ${cookiesOf(response)[0]}` };
    };
    const make = (replay, eventType, explanation, roleId) => ({ ticket: replay.ticket, attemptedAt: replay.serverTime, eventType, explanation, roleId });
    const count = async () => (await db.select().from(schema.clockEvents)).length;

    const offline = await issue();
    const action = make(offline.replay, "out", "Recorded during a connection drop");
    const before = await count();
    assert.equal((await clock("sync", device2, action)).status, 403);
    assert.equal((await clock("sync", deviceCookie, { ...action, ticket: `${action.ticket}0` })).status, 403);
    assert.equal((await clock("sync", deviceCookie, { ...action, attemptedAt: time - 1 })).status, 422);
    time += 10;
    await ok(await clock("lock", deviceCookie, {}));
    time += 31000;
    for (const response of await Promise.all([clock("sync", deviceCookie, action), clock("sync", deviceCookie, action)])) {
      assert.deepEqual(await ok(response), { outcome: "synced" });
    }
    assert.equal(await count(), before + 1);
    const [saved] = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.idempotencyKey, action.ticket.split(".")[0]));
    assert.equal(saved.occurredAt, new Date(action.attemptedAt).toISOString());
    assert.equal(saved.receivedAt, new Date(time).toISOString());
    assert.equal(saved.source, "offline");
    assert.equal((await clock("sync", deviceCookie, { ...action, explanation: "Changed after sync" })).status, 409);

    const online = await issue();
    const ordinary = make(online.replay, "in", "Response lost", f.roleA.id);
    await ok(await clock("clock", online.cookie, { ticket: ordinary.ticket, eventType: "in", roleId: f.roleA.id, explanation: ordinary.explanation }));
    assert.deepEqual(await ok(await clock("sync", deviceCookie, ordinary)), { outcome: "synced" });
    assert.equal(await count(), before + 2);

    const stale = await issue();
    time += 10;
    const other = await person(employeePin, device2);
    await ok(await clock("clock", other.cookie, { eventType: "out", explanation: "Newer attendance" }));
    const conflict = make(stale.replay, "break", "Review against newer clock-out");
    assert.deepEqual(await ok(await clock("sync", deviceCookie, conflict)), { outcome: "review" });
    assert.deepEqual(await ok(await clock("sync", deviceCookie, conflict)), { outcome: "review" });
    assert.equal(await count(), before + 3);
    assert.equal((await adm("offline-review", managerCookie)).status, 403);
    assert.equal((await adm("offline-review", deviceCookie)).status, 403);
    const { entries } = await ok(await adm("offline-review", ownerCookie));
    assert.deepEqual(entries, [{ id: conflict.ticket.split(".")[0], employee: f.a.name, role: f.roleA.name,
      eventType: "break", attemptedAt: new Date(conflict.attemptedAt).toISOString(), explanation: conflict.explanation, details: null }]);
    await ok(await adm("offline-review", ownerCookie, { id: entries[0].id }));
    assert.deepEqual(await ok(await adm("offline-review", ownerCookie)), { entries: [] });
    const queuedIn = await issue();
    const lockedRange = { targetKey: "period:offline-lock-test", startDate: "2026-01-01", endDate: "2026-12-31",
      startsAt: new Date(time - 60000).toISOString(), endsAt: new Date(time + 60000).toISOString(), actorAccountId: f.owner.id };
    await db.insert(schema.timesheetLockEvents).values({ ...lockedRange, action: "lock" });
    try {
      const queued = make(queuedIn.replay, "in", "Delayed punch for review", f.roleA.id);
      assert.deepEqual(await ok(await clock("sync", deviceCookie, queued)), { outcome: "review" });
      assert.equal(await count(), before + 3);
      const { entries } = await ok(await adm("offline-review", ownerCookie));
      assert.ok(entries.some(entry => entry.explanation === queued.explanation));
    } finally {
      await db.insert(schema.timesheetLockEvents).values({ ...lockedRange, action: "unlock" });
    }
  });
  await t.test("California clock controls preserve paid rest and validate a voluntary waiver on the server", async () => {
    const { zonedTimestamp } = await loadServerModule("workforce/time.ts");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    const fixed = wall => zonedTimestamp(date, wall, "America/Los_Angeles");
    let at = fixed("08:50");
    const ca = createKioskService(db, { secret, now: () => at });
    const send = (action, session, body) => request(ca, `/api/kiosk/${action}`, session, body);
    const pin = fixturePin1;
    await ok(await adm("employee-pin", ownerCookie, { employeeId: f.multi.id, pin, password }));
    await db.insert(schema.employeeSettings).values({ employeeId: f.multi.id, canWaiveMissedBreaks: true });
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 2, publishedByAccountId: f.owner.id }).returning();
    await db.insert(schema.shifts).values({ employeeId: f.multi.id, roleId: f.roleA.id, date, startTime: "09:00", endTime: "18:00", publicationId: publication.id });
    const settings = values => db.update(schema.locationSettings).set(values).where(eq(schema.locationSettings.businessId, 1));
    const sign = async () => {
      const response = await send("pin", deviceCookie, { pin, breaks: true, queue: true });
      return { data: await ok(response), cookie: `${deviceCookie}; ${cookiesOf(response)[0]}` };
    };
    const entry = { eventType: "in", roleId: f.roleA.id, explanation: "" };
    let actor = await sign();
    assert.equal((await send("clock", actor.cookie, entry)).status, 422);
    assert.equal((await send("clock", actor.cookie, { ...entry, details: { worked: true } })).status, 202);
    await ok(await send("lock", deviceCookie, {}));
    await settings({ blockEarlyClockIn: false, breakWaivers: true, unpaidRestOverage: true });
    try {
      actor = await sign();
      await ok(await send("clock", actor.cookie, entry));
      at = fixed("10:00");
      actor = await sign();
      const ticket = actor.data.replay.ticket;
      await ok(await send("lock", deviceCookie, {}));
      const sync = { eventType: "break", explanation: "", details: { breakKind: "rest" }, ticket, attemptedAt: at };
      at += 31000;
      assert.deepEqual(await ok(await send("sync", deviceCookie, sync)), { outcome: "synced" });
      at = fixed("10:15");
      actor = await sign();
      assert.deepEqual(actor.data.breakView.active, { kind: "rest", availableAt: fixed("10:10"), extensionAt: fixed("10:10") });
      await ok(await send("clock", actor.cookie, { eventType: "break_end", explanation: "", details: { offDutyExtension: true } }));
      at = fixed("14:20");
      actor = await sign();
      assert.equal(actor.data.assist.out, false);
      assert.equal((await send("clock", actor.cookie, { eventType: "out", explanation: "I forgot to sign out.",
        details: { assisted: { date, time: "14:15" } } })).status, 422);
      assert.deepEqual(actor.data.breakView.issues, [{ kind: "meal", slot: 1, canWaive: true }]);
      const waiver = { kind: "meal", slot: 1, outcome: "waived", reason: "Voluntarily elected to waive the first meal." };
      const exit = reports => ({ eventType: "out", explanation: "", details: { reports } });
      assert.equal((await send("clock", actor.cookie, exit([]))).status, 422);
      assert.equal((await send("clock", actor.cookie, exit([{ ...waiver, slot: 2 }]))).status, 422);
      await ok(await send("clock", actor.cookie, exit([waiver])));
      const events = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, f.multi.id));
      assert.equal(events.length, 4);
      assert.equal(events[1].source, "offline");
      assert.deepEqual(events[1].clockDetails, { breakKind: "rest", minimumMinutes: 10 });
      assert.deepEqual(events[2].clockDetails, { unpaidSeconds: 300 });
      assert.deepEqual(events[3].clockDetails, { california: true, reports: [waiver] });
    } finally {
      await settings({ blockEarlyClockIn: true, breakWaivers: false, unpaidRestOverage: false });
    }
  });
  await t.test("split-shift notes and the five-minute check-in window follow the same published shift", async () => {
    const { nextDate, zonedTimestamp } = await loadServerModule("workforce/time.ts");
    const zone = "America/Los_Angeles";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    const date = nextDate(nextDate(today));
    const stamp = wall => zonedTimestamp(date, wall, zone);
    const [employee] = await db.insert(schema.employees).values({ name: "Fictional early check-in employee", pinHash: "early-check-in-fixture-before-enrollment" }).returning();
    await db.insert(schema.employeeRoles).values([f.roleA, f.roleB].map(role => ({ employeeId: employee.id, roleId: role.id })));
    const pin = "812018";
    await ok(await adm("employee-pin", ownerCookie, { employeeId: employee.id, pin, password }));
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 555, publishedByAccountId: f.owner.id }).returning();
    await db.insert(schema.shifts).values([["09:00", "11:00", "Morning handoff"], ["13:00", "15:00", "Afternoon pickup"], ["17:00", "19:00", ""]].map(([startTime, endTime, notes]) => ({
      employeeId: employee.id, roleId: f.roleA.id, date, startTime, endTime, notes, publicationId: publication.id,
    })));
    const alternate = { employeeId: employee.id, roleId: f.roleB.id, date, startTime: "15:00", endTime: "16:00", notes: "Alternate role instructions", publicationId: publication.id };
    await db.insert(schema.shifts).values([
      alternate,
      { ...alternate, startTime: "08:00", endTime: "09:00", notes: "Unpublished note", publicationId: null },
      { ...alternate, startTime: "08:00", endTime: "09:00", notes: "Archived note", archivedAt: new Date(time).toISOString() },
      { ...alternate, employeeId: f.b.id, startTime: "08:00", endTime: "09:00", notes: "Another employee’s note" },
    ]);
    let at = stamp("08:55") - 1;
    const clockService = createKioskService(db, { secret, now: () => at });
    const send = (action, session, body) => request(clockService, `/api/kiosk/${action}`, session, body);
    const signedIn = async () => {
      const response = await send("pin", deviceCookie, { pin, queue: true, breaks: true });
      assert.equal(response.headers.get("cache-control"), "no-store");
      return { data: await ok(response), cookie: `${deviceCookie}; ${cookiesOf(response)[0]}` };
    };
    const clockIn = { eventType: "in", roleId: f.roleA.id, explanation: "" };
    const clockOut = { eventType: "out", explanation: "" };
    const schedule = text => ({ roleId: f.roleA.id, notes: [
      { roleId: f.roleA.id, text }, { roleId: f.roleB.id, text: alternate.notes },
    ].sort((a, b) => a.roleId - b.roleId) });
    let actor = await signedIn();
    assert.deepEqual(actor.data.clockInSchedule, schedule("Morning handoff"));
    assert.equal((await send("clock", actor.cookie, clockIn)).status, 422);
    at++;
    await ok(await send("clock", actor.cookie, clockIn));
    at = stamp("10:00");
    actor = await signedIn();
    assert.equal(actor.data.clockInSchedule, undefined);
    await ok(await send("clock", actor.cookie, clockOut));
    at = stamp("12:57");
    actor = await signedIn();
    assert.deepEqual(actor.data.clockInSchedule, schedule("Afternoon pickup"));
    await ok(await send("clock", actor.cookie, { ...clockIn, details: { worked: true } }));
    at = stamp("14:00");
    await ok(await send("clock", (await signedIn()).cookie, clockOut));
    at = stamp("16:58");
    actor = await signedIn();
    assert.equal(actor.data.clockInSchedule, undefined);
    await ok(await send("sync", deviceCookie, { ...clockIn, attemptedAt: at, ticket: actor.data.replay.ticket }));
    at = stamp("18:00");
    await ok(await send("clock", (await signedIn()).cookie, clockOut));
    const starts = (await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, employee.id)))
      .filter(event => event.eventType === "in" && Date.parse(event.occurredAt) >= stamp("08:55"));
    assert.deepEqual(starts.map(event => [Date.parse(event.occurredAt), event.clockDetails?.scheduledStart, event.clockDetails?.earlyWork]), [
      [stamp("08:55"), new Date(stamp("09:00")).toISOString(), undefined],
      [stamp("12:57"), undefined, true],
      [stamp("16:58"), undefined, undefined],
    ]);
  });
  await t.test("assisted clock times, role-scoped attendance and reminders preserve raw entries", async () => {
    const { nextDate, zonedTimestamp } = await loadServerModule("workforce/time.ts");
    const { fieldKey } = await import("./support/workforce-fixture.mjs");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    const date = nextDate(day);
    const fixed = wall => zonedTimestamp(date, wall);
    let at = fixed("09:00");
    const ca = createKioskService(db, { secret, now: () => at });
    const workforce = createWorkforceService(db, access, { secret, fieldKey, now: () => at });
    const self = createSelfService(db, auth, secret, () => time);
    const send = (action, session, body) => request(ca, `/api/kiosk/${action}`, session, body);
    const manage = (action, session, body) => request(workforce, `/api/workspace/${action}`, session, body);
    const [pub] = await db.insert(schema.schedulePublications).values({ version: 3, publishedByAccountId: f.owner.id }).returning();
    const [morning, other, afternoon] = await db.insert(schema.shifts).values([
      { employeeId: f.multi.id, roleId: f.roleA.id, date, startTime: "09:00", endTime: "11:30", publicationId: pub.id },
      { employeeId: f.b.id, roleId: f.roleB.id, date, startTime: "09:00", endTime: "12:30", publicationId: pub.id },
      { employeeId: f.multi.id, roleId: f.roleA.id, date, startTime: "14:30", endTime: "15:00", publicationId: pub.id },
    ]).returning();
    const [employeeAccount] = await db.insert(schema.accounts).values({
      email: "assisted-clock-employee@example.test", normalizedEmail: "assisted-clock-employee@example.test",
      displayName: f.multi.name, accessLevel: "employee", employeeId: f.multi.id, passwordHash: f.owner.passwordHash, loginEnabled: true,
    }).returning();
    const employee = await login(employeeAccount.email);
    const ownAlerts = body => request(self, "/api/self/schedule-alerts", employee, body);
    async function changePreferences(sendPreference, events) {
      const { revision, version, scheduleVersion, contextToken } = await ok(await sendPreference());
      return ok(await sendPreference({ id: randomBytes(32).toString("base64url"), revision, version, scheduleVersion, contextToken, events }));
    }
    const ownPreferences = body => request(self, "/api/self/notification-preferences", employee, body);
    const pin = fixturePin1;
    async function sign() {
      const response = await send("pin", deviceCookie, { pin, breaks: true, queue: true });
      return { data: await ok(response), cookie: `${deviceCookie}; ${cookiesOf(response)[0]}` };
    }
    const report = (eventType, wall) => ({ eventType, ...(eventType === "in" ? { roleId: f.roleA.id } : {}),
      explanation: "I forgot to use the tablet.", details: { assisted: { date, time: wall } } });
    assert.equal((await manage("attendance", "")).status, 401);
    assert.equal((await manage("assisted-clocks", deviceCookie)).status, 403);
    at = fixed("09:04");
    await runScheduledMaintenance(db, at);
    const overdue = await ok(await manage("attendance", managerCookie));
    assert.equal(overdue.rows.find(row => row.id === "shift-" + morning.id).status, "Late");
    assert.equal(overdue.alerts.some(alert => alert.employee === f.multi.name && alert.title === "Clock-in overdue"), true);
    assert.equal(overdue.rows.some(row => row.id === "shift-" + other.id), false);
    await changePreferences(body => manage("notification-preferences", managerCookie, body), { lateArrival: { inApp: false } });
    const mutedAttendance = await ok(await manage("attendance", managerCookie));
    assert.deepEqual(mutedAttendance.rows, overdue.rows);
    assert.equal(mutedAttendance.alerts.some(alert => alert.employee === f.multi.name && alert.title === "Clock-in overdue"), false);
    assert.equal((await ok(await manage("attendance", ownerCookie))).alerts.some(alert => alert.employee === f.multi.name), true);
    const person = await sign();
    assert.equal(person.data.assist.in, true);
    assert.equal((await send("clock", person.cookie, report("in", "09:20"))).status, 422);
    assert.equal((await ok(await send("clock", person.cookie, report("in", "08:58")))).assistance, "pending");
    const [start] = (await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, morning.id)));
    assert.equal(start.occurredAt, new Date(at).toISOString());
    assert.equal((await manage("assisted-clocks", managerCookie)).status, 403);
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "timesheets.manage", allowed: true });
    const review = await ok(await manage("assisted-clocks", managerCookie));
    assert.equal(review.requests[0].id, start.id);
    assert.equal(review.requests[0].requestedAt, new Date(fixed("08:58")).toISOString());
    assert.equal((await ok(await manage("attendance", managerCookie))).pendingReports, 1);
    const before = await ok(await manage("state", managerCookie));
    const provisional = before.state.clockEvents.find(event => event.id === start.id);
    assert.equal(provisional.at, new Date(fixed("08:58")).toISOString());
    assert.equal(provisional.assistedStatus, "pending");
    await ok(await manage("assisted-clocks", managerCookie, { id: start.id, action: "edit", actual: { date, time: "08:59" } }));
    assert.equal((await manage("assisted-clocks", managerCookie, { id: start.id, action: "approve" })).status, 404);
    at = fixed("09:45");
    await runScheduledMaintenance(db, at);
    const ownerAttendance = await ok(await manage("attendance", ownerCookie));
    assert.equal(ownerAttendance.rows.find(row => row.id === "shift-" + other.id).status, "No show");
    assert.equal(ownerAttendance.alerts.some(alert => alert.employee === f.b.name && alert.title === "No-show"), true);
    const breakActor = await sign();
    await ok(await send("clock", breakActor.cookie, { eventType: "break", explanation: "", details: { breakKind: "rest" } }));
    assert.equal((await ok(await manage("attendance", managerCookie))).rows.find(row => row.id === "shift-" + morning.id).status, "On break");
    at = fixed("10:00");
    const returnActor = await sign();
    await ok(await send("clock", returnActor.cookie, { eventType: "break_end", explanation: "" }));
    assert.equal((await ok(await manage("attendance", managerCookie))).rows.find(row => row.id === "shift-" + morning.id).status, "On shift");
    const reminders = () => db.all(sql`SELECT id,clock_email_state AS email FROM notifications WHERE employee_id=${f.multi.id} AND source_key LIKE 'clock-out-%' ORDER BY id`);
    at = fixed("11:39");
    await runScheduledMaintenance(db, at);
    assert.deepEqual(await reminders(), []);
    at = fixed("11:40");
    await runScheduledMaintenance(db, at);
    await runScheduledMaintenance(db, at);
    assert.deepEqual(await reminders(), [{ id: `clock-out-${start.id}-0`, email: null }]);
    const notices = await ok(await ownAlerts());
    assert.deepEqual(notices.notices.map(notice => notice.id), [`clock-out-${start.id}-0`]);
    assert.equal((await ownAlerts({ notificationId: "clock-manager-late-" + morning.id, action: "read", contextToken: notices.contextToken })).status, 404);
    await ok(await ownAlerts({ notificationId: notices.notices[0].id, action: "read", contextToken: notices.contextToken }));
    assert.equal((await ok(await ownAlerts())).notices[0].opened, true);
    at = fixed("11:45");
    const finish = await sign();
    assert.equal(finish.data.assist.reminder, true);
    assert.equal((await ok(await send("clock", finish.cookie, report("out", "11:30")))).assistance, "approved");
    at = fixed("13:45");
    await runScheduledMaintenance(db, at);
    assert.equal((await reminders()).length, 1);
    const applied = await ok(await manage("state", managerCookie));
    assert.equal(applied.state.clockEvents.find(event => event.id === start.id).at, new Date(fixed("08:59")).toISOString());
    const events = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, morning.id));
    const end = events.find(event => event.eventType === "out");
    assert.equal(end.occurredAt, new Date(fixed("11:45")).toISOString());
    assert.equal(applied.state.clockEvents.find(event => event.id === end.id).at, new Date(fixed("11:30")).toISOString());

    at = fixed("14:30");
    const newStart = await sign();
    await ok(await send("clock", newStart.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" }));
    await db.update(schema.locationSettings).set({ clockOutReminderEmail: true });
    const emails = [];
    const deliver = () => dispatchClockReminderEmails(db, {
      INVITATION_EMAIL: { send: async message => { emails.push(message); return { messageId: "isolated-test-message" }; } },
      INVITATION_EMAIL_FROM: "clock@example.test", INVITATION_EMAIL_REPLY_TO: "team@example.test", INVITATION_EMAIL_ORIGIN: "https://local.example.test",
    }, at);
    at = fixed("15:10");
    await changePreferences(ownPreferences, { clockOut: { inApp: false } });
    await runScheduledMaintenance(db, at);
    const queued = (await reminders()).find(row => row.email === "pending");
    assert.ok(queued);
    assert.equal((await sign()).data.assist.reminder, false);
    assert.deepEqual((await ok(await ownAlerts())).notices, []);
    await changePreferences(ownPreferences, { clockOut: { email: false } });
    await deliver();
    assert.equal((await reminders()).find(row => row.id === queued.id).email, "cancelled");
    assert.equal(emails.length, 0);
    await changePreferences(ownPreferences, { clockOut: { inApp: true, email: true } });
    for (const wall of ["16:00", "17:00"]) {
      at = fixed(wall);
      await runScheduledMaintenance(db, at, deliver);
      await runScheduledMaintenance(db, at, deliver);
    }
    const automatic = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, afternoon.id));
    assert.equal(automatic.length, 2);
    assert.equal(automatic[1].automatic, true);
    assert.deepEqual((await reminders()).map(row => row.id).filter(id => id.startsWith(`clock-out-${automatic[0].id}-`)),
      [0, 1, 2].map(slot => `clock-out-${automatic[0].id}-${slot}`));
    assert.equal(emails.length, 2);
    assert.ok(emails.every(message => message.to === f.multi.email && message.subject === "DomBase clock-out reminder"));
    assert.equal((await reminders()).filter(row => row.email === "accepted").length, 2);
    at = fixed("17:01");
    await db.update(schema.locationSettings).set({ breakWaivers: true });
    const paused = await sign();
    assert.equal(paused.data.assist.out, false);
    assert.equal(paused.data.assist.recovery, false);
    assert.equal((await send("clock", paused.cookie, report("out", "15:01"))).status, 422);
    const blockedReplay = { ...report("out", "15:01"), ticket: paused.data.replay.ticket, attemptedAt: at };
    assert.deepEqual(await ok(await send("sync", deviceCookie, blockedReplay)), { outcome: "review" });
    assert.deepEqual(await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, afternoon.id)), automatic);
    await db.update(schema.locationSettings).set({ breakWaivers: false });
    const recover = await sign();
    assert.equal(recover.data.assist.recovery, true);
    const submission = { ...report("out", "15:01"), ticket: recover.data.replay.ticket, attemptedAt: at };
    assert.deepEqual(await ok(await send("sync", deviceCookie, submission)), { outcome: "synced" });
    assert.deepEqual(await ok(await send("sync", deviceCookie, submission)), { outcome: "synced" });
    assert.deepEqual(await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, afternoon.id)), automatic);
    const pending = await ok(await manage("assisted-clocks", managerCookie));
    assert.deepEqual(pending.requests.map(row => row.id), [automatic[1].id]);
    await ok(await manage("assisted-clocks", managerCookie, { id: automatic[1].id, action: "approve" }));
    const recovered = await ok(await manage("state", managerCookie));
    assert.equal(recovered.state.clockEvents.find(event => event.id === automatic[1].id).at, new Date(fixed("15:01")).toISOString());
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
  await t.test("PIN resets, inactive employees and device revocation invalidate access", async () => {
    ownerCookie = await login(f.owner.email);
    const p = await person();
    await ok(await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: fixturePin2, password }));
    assert.equal((await clock("clock", p.cookie, { eventType: "out", explanation: "" })).status, 401);
    assert.equal((await clock("pin", deviceCookie, { pin: employeePin })).status, 401);
    await db.update(schema.employees).set({ active: false }).where(eq(schema.employees.id, f.a.id));
    assert.equal((await clock("pin", deviceCookie, { pin: fixturePin2 })).status, 401);
    await db.update(schema.employees).set({ active: true }).where(eq(schema.employees.id, f.a.id));
    const current = await person(fixturePin2);
    await platform.dispose(); platform = await open(); services();
    assert.equal((await clock("status", deviceCookie)).status, 200);
    await ok(await adm("revoke", ownerCookie, { deviceId }));
    assert.equal((await clock("status", deviceCookie)).status, 401);
    assert.equal((await clock("clock", current.cookie, { eventType: "out", explanation: "" })).status, 401);
    assert.equal((await clock("status", device2)).status, 200);
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
  await t.test("origin and guessing limits are enforced before accepting credentials", async () => {
    assert.equal((await clock("pin", device2, { pin: otherEmployeePin }, { Origin: "https://attacker.test" })).status, 403);
    assert.equal((await clock("pin", device2, { pin: otherEmployeePin }, { "sec-fetch-site": "cross-site" })).status, 403);
    time += 900001;
    for (let n = 0; n < 5; n++) assert.equal((await clock("pin", device2, { pin: "98765432" })).status, 401);
    const limited = await clock("pin", device2, { pin: "98765432" }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "900");
    time += 900001; assert.equal((await clock("pin", device2, { pin: "98765432" })).status, 401);
    const https = await kiosk.handle(new Request("https://clock.example.test/api/kiosk/pin", { method: "POST", headers: { Origin: "https://clock.example.test", "Content-Type": "application/json", Cookie: device2.replace("dombase-kiosk-device=", "__Host-dombase-kiosk-device=") }, body: JSON.stringify({ pin: otherEmployeePin }) }));
    assert.equal(https.status, 200);
    assert.ok(https.headers.getSetCookie().some(cookie => cookie.startsWith("__Host-dombase-kiosk-person=") && /; Secure/.test(cookie) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie)));
  });
  await t.test("rotating guesses lock the whole device, count down accurately and survive restarting the service", async () => {
    time += 900001;
    for (let n = 0; n < 20; n++) assert.equal((await clock("pin", device2, { pin: String(810000 + n) })).status, 401);
    const blocked = await clock("pin", device2, { pin: otherEmployeePin });
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("retry-after"), "900");
    assert.deepEqual(await blocked.json(), { error: "Too many PIN attempts on this tablet. PIN entry is temporarily locked.", retryAfterSeconds: 900, limitScope: "device" });
    assert.equal((await ok(await clock("status", device2))).pinRetryAfterSeconds, 900);
    time += 45000;
    await platform.dispose(); platform = await open(); services();
    assert.equal((await ok(await clock("status", device2))).pinRetryAfterSeconds, 855);
    const persisted = await clock("pin", device2, { pin: otherEmployeePin }); assert.equal(persisted.status, 429); assert.equal(persisted.headers.get("retry-after"), "855");
    time += 855001;
    assert.equal((await ok(await clock("status", device2))).pinRetryAfterSeconds, 0);
    await ok(await clock("pin", device2, { pin: otherEmployeePin }));
  });
  await t.test("a PIN-specific lockout allows another employee and successful sign-in cannot erase failed guesses", async () => {
    time += 900001;
    for (let n = 0; n < 5; n++) assert.equal((await clock("pin", device2, { pin: "87654321" })).status, 401);
    let limited = await clock("pin", device2, { pin: "87654321" }); assert.equal(limited.status, 429); assert.equal((await limited.json()).limitScope, "pin");
    await ok(await clock("pin", device2, { pin: otherEmployeePin }));
    limited = await clock("pin", device2, { pin: "87654321" }); assert.equal(limited.status, 429);
    assert.equal((await ok(await clock("status", device2))).pinRetryAfterSeconds, 0);
    time += 30000;
    assert.equal((await clock("pin", device2, { pin: "87654321" })).headers.get("retry-after"), "870");
  });
  await t.test("approval guessing has a separate device lockout and never records a punch while blocked", async () => {
    time += 900001;
    let p = await person(otherEmployeePin, device2);
    if (p.data.state !== "out") { await ok(await clock("clock", p.cookie, { eventType: "out", explanation: "" })); p = await person(otherEmployeePin, device2); }
    const pendingResponse = await clock("clock", p.cookie, { eventType: "in", roleId: f.roleB.id, explanation: "" }); assert.equal(pendingResponse.status, 202); const pending = await pendingResponse.json();
    const before = (await db.select().from(schema.clockEvents)).length;
    for (let n = 0; n < 10; n++) assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: String(910000 + n) })).status, 401);
    const blocked = await clock("approve", p.cookie, { requestId: pending.requestId, pin: ownerPin }); assert.equal(blocked.status, 429); assert.equal((await blocked.json()).limitScope, "device");
    assert.equal((await db.select().from(schema.clockEvents)).length, before);
    let status = await ok(await clock("status", device2)); assert.equal(status.approvalRetryAfterSeconds, 900); assert.equal(status.pinRetryAfterSeconds, 0);
    time += 30000; status = await ok(await clock("status", device2)); assert.equal(status.approvalRetryAfterSeconds, 870);
    time += 870001;
    assert.equal((await ok(await clock("status", device2))).approvalRetryAfterSeconds, 0);
    p = await person(otherEmployeePin, device2);
    const next = await clock("clock", p.cookie, { eventType: "in", roleId: f.roleB.id, explanation: "" }); assert.equal(next.status, 202);
    await ok(await clock("approve", p.cookie, { requestId: (await next.json()).requestId, pin: ownerPin }));
    assert.equal((await db.select().from(schema.clockEvents)).length, before + 1);
  });

});
