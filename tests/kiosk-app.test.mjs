import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedKioskFixture, employeePin, ownerPin, cookiesOf } from "./support/kiosk-fixture.mjs";

test("built Worker serves a separate registered kiosk and completes PIN → approval → clock → lock", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedKioskFixture }); t.after(app.close); const f = app.fixtureData;
  const call = (path, cookie = "", body, extra = {}) => fetch(`${app.origin}${path}`, {
    redirect: "manual", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }), ...extra },
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
  await ok(await call("/api/kiosk-admin/approval-pin", owner, { pin: ownerPin, password: app.password }));
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
  const status = await ok(await call("/api/kiosk/status", person)); assert.deepEqual(status, { registered: true, deviceName: "Built Worker test tablet" });
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
