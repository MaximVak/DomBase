// Hosted Stage 1 regression with fictional identities only. No real invitations.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";

if (process.argv.length !== 2) throw new Error("No target overrides are supported.");
const config = await readStagingConfig();
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
const origin = `https://${stagingName}.${subdomain}.workers.dev`;
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
const marker = `QA1-${randomUUID()}`;
const password = `Private hosted acceptance ${newToken()}`;
const tracked = { accounts: [], employees: [], departments: [], roles: [], files: [] };
const checks = [];
const receipt = async extra => writeFile(".wrangler/releases/nov10-team-acceptance.json", JSON.stringify({ at: new Date().toISOString(), marker, origin, tracked, checks, ...extra }, null, 2), { mode: 0o600 });
async function query(sql, params = []) {
  const rows = await cloudflare(`/accounts/${stagingAccount}/d1/database/${config.d1_databases[0].database_id}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(rows) || rows.some(row => !row.success)) throw new Error("Staging test query failed; private details withheld.");
  return rows[0].results;
}
async function call(path, cookie = "", body) {
  const binary = body instanceof Uint8Array;
  return fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": binary ? "image/png" : "application/json" }) }, ...(body === undefined ? {} : { method: binary ? "PUT" : "POST", body: binary ? body : JSON.stringify(body) }) });
}
async function ok(response) { assert.equal(response.status, 200, "Hosted team operation must succeed"); return response.json(); }
async function login(actor) {
  const response = await call("/api/auth/login", "", { email: actor.email, password }); await ok(response);
  actor.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).find(value => value.startsWith("__Host-dombase-session=")); assert.ok(actor.cookie);
}
async function account(level, employeeId = null) {
  const email = `${marker}-${level}@example.test`.toLowerCase();
  const [actor] = await query("INSERT INTO accounts (email,normalized_email,display_name,access_level,employee_id) VALUES (?,?,?,?,?) RETURNING id", [email, email, `${marker} fictional ${level}`, level, employeeId]);
  tracked.accounts.push(actor.id); await receipt(); actor.email = email;
  const token = newToken();
  await query("INSERT INTO account_setup_tokens (id,account_id,token_hash,issued_session_version,expires_at) VALUES (?,?,?,1,?)", [newToken(), actor.id, tokenHash(token), new Date(Date.now() + 3600000).toISOString()]);
  await ok(await call("/api/auth/setup", "", { token, password })); await login(actor); return actor;
}
const pass = async name => { checks.push(name); await receipt(); console.log(`Passed: ${name}`); };
try {
  const owner = await account("owner"), manager = await account("manager");
  for (const suffix of ["A", "B"]) {
    const [department] = await query("INSERT INTO departments (name) VALUES (?) RETURNING id", [`${marker} department ${suffix}`]); tracked.departments.push(department.id); await receipt();
    const [role] = await query("INSERT INTO roles (name,department_id) VALUES (?,?) RETURNING id", [`${marker} job ${suffix}`, department.id]); tracked.roles.push(role.id); await receipt();
  }
  const state = async (cookie = owner.cookie) => ok(await call("/api/team/state", cookie));
  const save = async (operation, data) => ok(await call("/api/team/commit", owner.cookie, { id: newToken(), revision: (await state()).revision, operation, data }));
  const email = `${marker}-person@example.test`.toLowerCase();
  await save("bulk", { rows: [{ name: `${marker} fictional person`, email, roleId: tracked.roles[0], startDate: "2026-11-01" }, { name: `${marker} outside department`, email: `${marker}-outside@example.test`.toLowerCase(), roleId: tracked.roles[1], startDate: "2026-11-01" }] });
  const people = (await state()).employees.filter(person => person.email === email || person.email === `${marker}-outside@example.test`.toLowerCase());
  tracked.employees.push(...people.map(person => person.id)); await receipt(); assert.equal(people.length, 2);
  let person = people.find(person => person.email === email); const outside = people.find(person => person.email !== email);
  await save("jobs", { employeeId: person.id, version: person.version, roleIds: tracked.roles });
  for (const [index, roleId] of tracked.roles.entries()) {
    person = (await state()).employees.find(row => row.id === person.id);
    await save("wage", { employeeId: person.id, version: person.version, roleId, amountCents: index ? 3100 : 2100, basis: "hourly", effectiveDate: "2026-11-01", overtimeExempt: false });
  }
  assert.equal((await state()).employees.find(row => row.id === person.id).wageRates.length, 2);
  const grant = async wages => { const access = await ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie)); await ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie, { version: access.account.version, departmentIds: [tracked.departments[0]], permissions: { "wages.read": wages } })); };
  await grant(true); await login(manager); let scoped = await state(manager.cookie);
  assert.equal(scoped.employees.some(row => row.id === outside.id), false);
  assert.equal(scoped.employees.find(row => row.id === person.id).wageRates.length, 1);
  const oldCookie = manager.cookie; await grant(false);
  assert.equal((await call("/api/team/state", oldCookie)).status, 401); await login(manager); scoped = await state(manager.cookie);
  assert.ok(scoped.employees.every(row => row.wageRates.length === 0));
  await pass("two role wages, department scope, wages hidden and old-session revocation on HTTPS");
  const employee = await account("employee", person.id);
  assert.equal((await ok(await call("/api/self/profile", employee.cookie))).employeeId, person.id);
  const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"));
  const file = { id: newToken(), employeeId: person.id, kind: "photo", title: "Profile photo", fileName: "fictional.png", contentType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  tracked.files.push(file.id); await receipt();
  await ok(await call("/api/self/photo/prepare", employee.cookie, file)); await ok(await call(`/api/self/photo/${file.id}/content`, employee.cookie, bytes));
  await login(employee); assert.equal((await ok(await call("/api/self/profile", employee.cookie))).photoFileId, file.id);
  const image = await call(`/api/self/photo/${file.id}/download`, employee.cookie); assert.equal(image.status, 200); assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.equal((await call(`/api/self/photo/${file.id}/download`)).status, 401);
  assert.equal((await call("/api/self/photo/prepare", employee.cookie, { ...file, id: newToken(), employeeId: outside.id })).status, 404);
  await pass("own profile and private R2 photo across fresh hosted login, with anonymous/cross-person denial");
  for (const [path, actor] of [["/team", owner], ["/team/reports", owner], ["/community", employee]]) {
    const response = await call(path, actor.cookie); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  }
  await ok(await call("/api/team/insights?start=2026-11-01&end=2026-11-10", owner.cookie));
  await ok(await call("/api/community/state", employee.cookie));
  assert.equal((await call("/api/team/inbox", owner.cookie)).status, 403, "Local capture inbox must remain unavailable on the hosted site");
  await pass("hosted Team/reports/community routes and private APIs; local invitation inbox denied");
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
} finally {
  const now = new Date().toISOString();
  for (const id of tracked.files) await query("UPDATE files SET status='deleted',updated_at=? WHERE id=?", [now, id]);
  for (const id of tracked.accounts) {
    await query("UPDATE accounts SET login_enabled=0,password_hash=NULL,disabled_at=?,session_version=session_version+1 WHERE id=?", [now, id]);
    await query("UPDATE account_sessions SET revoked_at=? WHERE account_id=?", [now, id]);
    await query("UPDATE account_setup_tokens SET used_at=? WHERE account_id=? AND used_at IS NULL", [now, id]);
  }
  for (const id of tracked.employees) { await query("UPDATE employees SET active=0,terminated=1 WHERE id=?", [id]); await query("UPDATE employee_roles SET active=0 WHERE employee_id=?", [id]); }
  for (const id of tracked.roles) await query("UPDATE roles SET archived=1 WHERE id=?", [id]);
  for (const id of tracked.departments) await query("UPDATE departments SET archived=1 WHERE id=?", [id]);
  await receipt({ cleaned: true }); console.log("Fictional account access revoked, workforce archived and file downloads disabled; audit/history retained.");
}
