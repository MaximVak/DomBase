import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createHash } from "node:crypto";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("Stage 1 team workflows operate locally with scoped, audited and preserved records", { timeout: 180000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/team-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  const schema = await loadServerModule("db/schema.ts");
  const runtime = await loadServerModule("tests/support/workforce-runtime.ts");
  const { createAuthService, createAccessService, createTeamService, createInvitationService, createWorkforceService, createDocumentService, newToken, saveBody, stateChanges } = runtime;
  const secret = "isolated-stage-one-team-test-secret-at-least-32-characters";
  let time = Date.parse("2026-11-05T05:00:00Z"); const now = () => time;
  async function connect() {
    platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
    const db = drizzle(platform.env.DB, { schema }); const auth = createAuthService(db, { secret }); const access = createAccessService(db, auth);
    return { db, auth, access, team: createTeamService(db, access, { secret, fieldKey, now }), invites: createInvitationService(db, secret, now), workspace: createWorkforceService(db, access, { secret, fieldKey, now }), docs: createDocumentService(db, access, { secret, bucket: platform.env.FILES, now }), photos: createDocumentService(db, access, { secret, bucket: platform.env.FILES, now, selfAuth: auth }) };
  }
  let { db, auth, access, team, invites, workspace, docs, photos } = await connect();
  const password = "Stage one isolated verification passphrase!"; const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const origin = "http://localhost:3000";
  const req = (path, cookie = "", body, extra = {}) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = async r => { const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body; };
  const login = async email => { const r = await auth.handle(req("/api/auth/login", "", { email, password })); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
  const owner = await login(f.owner.email); let manager = await login(f.manager.email); let employee = await login(f.employeeAccount.email);
  const state = (cookie = owner) => team.handle(req("/api/team/state", cookie)).then(ok);
  async function commit(operation, data, cookie = owner, base) { const snapshot = base ?? await state(cookie); return team.handle(req("/api/team/commit", cookie, { id: newToken(), revision: snapshot.revision, operation, data })); }
  const workspaceState = () => workspace.handle(req("/api/workspace/state", owner)).then(ok);
  async function legacy(update) { const before = await workspaceState(); const next = structuredClone(before.state); update(next); return workspace.handle(req("/api/workspace/commit", owner, saveBody(before, stateChanges(before.state, next, f.b.id), newToken()))); }
  const rawCount = async table => (await db.select().from(table)).length;
  let created;
  await t.test("bulk adds email-only and phone-only people atomically with captured local invitations", async () => {
    const before = await rawCount(schema.employees);
    await ok(await commit("bulk", { rows: [{ name: "Demo invited email", email: "invited@example.test", roleId: f.roleA.id, channel: "email", startDate: "2026-10-01" }, { name: "Demo invited phone", phone: "202-555-0140", roleId: f.roleB.id, channel: "sms" }] }));
    const data = await state(); created = data.employees.find(e => e.email === "invited@example.test"); assert.equal((await rawCount(schema.employees)), before + 2); assert.equal(created.tenure, "1 month");
    const inbox = await ok(await team.handle(req("/api/team/inbox", owner))); assert.equal(inbox.messages.length, 2); assert.ok(inbox.messages.every(m => m.status.includes("not sent")));
    const stored = await db.select().from(schema.teamInvitations); assert.equal(stored.length, 2); assert.ok(stored.every(i => !i.localTokenEncrypted.includes(new URL(inbox.messages[0].url).hash.slice(7))));
    const rowsBefore = await rawCount(schema.employees);
    assert.equal((await commit("bulk", { rows: [{ name: "Valid pending", email: "pending@example.test", roleId: f.roleA.id }, { name: "Invalid", email: "bad", roleId: f.roleA.id }] })).status, 400);
    assert.equal(await rawCount(schema.employees), rowsBefore);
    assert.equal((await commit("bulk", { rows: [{ name: "Duplicate", email: "INVITED@EXAMPLE.TEST", roleId: f.roleA.id }] })).status, 409);
  });
  await t.test("resend supersedes old invitations; acceptance is single-use, Employee-only and supports phone enrollment", async () => {
    let inbox = await ok(await team.handle(req("/api/team/inbox", owner))); const old = inbox.messages.find(m => m.employeeId === created.id); const token = new URL(old.url).hash.slice(7);
    assert.equal((await invites.handle(req("/api/invitations/inspect", "", { token }))).status, 200);
    await ok(await commit("invite", { employeeId: created.id, version: created.version, channel: "email" }));
    assert.equal((await invites.handle(req("/api/invitations/inspect", "", { token }))).status, 401);
    inbox = await ok(await team.handle(req("/api/team/inbox", owner))); const current = inbox.messages.find(m => m.employeeId === created.id); const next = new URL(current.url).hash.slice(7);
    assert.equal((await invites.handle(req("/api/invitations/accept", "", { token: next, email: "wrong@example.test", password }))).status, 400);
    const accepted = await Promise.all([invites.handle(req("/api/invitations/accept", "", { token: next, email: "invited@example.test", password })), invites.handle(req("/api/invitations/accept", "", { token: next, email: "invited@example.test", password }))]);
    assert.equal(accepted.filter(r => r.status === 200).length, 1); assert.ok(accepted.every(r => [200, 401, 409].includes(r.status)));
    const cookie = await login("invited@example.test"); assert.equal((await access.handle(req("/api/access/accounts", cookie))).status, 401);
    const phone = inbox.messages.find(m => m.channel === "sms");
    await ok(await invites.handle(req("/api/invitations/accept", "", { token: new URL(phone.url).hash.slice(7), email: "phone-signin@example.test", password })));
    assert.equal((await auth.handle(req("/api/auth/session", await login("phone-signin@example.test")))).status, 200);
  });
  await t.test("scope, invitation grants, tablet and forged fields cannot create broader access", async () => {
    const scoped = await state(manager); assert.equal(scoped.employees.some(e => e.id === f.b.id), false); assert.ok(scoped.employees.every(e => e.wageRates.length === 0 && e.payrollId === ""));
    assert.equal((await team.handle(req("/api/team/state", employee))).status, 401);
    assert.equal((await team.handle(req("/api/team/state", `dombase-kiosk-device=${f.deviceToken}; ${owner}`))).status, 403);
    assert.equal((await team.handle(new Request("https://test.example/api/team/inbox", { headers: { Cookie: owner } }))).status, 401);
    assert.equal((await commit("invite", { employeeId: f.a.id, version: 1, channel: "email" }, manager)).status, 403);
    assert.equal((await commit("bulk", { rows: [{ name: "Forged", email: "forged@example.test", roleId: f.roleA.id, accessLevel: "owner" }] })).status, 400);
  });
  await t.test("multiple jobs and dated hourly/salary rates persist without replacing wage history or future rates", async () => {
    let data = await state(); let e = data.employees.find(e => e.id === created.id);
    await ok(await commit("jobs", { employeeId: e.id, version: e.version, roleIds: [f.roleA.id, f.roleB.id] }));
    for (const rate of [{ roleId: f.roleA.id, amountCents: 2000, basis: "hourly", effectiveDate: "2026-10-01" }, { roleId: f.roleB.id, amountCents: 3000, basis: "hourly", effectiveDate: "2026-10-01" }, { roleId: f.roleA.id, amountCents: 4000, basis: "hourly", effectiveDate: "2027-01-01" }]) {
      e = (await state()).employees.find(e => e.id === created.id); await ok(await commit("wage", { employeeId: e.id, version: e.version, overtimeExempt: false, ...rate }));
    }
    e = (await state()).employees.find(e => e.id === created.id); assert.equal(e.jobs.length, 2); assert.equal(e.wageRates.length, 3);
    assert.equal((await workspaceState()).state.employees.find(e => e.id === created.id).wage, "$20.00/hr");
    await ok(await commit("wage", { employeeId: e.id, version: e.version, roleId: f.roleB.id, amountCents: 6240000, basis: "annual_salary", effectiveDate: "2026-11-01", overtimeExempt: false }));
    assert.equal((await state()).employees.find(e => e.id === created.id).wageRates.length, 4);
    e = (await state()).employees.find(e => e.id === created.id);
    await ok(await commit("details", { employeeId: e.id, version: e.version, startDate: "2026-09-01", payrollId: "00042" }));
    assert.equal((await state()).employees.find(e => e.id === created.id).payrollId, "00042");
    const accessBefore = await ok(await access.handle(req(`/api/access/accounts/${f.manager.id}`, owner)));
    await ok(await access.handle(req(`/api/access/accounts/${f.manager.id}`, owner, { version: accessBefore.account.version, permissions: { "wages.read": true }, departmentIds: [f.deptA.id] })));
    manager = await login(f.manager.email); const scoped = (await state(manager)).employees.find(e => e.id === created.id); assert.ok(scoped.wageRates.every(r => r.roleId === f.roleA.id));
  });
  await t.test("used jobs/departments cannot be archived and department publishing preserves another department draft", async () => {
    assert.equal((await legacy(state => { state.departments = state.departments.filter(d => d.id !== f.deptA.id); })).status, 409);
    assert.equal((await legacy(state => { state.departments.find(d => d.id === f.deptA.id).roles = []; })).status, 409);
    const before = await workspaceState(); const key = f.b.id; const after = structuredClone(before.state);
    after.scheduleDraftsByManager[key] = { upsertedShifts: [{ id: 70100, employeeId: created.id, role: f.roleA.name, date: "2026-12-01", start: "09:00", end: "17:00", station: "Floor" }, { id: 70101, employeeId: created.id, role: f.roleB.name, date: "2026-12-02", start: "09:00", end: "17:00", station: "Floor" }], deletedShiftIds: [], affectedEmployeeIds: [created.id] };
    await ok(await workspace.handle(req("/api/workspace/commit", owner, saveBody(before, stateChanges(before.state, after, key), newToken()))));
    await ok(await commit("publish", { departmentId: f.deptA.id })); const published = await workspaceState();
    assert.equal(published.state.shifts.some(s => s.id === 70100), true); assert.equal(published.state.shifts.some(s => s.id === 70101), false); assert.equal(published.state.scheduleDraftsByManager[key].upsertedShifts.length, 1);
    await ok(await commit("publish", { departmentId: f.deptB.id })); assert.equal((await workspaceState()).state.shifts.some(s => s.id === 70101), true);
  });
  await t.test("photos use local protected R2, preserve replaced objects and deny unrelated employee/file access", async () => {
    const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]); const checksum = createHash("sha256").update(png).digest("hex");
    async function upload(service, cookie, employeeId, prefix) {
      const id = newToken(); await ok(await service.handle(req(`${prefix}/prepare`, cookie, { id, employeeId, kind: "photo", title: "Profile photo", fileName: "demo.png", contentType: "image/png", sizeBytes: png.length, sha256: checksum })));
      const r = await service.handle(new Request(origin + `${prefix}/${id}/content`, { method: "PUT", headers: { Cookie: cookie, Origin: origin, "Content-Type": "image/png" }, body: png })); await ok(r); return id;
    }
    const first = await upload(photos, employee, f.a.id, "/api/self/photo");
    assert.equal((await photos.handle(req(`/api/self/photo/${first}/download`, employee))).status, 200);
    assert.equal((await photos.handle(req("/api/self/photo/prepare", employee, { id: newToken(), employeeId: f.b.id, kind: "photo", title: "Photo", fileName: "demo.png", contentType: "image/png", sizeBytes: png.length, sha256: checksum }))).status, 404);
    const second = await upload(docs, owner, f.a.id, "/api/documents");
    assert.equal((await docs.handle(req(`/api/documents/${first}/download`, owner))).status, 404);
    const download = await photos.handle(req(`/api/self/photo/${second}/download`, employee)); assert.equal(download.status, 200); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), png);
    assert.equal((await docs.handle(req(`/api/documents/${second}/download`, manager))).status, 200);
    assert.equal((await platform.env.FILES.get(`employee-documents/${f.a.id}/${first}`)) !== null, true);
  });
  await t.test("termination dates/reasons are enforced, sessions end, and rehire preserves history without reviving access", async () => {
    let e = (await state()).employees.find(e => e.id === created.id);
    for (const invalid of [{ date: "2099-01-01", reason: "Voluntary Resignation" }, { date: "2026-08-01", reason: "Voluntary Resignation" }, { date: "2026-11-04", reason: "invented" }]) assert.equal((await commit("employment", { employeeId: e.id, version: e.version, action: "terminate", eligibleForRehire: true, ...invalid })).status, 400);
    const cookie = await login("invited@example.test"); await ok(await commit("employment", { employeeId: e.id, version: e.version, action: "terminate", date: "2026-11-04", reason: "Voluntary Resignation", eligibleForRehire: true }));
    assert.equal((await auth.handle(req("/api/auth/session", cookie))).status, 401);
    e = (await state()).employees.find(e => e.id === created.id); assert.equal(e.terminated, true); assert.equal(e.employmentHistory.length, 1);
    await ok(await commit("employment", { employeeId: e.id, version: e.version, action: "rehire", date: "2026-11-04", eligibleForRehire: true }));
    e = (await state()).employees.find(e => e.id === created.id); assert.equal(e.terminated, false); assert.equal(e.employmentHistory.length, 2);
    assert.equal((await auth.handle(req("/api/auth/login", "", { email: "invited@example.test", password }))).status, 401);
  });
  await t.test("failed audits and concurrent identical bulk retries cannot leave partial or duplicated people", async () => {
    const data = await state(); const body = { id: newToken(), revision: data.revision, operation: "bulk", data: { rows: [{ name: "Concurrent local", email: "concurrent-team@example.test", roleId: f.roleA.id }] } };
    const replies = await Promise.all([team.handle(req("/api/team/commit", owner, body)), team.handle(req("/api/team/commit", owner, body))]); assert.equal(replies.some(r => r.status === 200), true);
    assert.equal((await db.select().from(schema.employees).where(eq(schema.employees.email, "concurrent-team@example.test"))).length, 1);
    const before = await rawCount(schema.employees); await db.run(sql`CREATE TRIGGER team_audit_fail BEFORE INSERT ON audit_log WHEN NEW.action = 'workforce.changed' BEGIN SELECT RAISE(ABORT, 'forced team rollback'); END`);
    try { assert.equal((await commit("bulk", { rows: [{ name: "Rollback team", email: "rollback-team@example.test", roleId: f.roleA.id, channel: "email" }] })).status, 503); assert.equal(await rawCount(schema.employees), before); } finally { await db.run(sql`DROP TRIGGER team_audit_fail`); }
    assert.equal((await db.select().from(schema.workforceWriteChecks)).length, 0); assert.equal((await db.all(sql`PRAGMA foreign_key_check`)).length, 0);
  });
  await t.test("invitations, profiles, jobs, rates and settings survive native runtime restart", async () => {
    await ok(await commit("settings", { payPeriod: "biweekly", anchorDate: "2026-11-02" })); const before = await state();
    await platform.dispose(); ({ db, auth, access, team, invites, workspace, docs, photos } = await connect());
    assert.deepEqual(await state(), before);
  });
});

