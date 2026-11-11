import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";

test("built Worker enforces login from HTTP through D1 and dashboard rendering", { timeout: 120000 }, async t => {
  const app = await startAuthApp();
  t.after(app.close);
  const post = (action, data, cookie = "") => fetch(`${app.origin}/api/auth/${action}`, {
    method: "POST", headers: { Origin: app.origin, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(data),
  });
  const anonymous = await fetch(app.origin, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anonymous.status));
  assert.equal(anonymous.headers.get("location"), "/login");
  const loginPage = await fetch(`${app.origin}/login`);
  assert.match(await loginPage.text(), /type="password"/);
  const wrong = await post("login", { email: app.email, password: "0000" });
  assert.equal(wrong.status, 401);
  const response = await post("login", { email: app.email, password: app.password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const dashboard = await fetch(app.origin, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.headers.get("cache-control"), /no-store/);
  const html = await dashboard.text();
  assert.match(html, /Local verification owner/);
  assert.equal(html.includes(app.password), false);
  assert.equal(html.includes(cookie.split("=")[1]), false);
  assert.equal((await fetch(`${app.origin}/api/auth/session`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await post("logout", {}, cookie)).status, 200);
  const afterLogout = await fetch(app.origin, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.ok([302, 303, 307].includes(afterLogout.status));
  const rsc = await fetch(app.origin, { headers: { RSC: "1" }, redirect: "manual" });
  assert.equal((await rsc.text()).includes("Local verification owner"), false);
});
