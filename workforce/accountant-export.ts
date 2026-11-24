import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { AuthError, readAuthBody } from "../auth/http";
import * as s from "../db/schema";
import { addDays, buildTimeCards, totalMetrics, weekStartFor, workDate, workTime } from "../app/timesheets-model";
import type { TimeCard } from "../app/timesheets-model";
import { accountantEarlyWindowMs } from "../kiosk/break-rules";
import { defaultPayCalendar, periodFor, rateFor } from "../team/rules";
import type { WageRate } from "../team/rules";
import { roundReportHours } from "./accountant-report";
import type { AccountantReport, AccountantRow } from "./accountant-report";
import type { Context, Database } from "./context";
import { offsetDate, workspacePeriod } from "./period";
import { workspaceSnapshot } from "./snapshot";
import { approvedLeaveMinutesByDay, type LeaveDates } from "./leave-duration";
import { activeTimesheetLock } from "./timesheet-lock-guards";
import * as v from "./validation";

const annualPeriods = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;
const uncertainClockIssues = new Set(["Missing clock-out", "Clock time needs review", "Confirm unfinished break"]);

function readStamp(db: Database, ctx: Context) {
  return db.get<{ revision: number; punches: number; reports: number }>(sql`SELECT revision,
    (SELECT COALESCE(MAX(id),0) FROM clock_events) AS punches,
    (SELECT COUNT(*) FROM assisted_clock_reports) AS reports
    FROM workforce_state WHERE id=1 AND ${ctx.activeActor()}`);
}

function stagingFixtureIds(value?: string): ReadonlySet<number> {
  if (!value?.trim()) return new Set();
  const ids = value.split(",").map(part => part.trim());
  if (ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new AuthError(503, "The staging accountant fixture list is invalid.");
  }
  return new Set(ids.map(Number));
}