test("dated rates, salary equivalents, weighted overtime and retention calendars use real work dates", async () => {
  const { periodFor, retainedThrough, rateFor, hourlyRate } = await loadServerModule("team/rules.ts");
  assert.deepEqual(periodFor("2026-11-04", "biweekly", "2026-11-02"), { start: "2026-11-02", end: "2026-11-15" });
  assert.equal(periodFor("2026-02-17", "semimonthly").end, "2026-02-28"); assert.equal(retainedThrough("2026-11-04", 1, "biweekly", "2026-11-02"), "2026-11-15");
  const rates = [{ id: 1, roleId: 1, role: "A", amountCents: 2000, basis: "hourly", effectiveDate: "2026-01-01" }, { id: 2, roleId: 2, role: "B", amountCents: 3000, basis: "hourly", effectiveDate: "2026-01-01" }, { id: 3, roleId: 1, role: "A", amountCents: 9900, basis: "hourly", effectiveDate: "2027-01-01" }];
  assert.equal(rateFor(rates, "A", "2026-11-04").amountCents, 2000); assert.equal(hourlyRate({ ...rates[0], basis: "annual_salary", amountCents: 6240000 }), 30);
  const { buildTimeCards } = await loadServerModule("app/timesheets-model.ts");
  const events = [{ id: 1, employeeId: 1, type: "in", at: "2026-11-02T09:00:00", role: "A" }, { id: 2, employeeId: 1, type: "out", at: "2026-11-02T19:00:00" }, { id: 3, employeeId: 1, type: "in", at: "2026-11-03T09:00:00", role: "B" }, { id: 4, employeeId: 1, type: "out", at: "2026-11-03T19:00:00" }];
  const input = { employees: [{ id: 1, name: "Weighted", role: "A", wage: "$99/hr", active: true, wageRates: rates }], events, shifts: [], adjustments: [], pto: [], start: "2026-11-02", end: "2026-11-03", now: Date.parse("2026-11-04T20:00:00"), rounding: "actual", weekStart: 1, mandatoryMealBreak: false, mealBreakAfterHours: 5 };
  const cards = buildTimeCards(input); assert.equal(cards.reduce((sum, c) => sum + c.metrics.wages, 0), 550); assert.equal(cards[0].wageLabel, "$20.00/hr");
  const salary = buildTimeCards({ ...input, employees: [{ ...input.employees[0], wageRates: [{ ...rates[0], amountCents: 6240000, basis: "annual_salary", overtimeExempt: false }] }], events: events.slice(0, 2) }); assert.equal(salary[0].metrics.wages, 330);
});
