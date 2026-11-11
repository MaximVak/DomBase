import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";
import { randomBytes } from "node:crypto";

test("built Worker routes an employee password session to only their personal profile", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedWorkforceFixture }); t.after(app.close);
  const call = (path, cookie = "", body, extra = {}) => fetch(`${app.origin}${path}`, { redirect: "manual", headers: { Cookie: cookie,
    ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const data = async r => { const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body; };
  const login = async email => { const r = await call("/api/auth/login", "", { email, password: app.password }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
  const owner = await login(app.email); const f = app.fixtureData;
  assert.equal((await call("/me")).headers.get("location"), "/login");
  assert.equal((await call("/me", owner)).headers.get("location"), "/");
  const created = await data(await call("/api/access/accounts", owner, { email: "http-employee@example.test", displayName: "HTTP employee",
    employeeId: f.multi.id, accessLevel: "employee", departmentIds: [] }));
  const setup = await data(await call(`/api/access/accounts/${created.account.id}/setup`, owner, { version: created.account.version }));
  assert.equal((await call("/api/auth/setup", "", { token: setup.token, password: app.password })).status, 200);
  const employee = await login(created.account.email);
  assert.equal((await call("/", employee)).headers.get("location"), "/me");
  const page = await call("/me", employee); assert.equal(page.status, 200); assert.match(page.headers.get("cache-control"), /no-store/);
  assert.equal(page.headers.get("x-frame-options"), "DENY"); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const html = await page.text(); assert.match(html, /My profile/); assert.doesNotMatch(html, /Manager overview|Team permissions|Other department private worker|Private manager note/);
  for (const path of ["/api/workspace/state", "/api/access/accounts", "/api/workforce/employees", `/api/workforce/employees/${f.b.id}/wages`, "/api/documents/private-file-a/download", "/api/kiosk-admin/devices"]) {
    assert.ok([401, 403].includes((await call(path, employee)).status), path);
  }
  for (const path of ["/access", "/kiosk-admin"]) assert.equal((await call(path, employee)).headers.get("location"), "/login");
  const p = await data(await call("/api/self/profile", employee));
  const body = { id: randomBytes(32).toString("base64url"), contextToken: p.contextToken, employeeVersion: p.employeeVersion, profileVersion: p.profileVersion,
    values: { ...p.values, name: "HTTP Employee", homeCity: "Sacramento", email: "http-personal@example.test", phone: "202-555-0125" } };
  assert.equal((await call("/api/self/profile", employee, body, { Origin: "https://outside.example" })).status, 403);
  assert.equal((await call("/api/self/profile", employee, body)).status, 200);
  assert.equal((await call("/api/self/profile", employee, body)).status, 200);
  const second = await login(created.account.email);
  const saved = await data(await call("/api/self/profile", second)); assert.equal(saved.values.phone, body.values.phone); assert.equal(saved.accountEmail, created.account.email);
  assert.equal((await call("/api/self/profile", employee, { ...body, id: randomBytes(32).toString("base64url"), employeeId: f.b.id })).status, 400);
  assert.equal((await call(`/api/self/profile/${f.b.id}`, employee)).status, 404);
  assert.equal((await call("/api/self/profile", `dombase-kiosk-device=${f.deviceToken}; ${employee}`)).status, 403);
  assert.equal((await call("/me", `dombase-kiosk-device=${f.deviceToken}; ${employee}`)).headers.get("location"), "/kiosk");
  assert.equal((await call("/api/auth/logout", employee, {})).status, 200);
  assert.equal((await call("/api/self/profile", employee)).status, 401); assert.equal((await call("/me", employee)).headers.get("location"), "/login");
});
