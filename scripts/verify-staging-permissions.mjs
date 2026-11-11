// Non-production permission acceptance. Never uses a real person's credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";
const config = await readStagingConfig();
const databaseId = config.d1_databases[0].database_id;
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
const origin = `https://${stagingName}.${subdomain}.workers.dev`;
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
const marker = `step5-${randomUUID()}`;
const accounts = [], departments = [], roles = [], employees = [];
const password = `Disposable verification ${newToken()}`;
async function query(sql, params = []) {
  const result = await cloudflare(`/accounts/${stagingAccount}/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(result) || result.some(row => !row.success)) throw new Error("Staging verification database operation failed.");
  return result[0].results;
}
async function call(path, cookie = "", body, requestOrigin = origin) {
  const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: requestOrigin, "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const text = await response.text(); let json;
  try { json = JSON.parse(text); } catch { /* HTML is checked separately. */ }
  return { status: response.status, json, headers: response.headers, text };
}
function ok(response, label) { assert.equal(response.status, 200, label); return response.json; }
async function login(account) {
  const response = await call("/api/auth/login", "", { email: account.email, password });
  ok(response, "Fictional account sign-in"); return response.headers.get("set-cookie").split(";")[0];
}
async function createAccount(level) {
  const email = `${marker}-${level}@example.test`;
  const [account] = await query("INSERT INTO accounts (email, normalized_email, display_name, access_level) VALUES (?, ?, ?, ?) RETURNING id", [email, email, "Disposable permission verification", level]);
  accounts.push(account.id); account.email = email;
  const token = newToken();
  await query("INSERT INTO account_setup_tokens (id, account_id, token_hash, issued_session_version, expires_at) VALUES (?, ?, ?, 1, ?)", [newToken(), account.id, tokenHash(token), new Date(Date.now() + 3600000).toISOString()]);
  ok(await call("/api/auth/setup", "", { token, password }), "Fictional account password setup");
  return account;
}
try {
  assert.equal((await call("/access")).headers.get("location"), "/login");
  assert.equal((await call("/api/workspace/state")).status, 401);
  const owner = await createAccount("owner"), manager = await createAccount("manager"), general = await createAccount("general_manager");
  const ownerCookie = await login(owner); let managerCookie = await login(manager); const generalCookie = await login(general);
  for (const suffix of ["A", "B"]) {
    const [department] = await query("INSERT INTO departments (name) VALUES (?) RETURNING id", [`Verification ${marker} ${suffix}`]); departments.push(department.id);
    const [role] = await query("INSERT INTO roles (name, department_id) VALUES (?, ?) RETURNING id", [`Verification job ${marker} ${suffix}`, department.id]); roles.push(role.id);
    const [employee] = await query("INSERT INTO employees (name, pin_hash, phone, start_date) VALUES (?, ?, ?, '2026-11-01') RETURNING id", [`Verification only ${marker} ${suffix}`, `disabled-fixture-${newToken()}`, "555-0100"]); employees.push(employee.id);
    await query("INSERT INTO employee_roles (employee_id, role_id) VALUES (?, ?)", [employee.id, role.id]);
    await query("INSERT INTO wage_rates (employee_id, role_id, basis, amount_cents, effective_date, recorded_by_account_id) VALUES (?, ?, 'hourly', ?, '2026-11-01', ?)", [employee.id, role.id, suffix === "A" ? 2200 : 8800, owner.id]);
  }
  async function grant(permissions, departmentIds) {
    const current = ok(await call(`/api/access/accounts/${manager.id}`, ownerCookie), "Owner access lookup");
    return ok(await call(`/api/access/accounts/${manager.id}`, ownerCookie, { version: current.account.version, permissions, departmentIds }), "Owner access save");
  }
  const unassigned = ok(await call("/api/workforce/employees", managerCookie), "Unassigned roster");
  assert.equal(unassigned.employees.length, 0);
  await grant({}, [departments[0]]);
  assert.equal((await call("/api/access/me", managerCookie)).status, 401, "Saved grants revoke prior sign-in"); managerCookie = await login(manager);
  const roster = ok(await call("/api/workforce/employees", managerCookie), "Department-scoped roster");
  assert.ok(roster.employees.some(e => e.id === employees[0])); assert.equal(roster.employees.some(e => e.id === employees[1]), false);
  assert.equal((await call(`/api/workforce/employees/${employees[1]}`, managerCookie)).status, 404);
  for (const suffix of ["wages", "profile", "files"]) assert.equal((await call(`/api/workforce/employees/${employees[0]}/${suffix}`, managerCookie)).status, 403);
  for (const cookie of [managerCookie, generalCookie]) assert.equal((await call("/api/access/accounts", cookie)).status, 403);
  const generalRoster = ok(await call("/api/workforce/employees", generalCookie), "General Manager cross-department roster");
  assert.ok(employees.every(id => generalRoster.employees.some(e => e.id === id)));
  const page = await call("/access", managerCookie); assert.equal(page.status, 200); assert.match(page.headers.get("cache-control"), /no-store/); assert.ok(page.text.includes("Account access"));
  const workspace = ok(await call("/api/workspace/state", managerCookie), "Shared workspace scope");
  assert.ok(workspace.state.employees.some(e => e.id === employees[0])); assert.equal(workspace.state.employees.some(e => e.id === employees[1]), false);
  await grant({ "team.manage": true, "team.contact.read": true, "wages.read": true }, [departments[0]]);
  assert.equal((await call("/api/workspace/state", managerCookie)).status, 401); managerCookie = await login(manager);
  const wages = ok(await call(`/api/workforce/employees/${employees[0]}/wages`, managerCookie), "Explicit wage grant"); assert.equal(wages.wages[0].amountCents, 2200);
  assert.equal((await call(`/api/workforce/employees/${employees[1]}/wages`, managerCookie)).status, 404);
  const employee = ok(await call(`/api/workforce/employees/${employees[0]}`, managerCookie), "Scoped employee").employee;
  const contact = { version: employee.version, email: "fictional-contact@example.test", phone: "555-0199" };
  assert.equal((await call(`/api/workforce/employees/${employees[0]}/contact`, managerCookie, contact, "https://wrong-origin.invalid")).status, 403);
  ok(await call(`/api/workforce/employees/${employees[0]}/contact`, managerCookie, contact), "Authorized audited contact write");
  assert.equal((await call(`/api/workforce/employees/${employees[0]}/contact`, managerCookie, contact)).status, 409);
  assert.equal((await call(`/api/workforce/employees/${employees[1]}/contact`, managerCookie, { version: 1, email: "fictional-contact@example.test", phone: "555-0199" })).status, 404);
  const updated = ok(await call(`/api/workforce/employees/${employees[0]}`, managerCookie), "Contact persisted").employee; assert.equal(updated.phone, "555-0199");
  assert.equal((await call(`/api/workforce/employees/${employees[0]}/contact`, managerCookie, { version: updated.version, email: "fictional-contact@example.test", phone: "555-0199", accessLevel: "owner" })).status, 400);
  await grant({}, [departments[1]]);
  assert.equal((await call("/api/access/me", managerCookie)).status, 401); managerCookie = await login(manager);
  assert.equal((await call(`/api/workforce/employees/${employees[0]}`, managerCookie)).status, 404);
  assert.equal((await call(`/api/workforce/employees/${employees[1]}`, managerCookie)).status, 200);
  assert.equal((await call(`/api/workforce/employees/${employees[1]}/wages`, managerCookie)).status, 403);
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  const audit = await query("SELECT COUNT(*) AS count FROM audit_log WHERE actor_account_id = ? AND action = 'employee.contact_changed'", [manager.id]); assert.ok(audit[0].count > 0);
  console.log(JSON.stringify({ origin, ownerAdministration: "passed", managerDepartmentScope: "passed", generalManagerScope: "passed", privateFieldsDenied: "passed", explicitGrants: "passed", sharedWorkspaceScope: "passed", sessionRevocation: "passed", auditedWrite: "passed", staleWriteRejected: "passed", massAssignmentRejected: "passed", crossOriginRejected: "passed", reassignment: "passed", foreignKeys: "passed", fileBytes: "covered separately by workforce:check:staging" }));
} finally {
  const now = new Date().toISOString();
  for (const id of accounts) {
    await query("UPDATE accounts SET login_enabled = 0, password_hash = NULL, disabled_at = ?, session_version = session_version + 1 WHERE id = ?", [now, id]);
    await query("UPDATE account_sessions SET revoked_at = ? WHERE account_id = ?", [now, id]);
    await query("UPDATE account_setup_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL", [now, id]);
  }
  // Retain audit-linked fictional records as inactive, never delete history.
  for (const id of employees) { await query("UPDATE employees SET active = 0, terminated = 1 WHERE id = ?", [id]); await query("UPDATE employee_roles SET active = 0 WHERE employee_id = ?", [id]); }
  for (const id of roles) await query("UPDATE roles SET archived = 1 WHERE id = ?", [id]);
  for (const id of departments) await query("UPDATE departments SET archived = 1 WHERE id = ?", [id]);
  console.log("Fictional verification accounts disabled, password verifiers removed, sessions revoked, workforce fixtures archived; audit retained.");
}
