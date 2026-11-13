import { eq, sql, type SQL } from "drizzle-orm";
import * as s from "../db/schema";
import type { KioskOperatorDatabase } from "../kiosk/database";
import { AuthError } from "../auth/http";
import { date as validDate } from "../workforce/validation";
import { offsetScheduleDate, type EmployeeSchedule } from "./schedule-model";

export async function readEmployeeSchedule(db: KioskOperatorDatabase, ctx: { account: { employeeId: number | null }; guard: SQL }, url: URL, now: number): Promise<EmployeeSchedule> {
  if ([...url.searchParams.keys()].some(key => key !== "date") || url.searchParams.getAll("date").length > 1) {
    throw new AuthError(400, "Choose a schedule date only; employee selectors are not allowed.");
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const anchor = validDate(url.searchParams.get("date") ?? today);
  // Both queries run in one D1 read transaction. The current company setting,
  // identity guard and date limits apply before any shift reaches the client.
  const weekStart = sql`date(${anchor}, '-' || ((CAST(strftime('%w', ${anchor}) AS INTEGER) - ${s.locationSettings.workWeekStart} + 7) % 7) || ' days')`;
  const [metadata, shifts] = await db.batch([
    db.select({ employeeId: s.employees.id, locationName: s.business.locationName, timeZone: s.business.timeZone,
      ownOnly: s.locationSettings.employeesOwnScheduleOnly, workWeekStart: s.locationSettings.workWeekStart })
      .from(s.business).innerJoin(s.locationSettings, eq(s.locationSettings.businessId, s.business.id))
      .innerJoin(s.employees, eq(s.employees.id, ctx.account.employeeId ?? -1))
      .where(sql`${s.business.id} = 1 AND ${ctx.guard}`).limit(1),
    db.select({ id: s.shifts.id, employeeId: s.shifts.employeeId, employeeName: s.employees.name,
      shiftType: s.shifts.shiftType, color: s.shifts.color, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime, role: s.shifts.roleName, station: s.shifts.station })
      .from(s.shifts).innerJoin(s.employees, eq(s.employees.id, s.shifts.employeeId))
      .innerJoin(s.locationSettings, eq(s.locationSettings.businessId, 1))
      .where(sql`${ctx.guard} AND ${s.shifts.archivedAt} IS NULL
        AND ${s.shifts.date} >= ${weekStart} AND ${s.shifts.date} < date(${weekStart}, '+7 days')
        AND (${s.locationSettings.employeesOwnScheduleOnly} = 0 OR ${s.shifts.employeeId} = ${ctx.account.employeeId})`)
      .orderBy(s.shifts.date, s.shifts.startTime, s.employees.name, s.shifts.id).limit(2001),
  ]);
  const meta = metadata[0];
  if (!meta) throw new AuthError(401, "Sign in to continue.");
  if (shifts.length > 2000) throw new AuthError(503, "This schedule is too large to display. Ask your manager for help.");
  const weekday = new Date(`${anchor}T12:00:00Z`).getUTCDay();
  const startDate = offsetScheduleDate(anchor, -((weekday - meta.workWeekStart + 7) % 7));
  return { employeeId: meta.employeeId, locationName: meta.locationName, timeZone: meta.timeZone, ownOnly: meta.ownOnly,
    today, startDate, endDate: offsetScheduleDate(startDate, 6), shifts };
}
