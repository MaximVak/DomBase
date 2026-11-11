import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";
import { cookiesOf } from "./support/kiosk-fixture.mjs";

test("permission changes remain consistent across legacy reads, shared screens and self profiles", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true }); const statePath = await mkdtemp(join(projectRoot, ".wrangler/permission-review-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath); const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts"); const { createAuthService, createAccessService, createWorkforceService, saveBody, newToken } = await loadServerModule("tests/support/workforce-runtime.ts");
  const db = drizzle(platform.env.DB, { schema }); const secret = "isolated-step5-review-secret-at-least-32-characters"; const password = "Step five fixture passphrase only!";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password); const auth = createAuthService(db, { secret }); const access = createAccessService(db, auth); const workspace = createWorkforceService(db, access, { secret, fieldKey });
  const origin = "http://localhost:3000";
  const call = (service, path, cookie = "", body, headers = {}) => service.handle(new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const data = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const login = async email => { const response = await call(auth, "/api/auth/login", "", { email, password }); await data(response); return cookiesOf(response)[0]; };
  const owner = await login(f.owner.email); let manager = await login(f.manager.email);
  const snapshot = () => call(workspace, "/api/workspace/state", manager).then(data);
  async function grant(permissions = {}, departments = [f.deptA.id]) {
    const current = await data(await call(access, `/api/access/accounts/${f.manager.id}`, owner));
    await data(await call(access, `/api/access/accounts/${f.manager.id}`, owner, { version: current.account.version, permissions, departmentIds: departments }));
    manager = await login(f.manager.email);
  }
  async function employeeChange(id, fields) {
    const before = await snapshot(); const employee = before.state.employees.find(e => e.id === id); assert.ok(employee);
    return call(workspace, "/api/workspace/commit", manager, saveBody(before, [{ entity: "employee", id, before: employee, after: { ...employee, ...fields } }], newToken()));
  }
  await t.test("read-only document grants do not expose onboarding tax filenames on older endpoints", async () => {
    const id = newToken(); await db.insert(schema.files).values({ id, employeeId: f.a.id, uploadedByAccountId: f.owner.id, objectKey: `fixture-only/${id}`, fileName: "private-tax-form.pdf", contentType: "application/pdf", sizeBytes: 1, status: "ready" });
    await db.insert(schema.documentUploads).values({ fileId: id, bodyHash: "fixture", kind: "onboarding", title: "W-4 Form", employeeVersion: 1, expiresAt: "2027-01-01T00:00:00.000Z" });
    await db.insert(schema.onboardingDocumentFiles).values({ employeeId: f.a.id, documentName: "W-4 Form", fileId: id });
    await db.insert(schema.onboardingDocumentLabels).values({ employeeId: f.a.id, documentName: "W-4 Form", fileName: "private-tax-form.pdf" });
    await grant({ "documents.read": true });
    const files = await data(await call(access, `/api/workforce/employees/${f.a.id}/files`, manager)); assert.equal(JSON.stringify(files).includes("private-tax-form.pdf"), false); assert.ok(files.files.some(row => row.id === "private-file-a"));
    await grant({ "documents.read": true, "team.private.read": true });
    assert.equal((await data(await call(access, `/api/workforce/employees/${f.a.id}/files`, manager))).files.some(row => row.id === id), true);
  });
  await t.test("document metadata reads do not authorize creating certificate records", async () => {
    await grant({ "team.manage": true, "documents.read": true }); const before = await snapshot(); const employee = before.state.employees.find(e => e.id === f.a.id);
    const certificate = { id: 99001, name: "Read-only certificate test", fileName: "" };
    assert.equal((await employeeChange(f.a.id, { certificates: [...employee.certificates, certificate] })).status, 403);
    await grant({ "team.manage": true, "documents.read": true, "documents.manage": true }); const current = await snapshot();
    await data(await employeeChange(f.a.id, { certificates: [...current.state.employees.find(e => e.id === f.a.id).certificates, certificate] }));
  });
  await t.test("self profile edits cannot rewrite administrative payroll or employment fields", async () => {
    await grant();
    for (const fields of [{ payrollClassification: "1099 Contractor" }, { payrollId: "self-forged-payroll" }, { employmentHistory: [{ type: "rehired", date: "2026-11-01", reason: "Self-forged" }] }, { terminationNote: "Self-forged termination note" }, { eligibleForRehire: false }]) assert.equal((await employeeChange(f.managerEmployee.id, fields)).status, 403);
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, f.managerEmployee.id)); assert.equal(employee.payrollClassification, "W-2 Employee"); assert.equal(employee.payrollId, "");
  });
  await t.test("own contact and profile fields remain editable without department assignments", async () => {
    await grant({}, []); const before = await snapshot(); assert.ok(before.state.employees.some(e => e.id === f.managerEmployee.id)); assert.equal(before.state.employees.some(e => e.id === f.a.id), false);
    await data(await employeeChange(f.managerEmployee.id, { phone: "555-0198", legalFirstName: "Own legal name" }));
    assert.equal((await snapshot()).state.employees.find(e => e.id === f.managerEmployee.id).phone, "555-0198");
  });
  await t.test("revoked parent reads do not leak sensitive fields through a different screen", async () => {
    await db.update(schema.employees).set({ payrollId: "private-payroll-a", payrollClassification: "1099 Contractor" }).where(eq(schema.employees.id, f.a.id));
    await db.insert(schema.ptoRequests).values({ employeeId: f.a.id, compensation: "unpaid", startDate: "2026-11-12", endDate: "2026-11-12", reason: "sick_emergency", explanation: "Private medical request text" });
    await grant({ "team.read": false, "timesheets.read": false, "schedule.read": true, "time_off.read": true, "wages.read": true, "exports.timesheets": true, "team.private.read": true });
    const view = await snapshot(); const employee = view.state.employees.find(e => e.id === f.a.id); assert.ok(employee);
    assert.equal(employee.payrollId, ""); assert.equal(employee.wage, ""); assert.equal(employee.payrollClassification, undefined);
    assert.equal(JSON.stringify(view).includes("Private medical request text"), false);
    await grant({ "team.read": false, "timesheets.read": true, "exports.timesheets": true, "wages.read": true });
    const timesheet = (await snapshot()).state.employees.find(e => e.id === f.a.id); assert.equal(timesheet.payrollId, "private-payroll-a"); assert.equal(timesheet.wage, "$22.00/hr");
  });
  await t.test("department reassignment revokes old sessions and prevents publishing a hidden old draft", async () => {
    await grant(); let view = await snapshot(); const draft = { upsertedShifts: [{ id: 99002, employeeId: f.a.id, date: "2026-11-12", start: "09:00", end: "17:00", role: f.roleA.name, station: "Floor", notes: "" }], deletedShiftIds: [], affectedEmployeeIds: [f.a.id] };
    await data(await call(workspace, "/api/workspace/commit", manager, saveBody(view, [{ entity: "schedule-draft", id: 1, before: null, after: draft }], newToken())));
    const old = manager; await grant({}, [f.deptB.id]);
    for (const [service, path] of [[access, "/api/access/me"], [access, "/api/workforce/employees"], [workspace, "/api/workspace/state"]]) assert.equal((await call(service, path, old)).status, 401);
    view = await snapshot(); assert.equal(view.state.employees.some(e => e.id === f.a.id), false);
    assert.ok([403, 404].includes((await call(workspace, "/api/workspace/commit", manager, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[f.managerEmployee.id], after: { publish: true } }], newToken()))).status));
    assert.equal((await db.select().from(schema.shifts).where(eq(schema.shifts.id, 99002))).length, 0);
  });
  await t.test("a captured write guard rejects a session that becomes idle before its mutation", async () => {
    await grant({ "team.manage": true });
    const ctx = await access.workspaceContext(new Request(origin + "/api/workspace/state", { headers: { Cookie: manager } }));
    assert.ok(await db.get(sql`SELECT 1 WHERE ${ctx.activeActor()}`));
    await db.update(schema.accountSessions).set({ lastSeenAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.accountSessions.id, ctx.sessionId));
    assert.equal(await db.get(sql`SELECT 1 WHERE ${ctx.activeActor()}`), undefined);
  });

});
