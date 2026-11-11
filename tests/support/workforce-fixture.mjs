import { eq } from "drizzle-orm";
import { seedAccessFixture } from "./access-fixture.mjs";
export const fieldKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export async function seedWorkforceFixture(db, schema, load, password) {
  const f = await seedAccessFixture(db, schema, load, password);
  const { encryptSsn } = await load("workforce/private.ts");
  await db.update(schema.employeeProfiles).set({ ssnEncrypted: encryptSsn("000-12-3456", f.a.id, fieldKey) }).where(eq(schema.employeeProfiles.employeeId, f.a.id));
  await db.insert(schema.business).values({ companyName: "Local QA company", locationName: "Local QA location", primaryOwnerAccountId: f.owner.id });
  await db.insert(schema.locationSettings).values({ businessId: 1, automaticClockOut: false });
  return f;
}
export function newEmployee(id, role, location, name = "Shared server worker") {
  return { id, name, email: "shared@example.test", phone: "555-0112", accessLevel: "Employee", location, role, wage: "", pin: "", active: true, terminated: false, startDate: "2026-11-01", payrollId: "", payrollClassification: "W-2 Employee", legalFirstName: "", legalMiddleName: "", legalLastName: "", dateOfBirth: "", socialSecurityNumber: "", homeAddress: "", homeAddressLine2: "", homeCity: "", homeStateProvince: "", homePostalCode: "", homeCityStateZip: "", emergencyContact: "", emergencyContactRelationship: "", emergencyContactPhone: "", emergencyContactPreference: "", locationSettings: { showInSchedule: true, sendLocationAlerts: true, includeInTimeClockErrors: true, eligibleForOpenShifts: true, canWaiveMissedBreaks: false }, employmentHistory: [], certificates: [], onboardingDocuments: {}, managerNotes: [] };
}
