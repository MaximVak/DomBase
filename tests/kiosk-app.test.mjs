import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedKioskFixture, employeePin, otherEmployeePin, cookiesOf } from "./support/kiosk-fixture.mjs";

test("built Worker serves a separate registered kiosk and completes PIN → approval → clock → lock", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedKioskFixture }); t.after(app.close); const f = app.fixtureData;
  const call = (path, cookie = "", body, extra = {}) => fetch(`${app.origin}${path}`, {
    signal: AbortSignal.timeout(20000), redirect: "manual", headers: { Cookie: cookie, Connection: "close", ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const ok = async response => { assert.equal(response.status, 200); return response.json(); };
  const login = async () => {
    const response = await call("/api/auth/login", "", { email: app.email, password: app.password }); await ok(response); return cookiesOf(response)[0];
  };
  const page = await call("/kiosk"); assert.equal(page.status, 200); const html = await page.text();
  assert.match(html, /DomBase time clock/); assert.match(html, /Checking this tablet/); assert.equal(html.includes(employeePin), false);
  assert.match(page.headers.get("cache-control"), /no-store/); assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal((await call("/kiosk-admin")).status, 307);
  assert.equal((await call("/api/kiosk/pin", "", { pin: employeePin })).status, 401);
  let owner = await login();
  const settings = await call("/kiosk-admin", owner); assert.equal(settings.status, 200); assert.match(await settings.text(), /Tablet.*PIN access/);
  await ok(await call("/api/kiosk-admin/employee-pin", owner, { employeeId: f.a.id, pin: employeePin, password: app.password }));
  const ownerPin = (await ok(await call("/api/kiosk-admin/approval-pin", owner, { password: app.password }))).pin;
  const registration = await call("/api/kiosk-admin/register", owner, { name: "Built Worker test tablet", password: app.password }); await ok(registration);
  const device = cookiesOf(registration).find(cookie => cookie.startsWith("dombase-kiosk-device=")); assert.ok(device);
  assert.equal((await call("/api/auth/session", owner)).status, 401);
  owner = await login();
  for (const path of ["/", "/login", "/setup", "/kiosk-admin"]) {
    const denied = await call(path, `${device}; ${owner}`); assert.equal(denied.status, 303); assert.equal(denied.headers.get("location"), "/kiosk");
  }
  for (const path of ["/api/auth/session", "/api/access/me", "/api/workforce/employees", "/api/kiosk-admin/devices"]) assert.equal((await call(path, `${device}; ${owner}`)).status, 403);
  assert.equal((await call("/api/auth/login", device, { email: app.email, password: app.password })).status, 403);
  assert.equal((await call("/api/kiosk/pin", device, { pin: "0000" })).status, 401);
  assert.equal((await call("/api/kiosk/pin", device, { pin: employeePin }, { Origin: "https://attacker.test" })).status, 403);
  const signed = await call("/api/kiosk/pin", device, { pin: employeePin }); const signedData = await ok(signed);
  assert.deepEqual(signedData.employee, { id: f.a.id, name: f.a.name }); assert.equal(signedData.state, "out");
  const person = `${device}; ${cookiesOf(signed)[0]}`;
  const prepared = await call("/api/kiosk/clock", person, { eventType: "in", roleId: f.roleA.id, explanation: "Built Worker verification" }); assert.equal(prepared.status, 202);
  const pending = await prepared.json();
  const approved = await call("/api/kiosk/approve", person, { requestId: pending.requestId, pin: ownerPin }); await ok(approved);
  assert.ok(cookiesOf(approved).includes("dombase-kiosk-person="));
  assert.equal((await call("/api/kiosk/approve", person, { requestId: pending.requestId, pin: ownerPin })).status, 401);
  const status = await ok(await call("/api/kiosk/status", person)); assert.deepEqual(status, { registered: true, deviceName: "Built Worker test tablet", pinRetryAfterSeconds: 0, approvalRetryAfterSeconds: 0 });
  const again = await call("/api/kiosk/pin", device, { pin: employeePin }); const current = await ok(again); assert.equal(current.state, "in");
  const nextPerson = `${device}; ${cookiesOf(again)[0]}`;
  await ok(await call("/api/kiosk/clock", nextPerson, { eventType: "out", explanation: "" }));
  const final = await call("/api/kiosk/pin", device, { pin: employeePin }); const finalData = await ok(final); assert.equal(finalData.state, "out");
  const lockedCookie = `${device}; ${cookiesOf(final)[0]}`;
  await ok(await call("/api/kiosk/lock", lockedCookie, {}));
  assert.equal((await call("/api/kiosk/clock", lockedCookie, { eventType: "in", roleId: f.roleA.id, explanation: "" })).status, 401);
  const listing = await ok(await call("/api/kiosk-admin/devices", owner)); const registered = listing.devices.find(row => row.name === "Built Worker test tablet"); assert.ok(registered);
  await ok(await call("/api/kiosk-admin/revoke", owner, { deviceId: registered.id }));
  assert.equal((await call("/api/kiosk/status", device)).status, 401);
});

test("registered tablets reconcile offline PIN clock entries exactly once and send conflicts for review", { timeout: 120000 }, async t => {
  const formatDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  const formatTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const app = await startAuthApp({ async seed(db, schema, load, password) {
    const fixture = await seedKioskFixture(db, schema, load, password);
    await db.update(schema.employeeProfiles).set({ ssnEncrypted: null });
    const nearStart = new Date(Date.now() - 3600000);
    const nearEnd = new Date(Date.now() + 3600000);
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 2, publishedByAccountId: fixture.owner.id }).returning();
    await db.insert(schema.shifts).values({ employeeId: fixture.a.id, roleId: fixture.roleA.id, date: formatDate.format(nearStart),
      startTime: formatTime.format(nearStart), endTime: formatTime.format(nearEnd), publicationId: publication.id });
    return fixture;
  } });
  t.after(app.close);
  const call = (path, cookie = "", body) => fetch(app.origin + path, {
    redirect: "manual", signal: AbortSignal.timeout(20000),
    headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const ok = async response => { assert.equal(response.status, 200); return response.json(); };
  async function login() {
    const response = await call("/api/auth/login", "", { email: app.email, password: app.password });
    await ok(response);
    return cookiesOf(response)[0];
  }
  let owner = await login();
  const employeeId = app.fixtureData.a.id;
  await ok(await call("/api/kiosk-admin/employee-pin", owner, { employeeId, pin: employeePin, password: app.password }));
  const registered = await call("/api/kiosk-admin/register", owner, { name: "Offline clock verification tablet", password: app.password });
  await ok(registered);
  const device = cookiesOf(registered).find(cookie => cookie.startsWith("dombase-kiosk-device="));
  assert.ok(device);
  owner = await login();

  const status = await ok(await call("/api/kiosk/status?offline=1", device));
  assert.match(status.offlineDevice, /^[a-f0-9]{64}$/);
  const person = await ok(await call("/api/kiosk/pin", device, { pin: employeePin, breaks: true, offline: true }));
  assert.equal(person.employee.id, employeeId);
  assert.equal(person.state, "out");
  assert.ok(person.offline.expiresAt > Date.now());
  const { token, key } = person.offline;
  const makeAction = (eventType, previous, attemptedAt = Date.now()) => {
    const entry = {
      ticket: randomBytes(32).toString("base64url"), attemptedAt, eventType,
      ...(eventType === "in" ? { roleId: app.fixtureData.roleA.id } : { details: { reports: [] } }),
      explanation: "Isolated offline clock verification.",
    };
    const payload = JSON.stringify([entry.ticket, previous, attemptedAt, eventType, entry.roleId ?? null, entry.explanation, entry.details ?? null]);
    const proof = createHmac("sha256", key).update(payload).digest("hex");
    return { ...entry, offline: { token, previous, proof } };
  };
  const sync = (body, cookie = device) => call("/api/kiosk/offline-sync", cookie, body);
  const first = makeAction("in", null);
  assert.equal((await sync(first, "")).status, 401);
  assert.equal((await sync(first, "dombase-kiosk-device=" + app.fixtureData.deviceToken)).status, 403);
  assert.equal((await sync({ ...first, explanation: "Changed after being signed" })).status, 403);
  const initialResults = await Promise.all([sync(first), sync(first)]);
  for (const response of initialResults) assert.deepEqual(await ok(response), { outcome: "synced" });
  const second = makeAction("out", "offline." + first.ticket);
  assert.deepEqual(await ok(await sync(second)), { outcome: "synced" });
  assert.deepEqual(await ok(await sync(second)), { outcome: "synced" });
  assert.deepEqual(await ok(await sync(makeAction("in", null))), { outcome: "review" });

  await ok(await call("/api/kiosk-admin/employee-pin", owner, { employeeId, pin: otherEmployeePin, password: app.password }));
  assert.deepEqual(await ok(await sync(makeAction("in", "offline." + second.ticket))), { outcome: "review" });
  assert.equal((await sync(makeAction("in", null, person.offline.expiresAt))).status, 422);
  const state = await ok(await call("/api/workspace/state", owner));
  assert.deepEqual(state.state.clockEvents.filter(event => event.employeeId === employeeId).map(event => [event.type, Date.parse(event.at)]), [
    ["in", first.attemptedAt], ["out", second.attemptedAt],
  ]);
  const review = await ok(await call("/api/kiosk-admin/offline-review", owner));
  assert.equal(review.entries.filter(entry => entry.employee === person.employee.name).length, 2);
});
