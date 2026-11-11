import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { atomicBatch } from "../kiosk/database";
import type { KioskOperatorDatabase } from "../kiosk/database";

type Database = KioskOperatorDatabase;
export const demoKey = "stage0-demo-v1";
const operatorId = 903001;
const publicationId = 904001;
const staff = [
  ["Alex Morgan", 0, 2200, [0, 1, 2, 3, 4]],
  ["Jordan Taylor", 0, 2150, [0, 1, 2, 3, 4]],
  ["Casey Parker", 0, 2300, [1, 2, 3, 4, 5]],
  ["Riley Bennett", 0, 2250, [1, 2, 3, 4, 5]],
  ["Sam Rivera", 1, 2400, [0, 1, 2, 3, 4]],
  ["Jamie Brooks", 1, 2350, [0, 1, 2, 3, 4]],
  ["Avery Quinn", 1, 2500, [1, 2, 3, 4, 5]],
  ["Morgan Ellis", 1, 2450, [1, 2, 3, 4, 5]],
  ["Drew Cameron", 2, 2700, [0, 1, 3, 4, 5]],
  ["Taylor Reed", 2, 2800, [1, 2, 4, 5, 6]],
] as const;

export function demoWeek(date = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const day = new Date(today + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function demoDataset(weekStart: string) {
  const start = new Date(weekStart + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== weekStart || start.getUTCDay() !== 1) throw new Error("Choose a valid Monday as --week YYYY-MM-DD.");
  const date = (offset: number) => new Date(start.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const departments = [{ id: 901001, name: "Demo Sales" }, { id: 901002, name: "Demo Warehouse & Delivery" }];
  const roles = [
    { id: 902001, name: "Demo Sales Associate", departmentId: departments[0].id },
    { id: 902002, name: "Demo Warehouse Associate", departmentId: departments[1].id },
    { id: 902003, name: "Demo Delivery Driver", departmentId: departments[1].id },
  ];
  const employees = staff.map(([name, role, cents], index) => ({ id: 900001 + index, name: `Demo ${name}`, roleId: roles[role].id, email: `demo.${name.toLowerCase().replaceAll(" ", ".")}@example.test`, phone: `202-555-${String(101 + index).padStart(4, "0")}`, startDate: weekStart, payrollId: `DEMO-${String(index + 1).padStart(3, "0")}`, amountCents: cents }));
  const shifts = staff.flatMap(([, role, , days], index) => days.map((offset, shift) => ({ id: 905001 + index * 5 + shift, employeeId: employees[index].id, roleId: roles[role].id, roleName: roles[role].name, date: date(offset), startTime: role === 0 ? "09:00" : "07:00", endTime: role === 0 ? "17:00" : "15:00", station: role === 0 ? "Sales floor" : role === 1 ? "Warehouse" : "Delivery", notes: "Fictional demo shift; not an actual employee schedule.", publicationId })));
  return { weekStart, weekEnd: date(6), employees, departments, roles, shifts, operatorId, publicationId };
}

async function existingSeed(db: Database) {
  const [row] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, "demo.seeded"), eq(s.auditLog.entityType, "demo"), eq(s.auditLog.entityId, demoKey))).limit(1);
  return row;
}

export async function verifyDemo(db: Database, weekStart: string) {
  const data = demoDataset(weekStart);
  const [employees, roles, departments, shifts] = await db.batch([
    db.select({ id: s.employees.id }).from(s.employees).where(inArray(s.employees.id, data.employees.map(row => row.id))),
    db.select({ id: s.roles.id }).from(s.roles).where(inArray(s.roles.id, data.roles.map(row => row.id))),
    db.select({ id: s.departments.id }).from(s.departments).where(inArray(s.departments.id, data.departments.map(row => row.id))),
    db.select({ id: s.shifts.id }).from(s.shifts).where(inArray(s.shifts.id, data.shifts.map(row => row.id))),
  ]);
  if (employees.length !== 10 || roles.length !== 3 || departments.length !== 2 || shifts.length !== 50) throw new Error("The demo receipt exists but records are missing. No automatic reset or repair was attempted.");
  return { weekStart: data.weekStart, weekEnd: data.weekEnd, employees: employees.length, jobRoles: roles.length, departments: departments.length, shifts: shifts.length };
}

