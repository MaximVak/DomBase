import { and, eq, isNull, sql } from "drizzle-orm";
import { buildTimeCards, totalMetrics } from "../app/timesheets-model";
import type { TimeCard } from "../app/timesheets-model";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { AuthError } from "../auth/http";
import * as s from "../db/schema";
import { workplaceDate } from "../kiosk/break-actions";
import type { Context, Database } from "./context";
import { offsetDate, requestPeriod, weekStart } from "./period";
import type { WorkspacePeriod } from "./period";
import { attendanceRows, attendanceTotals } from "./reports-attendance";
import type { AttendanceRow } from "./reports-attendance";
import { estimatedLaborCents, hasUnverifiedBreakPremium, laborBreakdown, laborEntries } from "./reports-labor";
import type { LaborAmounts, LaborDepartment, LaborRole } from "./reports-labor";
import { workspaceSnapshot } from "./snapshot";

export type ReportScope = {
  period: WorkspacePeriod;
  location: string;
  companyWide: boolean;
};

export type ReportsOverview = ReportScope & {
  schedule?: { shifts: number; paidSeconds: number };
  time?: { workedSeconds: number; paidLeaveSeconds: number; needsReview: boolean };
  attendance?: { onTime: number; late: number; noShows: number; punctualityRate: number | null };
  labor?: { estimatedCents: number | null };
};

export type ReportHours = {
  scheduledSeconds: number;
  workedSeconds: number;
  varianceSeconds: number;
  paidLeaveSeconds: number;
  breakPremiumSeconds: number | null;
  needsReview: boolean;
};

export type ReportsHours = ReportScope & {
  canViewLabor: boolean;
  totals: ReportHours;
  days: (ReportHours & { date: string })[];
  team: (ReportHours & { id: number; name: string })[];
};

export type ReportsAttendance = ReportScope & {
  canViewLabor: boolean;
  zone: string;
  lateMinutes: number;
  totals: ReturnType<typeof attendanceTotals>;
  shifts: AttendanceRow[];
};

export type ReportsLabor = ReportScope & {
  city: string;
  canCompare: boolean;
  holidayPayEnabled: boolean;
  totals: LaborAmounts;
  departments: LaborDepartment[];
  roles: LaborRole[];
};

const incompleteTime = new Set(["Missing clock-out", "Clock time needs review", "Confirm unfinished break"]);
const seconds = (hours: number | null) => Math.round((hours ?? 0) * 3600);

async function readReportSource(db: Database, ctx: Context, url: URL, fieldKey: string, now: number, attendanceLinks = false) {
  ctx.requirePermission("reports.read");
  const [site] = await db.select({ location: s.business.locationName, city: s.business.city, zone: s.business.timeZone, settings: s.locationSettings })
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
  if (period.start < "0002-01-01" || period.end > "9998-12-31" || period.end > offsetDate(period.start, 30)) {
    throw new AuthError(400, "Choose a report range of at most 31 days.");
  }
  const dataPeriod = { start: weekStart(period.start, settings.workWeekStart), end: offsetDate(weekStart(period.end, settings.workWeekStart), 6) };
  const canSchedule = ctx.permissions["schedule.read"], canTime = ctx.permissions["timesheets.read"];
  const view = canTime ? await workspaceSnapshot(db, ctx, fieldKey, dataPeriod, { attendanceLinks }) : null;
  if (view && (view.settings.workWeekStart !== settings.workWeekStart || view.basicInfo.timeZone !== site.zone)) {
    throw new AuthError(409, "Workweek settings changed. Apply the report dates again.");
  }
  const reportSettings = view?.settings ?? settings;
  // Pull in the prior evening for an overnight shift that starts before the workweek boundary.
  const priorDay = offsetDate(dataPeriod.start, -1);
  // The Timesheets snapshot returns published work with both schedule and time access.
  // A schedule-only viewer gets the same publication rules without a time-card read.
  const published = !canSchedule ? [] : view ? view.timesheetSchedule ?? [] : await db.select({
    id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime,
    role: sql<string>`COALESCE(NULLIF(${s.shifts.roleName}, ''), ${s.roles.name}, '')`,
  }).from(s.shifts).leftJoin(s.roles, eq(s.shifts.roleId, s.roles.id)).where(and(
    ctx.activeActor(), ctx.employeeFilter(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId), isNull(s.shifts.archivedAt),
    eq(s.shifts.shiftType, "work"), sql`${s.shifts.publicationId} IS NOT NULL AND ${s.shifts.date} BETWEEN ${priorDay} AND ${dataPeriod.end}`,
  ));
  const state = view?.state;
  const employees = state?.employees ?? [...new Set(published.map(shift => shift.employeeId))]
    .map(id => ({ id, name: "", role: "", wage: "", active: true }));
  const scope = { period, location: view?.basicInfo.locationName ?? site.location, companyWide: ctx.allDepartments };
  return { scope, city: view?.basicInfo.city ?? site.city, canSchedule, canTime, published, employees, state, dataPeriod, priorDay,
    settings: reportSettings, zone: site.zone, pto: view?.permissions["time_off.read"] ? view.state.ptoRequests : view?.timesheetLeave ?? [], revision: view?.revision };
}

