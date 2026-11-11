import { eq } from "drizzle-orm";

export async function seedAccessFixture(db, schema, loadServerModule, password) {
  const { hashPassword, newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
  const passwordHash = await hashPassword(password);
  const employee = async (name, pinHash) => (await db.insert(schema.employees).values({ name, pinHash, isManager: true,
    email: `${pinHash}@example.test`, phone: "555-0100" }).returning())[0];
  const a = await employee("Local department A worker", "a");
  const b = await employee("Other department private worker", "b");
  const managerEmployee = await employee("Local manager", "manager");
  const multi = await employee("Multi department worker", "multi");
  const account = async (email, accessLevel, employeeId = null) => (await db.insert(schema.accounts).values({
    email, normalizedEmail: email, displayName: email.split("@")[0], accessLevel, employeeId, passwordHash, loginEnabled: true,
  }).returning())[0];
  // Account 1 is deliberately a manager. Identity/row number must not confer Owner.
  const manager = await account("manager@example.test", "manager", managerEmployee.id);
  const owner = await account("owner@example.test", "owner", b.id);
  const secondOwner = await account("second-owner@example.test", "owner");
  const generalManager = await account("general@example.test", "general_manager");
  const unassigned = await account("unassigned@example.test", "manager");
  const employeeAccount = await account("employee@example.test", "employee", a.id);
  const [deptA, deptB] = await db.insert(schema.departments).values([{ name: "Department A" }, { name: "Department B" }]).returning();
  const [roleA, roleB] = await db.insert(schema.roles).values([
    { name: "Job A", departmentId: deptA.id, permissions: ["owner", "wages.read"] },
    { name: "Job B", departmentId: deptB.id },
  ]).returning();
  await db.insert(schema.employeeRoles).values([
    { employeeId: a.id, roleId: roleA.id }, { employeeId: b.id, roleId: roleB.id },
    { employeeId: managerEmployee.id, roleId: roleA.id },
    { employeeId: multi.id, roleId: roleA.id }, { employeeId: multi.id, roleId: roleB.id },
  ]);
  await db.insert(schema.departmentManagers).values({ accountId: manager.id, departmentId: deptA.id });
  await db.insert(schema.employeeProfiles).values({ employeeId: a.id, legalFirstName: "Private legal name",
    ssnEncrypted: "never-return-this-ciphertext", dateOfBirth: "1990-01-02", homeAddress: "Private address" });
  await db.insert(schema.employeeNotes).values({ employeeId: a.id, authorAccountId: owner.id, body: "Private manager note" });
  await db.insert(schema.files).values({ id: "private-file-a", employeeId: a.id, uploadedByAccountId: owner.id,
    objectKey: "never-return-this-object-key", fileName: "private-certificate.pdf", contentType: "application/pdf", sizeBytes: 10, status: "ready" });
  await db.insert(schema.wageRates).values([
    { employeeId: a.id, roleId: roleA.id, basis: "hourly", amountCents: 2200, effectiveDate: "2026-10-01", recordedByAccountId: owner.id },
    { employeeId: b.id, roleId: roleB.id, basis: "hourly", amountCents: 9900, effectiveDate: "2026-10-01", recordedByAccountId: owner.id },
    { employeeId: multi.id, roleId: roleA.id, basis: "hourly", amountCents: 2300, effectiveDate: "2026-10-01", recordedByAccountId: owner.id },
    { employeeId: multi.id, roleId: roleB.id, basis: "hourly", amountCents: 8800, effectiveDate: "2026-10-01", recordedByAccountId: owner.id },
  ]);
  const shifts = await db.insert(schema.shifts).values([
    { employeeId: a.id, roleId: roleA.id, date: "2026-10-30", startTime: "09:00", endTime: "17:00", notes: "Private shift A" },
    { employeeId: b.id, roleId: roleB.id, date: "2026-10-30", startTime: "09:00", endTime: "17:00", notes: "Private shift B" },
  ]).returning();
  await db.insert(schema.timeCards).values([{ employeeId: a.id, roleId: roleA.id, workDate: "2026-10-30" }, { employeeId: b.id, roleId: roleB.id, workDate: "2026-10-30" }]);
  await db.insert(schema.ptoRequests).values([{ employeeId: a.id, compensation: "unpaid", startDate: "2026-11-01", endDate: "2026-11-01", reason: "vacation" },
    { employeeId: b.id, compensation: "paid", startDate: "2026-11-02", endDate: "2026-11-02", reason: "sick_emergency", explanation: "Private medical explanation" }]);
  const [conversationA, conversationB] = await db.insert(schema.conversations).values([
    { creatorEmployeeId: managerEmployee.id }, { creatorEmployeeId: b.id },
  ]).returning();
  await db.insert(schema.conversationMembers).values([
    { conversationId: conversationA.id, employeeId: managerEmployee.id }, { conversationId: conversationA.id, employeeId: a.id },
    { conversationId: conversationB.id, employeeId: b.id },
  ]);
  await db.insert(schema.messages).values([
    { conversationId: conversationA.id, senderEmployeeId: a.id, body: "Local member message" },
    { conversationId: conversationB.id, senderEmployeeId: b.id, body: "Other conversation secret" },
  ]);
  await db.insert(schema.notifications).values([
    { id: "manager-notice", employeeId: managerEmployee.id, sourceKey: "manager-source", kind: "schedule", title: "Own notice", detail: "Own detail" },
    { id: "other-notice", employeeId: b.id, sourceKey: "other-source", kind: "request", title: "Other private notice", detail: "Other private detail" },
  ]);
  const employeeToken = newToken();
  await db.insert(schema.accountSessions).values({ id: newToken(), accountId: employeeAccount.id, tokenHash: tokenHash(employeeToken),
    sessionVersion: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const deviceToken = newToken();
  await db.insert(schema.kioskDevices).values({ id: "test-device", name: "Isolated test tablet", registeredByAccountId: owner.id });
  await db.insert(schema.deviceSessions).values({ id: newToken(), deviceId: "test-device", tokenHash: tokenHash(deviceToken), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const legacyToken = newToken();
  await db.insert(schema.pinSessions).values({ employeeId: managerEmployee.id, mode: "manager", sessionTokenHash: tokenHash(legacyToken), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  return { a, b, multi, managerEmployee, manager, owner, secondOwner, generalManager, unassigned, employeeAccount,
    employeeToken, deviceToken, legacyToken, deptA, deptB, roleA, roleB, shifts, conversationA, conversationB,
    disableManager: () => db.update(schema.accounts).set({ disabledAt: new Date().toISOString() }).where(eq(schema.accounts.id, manager.id)) };
}
