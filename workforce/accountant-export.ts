import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { AuthError } from "../auth/http";
import * as s from "../db/schema";
import { addDays, buildTimeCards, totalMetrics, weekStartFor } from "../app/timesheets-model";
import { defaultPayCalendar, periodFor, rateFor } from "../team/rules";
import type { WageRate } from "../team/rules";
import { roundReportHours } from "./accountant-report";
import type { AccountantReport, AccountantRow } from "./accountant-report";
import type { Context, Database } from "./context";
import { offsetDate, workspacePeriod } from "./period";
import type { WorkspacePeriod } from "./period";
import { workspaceSnapshot } from "./snapshot";

const annualPeriods = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;
const uncertainClockIssues = new Set(["Missing clock-out", "Clock time needs review", "Confirm unfinished break"]);
type PaidLeave = { employeeId: number; startDate: string; endDate: string; startTime: string | null; endTime: string | null };

function approvedLeaveHours(requests: PaidLeave[], period: WorkspacePeriod) {
  const byDay = new Map<string, { employeeId: number; intervals: [number, number][]; fullDay: boolean }>();
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  for (const request of requests) {
    const start = request.startDate < period.start ? period.start : request.startDate;
    const end = request.endDate > period.end ? period.end : request.endDate;
    for (let date = start; date <= end; date = offsetDate(date, 1)) {
      const key = `${request.employeeId}:${date}`;
      const day = byDay.get(key) ?? { employeeId: request.employeeId, intervals: [], fullDay: false };
      if (request.startTime && request.endTime && request.startDate === request.endDate) day.intervals.push([minutes(request.startTime), minutes(request.endTime)]);
      else day.fullDay = true;
      byDay.set(key, day);
    }
  }
  const byEmployee = new Map<number, number>();
  for (const { employeeId, fullDay, intervals } of byDay.values()) {
    let duration = fullDay ? 480 : 0;
    let previousEnd = 0;
    if (!fullDay) for (const [start, end] of intervals.sort(([a], [b]) => a - b)) {
      duration += Math.max(0, end - Math.max(start, previousEnd));
      previousEnd = Math.max(previousEnd, end);
    }
    byEmployee.set(employeeId, (byEmployee.get(employeeId) ?? 0) + duration);
  }
  return byEmployee;
}

function readStamp(db: Database, ctx: Context) {
  return db.get<{ revision: number; punches: number; reports: number }>(sql`SELECT revision,
    (SELECT COALESCE(MAX(id),0) FROM clock_events) AS punches,
    (SELECT COUNT(*) FROM assisted_clock_reports) AS reports
    FROM workforce_state WHERE id=1 AND ${ctx.activeActor()}`);
}

