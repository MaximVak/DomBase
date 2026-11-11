import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, getTableName, sql } from "drizzle-orm";
import { transpileModule, ModuleKind } from "typescript";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";

async function loadSchema(relativePath = "../db/schema.ts") {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  let code = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext } }).outputText;
  for (const dependency of ["drizzle-orm", "drizzle-orm/sqlite-core"]) {
    code = code.replaceAll(JSON.stringify(dependency), JSON.stringify(import.meta.resolve(dependency)));
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("local database commands reject target overrides", () => {
  assert.throws(() => runLocalDb("deploy"), /Use migrate, status, or execute/);
  for (const flag of ["--remote", "--config=other.jsonc", "--env", "--persist-to", "-c", "-e"]) {
    assert.throws(() => runLocalDb("execute", [flag]), /cannot override/);
  }
});

test("local migrations and Drizzle share D1 data across runtime restarts", { timeout: 120000 }, async t => {
  const stateRoot = join(projectRoot, ".wrangler");
  await mkdir(stateRoot, { recursive: true });
  const statePath = await mkdtemp(join(stateRoot, "db-check-"));
  let platform;
  t.after(async () => {
    try { await platform?.dispose(); }
    finally { await rm(statePath, { recursive: true, force: true }); }
  });

  const pending = await runLocalDb("status", [], statePath);
  assert.match(pending, /0000_wise_princess_powerful\.sql/);
  await runLocalDb("migrate", [], statePath);

  const { getPlatformProxy } = await import("wrangler");
  const schema = await loadSchema();
  const open = () => getPlatformProxy({
    configPath,
    persist: { path: join(statePath, "v3") },
    remoteBindings: false,
    envFiles: [],
  });
  platform = await open();
  let db = drizzle(platform.env.DB, { schema });
  const tables = await db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`);
  for (const table of Object.values(schema)) {
    assert.ok(tables.some(row => row.name === getTableName(table)), `Missing ${getTableName(table)}`);
  }
  const [role] = await db.insert(schema.roles).values({ name: "Local verification role" }).returning();
  const [employee] = await db.insert(schema.employees).values({
    name: "Local verification employee", roleId: role.id, pinHash: "test-only-not-a-login-credential",
  }).returning();
  await db.insert(schema.shifts).values({
    employeeId: employee.id, roleId: role.id, date: "2026-10-31", startTime: "09:00", endTime: "17:00",
  });
  await assert.rejects(db.batch([
    db.insert(schema.roles).values({ name: "Must roll back" }),
    db.insert(schema.shifts).values({ employeeId: 999999, date: "2026-10-31", startTime: "09:00", endTime: "17:00" }),
  ]));
  assert.equal((await db.select().from(schema.roles).where(eq(schema.roles.name, "Must roll back"))).length, 0);
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);

  const [otherEmployee] = await db.insert(schema.employees).values({ name: "Other employee", pinHash: "other-test-verifier" }).returning();
  const [owner] = await db.insert(schema.accounts).values({
    email: "Owner@example.com", normalizedEmail: "owner@example.com", displayName: "Owner", accessLevel: "owner",
  }).returning();
  const [reviewer] = await db.insert(schema.accounts).values({
    email: "reviewer@example.com", normalizedEmail: "reviewer@example.com", displayName: "Reviewer", accessLevel: "owner",
  }).returning();

  await t.test("account identity, device registration and approval contexts remain separate", async () => {
    assert.notEqual(owner.id, reviewer.id);
    assert.equal(owner.employeeId, null);
    await assert.rejects(db.insert(schema.accounts).values({ email: "OWNER@example.com", normalizedEmail: "owner@example.com", displayName: "Duplicate" }));
    await assert.rejects(db.insert(schema.accounts).values({ email: "new@example.com", normalizedEmail: "new@example.com", displayName: "Invalid", accessLevel: "superuser" }));
    await assert.rejects(db.insert(schema.accounts).values({ email: "enabled@example.com", normalizedEmail: "enabled@example.com", displayName: "No password", loginEnabled: true }));
    await db.insert(schema.accountPermissions).values({ accountId: reviewer.id, permission: "timesheets.read", allowed: true });
    await db.insert(schema.accountSessions).values({ id: "person", accountId: owner.id, tokenHash: "person-hash", sessionVersion: 1, expiresAt: "2026-11-01T00:00:00Z" });
    await db.insert(schema.kioskDevices).values({ id: "tablet", name: "Test tablet", registeredByAccountId: reviewer.id });
    await db.insert(schema.deviceSessions).values({ id: "device", deviceId: "tablet", tokenHash: "device-hash", expiresAt: "2027-01-01T00:00:00Z" });
    await db.insert(schema.kioskInteractions).values({ id: "employee", deviceSessionId: "device", employeeId: employee.id, tokenHash: "interaction-hash", expiresAt: "2026-11-01T00:00:00Z" });
    await db.insert(schema.managerApprovalCredentials).values({ accountId: reviewer.id, pinHash: "approval-verifier", pinLookup: "approval-keyed-lookup" });
    await db.insert(schema.kioskApprovalSessions).values({ id: "approval", deviceSessionId: "device", accountId: reviewer.id, tokenHash: "approval-hash", action: "clock.approve", targetId: "pending-clock", expiresAt: "2026-11-01T00:00:00Z" });
    await assert.rejects(db.insert(schema.kioskInteractions).values({ id: "bad-device", deviceSessionId: "absent", employeeId: employee.id, tokenHash: "absent-hash", expiresAt: "2026-11-01T00:00:00Z" }));
    await db.update(schema.deviceSessions).set({ revokedAt: "2026-10-31T20:00:00Z" });
    assert.equal((await db.select().from(schema.accountSessions))[0].revokedAt, null);
    await db.update(schema.employees).set({ pinLookup: "employee-keyed-lookup" }).where(eq(schema.employees.id, employee.id));
    await assert.rejects(db.update(schema.employees).set({ pinLookup: "employee-keyed-lookup" }).where(eq(schema.employees.id, otherEmployee.id)));
  });

  await t.test("single-location settings preserve all prototype rule defaults", async () => {
    await db.insert(schema.business).values({ companyName: "Test company", locationName: "Test location", primaryOwnerAccountId: owner.id });
    await db.insert(schema.locationSettings).values({ businessId: 1 });
    const [settings] = await db.select().from(schema.locationSettings);
    const { defaultScheduleEnforcement } = await loadSchema("../app/schedule-enforcement.ts");
    for (const [key, value] of Object.entries(defaultScheduleEnforcement)) assert.equal(settings[key], value, key);
    assert.equal((await db.select().from(schema.business))[0].timeZone, "America/Los_Angeles");
    await assert.rejects(db.insert(schema.business).values({ id: 2, companyName: "Other", locationName: "Other" }));
    await assert.rejects(db.update(schema.locationSettings).set({ workWeekStart: 8 }));
    await assert.rejects(db.update(schema.locationSettings).set({ hoursRoundingMinutes: 7 }));
    await assert.rejects(db.update(schema.locationSettings).set({ scheduleStartHour: 20, scheduleEndHour: 7 }));
  });

  await t.test("profiles, job assignments, compensation and files preserve ownership", async () => {
    const [department] = await db.insert(schema.departments).values({ name: "Sales" }).returning();
    await db.update(schema.roles).set({ departmentId: department.id }).where(eq(schema.roles.id, role.id));
    await db.insert(schema.departmentManagers).values({ departmentId: department.id, accountId: reviewer.id });
    await db.insert(schema.employeeRoles).values({ employeeId: employee.id, roleId: role.id });
    await db.insert(schema.employeeProfiles).values({ employeeId: employee.id, legalFirstName: "Test", homeCity: "Sacramento", emergencyContactPhone: "test-only" });
    await db.insert(schema.employeeSettings).values({ employeeId: employee.id });
    await db.insert(schema.employeeNotes).values({ employeeId: employee.id, authorAccountId: owner.id, body: "Private test note" });
    const wage = { employeeId: employee.id, roleId: role.id, basis: "hourly", amountCents: 2500, effectiveDate: "2026-10-01", recordedByAccountId: owner.id };
    await db.insert(schema.wageRates).values(wage);
    await db.insert(schema.wageRates).values({ ...wage, amountCents: 2600, effectiveDate: "2026-11-01" });
    await assert.rejects(db.insert(schema.wageRates).values({ ...wage, amountCents: -1 }));
    await assert.rejects(db.insert(schema.wageRates).values({ ...wage, amountCents: 25.5 }));
    await db.insert(schema.employmentHistory).values({ employeeId: employee.id, eventType: "terminated", date: "2026-10-31", actorAccountId: owner.id });
    await db.insert(schema.files).values({ id: "certificate-file", employeeId: employee.id, uploadedByAccountId: owner.id, objectKey: "test/certificate", fileName: "test.pdf", contentType: "application/pdf", sizeBytes: 123 });
    await db.insert(schema.employeeCertificates).values({ employeeId: employee.id, name: "Certificate", fileId: "certificate-file", expirationDate: "2027-10-31" });
    await assert.rejects(db.insert(schema.employeeCertificates).values({ employeeId: otherEmployee.id, name: "Wrong owner", fileId: "certificate-file" }));
    await db.insert(schema.onboardingDocumentLabels).values({ employeeId: employee.id, documentName: "W-4 Form", fileName: "filename-only.pdf" });
    await assert.rejects(db.delete(schema.roles).where(eq(schema.roles.id, role.id)));
    assert.equal((await db.select().from(schema.wageRates)).length, 2);
  });

  await t.test("draft publication and notification receipts retain their relationships", async () => {
    const [draft] = await db.insert(schema.scheduleDrafts).values({ ownerAccountId: owner.id }).returning();
    await db.insert(schema.scheduleDraftChanges).values({ draftId: draft.id, clientKey: "new-shift", operation: "upsert", employeeId: employee.id, roleId: role.id, roleName: role.name, date: "2026-10-31", startTime: "09:00", endTime: "17:00" });
    await assert.rejects(db.insert(schema.scheduleDraftChanges).values({ draftId: draft.id, clientKey: "bad-delete", operation: "delete" }));
    await db.insert(schema.scheduleDraftEmployees).values({ draftId: draft.id, employeeId: employee.id });
    const [publication] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: owner.id }).returning();
    await db.update(schema.shifts).set({ publicationId: publication.id, roleName: role.name });
    await db.insert(schema.scheduleEvents).values({ date: "2026-10-31", title: "Test event", createdByAccountId: owner.id });
    const notice = { id: "schedule-notice", employeeId: employee.id, sourceKey: "publication-1", kind: "schedule", title: "Published", detail: "Test", publicationId: publication.id };
    await db.insert(schema.notifications).values(notice);
    await assert.rejects(db.insert(schema.notifications).values({ ...notice, id: "duplicate-notice" }));
    await db.update(schema.notifications).set({ openedAt: "2026-10-31T20:00:00Z", dismissedAt: "2026-10-31T20:01:00Z" }).where(eq(schema.notifications.id, notice.id));
    assert.ok((await db.select().from(schema.notifications))[0].dismissedAt);
  });

  await t.test("raw punches are immutable and card revisions cannot cross employee boundaries", async () => {
    const [card] = await db.insert(schema.timeCards).values({ employeeId: employee.id, workDate: "2026-10-31", roleId: role.id, roleName: role.name }).returning();
    const punch = { employeeId: employee.id, cardId: card.id, eventType: "in", occurredAt: "2026-10-31T16:00:00Z", deviceId: "tablet", source: "kiosk", receivedAt: "2026-10-31T16:00:01Z", idempotencyKey: "punch-once" };
    const [raw] = await db.insert(schema.clockEvents).values(punch).returning();
    await assert.rejects(db.insert(schema.clockEvents).values(punch));
    for (const eventType of ["break", "break_end", "out"]) await db.insert(schema.clockEvents).values({ ...punch, eventType, durationSeconds: eventType === "break" ? 1800 : null, idempotencyKey: `punch-${eventType}` });
    await assert.rejects(db.insert(schema.clockEvents).values({ ...punch, employeeId: otherEmployee.id, idempotencyKey: "wrong-card" }));
    await assert.rejects(db.insert(schema.clockEvents).values({ ...punch, eventType: "invalid", idempotencyKey: "invalid-type" }));
    await assert.rejects(db.insert(schema.clockEvents).values({ ...punch, deviceId: null, idempotencyKey: "missing-device" }));
    await assert.rejects(db.update(schema.clockEvents).set({ occurredAt: "2026-10-31T15:00:00Z" }).where(eq(schema.clockEvents.id, raw.id)));
    await assert.rejects(db.delete(schema.clockEvents).where(eq(schema.clockEvents.id, raw.id)));
    const [publishedShift] = await db.select().from(schema.shifts);
    await db.insert(schema.clockEvents).values({ employeeId: employee.id, shiftId: publishedShift.id, eventType: "in", occurredAt: "2026-10-30T16:00:00Z" });
    await assert.rejects(db.delete(schema.shifts).where(eq(schema.shifts.id, publishedShift.id)));
    await db.update(schema.shifts).set({ archivedAt: "2026-10-31T20:00:00Z" }).where(eq(schema.shifts.id, publishedShift.id));
    assert.equal((await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.shiftId, publishedShift.id)))[0].shiftId, publishedShift.id);
    const [edit] = await db.insert(schema.timeCardEdits).values({ cardId: card.id, employeeId: employee.id, revision: 1, actorAccountId: owner.id, reason: "Correct test card", before: { events: [raw] }, after: { events: [{ ...raw, occurredAt: "2026-10-31T15:00:00Z" }] } }).returning();
    await assert.rejects(db.insert(schema.timeCardEdits).values({ ...edit, id: undefined, employeeId: otherEmployee.id, revision: 2 }));
    await assert.rejects(db.update(schema.timeCardEdits).set({ reason: "Erase history" }));
    assert.equal((await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.id, raw.id)))[0].occurredAt, raw.occurredAt);
    await db.insert(schema.hoursAdjustments).values({ employeeId: employee.id, date: "2026-10-31", adjustmentSeconds: -300, actorAccountId: owner.id, reason: "Test adjustment" });
    await assert.rejects(db.delete(schema.hoursAdjustments));
    await db.insert(schema.auditLog).values({ actorAccountId: owner.id, employeeId: employee.id, action: "card.correct", entityType: "time_card", entityId: String(card.id), metadata: { revision: 1 } });
    await assert.rejects(db.delete(schema.auditLog));
  });

  await t.test("leave and availability store valid ranges and attributed decisions", async () => {
    const [policy] = await db.insert(schema.ptoPolicies).values({ name: "Earned", method: "rate", earnedSeconds: 3600, perWorkedSeconds: 108000 }).returning();
    await db.insert(schema.ptoAssignments).values({ employeeId: employee.id, policyId: policy.id, startDate: "2026-01-01", openingBalanceSeconds: 28800 });
    await assert.rejects(db.insert(schema.ptoPolicies).values({ name: "Invalid", method: "rate", earnedSeconds: 0 }));
    const request = { employeeId: employee.id, compensation: "paid", startDate: "2026-11-02", endDate: "2026-11-03", reason: "vacation" };
    const [pto] = await db.insert(schema.ptoRequests).values(request).returning();
    await assert.rejects(db.insert(schema.ptoRequests).values({ ...request, endDate: "2026-11-01" }));
    await assert.rejects(db.insert(schema.ptoRequests).values({ ...request, status: "invalid" }));
    await db.insert(schema.ptoDecisions).values({ requestId: pto.id, status: "approved", actorAccountId: reviewer.id });
    await assert.rejects(db.delete(schema.ptoRequests).where(eq(schema.ptoRequests.id, pto.id)));
    await db.update(schema.ptoRequests).set({ archivedAt: "2026-10-31T20:00:00Z" }).where(eq(schema.ptoRequests.id, pto.id));
    assert.equal((await db.select().from(schema.ptoDecisions))[0].requestId, pto.id);
    const [availability] = await db.insert(schema.availabilityRequests).values({ employeeId: employee.id, effectiveDate: "2026-11-01" }).returning();
    const slot = { requestId: availability.id, dayOfWeek: 1, preference: "preferred", startMinute: 540, endMinute: 1020 };
    await db.insert(schema.availabilitySlots).values(slot);
    await assert.rejects(db.insert(schema.availabilitySlots).values({ ...slot, endMinute: 100 }));
    await db.insert(schema.availabilityDecisions).values({ requestId: availability.id, decision: "approved", actorAccountId: reviewer.id });
  });

  await t.test("messages and read receipts require membership in the same conversation", async () => {
    const [conversation] = await db.insert(schema.conversations).values({ creatorEmployeeId: employee.id }).returning();
    await db.insert(schema.conversationMembers).values([{ conversationId: conversation.id, employeeId: employee.id }, { conversationId: conversation.id, employeeId: otherEmployee.id, pinned: true, muted: true }]);
    const message = { conversationId: conversation.id, senderEmployeeId: employee.id, body: "Test message", idempotencyKey: "message-once" };
    const [sent] = await db.insert(schema.messages).values(message).returning();
    await assert.rejects(db.insert(schema.messages).values(message));
    const [outsider] = await db.insert(schema.employees).values({ name: "Nonmember", pinHash: "outsider-test-verifier" }).returning();
    await assert.rejects(db.insert(schema.messages).values({ ...message, senderEmployeeId: outsider.id, idempotencyKey: "not-a-member" }));
    await db.insert(schema.messageReads).values({ messageId: sent.id, conversationId: conversation.id, employeeId: otherEmployee.id });
    await assert.rejects(db.insert(schema.messageReads).values({ messageId: sent.id, conversationId: conversation.id, employeeId: outsider.id }));
    const [otherConversation] = await db.insert(schema.conversations).values({ creatorEmployeeId: employee.id }).returning();
    await db.insert(schema.conversationMembers).values({ conversationId: otherConversation.id, employeeId: employee.id });
    await assert.rejects(db.insert(schema.messageReads).values({ messageId: sent.id, conversationId: otherConversation.id, employeeId: employee.id }));
  });

  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);

  await platform.dispose();
  platform = undefined;
  // The CLI sees records written through the Worker binding, and reapplying is safe.
  const cliRead = await runLocalDb("execute", ["--command", "SELECT name FROM roles", "--json"], statePath);
  assert.match(cliRead, /Local verification role/);
  await runLocalDb("migrate", [], statePath);
  platform = await open();
  db = drizzle(platform.env.DB, { schema });
  assert.equal((await db.select().from(schema.roles)).length, 1);
  assert.equal((await db.select().from(schema.employees))[0].id, employee.id);
  assert.equal((await db.select().from(schema.shifts))[0].employeeId, employee.id);
  const migrations = await db.all(sql`SELECT name FROM d1_migrations`);
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.deepEqual(migrations.map(row => row.name), journal.entries.map(entry => `${entry.tag}.sql`));
});

test("upgrading the original scaffold preserves records without granting account access", { timeout: 120000 }, async t => {
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/db-upgrade-"));
  let platform;
  t.after(async () => {
    try { await platform?.dispose(); }
    finally { await rm(statePath, { recursive: true, force: true }); }
  });
  // Build an isolated fixture equivalent to an applied 0000 database. The status
  // command creates Wrangler's own migration ledger before this old SQL is loaded.
  await runLocalDb("status", [], statePath);
  await runLocalDb("execute", ["--file", join(projectRoot, "drizzle/0000_wise_princess_powerful.sql")], statePath);
  await runLocalDb("execute", ["--command", "INSERT INTO d1_migrations (name) VALUES ('0000_wise_princess_powerful.sql'); INSERT INTO roles (id, name) VALUES (7, 'Legacy role'); INSERT INTO employees (id, name, role_id, pin_hash, is_manager) VALUES (9, 'Legacy employee', 7, 'legacy-verifier', 1); INSERT INTO shifts (id, employee_id, role_id, date, start_time, end_time, notes) VALUES (11, 9, 7, '2026-10-30', '09:00', '17:00', 'Keep this note'); INSERT INTO clock_events (id, employee_id, event_type, occurred_at, shift_id) VALUES (13, 9, 'in', '2026-10-30T16:00:00Z', 11); INSERT INTO pin_sessions (id, employee_id, mode, session_token_hash, expires_at) VALUES (15, 9, 'manager', 'legacy-token-hash', '2027-01-01');"], statePath);
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadSchema();
  const db = drizzle(platform.env.DB, { schema });
  const [employee] = await db.select().from(schema.employees);
  assert.equal(employee.id, 9);
  assert.equal(employee.pinLookup, null);
  assert.equal((await db.select().from(schema.shifts))[0].notes, "Keep this note");
  assert.equal((await db.select().from(schema.shifts))[0].roleName, "Legacy role");
  const [punch] = await db.select().from(schema.clockEvents);
  assert.equal(punch.id, 13);
  assert.equal(punch.occurredAt, "2026-10-30T16:00:00Z");
  assert.equal(punch.roleName, "Legacy role");
  assert.deepEqual((await db.select().from(schema.employeeRoles)).map(row => [row.employeeId, row.roleId]), [[9, 7]]);
  assert.equal((await db.select().from(schema.pinSessions))[0].id, 15);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await db.select().from(schema.accountSessions)).length, 0);
  assert.equal((await db.select().from(schema.deviceSessions)).length, 0);
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
});
