// Explicit staging acceptance with fictional records. Never uses real credentials.
import assert from "node:assert/strict";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";
import { newEmployee } from "../tests/support/workforce-fixture.mjs";
import { storageStatus } from "./storage-staging.mjs";
const hold = process.argv.slice(2).join(" ") === "--hold";
if (process.argv.length > (hold ? 3 : 2)) throw new Error("Use no arguments, or --hold for browser acceptance.");
const config = await readStagingConfig(); const databaseId = config.d1_databases[0].database_id;
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
const origin = `https://${stagingName}.${subdomain}.workers.dev`;
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
const { newRecordId, saveBody } = await loadServerModule("tests/support/workforce-runtime.ts");
const run = randomUUID(); const label = `QA7 ${run.slice(0, 6)}`;
const password = `Private staging acceptance ${newToken()}`;
const tracked = { accounts: [], employees: [], departments: [], shifts: [], events: [], pto: [], policies: [], availability: [], conversations: [], devices: [], files: [] };
const checks = []; let originalSettings, changedSetting, owner, peer, manager;
const receiptPath = ".wrangler/releases/step7-workforce-acceptance.json";
async function receipt(extra = {}) { await writeFile(receiptPath, JSON.stringify({ run, label, origin, at: new Date().toISOString(), tracked, checks, ...extra }, null, 2) + "\n", { mode: 0o600 }); }
async function query(sql, params = []) {
  const result = await cloudflare(`/accounts/${stagingAccount}/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(result) || result.some(row => !row.success)) throw new Error("Staging acceptance database operation failed."); return result[0].results;
}
async function call(path, cookie = "", body, headers = {}) {
  const binary = body instanceof Uint8Array;
  const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": binary ? "image/png" : "application/json" }), ...(path === "/api/workspace/commit" ? { Prefer: "return=minimal" } : {}), ...headers }, ...(body === undefined ? {} : { method: binary ? "PUT" : "POST", body: binary ? body : JSON.stringify(body) }) });
  const text = await response.text(); let json; try { json = JSON.parse(text); } catch { /* May be a redirect. */ }
  if (response.status >= 500) console.log(JSON.stringify({ failedPath: path, status: response.status, error: json?.error, resourceLimit: /1102|resource limits/i.test(text), ray: response.headers.get("cf-ray") }));
  return { status: response.status, json, headers: response.headers, cookies: response.headers.getSetCookie().map(value => value.split(";")[0]) };
}
function ok(response, description) { assert.equal(response.status, 200, description); return response.json; }
const snapshot = async actor => ok(await call("/api/workspace/state", actor.cookie), "Shared snapshot");
async function login(actor) { const response = await call("/api/auth/login", "", { email: actor.email, password }); ok(response, "Fictional sign-in"); actor.cookie = response.cookies.find(cookie => cookie.startsWith("__Host-dombase-session=")); assert.ok(actor.cookie); }
async function account(role, suffix) {
  const email = `step7-${run}-${suffix.toLowerCase().replace(/[^a-z0-9]/g, "-")}@example.test`;
  const [row] = await query("INSERT INTO accounts (email, normalized_email, display_name, access_level) VALUES (?, ?, ?, ?) RETURNING id", [email, email, `${label} ${suffix}`, role]);
  tracked.accounts.push(row.id); await receipt(); const token = newToken();
  await query("INSERT INTO account_setup_tokens (id, account_id, token_hash, issued_session_version, expires_at) VALUES (?, ?, ?, 1, ?)", [newToken(), row.id, tokenHash(token), new Date(Date.now() + 3600000).toISOString()]);
  ok(await call("/api/auth/setup", "", { token, password }), "Fictional private setup");
  const actor = { id: row.id, email }; await login(actor); return actor;
}
async function commit(actor, changes, view) { view ??= await snapshot(actor); return call("/api/workspace/commit", actor.cookie, saveBody(view, changes, newToken())); }
async function employeeEdit(actor, id, fields) { const view = await snapshot(actor); const before = view.state.employees.find(row => row.id === id); assert.ok(before); return commit(actor, [{ entity: "employee", id, before, after: { ...before, ...fields } }], view); }
async function check(name, runCheck) { await runCheck(); checks.push(name); await receipt(); console.log(`Passed: ${name}`); }
const localDate = offset => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const future = localDate(2);
let roleName, roleId, a, b, m, outside, shiftId;
async function cleanup() {
  // Every cleanup is scoped to IDs provisioned by this run; audit/punch history stays intact.
  const now = new Date().toISOString();
  if (changedSetting && owner) {
    const view = await snapshot(owner);
    if (view.settings.noShowMinutes === changedSetting) {
      ok(await commit(owner, [{ entity: "settings", id: 1, before: { ...view.settings, hoursRoundingMinutes: view.state.hoursRoundingMinutes }, after: { ...view.settings, noShowMinutes: originalSettings.noShowMinutes, hoursRoundingMinutes: view.state.hoursRoundingMinutes } }], view), "Restore only the test setting");
    }
  }
  for (const id of tracked.devices) { await query("UPDATE kiosk_devices SET revoked_at = ? WHERE id = ?", [now, id]); await query("UPDATE device_sessions SET revoked_at = ? WHERE device_id = ?", [now, id]); }
  for (const id of tracked.shifts) await query("UPDATE shifts SET archived_at = ? WHERE id = ?", [now, id]);
  for (const id of tracked.events) await query("DELETE FROM schedule_events WHERE id = ?", [id]);
  for (const id of tracked.pto) await query("UPDATE pto_requests SET archived_at = ? WHERE id = ?", [now, id]);
  for (const id of tracked.policies) await query("UPDATE pto_policies SET archived = 1 WHERE id = ?", [id]);
  for (const id of tracked.conversations) await query("UPDATE conversations SET archived_at = ? WHERE id = ?", [now, id]);
  // Keep tiny fictional object/history bytes for recovery evidence, but remove
  // all application download access after this acceptance run.
  for (const id of tracked.files) await query("UPDATE files SET status = 'deleted', updated_at = ? WHERE id = ?", [now, id]);
  for (const id of tracked.employees) { await query("UPDATE employees SET active = 0, terminated = 1, pin_hash = ?, pin_lookup = NULL, pin_version = pin_version + 1 WHERE id = ?", [`disabled-step7-${newToken()}`, id]); await query("UPDATE employee_roles SET active = 0 WHERE employee_id = ?", [id]); }
  for (const id of tracked.departments) { await query("UPDATE departments SET archived = 1 WHERE id = ?", [id]); await query("UPDATE roles SET archived = 1 WHERE department_id = ?", [id]); }
  for (const id of tracked.accounts) {
    await query("UPDATE accounts SET login_enabled = 0, password_hash = NULL, disabled_at = ?, session_version = session_version + 1 WHERE id = ?", [now, id]);
    await query("UPDATE account_sessions SET revoked_at = ? WHERE account_id = ?", [now, id]);
    await query("UPDATE account_setup_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL", [now, id]);
    await query("DELETE FROM manager_approval_credentials WHERE account_id = ?", [id]);
  }
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  await receipt({ cleaned: true }); console.log("Fictional accounts disabled, credentials revoked and test workforce archived; immutable history retained.");
}
try {
  owner = await account("owner", "Owner A"); peer = await account("owner", "Owner B"); manager = await account("manager", "Manager");
  await check("server-backed departments, jobs and employee creation", async () => {
    for (const suffix of ["A", "B"]) {
      const id = newRecordId(); tracked.departments.push(id); await receipt();
      ok(await commit(owner, [{ entity: "department", id, before: null, after: { id, name: `${label} department ${suffix}`, roles: [`${label} job ${suffix}`], managerIds: [] } }]), "Create relational department and job");
    }
    roleName = `${label} job A`; [{ id: roleId }] = await query("SELECT id FROM roles WHERE name = ?", [roleName]);
    for (const suffix of ["Worker A", "Worker B", "Manager", "Other department"]) {
      const id = newRecordId(); tracked.employees.push(id); await receipt(); const view = await snapshot(owner);
      ok(await commit(owner, [{ entity: "employee", id, before: null, after: newEmployee(id, suffix === "Other department" ? `${label} job B` : roleName, view.basicInfo.locationName, `${label} ${suffix}`) }], view), "Create fictional employee");
    }
    [a, b, m, outside] = tracked.employees;
    for (const [actor, id] of [[owner, a], [peer, b], [manager, m]]) { actor.employeeId = id; await query("UPDATE accounts SET employee_id = ? WHERE id = ?", [id, actor.id]); await login(actor); }
    const access = ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie), "Manager access lookup");
    ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie, { version: access.account.version, permissions: {}, departmentIds: [tracked.departments[0]] }), "Assign only the test department"); await login(manager);
    assert.ok((await snapshot(peer)).state.employees.some(row => row.id === a));
    assert.equal((await snapshot(manager)).state.employees.some(row => row.id === outside), false);
  });
  await check("private profile encryption, wage history and restricted projection", async () => {
    ok(await employeeEdit(owner, a, { legalFirstName: "Fictional", socialSecurityNumber: "000-98-7654", wage: "$25.50/hr" }), "Save private test profile");
    const [stored] = await query("SELECT ssn_encrypted AS value FROM employee_profiles WHERE employee_id = ?", [a]); assert.ok(stored.value.startsWith("v1.") && !stored.value.includes("000-98-7654"));
    const visible = (await snapshot(peer)).state.employees.find(row => row.id === a); assert.equal(visible.socialSecurityNumber, "•••-••-7654");
    const hidden = (await snapshot(manager)).state.employees.find(row => row.id === a); assert.equal(hidden.socialSecurityNumber, ""); assert.equal(hidden.wage, "");
    ok(await employeeEdit(owner, a, { wage: "$26.00/hr" }), "Append wage change"); assert.equal((await query("SELECT COUNT(*) AS count FROM wage_rates WHERE employee_id = ?", [a]))[0].count, 2);
  });
  await check("private R2 certificate/onboarding bytes, scope, replacement and revocation on HTTPS", async () => {
    assert.equal((await storageStatus()).private, true, "Attachment bucket must have no public domains");
    const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"));
    const base = { employeeId: a, kind: "certificate", title: `${label} fictional certificate`, expirationDate: "2027-11-01", fileName: "fictional-acceptance.png", contentType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    async function upload(values) {
      const file = { ...base, ...values, id: newToken() }; tracked.files.push(file.id); await receipt();
      ok(await call("/api/documents/prepare", owner.cookie, file), "Prepare protected document");
      ok(await call(`/api/documents/${file.id}/content`, owner.cookie, bytes), "Publish exact document bytes");
      return file.id;
    }
    const certificate = await upload({});
    const path = id => `/api/documents/${id}/download`;
    assert.equal((await call(path(certificate))).status, 401);
    assert.equal((await call(path(certificate), manager.cookie)).status, 403);
    await login(peer);
    const download = await fetch(origin + path(certificate), { headers: { Cookie: peer.cookie }, redirect: "manual", signal: AbortSignal.timeout(30000) });
    assert.equal(download.status, 200); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
    assert.match(download.headers.get("content-disposition"), /attachment/); assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    const old = await upload({ kind: "onboarding", title: "W-4 Form", expirationDate: undefined });
    const current = await upload({ kind: "onboarding", title: "W-4 Form", expirationDate: undefined });
    assert.equal((await call(path(old), owner.cookie)).status, 404);
    assert.equal((await snapshot(peer)).state.employees.find(e => e.id === a).onboardingFileIds["W-4 Form"], current);
    const outsideFile = await upload({ employeeId: outside });
    let access = ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie), "Read test Manager grants");
    ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie, { version: access.account.version, permissions: { "documents.read": true, "documents.download": true }, departmentIds: [tracked.departments[0]] }), "Grant scoped certificate downloads");
    await login(manager); assert.equal((await call(path(certificate), manager.cookie)).status, 200);
    assert.equal((await call(path(outsideFile), manager.cookie)).status, 404);
    assert.equal((await call(path(current), manager.cookie)).status, 403, "Onboarding still requires private-profile permission");
    access = ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie), "Read test grants for revocation");
    const oldCookie = manager.cookie;
    ok(await call(`/api/access/accounts/${manager.id}`, owner.cookie, { version: access.account.version, permissions: {}, departmentIds: [tracked.departments[0]] }), "Revoke test document grants");
    assert.equal((await call(path(certificate), oldCookie)).status, 401); await login(manager);
    assert.equal((await call(path(certificate), manager.cookie)).status, 403);
  });
  await check("draft privacy, schedule publication and independent-session persistence", async () => {
    shiftId = newRecordId(); tracked.shifts.push(shiftId); const view = await snapshot(owner); const key = owner.employeeId;
    const draft = { upsertedShifts: [{ id: shiftId, employeeId: a, date: future, start: "09:00", end: "17:00", role: roleName, station: "Floor", notes: "Fictional hosted acceptance shift" }], deletedShiftIds: [], affectedEmployeeIds: [a] };
    ok(await commit(owner, [{ entity: "schedule-draft", id: 1, before: view.state.scheduleDraftsByManager[key] ?? null, after: draft }], view), "Save draft");
    assert.equal((await snapshot(peer)).state.shifts.some(row => row.id === shiftId), false);
    const ready = await snapshot(owner); ok(await commit(owner, [{ entity: "schedule-publish", id: 1, before: ready.state.scheduleDraftsByManager[key], after: { publish: true } }], ready), "Publish schedule");
    assert.ok((await snapshot(peer)).state.shifts.some(row => row.id === shiftId));
    await login(peer); assert.ok((await snapshot(peer)).state.shifts.some(row => row.id === shiftId));
    // A new cookie jar sends no browser-local data, matching a cleared/fresh browser session.
    const fresh = { ...peer, cookie: "" }; await login(fresh); assert.ok((await snapshot(fresh)).state.shifts.some(row => row.id === shiftId));
  });
  await check("idempotent saves and stale/concurrent edit conflicts", async () => {
    const view = await snapshot(owner); const before = view.state.employees.find(row => row.id === a);
    const body = saveBody(view, [{ entity: "employee", id: a, before, after: { ...before, phone: "555-0171" } }], newToken());
    ok(await call("/api/workspace/commit", owner.cookie, body), "First save"); ok(await call("/api/workspace/commit", owner.cookie, body), "Same-request retry");
    assert.equal((await call("/api/workspace/commit", peer.cookie, { ...body, id: newToken() })).status, 409);
    const base = await snapshot(owner); const person = base.state.employees.find(row => row.id === a);
    const payload = phone => saveBody(base, [{ entity: "employee", id: a, before: person, after: { ...person, phone } }], newToken());
    const results = await Promise.all([call("/api/workspace/commit", owner.cookie, payload("555-0172")), call("/api/workspace/commit", peer.cookie, payload("555-0173"))]);
    assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  });
  await check("settings and company details acknowledged across sessions", async () => {
    const view = await snapshot(owner); originalSettings = view.settings; changedSetting = view.settings.noShowMinutes === 6 ? 7 : 6;
    ok(await commit(owner, [{ entity: "settings", id: 1, before: { ...view.settings, hoursRoundingMinutes: view.state.hoursRoundingMinutes }, after: { ...view.settings, noShowMinutes: changedSetting, hoursRoundingMinutes: view.state.hoursRoundingMinutes } }], view), "Save setting");
    assert.equal((await snapshot(peer)).settings.noShowMinutes, changedSetting);
    const changed = await snapshot(owner); ok(await commit(owner, [{ entity: "settings", id: 1, before: { ...changed.settings, hoursRoundingMinutes: changed.state.hoursRoundingMinutes }, after: { ...changed.settings, noShowMinutes: originalSettings.noShowMinutes, hoursRoundingMinutes: changed.state.hoursRoundingMinutes } }], changed), "Restore setting"); changedSetting = null;
    const base = await snapshot(owner); ok(await commit(owner, [{ entity: "business", id: 1, before: base.basicInfo, after: { ...base.basicInfo } }], base), "Persist existing company contact values without changing them");
  });
  await check("time-off and availability request/decision persistence", async () => {
    const id = newRecordId(); tracked.pto.push(id); const now = new Date().toISOString();
    ok(await commit(manager, [{ entity: "pto-request", id, before: null, after: { id, employeeId: m, compensation: "unpaid", startDate: future, endDate: future, reason: "vacation", explanation: "Fictional acceptance request", status: "pending", requestedAt: now } }]), "Submit own time off");
    const view = await snapshot(owner); const before = view.state.ptoRequests.find(row => row.id === id); assert.equal(before.status, "pending");
    ok(await commit(owner, [{ entity: "pto-request", id, before, after: { ...before, status: "approved", decidedAt: now, decidedByEmployeeId: a } }], view), "Approve time off");
    assert.equal((await snapshot(manager)).state.ptoRequests.find(row => row.id === id).status, "approved");
    const availabilityId = newRecordId(); tracked.availability.push(availabilityId); const base = await snapshot(manager);
    ok(await commit(manager, [{ entity: "availability", id: availabilityId, before: null, after: { id: availabilityId, employeeId: m, effectiveDate: future, status: "pending", slots: [{ day: "Wednesday", preference: "preferred", startHour: 9, endHour: 17, location: base.basicInfo.locationName }], submittedAt: now, requestNote: "Fictional acceptance availability" } }], base), "Submit availability");
    const pending = await snapshot(owner); const av = pending.state.availabilityRequests.find(row => row.id === availabilityId);
    if (av.status === "pending") ok(await commit(owner, [{ entity: "availability", id: availabilityId, before: av, after: { ...av, status: "approved", decidedAt: now, decidedByEmployeeId: a } }], pending), "Approve availability");
    assert.equal((await snapshot(manager)).state.availabilityRequests.find(row => row.id === availabilityId).status, "approved");
    const policyId = newRecordId(); tracked.policies.push(policyId);
    ok(await commit(owner, [{ entity: "pto-policy", id: policyId, before: null, after: { id: policyId, name: `${label} test allowance`, method: "fixed", fixedHours: 40, earnedHours: 0, workedHours: 0, employeeIds: [m], startingBalances: { [m]: { startDate: localDate(0), balance: 8 } } } }]), "Save test PTO policy");
    assert.equal((await snapshot(peer)).state.ptoPolicies.find(row => row.id === policyId).startingBalances[m].balance, 8);
  });
  await check("member-only messages and individual notification receipts", async () => {
    const id = newRecordId(); tracked.conversations.push(id); const messageId = newRecordId();
    const conversation = { id, name: `${label} private test conversation`, creatorEmployeeId: a, participantIds: [a, b], messages: [{ id: messageId, senderEmployeeId: a, body: "Fictional hosted message", sentAt: new Date().toISOString(), readByEmployeeIds: [a] }], pinnedByEmployeeIds: [], mutedByEmployeeIds: [] };
    ok(await commit(owner, [{ entity: "conversation", id, before: null, after: conversation }]), "Send member message");
    const view = await snapshot(peer); const before = view.state.conversations.find(row => row.id === id); assert.equal(before.messages[0].body, "Fictional hosted message");
    assert.equal((await snapshot(manager)).state.conversations.some(row => row.id === id), false);
    const after = structuredClone(before); after.messages[0].readByEmployeeIds.push(b); after.pinnedByEmployeeIds.push(b);
    ok(await commit(peer, [{ entity: "conversation", id, before, after }], view), "Save own message receipt");
    assert.ok((await snapshot(owner)).state.conversations.find(row => row.id === id).messages[0].readByEmployeeIds.includes(b));
    const current = await snapshot(owner); const source = `request-${newRecordId()}`;
    ok(await commit(owner, [{ entity: "notifications", id: 1, before: { opened: current.opened[a] ?? [], dismissed: current.dismissed[a] ?? [] }, after: { opened: [source], dismissed: [source] } }], current), "Save own notification receipt");
    assert.ok((await snapshot(owner)).dismissed[a].includes(source)); assert.equal((await snapshot(peer)).dismissed[b].includes(source), false);
  });
  await check("registered-device punch through HTTPS into shared timesheets and correction history", async () => {
    const pin = String(randomInt(100000, 1000000));
    ok(await call("/api/kiosk-admin/employee-pin", owner.cookie, { employeeId: a, pin, password }), "Enroll fictional employee PIN");
    const approvalPin = ok(await call("/api/kiosk-admin/approval-pin", owner.cookie, { password }), "Enroll fictional approval PIN").pin;
    const registration = await call("/api/kiosk-admin/register", owner.cookie, { name: `${label} disposable test device`, password }); const data = ok(registration, "Register test device");
    const device = registration.cookies.find(cookie => cookie.startsWith("__Host-dombase-kiosk-device=")); assert.ok(device);
    // Device ID is obtained via its Owner listing rather than assumed response fields.
    await login(owner); const listing = ok(await call("/api/kiosk-admin/devices", owner.cookie), "List test device");
    tracked.devices.push(listing.devices.find(row => row.name === `${label} disposable test device`).id); await receipt(); void data;
    assert.equal((await call("/api/workspace/state", `${device}; ${owner.cookie}`)).status, 403);
    const enter = await call("/api/kiosk/pin", device, { pin }); ok(enter, "Employee PIN sign-in");
    const person = `${device}; ${enter.cookies.find(cookie => cookie.startsWith("__Host-dombase-kiosk-person="))}`;
    const clock = await call("/api/kiosk/clock", person, { eventType: "in", roleId, explanation: "Fictional hosted acceptance punch" });
    if (clock.status === 202) ok(await call("/api/kiosk/approve", person, { requestId: clock.json.requestId, pin: approvalPin }), "One-request approval"); else ok(clock, "Clock in");
    const state = await snapshot(peer); assert.ok(state.state.clockEvents.some(row => row.employeeId === a && row.type === "in"));
    const again = await call("/api/kiosk/pin", device, { pin }); ok(again, "Fresh employee PIN");
    const exit = await call("/api/kiosk/clock", `${device}; ${again.cookies.find(cookie => cookie.startsWith("__Host-dombase-kiosk-person="))}`, { eventType: "out", explanation: "Fictional hosted acceptance punch" });
    if (exit.status === 202) ok(await call("/api/kiosk/approve", `${device}; ${again.cookies.find(cookie => cookie.startsWith("__Host-dombase-kiosk-person="))}`, { requestId: exit.json.requestId, pin: approvalPin }), "Clock-out approval"); else ok(exit, "Clock out");
    const raw = await query("SELECT id, occurred_at, event_type FROM clock_events WHERE employee_id = ? ORDER BY id", [a]); assert.equal(raw.length, 2);
    const view = await snapshot(owner); const events = view.state.clockEvents.filter(row => row.employeeId === a);
    const corrected = events.map(row => ({ id: newRecordId(), employeeId: a, type: row.type, at: row.type === "in" ? new Date(Date.parse(row.at) - 60000).toISOString() : row.at, role: roleName }));
    ok(await commit(owner, [{ entity: "timecard", id: newRecordId(), before: { events }, after: { employeeId: a, date: localDate(0), eventIds: events.map(row => row.id), events: corrected, reason: "Fictional correction acceptance" } }], view), "Append attributed correction");
    assert.deepEqual(await query("SELECT id, occurred_at, event_type FROM clock_events WHERE employee_id = ? ORDER BY id", [a]), raw);
    assert.ok((await snapshot(peer)).state.clockEvents.some(row => row.id === corrected[0].id));
    ok(await call("/api/kiosk-admin/revoke", owner.cookie, { deviceId: tracked.devices[0] }), "Revoke test device");
    assert.equal((await call("/api/kiosk/status", device)).status, 401);
  });
  await check("schedule events, manual hours adjustments and attribution", async () => {
    const id = newRecordId(); tracked.events.push(id); ok(await commit(owner, [{ entity: "schedule-event", id, before: null, after: { id, date: future, title: `${label} test event`, notes: "Fictional acceptance" } }]), "Save schedule event");
    assert.ok((await snapshot(peer)).state.scheduleEvents.some(row => row.id === id));
    const adjustmentId = newRecordId(); ok(await commit(owner, [{ entity: "hours-adjustment", id: adjustmentId, before: null, after: { id: adjustmentId, employeeId: a, date: localDate(0), hours: 0.25 } }]), "Append manual hours adjustment");
    assert.equal((await snapshot(peer)).state.hoursAdjustments.find(row => row.id === adjustmentId).hours, 0.25);
    assert.ok((await query("SELECT COUNT(*) AS count FROM audit_log WHERE actor_account_id = ? AND action = 'workforce.changed'", [owner.id]))[0].count > 0);
  });
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  await receipt({ readyForBrowser: true, futureDate: future, workerName: `${label} Worker A`, shiftId });
  console.log(JSON.stringify({ readyForBrowser: true, workerName: `${label} Worker A`, futureDate: future, checks: checks.length, receiptPath }));
  if (hold) {
    console.log("Waiting for browser acceptance; send close to archive this run's fictional records.");
    await new Promise(resolve => { process.stdin.setEncoding("utf8"); process.stdin.on("data", data => { if (data.trim() === "close") resolve(); }); process.once("SIGTERM", resolve); });
  }
} finally { await cleanup(); }