export async function readAccountantReport(db: Database, ctx: Context, request: Request, fieldKey: string, now: number, configuredFixtureIds?: string): Promise<AccountantReport> {
  ctx.requirePermission("timesheets.read");
  ctx.requirePermission("exports.timesheets");
  if (!ctx.allDepartments) throw new AuthError(403, "The accountant export requires company-wide Timesheets access.");
  const url = new URL(request.url);
  const fixtures = stagingFixtureIds(configuredFixtureIds);
  if (url.searchParams.size !== 2 || url.searchParams.getAll("start").length !== 1 || url.searchParams.getAll("end").length !== 1) throw new AuthError(400, "Choose the start and end dates for the accountant export.");
  const period = workspacePeriod({ start: url.searchParams.get("start"), end: url.searchParams.get("end") }, now);
  if (period.end > offsetDate(period.start, 30)) throw new AuthError(400, "Choose an export date range of at most 31 days.");
  let selected: number[] = [];
  if (request.method === "POST") {
    const body = await readAuthBody(request, 200_000);
    v.keys(body, ["scheduledStartIds"]);
    selected = v.list(body.scheduledStartIds, 10_000).map(id => v.integer(id));
    if (new Set(selected).size !== selected.length) throw new AuthError(400, "Choose each early check-in once.");
  }
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
  const rates = new Map<number, WageRate[]>();
  for (const { employeeId, role, ...rate } of rateRows) {
    const entries = rates.get(employeeId) ?? [];
    entries.push({ ...rate, role: role ?? "" });
    rates.set(employeeId, entries);
  }
  // Exclude explicitly identified retired test people from the report only.
  const employees = view.state.employees
    .filter(employee => !fixtures.has(employee.id) || employee.active || !employee.terminated)
    .map(employee => ({ ...employee, wage: "", wageRates: rates.get(employee.id) ?? [] }));
  const input = { ...dataPeriod, employees, shifts: [], events: view.state.clockEvents, adjustments: view.state.hoursAdjustments, pto: [],
    timeZone: view.basicInfo.timeZone, now, rounding: "actual", weekStart, mandatoryMealBreak: view.settings.mandatoryMealBreak,
    mealBreakAfterHours: view.settings.mealBreakAfterHours, mealBreakMinutes: view.settings.mealBreakMinutes,
    overtimePolicy: view.settings, overtimeScope: { companyWide: true, dataPeriod } } satisfies Parameters<typeof buildTimeCards>[0];
  const actualCards = buildTimeCards(input);
  const provisional = new Set(view.state.clockEvents.filter(event => event.automatic && !event.assistedStatus).map(event => event.id));
  const blockedWeeks = new Set(actualCards.filter(card => card.issues.some(issue => uncertainClockIssues.has(issue)) || card.eventIds.some(id => provisional.has(id)))
    .map(card => `${card.employeeId}:${weekStartFor(card.date, weekStart)}`));
  const events = new Map(input.events.map(event => [event.id, event]));
  const employeeNames = new Map(employees.map(employee => [employee.id, employee.name]));
  const adjustments = new Set(input.adjustments.map(row => `${row.employeeId}:${row.date}`));
  const candidates = new Map<number, { employeeId: number; employeeName: string; date: string; recordedAt: string; scheduledAt: string; firstWeek: string; lastWeekEnd: string }>();
  for (const card of actualCards) {
    const first = events.get(card.eventIds[0]);
    const scheduledAt = first?.clockDetails?.scheduledStart;
    const employeeName = employeeNames.get(card.employeeId);
    if (!first || first.type !== "in" || !scheduledAt || first.cardId !== undefined || first.clockDetails?.earlyWork || !card.end || employeeName === undefined) continue;
    const start = Date.parse(first.at), scheduled = Date.parse(scheduledAt);
    const early = scheduled - start;
    if (!(early > 0 && early <= accountantEarlyWindowMs && scheduled < Date.parse(card.end))) continue;
    const date = workDate(start, input.timeZone), startDate = workDate(scheduled, input.timeZone);
    if (card.date !== date || date < period.start || startDate > period.end || card.eventIds.some(id => {
      const event = events.get(id);
      return !event || !!event.assistedStatus || event.automatic || event.type === "break" && Date.parse(event.at) < scheduled;
    })) continue;
    const firstWeek = weekStartFor(date, weekStart), lastWeek = weekStartFor(startDate, weekStart);
    if ([date, startDate].some(day => adjustments.has(`${card.employeeId}:${day}`)) ||
      [firstWeek, lastWeek].some(week => blockedWeeks.has(`${card.employeeId}:${week}`))) continue;
    candidates.set(first.id, { employeeId: card.employeeId, employeeName, date, recordedAt: first.at, scheduledAt, firstWeek, lastWeekEnd: addDays(lastWeek, 6) });
  }
  // Changing the first few minutes can reallocate weekly overtime on any card in the workweek.
  const locks = candidates.size ? await db.all<{ employeeId: number | null; startDate: string; endDate: string }>(sql`
    SELECT l.employee_id AS employeeId, l.start_date AS startDate, l.end_date AS endDate FROM timesheet_lock_events l
    WHERE l.start_date <= ${dataPeriod.end} AND l.end_date >= ${dataPeriod.start} AND ${activeTimesheetLock} AND ${ctx.activeActor()}`) : [];
  for (const [id, candidate] of candidates) {
    if (locks.some(lock => (lock.employeeId === null || lock.employeeId === candidate.employeeId) &&
      lock.startDate <= candidate.lastWeekEnd && lock.endDate >= candidate.firstWeek)) candidates.delete(id);
  }
  const after = await readStamp(db, ctx);
  if (!after) throw new AuthError(401, "Sign in to export timesheets.");
  if (before.revision !== after.revision || view.revision !== after.revision || before.punches !== after.punches || before.reports !== after.reports) {
    throw new AuthError(409, "Timesheets changed while preparing the report. Refresh and try again.");
  }
  if (selected.some(id => !candidates.has(id))) throw new AuthError(409, "An early check-in is no longer eligible. Reload the recorded report and review your selections again.");
  const scheduledStarts = new Map(selected.map(id => [id, candidates.get(id)!.scheduledAt]));
  const cards: TimeCard[] = selected.length ? buildTimeCards({ ...input, events: input.events.map(event => {
    const start = scheduledStarts.get(event.id);
    return start ? { ...event, at: start } : event;
  }) }) : actualCards;
  const byEmployee = new Map<number, typeof cards>();
  for (const card of cards) {
    if (card.date < period.start || card.date > period.end) continue;
    const entries = byEmployee.get(card.employeeId) ?? [];
    entries.push(card);
    byEmployee.set(card.employeeId, entries);
  }
  const leaveByEmployee = new Map<number, LeaveDates[]>();
  for (const request of leave) {
    const own = leaveByEmployee.get(request.employeeId) ?? [];
    own.push(request);
    leaveByEmployee.set(request.employeeId, own);
  }
  const calendar = view.teamPeriod ?? defaultPayCalendar;
  const configured = periodFor(period.start, calendar.payPeriod, calendar.anchorDate);
  const periodsPerYear = configured.start === period.start && configured.end === period.end ? annualPeriods[calendar.payPeriod] : null;
  const rows: AccountantRow[] = [];
  for (const employee of employees) {
    const own = byEmployee.get(employee.id) ?? [];
    const totals = totalMetrics(own);
    const leaveMinutes = [...approvedLeaveMinutesByDay(leaveByEmployee.get(employee.id) ?? [], period).values()].reduce((total, minutes) => total + minutes, 0);
    const pto = roundReportHours(leaveMinutes / 60);
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
  const earlyCheckIns = [...candidates.entries()].map(([eventId, { employeeName, date, recordedAt, scheduledAt }]) => ({
    eventId, employeeName, date, recordedTime: workTime(recordedAt, input.timeZone, true), scheduledTime: workTime(scheduledAt, input.timeZone),
  })).sort((a, b) => a.date.localeCompare(b.date) || a.recordedTime.localeCompare(b.recordedTime) || a.employeeName.localeCompare(b.employeeName) || a.eventId - b.eventId);
  return { period, location: view.basicInfo.locationName, periodsPerYear, rows,
    ...(earlyCheckIns.length ? { earlyCheckIns } : {}), ...(selected.length ? { scheduledStartIds: selected } : {}) };
}
