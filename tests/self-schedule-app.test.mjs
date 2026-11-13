import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedSelfScheduleFixture } from "./support/self-schedule-fixture.mjs";

test("built Worker gives independent Employee sessions their own schedules and follows company privacy changes", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedSelfScheduleFixture }); t.after(app.close);
  const call = (path, cookie = "", body) => fetch(app.origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Cookie: cookie, Connection: "close", ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const ok = async response => { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const login = async account => { const response = await call("/api/auth/login", "", { email: account.email, password: app.password }); await ok(response); return response.headers.get("set-cookie").split(";")[0]; };
  const f = app.fixtureData, first = await login(f.employeeAccount), second = await login(f.secondAccount), owner = await login(f.owner);
  const path = "/api/self/schedule?date=2026-11-12";
  for (const [cookie, id] of [[first, f.a.id], [second, f.secondPerson.id]]) {
    const data = await ok(await call(path, cookie)); assert.equal(data.ownOnly, true); assert.equal(data.shifts.length, 1);
    assert.ok(data.shifts.every(shift => shift.employeeId === id));
    const page = await call("/me/schedule", cookie); assert.equal(page.status, 200); assert.match(page.headers.get("cache-control"), /no-store/);
    assert.equal(page.headers.get("x-frame-options"), "DENY"); assert.match(await page.text(), /My schedule/);
    assert.equal((await call("/api/workspace/state", cookie)).status, 401);
    assert.equal((await call("/api/access/accounts", cookie)).status, 401);
  }
  async function privacy(value) {
    const view = await ok(await call("/api/workspace/state", owner));
    await ok(await call("/api/workspace/commit", owner, { id: randomBytes(32).toString("base64url"), revision: view.revision,
      employeeVersions: view.employeeVersions, changes: [{ entity: "settings", id: 1, before: { ...view.settings, hoursRoundingMinutes: view.state.hoursRoundingMinutes },
        after: { ...view.settings, employeesOwnScheduleOnly: value } }] }));
  }
  await privacy(false);
  const team = await ok(await call(path, first)); assert.equal(team.ownOnly, false); assert.equal(team.shifts.length, 2);
  assert.doesNotMatch(JSON.stringify(team), /Private|UNPUBLISHED|notes|wage|ssn|phone|email/i);
  await privacy(true); assert.equal((await ok(await call(path, first))).shifts.length, 1);
  assert.equal((await ok(await call(path, second))).shifts[0].employeeId, f.secondPerson.id);
  assert.equal((await call("/me/schedule", `dombase-kiosk-device=${f.deviceToken}; ${first}`)).headers.get("location"), "/kiosk");
  assert.equal((await call(path)).status, 401);
  assert.equal((await call("/me/schedule")).headers.get("location"), "/login");
  assert.equal((await call("/api/self/schedule?employeeId=1", first)).status, 400);
  await ok(await call("/api/auth/logout", first, {})); assert.equal((await call(path, first)).status, 401);
  assert.equal((await call(path, second)).status, 200);
});