type ReportSource = Awaited<ReturnType<typeof readReportSource>>;

function reportTime({ scope, employees, state, published, pto, dataPeriod, priorDay, settings, zone }: ReportSource, now: number) {
  const cards = buildTimeCards({ ...dataPeriod, start: priorDay, employees, events: state?.clockEvents ?? [], shifts: published,
    adjustments: state?.hoursAdjustments ?? [], pto, now, timeZone: zone, rounding: "actual", weekStart: settings.workWeekStart,
    mandatoryMealBreak: settings.mandatoryMealBreak, mealBreakAfterHours: settings.mealBreakAfterHours,
    mealBreakMinutes: settings.mealBreakMinutes, overtimePolicy: settings, holidayPolicy: settings,
    overtimeScope: { companyWide: scope.companyWide, dataPeriod },
    breakPremiumPolicy: settings.breakPremiums ? { companyWide: scope.companyWide, dataPeriod,
      mealLimit: settings.mealPremiumLimit, restLimit: settings.restPremiumLimit } : undefined,
  });
  const auto = new Set(state?.clockEvents.filter(event => event.automatic && !event.assistedStatus).map(event => event.id));
  const unresolved = new Set(cards.filter(card => card.issues.some(issue => incompleteTime.has(issue)) || card.eventIds.some(id => auto.has(id))));
  const selected = cards.filter(({ date }) => date >= scope.period.start && date <= scope.period.end);
  return { selected, unresolved };
}

async function reportAttendance(db: Database, ctx: Context, { scope, employees, published, state, settings, zone }: ReportSource, now: number) {
  const { period } = scope;
  const approvedLeave = await db.select({ employeeId: s.ptoRequests.employeeId, startDate: s.ptoRequests.startDate,
    endDate: s.ptoRequests.endDate, startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime,
  }).from(s.ptoRequests).where(and(ctx.activeActor(), ctx.employeeFilter(s.ptoRequests.employeeId), isNull(s.ptoRequests.archivedAt),
    eq(s.ptoRequests.status, "approved"), sql`${s.ptoRequests.startDate} <= ${period.end} AND ${s.ptoRequests.endDate} >= ${period.start}`));
  const shifts = attendanceRows(employees, published, state?.clockEvents ?? [], approvedLeave, period, settings, zone, now);
  return { shifts, totals: attendanceTotals(shifts) };
}

async function assertReportCurrent(db: Database, ctx: Context, revision?: number) {
  const [current] = await db.select({ revision: s.workforceState.revision }).from(s.workforceState)
    .where(and(eq(s.workforceState.id, 1), ctx.activeActor())).limit(1);
  if (!current) throw new AuthError(401, "Sign in to view Reports.");
  if (revision !== undefined && current.revision !== revision) throw new AuthError(409, "Report data changed. Apply the report dates again.");
}