export async function seedDemo(db: Database, { weekStart }: { weekStart?: string } = {}) {
  if (weekStart !== undefined) demoDataset(weekStart);
  const prior = await existingSeed(db);
  if (prior) {
    const savedWeek = prior.metadata.weekStart;
    if (typeof savedWeek !== "string" || weekStart && savedWeek !== weekStart) throw new Error("This demo was already seeded for a different week. Existing data was preserved.");
    return { created: false, ...await verifyDemo(db, savedWeek) };
  }
  const data = demoDataset(weekStart ?? demoWeek());
  const occupied = await db.get<{ count: number }>(sql`SELECT (SELECT COUNT(*) FROM employees) + (SELECT COUNT(*) FROM departments) + (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM shifts) + (SELECT COUNT(*) FROM schedule_publications) AS count`);
  if (occupied?.count) throw new Error("Local workforce already contains records. Demo seeding will not overwrite or clear them.");
  const [version] = await db.select().from(s.workforceState).where(eq(s.workforceState.id, 1));
  if (!version) throw new Error("Apply the existing local database migrations before seeding.");
  const stamp = new Date().toISOString(); const check = `demo:${randomUUID()}`;
  const queries = [
    sql`UPDATE workforce_state SET revision = revision + 1 WHERE id = 1 AND revision = ${version.revision}`,
    sql`INSERT INTO workforce_write_checks (id, passed) VALUES (${check}, CASE WHEN changes() = 1 THEN 1 ELSE 0 END)`,
    db.insert(s.accounts).values({ id: operatorId, email: "stage0-demo-operator@example.test", normalizedEmail: "stage0-demo-operator@example.test", displayName: "Local demo seed (disabled system record)", accessLevel: "employee", loginEnabled: false, disabledAt: stamp }),
    db.insert(s.business).values({ id: 1, companyName: "Molding Mart (Local Demo)", locationName: "Molding Mart Demo" }).onConflictDoNothing(),
    db.insert(s.locationSettings).values({ businessId: 1 }).onConflictDoNothing(),
    ...data.departments.map(row => db.insert(s.departments).values(row)),
    ...data.roles.map(row => db.insert(s.roles).values(row)),
    ...data.employees.flatMap(({ amountCents, ...row }) => [
      db.insert(s.employees).values({ ...row, pinHash: `demo-unenrolled:${randomUUID()}` }),
      db.insert(s.employeeRoles).values({ employeeId: row.id, roleId: row.roleId }),
      db.insert(s.employeeSettings).values({ employeeId: row.id }),
      db.insert(s.wageRates).values({ employeeId: row.id, roleId: row.roleId, basis: "hourly", amountCents, effectiveDate: data.weekStart, recordedByAccountId: operatorId }),
    ]),
    db.insert(s.schedulePublications).values({ id: publicationId, version: 1, publishedByAccountId: operatorId, publishedAt: stamp }),
    ...data.shifts.map(row => db.insert(s.shifts).values(row)),
    db.insert(s.auditLog).values({ action: "demo.seeded", entityType: "demo", entityId: demoKey, metadata: { version: 1, weekStart: data.weekStart, weekEnd: data.weekEnd, employees: 10, jobRoles: 3, departments: 2, shifts: 50, fictional: true }, createdAt: stamp }),
    sql`DELETE FROM workforce_write_checks WHERE id = ${check}`,
  ];
  try { await atomicBatch(db, queries as [typeof queries[number], ...typeof queries[number][]]); }
  catch (error) {
    // A simultaneous seed can win the transaction; never retry writes or reset edits.
    if (await existingSeed(db)) return { created: false, ...await verifyDemo(db, data.weekStart) };
    throw error;
  }
  return { created: true, ...await verifyDemo(db, data.weekStart) };
}
