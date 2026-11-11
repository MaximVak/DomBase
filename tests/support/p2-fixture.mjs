import { eq } from "drizzle-orm";
import { seedWorkforceFixture } from "./workforce-fixture.mjs";
export async function seedP2Fixture(db, s, load, password) {
  const f = await seedWorkforceFixture(db, s, load, password);
  await db.update(s.employees).set({ startDate: "2026-08-04" }).where(eq(s.employees.id, f.a.id));
  await db.update(s.employeeProfiles).set({ dateOfBirth: "1990-11-05" }).where(eq(s.employeeProfiles.employeeId, f.a.id));
  await db.insert(s.employeeProfiles).values({ employeeId: f.b.id, dateOfBirth: "1985-11-06" });
  await db.insert(s.employeeCertificates).values([
    { employeeId: f.a.id, name: "Safety certificate", expirationDate: "2026-11-14" },
    { employeeId: f.a.id, name: "Lift certificate", expirationDate: "2026-11-15" },
    { employeeId: f.a.id, name: "Expired certificate", expirationDate: "2026-11-03" },
    { employeeId: f.b.id, name: "Other department secret certification", expirationDate: "2026-11-12" },
  ]);
  const [publication] = await db.insert(s.schedulePublications).values({ version: 1, publishedByAccountId: f.owner.id }).returning();
  const shifts = await db.insert(s.shifts).values([
    ...["01", "02", "03", "04"].map(day => ({ employeeId: f.a.id, roleId: f.roleA.id, roleName: f.roleA.name, date: `2026-11-${day}`, startTime: "09:00", endTime: "17:00", publicationId: publication.id })),
    { employeeId: f.b.id, roleId: f.roleB.id, roleName: f.roleB.name, date: "2026-11-03", startTime: "09:00", endTime: "17:00", publicationId: publication.id },
    { employeeId: f.multi.id, roleId: f.roleA.id, roleName: f.roleA.name, date: "2026-11-01", startTime: "09:00", endTime: "17:00", publicationId: publication.id },
    { employeeId: f.multi.id, roleId: f.roleB.id, roleName: f.roleB.name, date: "2026-11-02", startTime: "09:00", endTime: "17:00", publicationId: publication.id },
  ]).returning();
  const events = await db.insert(s.clockEvents).values([
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "in", occurredAt: "2026-11-01T17:00:00.000Z", shiftId: shifts[0].id, source: "system" },
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "break", occurredAt: "2026-11-01T21:00:00.000Z", shiftId: shifts[0].id, source: "system" },
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "break_end", occurredAt: "2026-11-01T21:30:00.000Z", shiftId: shifts[0].id, source: "system" },
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "out", occurredAt: "2026-11-02T01:00:00.000Z", shiftId: shifts[0].id, source: "system" },
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "in", occurredAt: "2026-11-02T17:10:00.000Z", shiftId: shifts[1].id, source: "system" },
    { employeeId: f.a.id, roleName: f.roleA.name, eventType: "out", occurredAt: "2026-11-03T01:00:00.000Z", shiftId: shifts[1].id, source: "system" },
  ]).returning();
  await db.insert(s.ptoRequests).values({ employeeId: f.a.id, compensation: "paid", startDate: "2026-11-03", endDate: "2026-11-03", status: "approved", reason: "sick_emergency", explanation: "NEVER EXPOSE THIS PRIVATE MEDICAL EXPLANATION" });
  return { ...f, p2Shifts: shifts, p2Events: events };
}
