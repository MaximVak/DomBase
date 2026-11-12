import assert from "node:assert/strict";
import test from "node:test";
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
  const { createAuthService, createAccessService, createKioskAdmin, createKioskService, pinLookup, verifyPin, tokenHash } = await loadServerModule("tests/support/kiosk-runtime.ts");
  const secret = "isolated-kiosk-verification-secret-at-least-32-characters";
  const password = "Temporary kiosk verification passphrase!";
  const origin = "http://localhost:3000";
  let time = Date.now(); let db; let auth; let access; let admin; let kiosk;
  function services() {
    db = drizzle(platform.env.DB, { schema }); auth = createAuthService(db, { secret, now: () => time });
    access = createAccessService(db, auth); admin = createKioskAdmin(db, access, secret); kiosk = createKioskService(db, { secret, now: () => time });
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
    assert.equal(await verifyPin("wrong-server-secret-at-least-32-characters", employeePin, stored.pinHash), false);
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
    const p = await person(); const response = await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "Approved test clock-in" });
    assert.equal(response.status, 202); const pending = await response.json(); assert.equal(pending.approvalRequired, true);
    assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: employeePin })).status, 401);
    const wrongDevicePerson = await person(employeePin, device2);
    assert.equal((await clock("approve", wrongDevicePerson.cookie, { requestId: pending.requestId, pin: managerPin })).status, 409);
    const success = await clock("approve", p.cookie, { requestId: pending.requestId, pin: managerPin }); await ok(success);
    assert.ok(cookiesOf(success).some(cookie => cookie === "dombase-kiosk-person="));
    assert.equal((await clock("approve", p.cookie, { requestId: pending.requestId, pin: managerPin })).status, 401);
    const [event] = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.idempotencyKey, pending.requestId));
    assert.equal(event.employeeId, f.a.id); assert.equal(event.recordedByAccountId, f.manager.id); assert.equal(event.deviceId, deviceId); assert.equal(event.source, "kiosk"); assert.equal(event.occurredAt, new Date(time).toISOString());
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
    await db.insert(schema.shifts).values({ employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "00:00", endTime: "23:59", publicationId: pub.id });
    const p = await person();
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleB.id, explanation: "" })).status, 403);
    assert.equal((await clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "", occurredAt: "2020-01-01", employeeId: f.b.id })).status, 400);
    const before = (await db.select().from(schema.clockEvents)).length;
    const concurrent = await Promise.all([clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" }), clock("clock", p.cookie, { eventType: "in", roleId: f.roleA.id, explanation: "" })]);
    assert.equal(concurrent.filter(r => r.status === 200).length, 1); assert.equal((await db.select().from(schema.clockEvents)).length, before + 1);
    for (const eventType of ["break", "break_end", "out"]) { const next = await person(); await ok(await clock("clock", next.cookie, { eventType, explanation: "" })); }
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
  await t.test("PIN resets, inactive employees and device revocation invalidate access", async () => {
    ownerCookie = await login(f.owner.email);
    const p = await person();
    await ok(await adm("employee-pin", ownerCookie, { employeeId: f.a.id, pin: "567832", password }));
    assert.equal((await clock("clock", p.cookie, { eventType: "out", explanation: "" })).status, 401);
    assert.equal((await clock("pin", deviceCookie, { pin: employeePin })).status, 401);
    await db.update(schema.employees).set({ active: false }).where(eq(schema.employees.id, f.a.id));
    assert.equal((await clock("pin", deviceCookie, { pin: "567832" })).status, 401);
    await db.update(schema.employees).set({ active: true }).where(eq(schema.employees.id, f.a.id));
    const current = await person("567832");
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
});