export async function readAccountantReport(db: Database, ctx: Context, url: URL, fieldKey: string, now: number): Promise<AccountantReport> {
  ctx.requirePermission("timesheets.read");
  ctx.requirePermission("exports.timesheets");
  if (!ctx.allDepartments) throw new AuthError(403, "The accountant export requires company-wide Timesheets access.");
  if (url.searchParams.size !== 2 || url.searchParams.getAll("start").length !== 1 || url.searchParams.getAll("end").length !== 1) throw new AuthError(400, "Choose the start and end dates for the accountant export.");
  const period = workspacePeriod({ start: url.searchParams.get("start"), end: url.searchParams.get("end") }, now);
  if (period.end > offsetDate(period.start, 30)) throw new AuthError(400, "Choose an export date range of at most 31 days.");
  const [before, [settings]] = await Promise.all([readStamp(db, ctx), db.select({ workWeekStart: s.locationSettings.workWeekStart }).from(s.locationSettings).limit(1)]);
  if (!before) throw new AuthError(401, "Sign in to export timesheets.");
  const weekStart = settings?.workWeekStart ?? 1;
  const dataPeriod = { start: weekStartFor(period.start, weekStart), end: addDays(weekStartFor(period.end, weekStart), 6) };

  // Read pay classification server-side even when an accountant cannot view wage amounts or leave details.
  const [view, rateRows, leave] = await Promise.all([
    workspaceSnapshot(db, ctx, fieldKey, dataPeriod),
    db.select({ id: s.wageRates.id, employeeId: s.wageRates.employeeId, roleId: s.wageRates.roleId, role: s.roles.name,
      basis: s.wageRates.basis, effectiveDate: s.wageRates.effectiveDate, amountCents: s.wageRates.amountCents, overtimeExempt: s.wageRates.overtimeExempt })
      .from(s.wageRates).leftJoin(s.roles, eq(s.wageRates.roleId, s.roles.id)).where(and(lte(s.wageRates.effectiveDate, dataPeriod.end), ctx.activeActor())),
    db.select({ employeeId: s.ptoRequests.employeeId, startDate: s.ptoRequests.startDate, endDate: s.ptoRequests.endDate,
      startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime }).from(s.ptoRequests)
      .where(and(ctx.activeActor(), eq(s.ptoRequests.status, "approved"), eq(s.ptoRequests.compensation, "paid"), isNull(s.ptoRequests.archivedAt),
        sql`${s.ptoRequests.startDate} <= ${period.end} AND ${s.ptoRequests.endDate} >= ${period.start}`)),
  ]);
  const after = await readStamp(db, ctx);
  if (!after) throw new AuthError(401, "Sign in to export timesheets.");
  if (before.revision !== after.revision || view.revision !== after.revision || before.punches !== after.punches || before.reports !== after.reports) {
    throw new AuthError(409, "Timesheets changed while preparing the report. Refresh and try again.");
  }

  const rates = new Map<number, WageRate[]>();
  for (const { employeeId, role, ...rate } of rateRows) {
    const entries = rates.get(employeeId) ?? [];
    entries.push({ ...rate, role: role ?? "" });
    rates.set(employeeId, entries);
  }
  const employees = view.state.employees.map(employee => ({ ...employee, wage: "", wageRates: rates.get(employee.id) ?? [] }));
  const cards = buildTimeCards({ ...dataPeriod, employees, shifts: [], events: view.state.clockEvents, adjustments: view.state.hoursAdjustments, pto: [],
    timeZone: view.basicInfo.timeZone, now, rounding: "actual", weekStart, mandatoryMealBreak: view.settings.mandatoryMealBreak,
    mealBreakAfterHours: view.settings.mealBreakAfterHours, mealBreakMinutes: view.settings.mealBreakMinutes,
    overtimePolicy: view.settings, overtimeScope: { companyWide: true, dataPeriod } });
  const provisional = new Set(view.state.clockEvents.filter(event => event.automatic && !event.assistedStatus).map(event => event.id));
  const blockedWeeks = new Set(cards.filter(card => card.issues.some(issue => uncertainClockIssues.has(issue)) || card.eventIds.some(id => provisional.has(id)))
    .map(card => `${card.employeeId}:${weekStartFor(card.date, weekStart)}`));
  const byEmployee = new Map<number, typeof cards>();
  for (const card of cards) {
    if (card.date < period.start || card.date > period.end) continue;
    const entries = byEmployee.get(card.employeeId) ?? [];
    entries.push(card);
    byEmployee.set(card.employeeId, entries);
  }
  const ptoMinutes = approvedLeaveHours(leave, period);
  const calendar = view.teamPeriod ?? defaultPayCalendar;
  const configured = periodFor(period.start, calendar.payPeriod, calendar.anchorDate);
  const periodsPerYear = configured.start === period.start && configured.end === period.end ? annualPeriods[calendar.payPeriod] : null;
  const rows: AccountantRow[] = [];
  for (const employee of employees) {
    const own = byEmployee.get(employee.id) ?? [];
    const totals = totalMetrics(own);
    const pto = roundReportHours((ptoMinutes.get(employee.id) ?? 0) / 60);
    const ratesInPeriod = [period.start, ...employee.wageRates.map(rate => rate.effectiveDate).filter(date => date > period.start && date <= period.end)];
    const coversPeriod = (!employee.startDate || employee.startDate <= period.start) && (!employee.terminationDate || employee.terminationDate > period.end);
    const salaryEligible = periodsPerYear !== null && coversPeriod && (employee.active || !!employee.terminationDate)
      && ratesInPeriod.every(date => rateFor(employee.wageRates, employee.role, date)?.basis === "annual_salary")
      && own.every(card => !(card.metrics.actual ?? 0) || rateFor(employee.wageRates, card.role, card.date)?.basis === "annual_salary");
    const uncertain = own.some(card => (card.start || card.adjustment) && blockedWeeks.has(`${employee.id}:${weekStartFor(card.date, weekStart)}`))
      || totals.regular === null || totals.ot === null || totals.doubleOt === null;
    if (!(totals.actual || pto || uncertain || salaryEligible || own.some(card => card.adjustment))) continue;
    const regular = uncertain ? null : roundReportHours(totals.regular ?? 0);
    const overtime = uncertain ? null : roundReportHours(totals.ot ?? 0);
    const doubleTime = uncertain ? null : roundReportHours(totals.doubleOt ?? 0);
    const total = regular === null || overtime === null || doubleTime === null ? null : roundReportHours(regular + overtime + doubleTime + pto);
    rows.push({ employeeId: employee.id, name: employee.name, payrollId: employee.payrollId ?? "", regular, overtime, doubleTime, pto, total, salaryEligible });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.employeeId - b.employeeId);
  return { period, location: view.basicInfo.locationName, periodsPerYear, rows };
}
