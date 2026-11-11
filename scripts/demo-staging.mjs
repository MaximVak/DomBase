// Explicit hosted demo operation. Never imports local data or deletes history.
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";
import { newEmployee } from "../tests/support/workforce-fixture.mjs";

const [flag, week] = process.argv.slice(2);
if (flag !== "--week" || process.argv.length !== 4) throw new Error("Provide only --week YYYY-MM-DD; hosted account/target overrides are forbidden.");
const { demoDataset } = await loadServerModule("demo/seed.ts");
const data = demoDataset(week);
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
const { saveBody } = await loadServerModule("tests/support/workforce-runtime.ts");
const config = await readStagingConfig();
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
const origin = `https://${stagingName}.${subdomain}.workers.dev`;
const seedKey = "stage0-hosted-demo-v1";
const privateFile = ".wrangler/private-setup/staging-demo-employee.txt";
const receiptPath = ".wrangler/releases/hosted-demo.json";
const progress = { weekStart: week, origin, stages: [], employeeIds: data.employees.map(row => row.id), departmentIds: data.departments.map(row => row.id) };
let operator, cookie;
const password = `Private demo operator ${newToken()}`;
const receipt = async () => writeFile(receiptPath, JSON.stringify({ at: new Date().toISOString(), ...progress }, null, 2), { mode: 0o600 });
async function query(sql, params = []) {
  const r = await cloudflare(`/accounts/${stagingAccount}/d1/database/${config.d1_databases[0].database_id}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(r) || r.some(x => !x.success)) throw new Error("Hosted demo query failed; private details withheld."); return r[0].results;
}
async function call(path, body, auth = cookie) {
  return fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(90000), headers: { ...(auth ? { Cookie: auth } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...(path === "/api/workspace/commit" ? { Prefer: "return=minimal" } : {}) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
}
async function ok(r) { assert.equal(r.status, 200, "Hosted demo operation must succeed"); return r.json(); }
async function login() { const r = await call("/api/auth/login", { email: operator.email, password }, ""); await ok(r); cookie = r.headers.getSetCookie().map(x => x.split(";")[0]).find(x => x.startsWith("__Host-dombase-session=")); assert.ok(cookie); }
const snapshot = () => call("/api/workspace/state").then(ok);
async function commit(changes, view) { view ??= await snapshot(); await ok(await call("/api/workspace/commit", saveBody(view, changes, newToken()))); }
async function stage(name) { progress.stages.push(name); await receipt(); console.log(`Completed: ${name}`); }
try {
  await mkdir(".wrangler/releases", { recursive: true, mode: 0o700 });
  await mkdir(".wrangler/private-setup", { recursive: true, mode: 0o700 }); await chmod(".wrangler/private-setup", 0o700);
  const [prior] = await query("SELECT metadata FROM audit_log WHERE action='demo.seeded' AND entity_type='demo' AND entity_id=? LIMIT 1", [seedKey]);
  if (prior) {
    const saved = JSON.parse(prior.metadata);
    if (saved.weekStart !== week) throw new Error("Hosted demo already uses a different week. No records were reset.");
    await readFile(privateFile); console.log("Hosted demo already seeded; existing edits and test PIN preserved.");
  } else {
    const [counts] = await query("SELECT (SELECT count(*) FROM employees WHERE active=1 AND terminated=0) employees,(SELECT count(*) FROM departments WHERE archived=0) departments,(SELECT count(*) FROM roles WHERE archived=0) roles,(SELECT count(*) FROM shifts WHERE archived_at IS NULL) shifts");
    if (Object.values(counts).some(Number)) throw new Error("Active workforce exists. No data was overwritten; review it before hosted seeding.");
    const email = `hosted-demo-operator-${newToken()}@example.test`.toLowerCase();
    [operator] = await query("INSERT INTO accounts (email,normalized_email,display_name,access_level) VALUES (?,?,?,'owner') RETURNING id", [email, email, "Temporary hosted demo provisioner (disabled after use)"]); operator.email = email;
    progress.operatorId = operator.id; await receipt();
    const token = newToken();
    await query("INSERT INTO account_setup_tokens (id,account_id,token_hash,issued_session_version,expires_at) VALUES (?,?,?,1,?)", [newToken(), operator.id, tokenHash(token), new Date(Date.now() + 3600000).toISOString()]);
    await ok(await call("/api/auth/setup", { token, password }, "")); await login();
    const view = await snapshot();
    const departments = data.departments.map(row => ({ entity: "department", id: row.id, before: null, after: { ...row, roles: data.roles.filter(role => role.departmentId === row.id).map(role => role.name), managerIds: [] } }));
    const employees = data.employees.map(row => ({ entity: "employee", id: row.id, before: null, after: { ...newEmployee(row.id, data.roles.find(role => role.id === row.roleId).name, view.basicInfo.locationName, row.name), email: row.email, phone: row.phone, startDate: row.startDate, payrollId: row.payrollId, wage: `$${(row.amountCents / 100).toFixed(2)}/hr` } }));
    await commit([...departments, ...employees], view); await stage("ten fictional employees, three jobs and two departments created atomically");
    const ready = await snapshot(); const draftKey = -operator.id;
    const draft = { upsertedShifts: data.shifts.map(row => ({ id: row.id, employeeId: row.employeeId, date: row.date, start: row.startTime, end: row.endTime, role: row.roleName, station: row.station, notes: row.notes })), deletedShiftIds: [], affectedEmployeeIds: data.employees.map(row => row.id) };
    await commit([{ entity: "schedule-draft", id: 1, before: ready.state.scheduleDraftsByManager[draftKey] ?? null, after: draft }], ready);
    const pending = await snapshot(); await commit([{ entity: "schedule-publish", id: 1, before: pending.state.scheduleDraftsByManager[draftKey], after: { publish: true } }], pending);
    await stage("fifty fictional shifts published for the requested week");
    const pin = String(randomInt(100000, 1000000));
    // Persist only in the ignored owner-readable file, never source/log/argv.
    await writeFile(privateFile, `FICTIONAL STAGING TEST ONLY\nEmployee: ${data.employees[0].name}\nPIN: ${pin}\nSite: ${origin}\nWeek: ${data.weekStart} through ${data.weekEnd}\nUse /kiosk after registering a separate test browser through /kiosk-admin as Owner.\nThis PIN never signs into the Owner/Manager dashboard. Do not share real passwords.\n`, { mode: 0o600, flag: "wx" });
    await ok(await call("/api/kiosk-admin/employee-pin", { employeeId: data.employees[0].id, pin, password }));
    const registration = await call("/api/kiosk-admin/register", { name: "Disposable demo PIN verification browser", password }); await ok(registration);
    const deviceCookie = registration.headers.getSetCookie().map(x => x.split(";")[0]).find(x => x.startsWith("__Host-dombase-kiosk-device=")); assert.ok(deviceCookie);
    const deviceRows = await query("SELECT id FROM kiosk_devices WHERE registered_by_account_id=? AND revoked_at IS NULL", [operator.id]);
    try {
      await ok(await call("/api/kiosk/pin", { pin }, deviceCookie));
      assert.equal((await call("/api/workspace/state", undefined, deviceCookie)).status, 403);
    } finally {
      const now = new Date().toISOString();
      for (const device of deviceRows) { await query("UPDATE kiosk_devices SET revoked_at=? WHERE id=?", [now, device.id]); await query("UPDATE device_sessions SET revoked_at=? WHERE device_id=?", [now, device.id]); }
    }
    await login(); await stage("fictional employee PIN verified on registered HTTPS device; device revoked");
    const result = await snapshot();
    assert.equal(result.state.employees.filter(row => progress.employeeIds.includes(row.id)).length, 10);
    assert.equal(result.state.departments.filter(row => progress.departmentIds.includes(row.id)).length, 2);
    const shifts = result.state.shifts.filter(row => progress.employeeIds.includes(row.employeeId) && row.date >= data.weekStart && row.date <= data.weekEnd); assert.equal(shifts.length, 50);
    await query("INSERT INTO audit_log (actor_account_id,action,entity_type,entity_id,metadata) VALUES (?,'demo.seeded','demo',?,?)", [operator.id, seedKey, JSON.stringify({ weekStart: week, weekEnd: data.weekEnd, fictional: true, employees: 10, roles: 3, departments: 2, shifts: 50 })]);
    await stage("fresh sign-in verified demo counts and shared schedule");
  }
} finally {
  if (operator) {
    const now = new Date().toISOString();
    await query("UPDATE kiosk_devices SET revoked_at=? WHERE registered_by_account_id=? AND revoked_at IS NULL", [now, operator.id]);
    await query("UPDATE device_sessions SET revoked_at=? WHERE device_id IN (SELECT id FROM kiosk_devices WHERE registered_by_account_id=?)", [now, operator.id]);
    await query("UPDATE kiosk_interactions SET ended_at=? WHERE device_session_id IN (SELECT ds.id FROM device_sessions ds JOIN kiosk_devices kd ON kd.id=ds.device_id WHERE kd.registered_by_account_id=?) AND ended_at IS NULL", [now, operator.id]);
    await query("UPDATE accounts SET login_enabled=0,password_hash=NULL,disabled_at=?,session_version=session_version+1 WHERE id=?", [now, operator.id]);
    await query("UPDATE account_sessions SET revoked_at=? WHERE account_id=?", [now, operator.id]);
    await query("UPDATE account_setup_tokens SET used_at=? WHERE account_id=? AND used_at IS NULL", [now, operator.id]);
    progress.operatorDisabled = true; await receipt();
  }
}
console.log(`Hosted fictional demo ready. Private employee PIN instructions: ${privateFile}. No PIN/password/setup token displayed.`);
