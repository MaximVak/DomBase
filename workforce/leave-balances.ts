import { and, eq, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { AuthError } from "../auth/http";
import * as s from "../db/schema";
import { buildTimeCards, workDate } from "../app/timesheets-model";
import { defaultPayCalendar, plusDays } from "../team/rules";
import { currentRawPunch, projectClockEvents } from "./clock-projection";
import type { Context, Database } from "./context";
import { approvedLeaveMinutesByDay, leaveCategories, leaveCategory, type LeaveCategory, type LeaveDates } from "./leave-duration";
import { leaveBalance, leaveUsageStarts, type EmployeeLeaveBalances, type LeaveAccount, type LeaveTerms } from "./leave-policy";

type LeaveScope = { guard: SQL; employees: (column: SQLWrapper) => SQL };
export type PaidRequest = LeaveDates & { id?: number; employeeId: number; compensation: string; category?: LeaveCategory | null };
type Assignment = { policy: LeaveTerms & { id: number; name: string }; enrollment: Pick<typeof s.ptoAssignments.$inferSelect,
  "employeeId" | "startDate" | "openingBalanceSeconds" | "legacyBalanceYear">; hireDate: string | null };
export const managerLeaveScope = (ctx: Context): LeaveScope => ({ guard: ctx.activeActor(), employees: ctx.employeeFilter });
export const ownLeaveScope = (guard: SQL, employeeId: number): LeaveScope => ({ guard, employees: column => sql`${column} = ${employeeId}` });

async function leaveInputs(db: Database, scope: LeaveScope, now: number) {
  const p = s.ptoPolicies, a = s.ptoAssignments;
  const [assignments, [calendar], [business]] = await db.batch([
    db.select({ policy: { id: p.id, name: p.name, category: p.category, method: p.method, fixedFrequency: p.fixedFrequency,
      fixedAllowanceSeconds: p.fixedAllowanceSeconds, earnedSeconds: p.earnedSeconds, perWorkedSeconds: p.perWorkedSeconds,
      maxBalanceSeconds: p.maxBalanceSeconds, carryoverSeconds: p.carryoverSeconds, waitingDays: p.waitingDays, tenureBonuses: p.tenureBonuses },
      enrollment: { employeeId: a.employeeId, startDate: a.startDate, openingBalanceSeconds: a.openingBalanceSeconds, legacyBalanceYear: a.legacyBalanceYear },
      hireDate: sql<string | null>`${s.employees.startDate}`.as("hire_date") }).from(s.ptoAssignments)
      .innerJoin(s.ptoPolicies, and(eq(s.ptoPolicies.id, s.ptoAssignments.policyId), eq(s.ptoPolicies.category, s.ptoAssignments.category)))
      .innerJoin(s.employees, eq(s.employees.id, s.ptoAssignments.employeeId))
      .where(and(scope.guard, scope.employees(s.ptoAssignments.employeeId), eq(s.ptoPolicies.archived, false))),
    db.select({ payPeriod: s.teamSettings.payPeriod, anchorDate: s.teamSettings.anchorDate }).from(s.teamSettings).where(scope.guard).limit(1),
    db.select({ timeZone: s.business.timeZone }).from(s.business).where(scope.guard).limit(1),
  ]);
  const zone = business?.timeZone ?? "America/Los_Angeles";
  const today = workDate(now, zone);
  const initial = { assignments, calendar: calendar ?? defaultPayCalendar, today, requests: [] as PaidRequest[], worked: new Map<number, Map<string, number>>() };
  if (!assignments.length) return initial;
  const yearStart = today.slice(0, 4) + "-01-01";
  const start = assignments.reduce((first, { enrollment, policy }) => {
    if (policy.method !== "rate") return first;
    const date = enrollment.legacyBalanceYear === null ? enrollment.startDate : Math.max(enrollment.legacyBalanceYear, 1) + "-01-01";
    return date < first ? date : first;
  }, yearStart);
  const requestStart = assignments.reduce((first, { enrollment }) => {
    const date = enrollment.legacyBalanceYear === null ? enrollment.startDate : enrollment.legacyBalanceYear + "-01-01";
    return date < first ? date : first;
  }, yearStart);
  const linked = [...new Set(assignments.map(row => row.enrollment.employeeId))];
  // One bound JSON input keeps employee selection inside D1's parameter limit.
  const assigned = (column: SQLWrapper) => sql`${scope.guard} AND ${column} IN (SELECT value FROM json_each(${JSON.stringify(linked)}))`;
  const [raw, edits, adjustments, requests] = await db.batch([
    db.select({ event: s.clockEvents, assistance: s.assistedClockReports }).from(s.clockEvents)
      .leftJoin(s.assistedClockReports, eq(s.assistedClockReports.eventId, s.clockEvents.id))
      .where(and(assigned(s.clockEvents.employeeId), currentRawPunch, sql`${s.clockEvents.occurredAt} >= ${plusDays(start, -2)} AND ${s.clockEvents.occurredAt} < ${plusDays(today, 2)}`)),
    db.select({ before: s.timeCardEdits.before, after: s.timeCardEdits.after, cardId: s.timeCardEdits.cardId }).from(s.timeCardEdits)
      .innerJoin(s.timeCards, eq(s.timeCards.id, s.timeCardEdits.cardId)).where(and(assigned(s.timeCardEdits.employeeId),
        sql`${s.timeCards.workDate} BETWEEN ${plusDays(start, -2)} AND ${plusDays(today, 2)}`))
      .orderBy(s.timeCardEdits.cardId, s.timeCardEdits.revision),
    db.select({ employeeId: s.hoursAdjustments.employeeId, date: s.hoursAdjustments.date, seconds: s.hoursAdjustments.adjustmentSeconds }).from(s.hoursAdjustments)
      .where(and(assigned(s.hoursAdjustments.employeeId), sql`${s.hoursAdjustments.date} BETWEEN ${start} AND ${today}`)),
    db.select({ id: s.ptoRequests.id, employeeId: s.ptoRequests.employeeId, category: s.ptoRequests.category, compensation: s.ptoRequests.compensation,
      startDate: s.ptoRequests.startDate, endDate: s.ptoRequests.endDate, startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime }).from(s.ptoRequests)
      .where(and(assigned(s.ptoRequests.employeeId), eq(s.ptoRequests.status, "approved"), eq(s.ptoRequests.compensation, "paid"),
        isNull(s.ptoRequests.archivedAt), sql`${s.ptoRequests.endDate} >= ${requestStart}`)),
  ]);
  const events = projectClockEvents(raw, edits);
  const provisional = new Set(events.filter(event => event.assistedStatus === "pending" || (event.automatic && !event.assistedStatus)).map(event => event.id));
  const cards = buildTimeCards({ employees: linked.map(id => ({ id, name: "", role: "", wage: "", active: true })), events, shifts: [], adjustments: [], pto: [],
    start, end: today, now, rounding: "actual", weekStart: 1, mandatoryMealBreak: false, mealBreakAfterHours: 5, timeZone: zone, workedOnly: true });
  function add(employeeId: number, date: string, seconds: number) {
    const days = initial.worked.get(employeeId) ?? new Map<string, number>();
    days.set(date, (days.get(date) ?? 0) + seconds);
    initial.worked.set(employeeId, days);
  }
  for (const card of cards) {
    if (card.end && Date.parse(card.end) <= now && !card.issues.includes("Confirm unfinished break") && !card.eventIds.some(id => provisional.has(id))) {
      add(card.employeeId, card.date, (card.metrics.actual ?? 0) * 3600);
    }
  }
  for (const row of adjustments) add(row.employeeId, row.date, row.seconds);
  for (const days of initial.worked.values()) for (const [date, seconds] of days) days.set(date, Math.max(0, seconds));
  return { ...initial, requests };
}

type Inputs = Awaited<ReturnType<typeof leaveInputs>>;
function requestsFor(data: Inputs, employeeId: number, category: LeaveCategory) {
  return data.requests.filter(row => row.employeeId === employeeId && leaveCategory(row) === category);
}
function balanceFor(data: Inputs, row: Assignment, approved: LeaveDates[]): LeaveAccount {
  return { category: row.policy.category, name: row.policy.name, policyId: row.policy.id, ...leaveBalance({
    terms: row.policy, enrollment: row.enrollment, hireDate: row.hireDate, calendar: data.calendar, today: data.today, approved,
    worked: data.worked.get(row.enrollment.employeeId) ?? new Map(),
  }) };
}

export async function readLeaveBalances(db: Database, scope: LeaveScope, now: number): Promise<EmployeeLeaveBalances[]> {
  const data = await leaveInputs(db, scope, now);
  const result = new Map<number, EmployeeLeaveBalances>();
  for (const row of data.assignments) {
    const employeeId = row.enrollment.employeeId;
    const current = result.get(employeeId) ?? {
      employeeId, verifiedWorkedSeconds: Math.round([...(data.worked.get(employeeId) ?? [])].reduce((sum, [date, seconds]) => date.startsWith(data.today.slice(0, 4)) ? sum + seconds : sum, 0)),
      balances: [],
    };
    current.balances.push(balanceFor(data, row, requestsFor(data, employeeId, row.policy.category)));
    result.set(employeeId, current);
  }
  return [...result.values()];
}

export async function requireLeaveAvailable(db: Database, ctx: Context, now: number, proposed: PaidRequest, replaced?: PaidRequest, staged: PaidRequest[] = []) {
  const category = leaveCategory(proposed);
  if (category === "unpaid") return;
  const employeeId = proposed.employeeId;
  const data = await leaveInputs(db, ownLeaveScope(ctx.activeActor(), employeeId), now);
  const requests = [...requestsFor(data, employeeId, category), ...staged.filter(row => row.employeeId === employeeId && leaveCategory(row) === category)];
  const old = replaced && leaveCategory(replaced) === category ? replaced : undefined;
  const other = old ? requests.filter(row => row.id !== old.id) : requests;
  // Unchanged or reduced coverage remains editable for legacy requests.
  const period = { start: proposed.startDate, end: proposed.endDate };
  const priorDays = approvedLeaveMinutesByDay(old ? [...other, old] : other, period);
  const revised = [...other, proposed];
  const revisedDays = approvedLeaveMinutesByDay(revised, period);
  const additionalDates = [...revisedDays].filter(([date, minutes]) => minutes > (priorDays.get(date) ?? 0)).map(([date]) => date);
  if (!additionalDates.length) return;
  const assigned = data.assignments.find(item => item.policy.category === category);
  if (!assigned) throw new AuthError(409, "Assign a " + leaveCategories[category].toLowerCase() + " policy before approving this request.");
  const usableFrom = leaveUsageStarts(assigned.policy, assigned.enrollment.startDate, assigned.hireDate);
  if (additionalDates.some(date => date < usableFrom)) throw new AuthError(409, "This policy is available from " + usableFrom + ".");
  if (balanceFor(data, assigned, revised).availableSeconds < 0) {
    throw new AuthError(409, "This employee does not have enough " + leaveCategories[category].toLowerCase() + " for these hours.");
  }
}