export async function readReportsOverview(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<ReportsOverview> {
  const source = await readReportSource(db, ctx, url, fieldKey, now, true);
  const { scope, canSchedule, canTime, published, settings, revision } = source;
  const { selected, unresolved } = reportTime(source, now);
  const { period } = scope;
  const actual = selected.filter(card => !unresolved.has(card));
  const actualTotals = totalMetrics(actual);
  const needsReview = selected.some(card => unresolved.has(card));
  const result: ReportsOverview = { ...scope };
  if (canSchedule) result.schedule = { shifts: published.filter(({ date }) => date >= period.start && date <= period.end).length,
    paidSeconds: seconds(totalMetrics(selected).scheduled) };
  if (canTime) result.time = { workedSeconds: seconds(actualTotals.actual), paidLeaveSeconds: seconds(totalMetrics(selected).pto), needsReview };
  if (canTime && ctx.permissions["wages.read"]) {
    const estimatedCents = ctx.allDepartments ? estimatedLaborCents(laborEntries(selected, unresolved, settings.workWeekStart, settings.holidayPayEnabled)) : null;
    result.labor = { estimatedCents };
  }
  if (canSchedule && canTime) {
    const { totals: { onTime, late, noShows, punctualityRate } } = await reportAttendance(db, ctx, source, now);
    result.attendance = { onTime, late, noShows, punctualityRate };
  }
  await assertReportCurrent(db, ctx, revision);
  return result;
}

export async function readReportsHours(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<ReportsHours> {
  ctx.requirePermission("schedule.read");
  ctx.requirePermission("timesheets.read");
  const source = await readReportSource(db, ctx, url, fieldKey, now);
  const { scope, employees, settings, revision } = source;
  const { selected, unresolved } = reportTime(source, now);
  const canCalculatePremium = ctx.allDepartments && ctx.permissions["wages.read"];

  function summarize(cards: TimeCard[]): ReportHours {
    let scheduled = 0, worked = 0, paidLeave = 0;
    let premium = 0, premiumIncomplete = !canCalculatePremium, needsReview = false;
    for (const card of cards) {
      const { metrics } = card;
      scheduled += metrics.scheduled ?? 0;
      paidLeave += metrics.pto ?? 0;
      if (unresolved.has(card)) {
        needsReview = true;
        premiumIncomplete = true;
        continue;
      }
      worked += metrics.actual ?? 0;
      premium += (metrics.mealPremium ?? 0) + (metrics.restPremium ?? 0);
      premiumIncomplete ||= hasUnverifiedBreakPremium(card);
    }
    const scheduledSeconds = seconds(scheduled), workedSeconds = seconds(worked);
    return { scheduledSeconds, workedSeconds, varianceSeconds: workedSeconds - scheduledSeconds, paidLeaveSeconds: seconds(paidLeave),
      breakPremiumSeconds: settings.breakPremiums ? premiumIncomplete ? null : seconds(premium) : 0, needsReview };
  }

  const byDate = Map.groupBy(selected, card => card.date);
  const byEmployee = Map.groupBy(selected, card => card.employeeId);
  const days = [...byDate.keys()].sort().map(date => ({ date, ...summarize(byDate.get(date)!) }));
  const team = employees.flatMap(({ id, name }) => {
    const cards = byEmployee.get(id);
    return cards ? [{ id, name, ...summarize(cards) }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  await assertReportCurrent(db, ctx, revision);
  return { ...scope, canViewLabor: ctx.permissions["wages.read"], totals: summarize(selected), days, team };
}

export async function readReportsAttendance(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<ReportsAttendance> {
  ctx.requirePermission("schedule.read");
  ctx.requirePermission("timesheets.read");
  const source = await readReportSource(db, ctx, url, fieldKey, now, true);
  const attendance = await reportAttendance(db, ctx, source, now);
  await assertReportCurrent(db, ctx, source.revision);
  return { ...source.scope, canViewLabor: ctx.permissions["wages.read"], zone: source.zone, lateMinutes: source.settings.lateMinutes, ...attendance };
}

export async function readReportsLabor(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<ReportsLabor> {
  ctx.requirePermission("timesheets.read");
  ctx.requirePermission("wages.read");
  const source = await readReportSource(db, ctx, url, fieldKey, now);
  const { scope, city, canSchedule, settings, revision } = source;
  const { holidayPayEnabled, workWeekStart } = settings;
  const report = { ...scope, city, canCompare: canSchedule, holidayPayEnabled };
  if (!scope.companyWide) {
    await assertReportCurrent(db, ctx, revision);
    return { ...report, totals: { estimatedCents: null, breakPremiumCents: null, holidayPremiumCents: null, totalCents: null }, departments: [], roles: [] };
  }
  const { selected, unresolved } = reportTime(source, now);
  // Keep historical assignments even when a role or department has since been archived.
  const roleDepartments = await db.select({ name: s.roles.name, departmentId: s.roles.departmentId, department: s.departments.name })
    .from(s.roles).leftJoin(s.departments, eq(s.roles.departmentId, s.departments.id)).where(ctx.activeActor());
  const costs = laborBreakdown(laborEntries(selected, unresolved, workWeekStart, holidayPayEnabled), roleDepartments, holidayPayEnabled);
  await assertReportCurrent(db, ctx, revision);
  return { ...report, ...costs };
}
