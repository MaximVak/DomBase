import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";

test("built Worker completes Stage 1 invitations, photos and scoped two-rate acceptance locally", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedWorkforceFixture }); t.after(app.close); const f = app.fixtureData;
  const call = (path, cookie = "", body, method = body === undefined ? "GET" : "POST", headers = {}) => fetch(app.origin + path, { method, redirect: "manual", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": body instanceof Uint8Array ? "image/png" : "application/json" }), ...headers }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const ok = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const login = async email => { const r = await call("/api/auth/login", "", { email, password: app.password }); await ok(r); return r.headers.get("set-cookie").split(";")[0]; };
  const id = () => randomBytes(32).toString("base64url"); const owner = await login(app.email);
  const state = async (cookie = owner) => ok(await call("/api/team/state", cookie));
  async function save(operation, data) { return ok(await call("/api/team/commit", owner, { id: id(), revision: (await state()).revision, operation, data })); }
  assert.equal((await call("/team")).headers.get("location"), "/login");
  const page = await call("/team", owner); assert.equal(page.status, 200); assert.match(await page.text(), /Team details/); assert.match(page.headers.get("cache-control"), /no-store/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  await save("bulk", { rows: [{ name: "Local acceptance person", email: "acceptance-team@example.test", roleId: f.roleA.id, startDate: "2026-11-01", channel: "email" }] });
  let person = (await state()).employees.find(e => e.email === "acceptance-team@example.test"); assert.ok(person);
  await save("jobs", { employeeId: person.id, version: person.version, roleIds: [f.roleA.id, f.roleB.id] });
  for (const [roleId, amountCents] of [[f.roleA.id, 2100], [f.roleB.id, 3100]]) {
    person = (await state()).employees.find(e => e.id === person.id); await save("wage", { employeeId: person.id, version: person.version, roleId, amountCents, basis: "hourly", effectiveDate: "2026-11-01", overtimeExempt: false });
  }
  person = (await state()).employees.find(e => e.id === person.id); assert.equal(person.wageRates.length, 2);
  const inbox = await ok(await call("/api/team/inbox", owner)); const invitation = inbox.messages.find(m => m.employeeId === person.id); assert.match(invitation.status, /not sent/);
  const invitePage = await call("/invite"); assert.equal(invitePage.status, 200); assert.match(invitePage.headers.get("cache-control"), /no-store/); assert.match(await invitePage.text(), /invitation/i);
  const token = new URL(invitation.url).hash.slice(7); await ok(await call("/api/invitations/inspect", "", { token }));
  assert.equal((await call("/api/invitations/accept", "", { token, email: person.email, password: app.password }, "POST", { Origin: "https://outside.example" })).status, 403);
  await ok(await call("/api/invitations/accept", "", { token, email: person.email, password: app.password }));
  assert.equal((await call("/api/invitations/inspect", "", { token })).status, 401);
  const employee = await login(person.email); assert.equal((await call("/team", employee)).headers.get("location"), "/login");
  assert.ok([401, 403].includes((await call("/api/team/state", employee)).status));
  const own = await ok(await call("/api/self/profile", employee)); assert.equal(own.employeeId, person.id);
  const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"));
  const file = { id: id(), employeeId: person.id, kind: "photo", title: "Profile photo", fileName: "qa.png", contentType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await ok(await call("/api/self/photo/prepare", employee, file)); await ok(await call(`/api/self/photo/${file.id}/content`, employee, bytes, "PUT"));
  const freshEmployee = await login(person.email); assert.equal((await ok(await call("/api/self/profile", freshEmployee))).photoFileId, file.id);
  const image = await call(`/api/self/photo/${file.id}/download`, freshEmployee); assert.equal(image.status, 200); assert.match(image.headers.get("content-disposition"), /inline/); assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.equal((await call(`/api/self/photo/${file.id}/download`)).status, 401);
  assert.equal((await call("/api/self/photo/prepare", freshEmployee, { ...file, id: id(), employeeId: f.b.id })).status, 404);
  assert.equal((await call("/api/team/state", `dombase-kiosk-device=${f.deviceToken}; ${owner}`)).status, 403);
  const access = await ok(await call(`/api/access/accounts/${f.manager.id}`, owner));
  await ok(await call(`/api/access/accounts/${f.manager.id}`, owner, { version: access.account.version, departmentIds: [f.deptA.id], permissions: { "wages.read": true } }));
  let manager = await login(f.manager.email); let scoped = await state(manager);
  assert.equal(scoped.employees.some(e => e.id === f.b.id), false); assert.equal(scoped.employees.find(e => e.id === person.id).wageRates.length, 1);
  const access2 = await ok(await call(`/api/access/accounts/${f.manager.id}`, owner));
  await ok(await call(`/api/access/accounts/${f.manager.id}`, owner, { version: access2.account.version, departmentIds: [f.deptA.id], permissions: { "wages.read": false } }));
  assert.equal((await call("/api/team/state", manager)).status, 401); manager = await login(f.manager.email); scoped = await state(manager);
  assert.ok(scoped.employees.every(e => e.wageRates.length === 0));
  const workspace = await ok(await call("/api/workspace/state", manager)); assert.ok(workspace.state.employees.every(e => e.wage === "" && e.wageRates.length === 0));
  const { permissionCatalog } = await loadServerModule("access/policy.ts");
  const restricted = Object.fromEntries(permissionCatalog.map(({ id }) => [id, ["timesheets.read", "wages.read", "exports.timesheets"].includes(id)]));
  const access3 = await ok(await call(`/api/access/accounts/${f.generalManager.id}`, owner));
  await ok(await call(`/api/access/accounts/${f.generalManager.id}`, owner, { version: access3.account.version, departmentIds: [], permissions: restricted }));
  const limited = await login(f.generalManager.email); const grants = await ok(await call("/api/access/me", limited)); assert.equal(grants.permissions["team.read"], false); assert.equal(grants.permissions["exports.timesheets"], true);
  assert.equal((await call("/api/team/state", limited)).status, 403); assert.equal((await call("/api/workspace/state", limited)).status, 200);
});
