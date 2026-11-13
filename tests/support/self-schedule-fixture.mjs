import { eq } from "drizzle-orm";
import { seedWorkforceFixture } from "./workforce-fixture.mjs";

export async function seedSelfScheduleFixture(db, s, load, password) {
  const f = await seedWorkforceFixture(db, s, load, password);
  const [secondPerson] = await db.insert(s.employees).values({ name: "Second schedule employee", pinHash: "schedule-unenrolled" }).returning();
  const [secondAccount] = await db.insert(s.accounts).values({ employeeId: secondPerson.id, email: "second-schedule@example.test",
    normalizedEmail: "second-schedule@example.test", displayName: "Second schedule employee", accessLevel: "employee",
    passwordHash: f.employeeAccount.passwordHash, loginEnabled: true }).returning();
  await db.update(s.locationSettings).set({ employeesOwnScheduleOnly: true }).where(eq(s.locationSettings.businessId, 1));
  const scheduledShifts = await db.insert(s.shifts).values([
    { employeeId: f.a.id, roleId: f.roleA.id, roleName: "Job A", date: "2026-11-12", startTime: "09:00", endTime: "17:00", notes: "Private shift notes must never leave this API" },
    { employeeId: secondPerson.id, roleId: f.roleB.id, roleName: "Job B", date: "2026-11-12", startTime: "10:00", endTime: "18:00", notes: "Other private shift notes" },
    { employeeId: f.a.id, roleId: f.roleA.id, roleName: "Job A", date: "2026-11-16", startTime: "08:00", endTime: "16:00" },
    { employeeId: f.a.id, roleId: f.roleA.id, roleName: "Job A", date: "2026-11-13", startTime: "09:00", endTime: "17:00", archivedAt: "2026-11-10T00:00:00Z" },
  ]).returning();
  const [draft] = await db.insert(s.scheduleDrafts).values({ ownerAccountId: f.owner.id }).returning();
  await db.insert(s.scheduleDraftChanges).values({ draftId: draft.id, clientKey: "private-draft", operation: "upsert",
    employeeId: f.a.id, roleId: f.roleA.id, roleName: "UNPUBLISHED ROLE", date: "2026-11-14", startTime: "07:00", endTime: "15:00" });
  // Time off must not silently remove a published shift from this read-only view.
  await db.insert(s.ptoRequests).values({ employeeId: f.a.id, compensation: "unpaid", startDate: "2026-11-12", endDate: "2026-11-12", reason: "vacation", status: "approved" });
  return { ...f, secondPerson, secondAccount, scheduledShifts };
}
