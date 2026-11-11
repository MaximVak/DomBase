import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedAccessFixture } from "./support/access-fixture.mjs";

test("built Worker applies saved permissions to real HTTP reads and writes", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedAccessFixture });
  t.after(app.close);
  const f = app.fixtureData;
  const call = (path, cookie = "", body) => fetch(`${app.origin}${path}`, { headers: { Cookie: cookie,
    ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const json = async response => { assert.equal(response.status, 200); return response.json(); };
  const login = async email => {
    const response = await call("/api/auth/login", "", { email, password: app.password });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  assert.equal((await call("/api/workforce/employees")).status, 401);
  const ownerCookie = await login(app.email);
  const anonymousAccessPage = await fetch(`${app.origin}/access`, { redirect: "manual" }); assert.equal(anonymousAccessPage.headers.get("location"), "/login");
  const ownerAccessPage = await call("/access", ownerCookie); assert.equal(ownerAccessPage.status, 200); assert.match(ownerAccessPage.headers.get("cache-control"), /no-store/); assert.match(await ownerAccessPage.text(), /Account access/);

  let managerCookie = await login(f.manager.email);
  const managerAccessPage = await call("/access", managerCookie); assert.equal(managerAccessPage.status, 200); assert.match(await managerAccessPage.text(), /Team permissions/);
  const tabletAccessPage = await fetch(`${app.origin}/access`, { redirect: "manual", headers: { Cookie: `dombase-kiosk-device=${f.deviceToken}; ${ownerCookie}` } }); assert.equal(tabletAccessPage.headers.get("location"), "/kiosk");

  assert.equal((await call("/api/access/accounts", managerCookie)).status, 403);
  const rosterResponse = await call("/api/workforce/employees", managerCookie);
  assert.match(rosterResponse.headers.get("cache-control"), /no-store/);
  const roster = await json(rosterResponse);
  assert.deepEqual(roster.employees.map(row => row.id), [f.a.id, f.managerEmployee.id, f.multi.id]);
  assert.equal(roster.employees.some(row => "email" in row || "wage" in row || "pinHash" in row), false);
  assert.equal((await call(`/api/workforce/employees/${f.b.id}`, managerCookie)).status, 404);
  assert.equal((await call(`/api/workforce/employees/${f.a.id}/wages`, managerCookie)).status, 403);
  const original = await json(await call(`/api/access/accounts/${f.manager.id}`, ownerCookie));
  const changed = await call(`/api/access/accounts/${f.manager.id}`, ownerCookie, {
    version: original.account.version, permissions: { "wages.read": true, "team.contact.read": true, "team.manage": true }, departmentIds: [f.deptA.id],
  });
  assert.equal(changed.status, 200);
  assert.equal((await call("/api/workforce/employees", managerCookie)).status, 401);
  managerCookie = await login(f.manager.email);
  assert.deepEqual((await json(await call(`/api/workforce/employees/${f.a.id}/wages`, managerCookie))).wages.map(row => row.amountCents), [2200]);
  assert.deepEqual((await json(await call(`/api/workforce/employees/${f.multi.id}/wages`, managerCookie))).wages.map(row => row.amountCents), [2300]);
  const contact = { version: 1, email: "http-verified@example.test", phone: "555-0111" };
  assert.equal((await call(`/api/workforce/employees/${f.b.id}/contact`, managerCookie, contact)).status, 404);
  assert.equal((await call(`/api/workforce/employees/${f.a.id}/contact`, managerCookie, { ...contact, accessLevel: "owner" })).status, 400);
  assert.equal((await call(`/api/workforce/employees/${f.a.id}/contact`, managerCookie, contact)).status, 200);
  const saved = await json(await call(`/api/workforce/employees/${f.a.id}`, ownerCookie));
  assert.equal(saved.employee.email, contact.email);
  assert.equal(saved.employee.version, 2);
  assert.equal((await call(`/api/workforce/employees/${f.a.id}/contact`, managerCookie, contact)).status, 409);
  assert.equal((await call(`/api/workforce/conversations/${f.conversationB.id}/messages`, managerCookie)).status, 404);
  const shifts = await json(await call("/api/workforce/shifts", managerCookie));
  assert.equal(shifts.shifts[0].notes, undefined);
  const session = await json(await call("/api/auth/session", managerCookie));
  assert.equal(session.account.accessLevel, "manager");
  await t.test("Owner prepares a manager through HTTP, with private setup, scoped sign-in and revocation", async () => {
    const created = await json(await call("/api/access/accounts", ownerCookie, {
      email: "http-new-manager@example.test", displayName: "HTTP created manager", employeeId: null,
      accessLevel: "manager", departmentIds: [f.deptB.id],
    }));
    assert.equal(created.account.loginEnabled, false);
    assert.equal((await call("/api/access/accounts", managerCookie, {})).status, 403);
    const setupResponse = await call(`/api/access/accounts/${created.account.id}/setup`, ownerCookie, { version: created.account.version });
    assert.match(setupResponse.headers.get("cache-control"), /no-store/);
    const setup = await json(setupResponse);
    assert.equal((await call("/api/auth/setup", "", { token: setup.token, password: app.password })).status, 200);
    const newCookie = await login(created.account.email);
    const scoped = await json(await call("/api/workforce/employees", newCookie));
    assert.deepEqual(scoped.employees.map(e => e.id), [f.b.id, f.multi.id]);
    const current = await json(await call(`/api/access/accounts/${created.account.id}`, ownerCookie));
    const { email, displayName, employeeId, accessLevel, version } = current.account;
    assert.equal((await call(`/api/access/accounts/${created.account.id}/lifecycle`, ownerCookie, {
      email, displayName, employeeId, accessLevel, version, departmentIds: current.departmentIds, disabled: true,
    })).status, 200);
    assert.equal((await call("/api/workforce/employees", newCookie)).status, 401);
  });
});
