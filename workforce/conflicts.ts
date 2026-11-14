import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import * as s from "../db/schema";
import type { Context, Database } from "./context";
import * as v from "./validation";
import { AuthError } from "../auth/http";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { scheduleWeekStart, type PlannedShift } from "../app/schedule-estimates";
import { availabilityWeekdays } from "../app/availability-model";
import { scheduleConflicts, type ConflictAssessment } from "../app/schedule-conflicts";
import { offsetDate, workspacePeriod } from "./period";
import { maxScheduleEntries } from "../app/schedule-tools-model";

export async function readScheduleConflicts(db: Database, ctx: Context, body: Record<string, unknown>): Promise<ConflictAssessment> {
  ctx.requirePermission("schedule.read"); v.keys(body, ["period", "revision", "upserts", "deletedShiftIds"]);
  const period = workspacePeriod(body.period), revision = v.integer(body.revision, 0);
  if (Date.parse(period.end) - Date.parse(period.start) > 61 * 86400000) throw new AuthError(400, "Review at most 62 days of schedule warnings.");
  const upserts: PlannedShift[] = v.list(body.upserts, maxScheduleEntries).map(value => {
    const row = v.object(value); v.keys(row, ["id", "employeeId", "date", "start", "end", "role", "shiftType"]);
    const shiftType = v.oneOf(row.shiftType ?? "work", ["work", "day_off"]), start = v.time(row.start), end = v.time(row.end);
    if (shiftType === "work" ? start >= end : start !== "00:00" || end !== "00:00") throw new AuthError(400, "Choose valid shift times before reviewing warnings.");
    return { id: v.integer(row.id, -maxScheduleEntries), employeeId: v.integer(row.employeeId), date: v.date(row.date), start, end, role: v.text(row.role, 100, true), shiftType };
  });
  const deleted = v.list(body.deletedShiftIds, maxScheduleEntries).map(id => v.integer(id));
  if (upserts.length || deleted.length) ctx.requirePermission("schedule.manage");
  if (new Set(upserts.map(s => s.id)).size !== upserts.length || new Set(deleted).size !== deleted.length) throw new AuthError(400, "Duplicate proposed shifts.");
  // Padding includes complete workweeks for any configured start, plus both
  // boundaries for rest checks. Raw cross-department context never leaves here.
  const start = offsetDate(period.start, -8), end = offsetDate(period.end, 8);
  const range = sql`${s.shifts.date} BETWEEN ${start} AND ${end}`;
  const ids = [...new Set([...deleted, ...upserts.filter(s => s.id > 0).map(s => s.id)])];
  const selection = ids.length ? sql`(${range} OR ${s.shifts.id} IN (SELECT CAST(value AS INTEGER) FROM json_each(${JSON.stringify(ids)})))` : range;
  const availabilityScope = and(ctx.activeActor(), sql`${ctx.permissions["availability.read"] ? 1 : 0} = 1`, ctx.employeeFilter(s.availabilityRequests.employeeId), eq(s.availabilityRequests.status, "approved"), sql`${s.availabilityRequests.effectiveDate} <= ${end}`);
  const [metadata, employees, roles, stored, availability, slots, leave, rates] = await db.batch([
    db.select({ ...getTableColumns(s.locationSettings), revision: s.workforceState.revision }).from(s.locationSettings).innerJoin(s.workforceState, eq(s.workforceState.id, 1)).where(and(eq(s.locationSettings.businessId, 1), ctx.activeActor())).limit(1),
    db.select({ id: s.employees.id }).from(s.employees).where(and(ctx.activeActor(), ctx.employeeFilter(s.employees.id))).limit(2001),
    db.select({ id: s.roles.id, name: s.roles.name }).from(s.roles).where(and(ctx.activeActor(), eq(s.roles.archived, false), ctx.roleFilter(s.roles.id))).limit(2001),
    db.select({ id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime, role: s.shifts.roleName, roleId: s.shifts.roleId, shiftType: s.shifts.shiftType }).from(s.shifts).where(and(ctx.activeActor(), ctx.employeeFilter(s.shifts.employeeId), isNull(s.shifts.archivedAt), selection)).limit(10001),
    db.select({ id: s.availabilityRequests.id, employeeId: s.availabilityRequests.employeeId, effectiveDate: s.availabilityRequests.effectiveDate, submittedAt: s.availabilityRequests.submittedAt, status: s.availabilityRequests.status }).from(s.availabilityRequests).where(availabilityScope).limit(5001),
    db.select({ requestId: s.availabilitySlots.requestId, dayOfWeek: s.availabilitySlots.dayOfWeek, start: s.availabilitySlots.startMinute, end: s.availabilitySlots.endMinute, preference: s.availabilitySlots.preference }).from(s.availabilitySlots).innerJoin(s.availabilityRequests, eq(s.availabilityRequests.id, s.availabilitySlots.requestId)).where(availabilityScope).limit(500001),
    db.select({ employeeId: s.ptoRequests.employeeId, startDate: s.ptoRequests.startDate, endDate: s.ptoRequests.endDate, startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime }).from(s.ptoRequests).where(and(ctx.activeActor(), sql`${ctx.permissions["time_off.read"] ? 1 : 0} = 1`, ctx.employeeFilter(s.ptoRequests.employeeId), eq(s.ptoRequests.status, "approved"), isNull(s.ptoRequests.archivedAt), sql`${s.ptoRequests.startDate} <= ${end} AND ${s.ptoRequests.endDate} >= ${start}`)).limit(10001),
    // Read classification only, never pay amounts. This is used privately to
    // avoid treating recorded exempt salaries as scheduled overtime.
    db.select({ id: s.wageRates.id, employeeId: s.wageRates.employeeId, roleId: s.wageRates.roleId, role: s.roles.name, basis: s.wageRates.basis, overtimeExempt: s.wageRates.overtimeExempt, effectiveDate: s.wageRates.effectiveDate }).from(s.wageRates).leftJoin(s.roles, eq(s.roles.id, s.wageRates.roleId)).where(and(ctx.activeActor(), ctx.employeeFilter(s.wageRates.employeeId), sql`${s.wageRates.effectiveDate} <= ${end}`)).limit(10001),
  ]);
  if (!metadata[0]) throw new AuthError(401, "Sign in to continue.");
  if (metadata[0].revision !== revision) throw new AuthError(409, "Shared data changed. Reload the schedule to refresh warnings.");
  if (employees.length > 2000 || roles.length > 2000 || stored.length > 10000 || availability.length > 5000 || slots.length > 500000 || leave.length > 10000 || rates.length > 10000) throw new AuthError(503, "This warning review is too large. Narrow the dates or ask an Owner for help.");
  const roleIds = new Set(roles.map(role => role.id)), employeeIds = new Set(employees.map(employee => employee.id));
  const allowedRole = (id: number | null) => ctx.allDepartments || (id !== null && roleIds.has(id));
  for (const shift of upserts) {
    if (!employeeIds.has(shift.employeeId) || !roles.some(role => role.name === shift.role)) throw new AuthError(404, "A proposed shift is outside your access.");
    const original = stored.find(row => row.id === shift.id);
    if (original && !allowedRole(original.roleId)) throw new AuthError(404, "A proposed shift is outside your access.");
  }
  for (const id of deleted) { const original = stored.find(row => row.id === id); if (original && !allowedRole(original.roleId)) throw new AuthError(404, "A proposed shift is outside your access."); }
  const replaced = new Set([...deleted, ...upserts.map(shift => shift.id)]);
  const plan = [...stored.filter(shift => !replaced.has(shift.id)), ...upserts].filter(shift => shift.date >= start && shift.date <= end);
  const settings = normalizeScheduleEnforcement(metadata[0]);
  // Restrict overtime evaluation to full weeks. Outside-edge shifts are retained
  // for rest comparisons, but no partial-week overtime result is projected.
  const assessed = scheduleConflicts({ shifts: plan, settings, availabilityAllowed: ctx.permissions["availability.read"], leaveAllowed: ctx.permissions["time_off.read"], leave,
    availability: availability.map(row => ({ ...row, submittedAt: row.submittedAt.includes("T") ? row.submittedAt : row.submittedAt.replace(" ", "T") + "Z", slots: slots.filter(slot => slot.requestId === row.id).map(slot => ({ day: availabilityWeekdays[slot.dayOfWeek], preference: slot.preference, startHour: slot.start / 60, endHour: slot.end / 60, location: "This location" })) })),
    employees: employees.map(employee => ({ id: employee.id, wageRates: rates.filter(rate => rate.employeeId === employee.id).map(rate => ({ ...rate, role: rate.role ?? "", amountCents: 0 })) })),
  });
  const visible = new Set([...stored.filter(shift => allowedRole(shift.roleId) && !replaced.has(shift.id)), ...upserts].filter(shift => shift.date >= period.start && shift.date <= period.end).map(shift => shift.id));
  // Full requested weeks fit inside eight days of padding for every workweek start.
  if (scheduleWeekStart(period.start, settings.workWeekStart) < start) throw new AuthError(503, "Could not assess the complete workweek.");
  return { revision, availability: ctx.permissions["availability.read"], timeOff: ctx.permissions["time_off.read"], warnings: assessed.filter(warning => visible.has(warning.shiftId)) };
}
