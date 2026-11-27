import { and, eq, isNull, sql } from "drizzle-orm";
import { buildTimeCards, totalMetrics } from "../app/timesheets-model";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { AuthError } from "../auth/http";
import * as s from "../db/schema";
import { workplaceDate } from "../kiosk/break-actions";
import { reliabilityFor, reliabilityTotals } from "../team/insights-rules";
import type { Context, Database } from "./context";
import { offsetDate, requestPeriod, weekStart } from "./period";
import type { WorkspacePeriod } from "./period";
import { workspaceSnapshot } from "./snapshot";

export type ReportsOverview = {
  period: WorkspacePeriod;
  location: string;
  companyWide: boolean;
  schedule?: { shifts: number; paidSeconds: number };
  time?: { workedSeconds: number; paidLeaveSeconds: number; needsReview: boolean };
  attendance?: { onTime: number; late: number; noShows: number; punctualityRate: number | null };
  labor?: { estimatedCents: number | null };
};

const incompleteTime = new Set(["Missing clock-out", "Clock time needs review", "Confirm unfinished break"]);
const seconds = (hours: number | null) => Math.round((hours ?? 0) * 3600);

export async function readReportsOverview(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<ReportsOverview> {
  ctx.requirePermission("reports.read");
  const [site] = await db.select({ location: s.business.locationName, zone: s.business.timeZone, settings: s.locationSettings })
    .from(s.business).leftJoin(s.locationSettings, eq(s.locationSettings.businessId, s.business.id))
    .where(and(eq(s.business.id, 1), ctx.activeActor())).limit(1);
  if (!site) throw new AuthError(401, "Sign in to view Reports.");
  const settings = normalizeScheduleEnforcement(site.settings ?? undefined);
  if ([...url.searchParams.keys()].some(key => key !== "start" && key !== "end")
    || url.searchParams.getAll("start").length > 1 || url.searchParams.getAll("end").length > 1) {
    throw new AuthError(400, "Choose one start date and one end date.");
  }
  const currentWeek = weekStart(workplaceDate(now, site.zone), settings.workWeekStart);
  const period = url.searchParams.size ? requestPeriod(url, now) : { start: currentWeek, end: offsetDate(currentWeek, 6) };
  if (period.start < "0001-01-01" || period.end > "9998-12-31" || period.end > offsetDate(period.start, 30)) {
    throw new AuthError(400, "Choose a report range of at most 31 days.");
  }
  const dataPeriod = { start: weekStart(period.start, settings.workWeekStart), end: offsetDate(weekStart(period.end, settings.workWeekStart), 6) };
  const canSchedule = ctx.permissions["schedule.read"], canTime = ctx.permissions["timesheets.read"];
  const view = canTime ? await workspaceSnapshot(db, ctx, fieldKey, dataPeriod) : null;
  if (view && (view.settings.workWeekStart !== settings.workWeekStart || view.basicInfo.timeZone !== site.zone)) {
    throw new AuthError(409, "Workweek settings changed. Apply the report dates again.");
  }
  const reportSettings = view?.settings ?? settings;
  // The Timesheets snapshot returns published work with both schedule and time access.
  // A schedule-only viewer gets the same publication rules without a time-card read.
  const published = !canSchedule ? [] : view ? view.timesheetSchedule ?? [] : await db.select({
    id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime,
    role: sql<string>`COALESCE(NULLIF(${s.shifts.roleName}, ''), ${s.roles.name}, '')`,
  }).from(s.shifts).leftJoin(s.roles, eq(s.shifts.roleId, s.roles.id)).where(and(
    ctx.activeActor(), ctx.employeeFilter(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId), isNull(s.shifts.archivedAt),
    eq(s.shifts.shiftType, "work"), sql`${s.shifts.publicationId} IS NOT NULL AND ${s.shifts.date} BETWEEN ${dataPeriod.start} AND ${dataPeriod.end}`,
  ));
  const inRange = ({ date }: { date: string }) => date >= period.start && date <= period.end;
  const publishedInRange = published.filter(inRange);
  const state = view?.state;
  const employees = state?.employees ?? [...new Set(published.map(shift => shift.employeeId))]
    .map(id => ({ id, name: "", role: "", wage: "", active: true }));
  const cards = buildTimeCards({ ...dataPeriod, employees, events: state?.clockEvents ?? [], shifts: published,
    adjustments: state?.hoursAdjustments ?? [], pto: view?.permissions["time_off.read"] ? view.state.ptoRequests : view?.timesheetLeave ?? [],
    now, timeZone: site.zone, rounding: "actual", weekStart: reportSettings.workWeekStart,
    mandatoryMealBreak: reportSettings.mandatoryMealBreak, mealBreakAfterHours: reportSettings.mealBreakAfterHours,
    mealBreakMinutes: reportSettings.mealBreakMinutes, overtimePolicy: reportSettings, holidayPolicy: reportSettings,
    overtimeScope: { companyWide: ctx.allDepartments, dataPeriod },
    breakPremiumPolicy: reportSettings.breakPremiums ? { companyWide: ctx.allDepartments, dataPeriod,
      mealLimit: reportSettings.mealPremiumLimit, restLimit: reportSettings.restPremiumLimit } : undefined,
  });
  const auto = new Set(state?.clockEvents.filter(event => event.automatic && !event.assistedStatus).map(event => event.id));
  const unresolved = new Set(cards.filter(card => card.issues.some(issue => incompleteTime.has(issue)) || card.eventIds.some(id => auto.has(id))));
  const selected = cards.filter(inRange);
  const actual = selected.filter(card => !unresolved.has(card));
  const paid = selected.filter(card => card.metrics.actual || card.metrics.pto || card.metrics.mealPremium || card.metrics.restPremium);
  const actualTotals = totalMetrics(actual);
  const needsReview = selected.some(card => unresolved.has(card));
  const result: ReportsOverview = { period, location: view?.basicInfo.locationName ?? site.location, companyWide: ctx.allDepartments };
  if (canSchedule) result.schedule = { shifts: publishedInRange.length, paidSeconds: seconds(totalMetrics(selected).scheduled) };
  if (canTime) result.time = { workedSeconds: seconds(actualTotals.actual), paidLeaveSeconds: seconds(totalMetrics(selected).pto), needsReview };
  if (canTime && ctx.permissions["wages.read"]) {
    const unresolvedWeeks = new Set([...unresolved].map(card => `${card.employeeId}:${weekStart(card.date, reportSettings.workWeekStart)}`));
    const incomplete = needsReview || paid.some(card => unresolvedWeeks.has(`${card.employeeId}:${weekStart(card.date, reportSettings.workWeekStart)}`));
    const wages = paid.length ? totalMetrics(paid).wages : 0;
    result.labor = { estimatedCents: !ctx.allDepartments || incomplete || wages === null ? null : Math.round(wages * 100) };
  }
  if (canSchedule && state) {
    const leave = await db.select({ employeeId: s.ptoRequests.employeeId, status: s.ptoRequests.status, startDate: s.ptoRequests.startDate,
      endDate: s.ptoRequests.endDate, startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime,
    }).from(s.ptoRequests).where(and(ctx.activeActor(), ctx.employeeFilter(s.ptoRequests.employeeId), isNull(s.ptoRequests.archivedAt),
      eq(s.ptoRequests.status, "approved"), sql`${s.ptoRequests.startDate} <= ${period.end} AND ${s.ptoRequests.endDate} >= ${period.start}`));
    const { onTime, late, noShows, punctualityRate } = reliabilityTotals(reliabilityFor({ employees, shifts: published,
      clockEvents: state.clockEvents, ptoRequests: leave.map(row => ({ ...row, startTime: row.startTime ?? undefined, endTime: row.endTime ?? undefined })),
    }, period.start, period.end, now, reportSettings, site.zone));
    result.attendance = { onTime, late, noShows, punctualityRate };
  }
  const [current] = await db.select({ revision: s.workforceState.revision }).from(s.workforceState)
    .where(and(eq(s.workforceState.id, 1), ctx.activeActor())).limit(1);
  if (!current) throw new AuthError(401, "Sign in to view Reports.");
  if (view && current.revision !== view.revision) throw new AuthError(409, "Report data changed. Apply the report dates again.");
  return result;
}
