import { and, eq, sql } from "drizzle-orm";
import { AuthError, json, readAuthBody } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { addDays, buildTimeCards, weekStartFor, workTimestamp } from "../app/timesheets-model";
import type { TimeCard } from "../app/timesheets-model";
import * as s from "../db/schema";
import { canonical, newRecordId } from "./contract";
import type { WorkspaceData } from "./contract";
import type { Context, Database } from "./context";
import { workspacePeriod } from "./period";
import type { WorkspacePeriod } from "./period";
import { requireOtherEmployee } from "./self-edit";
import { workspaceSnapshot } from "./snapshot";
import { noShowReasons, reviewBatchLimit } from "./timesheet-review-types";
import type { ReviewItem, TimesheetReview } from "./timesheet-review-types";
import { WorkspaceTransaction } from "./transaction";
import * as v from "./validation";
import { timesheetCardKey } from "./timesheet-lock-types";
import { periodLockByDate, requireTimesheetUnlocked } from "./timesheet-lock-guards";

type Options = { secret: string; fieldKey: string; now: number };
type Shift = { id: number; employeeId: number; date: string; start: string; end: string; role: string; version: number };
type Candidate = Omit<ReviewItem, "status" | "allowedAction" | "decision"> & { blocked?: boolean };
const punchStamp = sql`(SELECT COALESCE(MAX(id), 0) FROM clock_events)`;
const reportStamp = sql`(SELECT count(*) FROM assisted_clock_reports)`;
const revisionStamp = sql`(SELECT revision FROM workforce_state WHERE id = 1)`;
const reviewActions = ["approve", "resolve", "no_show"] as const;
const blockedIssues = new Set(["Missing clock-out", "Clock time needs review", "Confirm unfinished break", "Confirm time and breaks before calculating premiums"]);
const payReviewWarnings = new Set([
  "Review changes between hourly or salary rates", "Review overtime in company-wide Timesheets", "Review the workweek overtime rate",
  "Review premiums in company-wide Timesheets", "Review salaried break premium", "Review break premium wage rate",
  "Confirm time and breaks before calculating premiums",
]);

function readStamp(db: Database) {
  return db.get<{ clock: number; reports: number; revision: number }>(sql`SELECT ${punchStamp} AS clock, ${reportStamp} AS reports, ${revisionStamp} AS revision`);
}

function readShifts(db: Database, ctx: Context, period: WorkspacePeriod) {
  return db.select({ id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime,
    end: s.shifts.endTime, role: sql<string>`COALESCE(NULLIF(${s.shifts.roleName}, ''), ${s.roles.name}, '')`.as("review_role"), version: s.shifts.version })
    .from(s.shifts).leftJoin(s.roles, eq(s.shifts.roleId, s.roles.id))
    .where(and(ctx.employeeFilter(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId), sql`
      ${s.shifts.date} BETWEEN ${period.start} AND ${period.end} AND ${s.shifts.publicationId} IS NOT NULL
      AND ${s.shifts.archivedAt} IS NULL AND ${s.shifts.shiftType} = 'work'`));
}

function shiftInterval(shift: Shift, zone: string) {
  const start = workTimestamp(shift.date, shift.start, zone);
  const end = workTimestamp(shift.end <= shift.start ? addDays(shift.date, 1) : shift.date, shift.end, zone);
  return { start, end };
}
const intersects = (start: number, end: number, other: { start: number; end: number }) => Math.max(start, other.start) < Math.min(end, other.end);

function cardCandidates(view: WorkspaceData, shifts: Shift[], range: WorkspacePeriod, options: Options) {
  const state = view.state, policy = view.settings, zone = view.basicInfo.timeZone;
  const start = weekStartFor(addDays(range.start, -1), policy.workWeekStart);
  const end = addDays(weekStartFor(addDays(range.end, 1), policy.workWeekStart), 6);
  const workweek = { companyWide: view.scheduleEstimateScopeComplete === true, dataPeriod: view.period };
  const cards = buildTimeCards({
    employees: state.employees, shifts, events: state.clockEvents, adjustments: state.hoursAdjustments, pto: state.ptoRequests,
    start, end, now: options.now, timeZone: zone, rounding: "actual", weekStart: policy.workWeekStart,
    mandatoryMealBreak: policy.mandatoryMealBreak, mealBreakAfterHours: policy.mealBreakAfterHours, mealBreakMinutes: policy.mealBreakMinutes,
    overtimePolicy: policy, overtimeScope: workweek,
    breakPremiumPolicy: policy.breakPremiums ? { ...workweek, mealLimit: policy.mealPremiumLimit, restLimit: policy.restPremiumLimit } : undefined,
  });
  const bySession = new Map<number, TimeCard[]>();
  const employees = new Map(state.employees.map(employee => [employee.id, employee]));
  const byEvent = new Map(state.clockEvents.map(event => [event.id, event]));
  const departments = new Map(state.departments.flatMap(dept => dept.roles.map(role => [role, dept.name] as const)));
  const byAssignment = new Map<string, { start: number; end: number }[]>();
  for (const shift of shifts) {
    const key = `${shift.employeeId}:${shift.role}`;
    const assignment = byAssignment.get(key) ?? [];
    assignment.push(shiftInterval(shift, zone));
    byAssignment.set(key, assignment);
  }
  for (const card of cards) {
    if (!card.start || !card.eventIds.length) continue;
    const session = bySession.get(card.eventIds[0]) ?? [];
    session.push(card);
    bySession.set(card.eventIds[0], session);
  }
  const result: Candidate[] = [];
  const work: { employeeId: number; start: number; end: number }[] = [];
  for (const [firstEventId, session] of bySession) {
    const visible = session.filter(card => card.date >= range.start && card.date <= range.end);
    const first = session[0], employee = employees.get(first.employeeId);
    if (!employee || !first.start) continue;
    work.push({ employeeId: employee.id, start: Date.parse(first.start), end: first.end ? Date.parse(first.end) : options.now });
    if (!visible.length) continue;
    const events = first.eventIds.flatMap(id => byEvent.get(id) ?? []);
    const elapsed = Date.parse(first.end ?? "") - Date.parse(first.start);
    // Payroll and wage-scope warnings remain in the ledger. Card review applies
    // the same clock evidence even when the reviewer cannot read wages.
    const issues = [...new Set(session.flatMap(card => card.issues))].filter(issue => !payReviewWarnings.has(issue));
    if (employee.locationSettings.includeInTimeClockErrors && first.end
      && !(byAssignment.get(`${employee.id}:${first.role}`) ?? []).some(shift => intersects(Date.parse(first.start!), Date.parse(first.end!), shift))) issues.push("Unscheduled time");
    const unconfirmedBreakRecord = policy.breakPremiums && events.every(event => !event.clockDetails?.california && !event.clockDetails?.breakKind);
    if (unconfirmedBreakRecord && !issues.includes("Confirm time and breaks before calculating premiums")) issues.push("Confirm time and breaks before calculating premiums");
    const blocked = !first.end || elapsed <= 0 || elapsed > 24 * 3600000 || unconfirmedBreakRecord ||
      issues.some(issue => blockedIssues.has(issue)) || events.some(event => event.automatic && !event.assistedStatus);
    const key = timesheetCardKey(employee.id, firstEventId, events[0]?.cardId);
    const facts = events.map(event => [event.id, event.type, event.at, event.automatic, event.assistedStatus, event.clockDetails]);
    const version = rateKey(options.secret, canonical([key, first.role, facts, [...issues].sort(), blocked]));
    result.push({ key, version, kind: "card", employeeId: employee.id, employee: employee.name, role: first.role,
      department: departments.get(first.role) ?? "Unassigned", date: visible[0].date, start: first.start, end: first.end,
      firstEventId, lockable: elapsed > 0 && elapsed <= 24 * 3600000 && !events.some(event => event.assistedStatus === "pending"),
      workedMinutes: Math.round(visible.reduce((sum, card) => sum + (card.metrics.actual ?? 0), 0) * 60), issues, blocked });
  }
  return { cards: result, work };
}

async function noShowCandidates(db: Database, ctx: Context, view: WorkspaceData, shifts: Shift[], range: WorkspacePeriod, options: Options, work: { employeeId: number; start: number; end: number }[]): Promise<Candidate[]> {
  if (!shifts.length || !ctx.permissions["schedule.read"]) return [];
  const zone = view.basicInfo.timeZone;
  const state = view.state;
  const byEmployee = new Map(state.employees.map(employee => [employee.id, employee]));
  const departments = new Map(state.departments.flatMap(dept => dept.roles.map(role => [role, dept.name] as const)));
  const window = { start: addDays(range.start, -1), end: addDays(range.end, 1) };
  // The review only consumes absence/adjustment dates. Leave reasons and pay
  // amounts are never returned from this path.
  const [leave, adjustments] = await db.batch([
    db.select({ employeeId: s.ptoRequests.employeeId, start: s.ptoRequests.startDate, end: s.ptoRequests.endDate })
      .from(s.ptoRequests).where(and(ctx.employeeFilter(s.ptoRequests.employeeId), sql`${s.ptoRequests.status}='approved'
        AND ${s.ptoRequests.archivedAt} IS NULL AND ${s.ptoRequests.startDate} <= ${window.end} AND ${s.ptoRequests.endDate} >= ${window.start}`)),
    db.select({ employeeId: s.hoursAdjustments.employeeId, date: s.hoursAdjustments.date })
      .from(s.hoursAdjustments).where(and(ctx.employeeFilter(s.hoursAdjustments.employeeId), sql`${s.hoursAdjustments.date} BETWEEN ${window.start} AND ${window.end}`)),
  ]);
  const result: Candidate[] = [];
  for (const shift of shifts) {
    if (shift.date < range.start || shift.date > range.end) continue;
    const employee = byEmployee.get(shift.employeeId);
    const interval = shiftInterval(shift, zone);
    if (!employee?.active || !employee.locationSettings.includeInTimeClockErrors || !Number.isFinite(interval.end)
      || interval.start >= interval.end || interval.end > options.now) continue;
    const endDate = shift.end <= shift.start ? addDays(shift.date, 1) : shift.date;
    if (leave.some(row => row.employeeId === employee.id && row.start <= endDate && row.end >= shift.date)
      || adjustments.some(row => row.employeeId === employee.id && row.date >= shift.date && row.date <= endDate)
      || work.some(row => row.employeeId === employee.id && intersects(row.start, row.end, interval))) continue;
    const key = `shift:${shift.id}`;
    const version = rateKey(options.secret, canonical([key, employee.id, shift.version, shift.date, shift.role, interval]));
    result.push({ key, version, kind: "no-show", employeeId: employee.id, employee: employee.name, role: shift.role,
      department: departments.get(shift.role) ?? "Unassigned", date: shift.date, start: new Date(interval.start).toISOString(),
      end: new Date(interval.end).toISOString(), issues: ["No-show"] });
  }
  return result;
}

export function clockReviewGuard(stamp: { clock: number; reports: number }) {
  return sql`${punchStamp} = ${stamp.clock} AND ${reportStamp} = ${stamp.reports}`;
}

export async function readTimesheetReviewState(db: Database, ctx: Context, range: WorkspacePeriod, options: Options, includeNoShows = true) {
  const expanded = { start: addDays(range.start, -8), end: addDays(range.end, 8) };
  const initial = await readStamp(db);
  const [view, shifts] = await Promise.all([workspaceSnapshot(db, ctx, options.fieldKey, expanded), readShifts(db, ctx, expanded)]);
  const { cards, work } = cardCandidates(view, shifts, range, options);
  const absences = includeNoShows ? await noShowCandidates(db, ctx, view, shifts, range, options, work) : [];
  const candidates = [...cards, ...absences];
  const targetKeys = JSON.stringify(candidates.map(item => item.key));
  const recorded = candidates.length ? await db.select({ review: s.timesheetReviews, actor: s.accounts.displayName }).from(s.timesheetReviews)
    .innerJoin(s.accounts, eq(s.accounts.id, s.timesheetReviews.actorAccountId))
    .where(sql`${s.timesheetReviews.targetKey} IN (SELECT value FROM json_each(${targetKeys}))`) : [];
  const stamp = await readStamp(db);
  if (!initial || !stamp || initial.clock !== stamp.clock || initial.reports !== stamp.reports || initial.revision !== stamp.revision || stamp.revision !== view.revision) {
    throw new AuthError(409, "Time records changed. Refresh Timesheets and review them again.");
  }
  const decisions = new Map(recorded.map(row => [`${row.review.targetKey}:${row.review.targetVersion}:${row.review.action}`, row]));
  const canManage = ctx.permissions["timesheets.manage"];
  const items = candidates.map(({ blocked, ...item }): ReviewItem => {
    const record = (action: string) => decisions.get(`${item.key}:${item.version}:${action}`);
    const approved = record("approve"), resolved = record("resolve"), absence = record("no_show");
    const decided = approved ?? absence ?? resolved;
    const own = ctx.account.accessLevel !== "owner" && ctx.account.employeeId === item.employeeId;
    const status = approved ? "approved" : absence ? "resolved-no-show"
      : item.kind === "no-show" || blocked || (item.issues.length && !resolved) ? "needs-review" : "ready";
    let allowedAction: ReviewItem["allowedAction"];
    if (canManage && !own) {
      if (status === "ready") allowedAction = "approve";
      if (status === "needs-review" && !blocked) allowedAction = item.kind === "card" ? "resolve" : "no_show";
    }
    return { ...item, status, allowedAction, ...(decided ? { decision: { actor: decided.actor, at: decided.review.createdAt,
      reason: decided.review.reason, note: decided.review.note } } : {}) };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
  return { items, stamp, timeZone: view.basicInfo.timeZone };
}

export async function handleTimesheetReview(db: Database, ctx: Context, request: Request, options: Options): Promise<Response> {
  ctx.requirePermission("timesheets.read");
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.size !== 2) throw new AuthError(400, "Choose a start and end date for review.");
    const range = reviewPeriod({ start: url.searchParams.get("start"), end: url.searchParams.get("end") }, options.now);
    const state: TimesheetReview = { items: (await readTimesheetReviewState(db, ctx, range, options)).items };
    return json(state);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  ctx.requirePermission("timesheets.manage");
  if (url.search) throw new AuthError(400, "Choose review options in the request body.");
  const body = await readAuthBody(request, 350000);
  v.keys(body, ["id", "period", "action", "targets", "reason", "note"]);
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid review identifier.");
  const id = body.id, action = v.oneOf(body.action, reviewActions);
  const period = reviewPeriod(body.period, options.now);
  const reason = action === "no_show" ? v.oneOf(body.reason, noShowReasons) : "";
  const note = action === "no_show" ? v.text(body.note ?? "", 1000) : "";
  if (action !== "no_show" && (body.reason !== undefined || body.note !== undefined)) throw new AuthError(400, "Reasons and notes belong to no-show decisions.");
  const targets = v.list(body.targets, reviewBatchLimit).map(value => {
    const target = v.object(value); v.keys(target, ["key", "version"]);
    return { key: v.text(target.key, 100, true), version: v.text(target.version, 64, true) };
  });
  if (!targets.length || (action === "no_show" && targets.length !== 1) || new Set(targets.map(target => target.key)).size !== targets.length) {
    throw new AuthError(400, "Choose time cards or one missed shift to review.");
  }
  const hash = rateKey(options.secret, canonical(body));
  const [receipt] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, id)).limit(1);
  if (receipt) {
    if (receipt.accountId !== ctx.account.id || receipt.bodyHash !== hash) throw new AuthError(409, "This identifier is already in use.");
    return json({ saved: true, count: targets.length });
  }
  const { items, stamp } = await readTimesheetReviewState(db, ctx, period, options);
  if (action === "no_show") {
    const item = items.find(candidate => candidate.key === targets[0].key);
    if (item) await requireTimesheetUnlocked(db, periodLockByDate(item.date));
  }
  const byKey = new Map(items.map(item => [item.key, item]));
  const tx = new WorkspaceTransaction(db, ctx, id, new Date(options.now).toISOString());
  const rows = targets.map(target => {
    const item = byKey.get(target.key);
    if (!item || item.version !== target.version) throw new AuthError(409, "A selected record changed or is outside your scope. Refresh and review it again.");
    requireOtherEmployee(ctx, item.employeeId);
    if (item.allowedAction !== action) throw new AuthError(409, "A selected record still needs attention or has already been reviewed.");
    return { id: newRecordId(), targetKey: item.key, targetVersion: item.version, employeeId: item.employeeId,
      workDate: item.date, actorAccountId: ctx.account.id, action, reason, note, createdAt: tx.stamp };
  });
  const guard = clockReviewGuard(stamp);
  for (let index = 0; index < rows.length; index += 100) tx.insertRows(s.timesheetReviews, rows.slice(index, index + 100), guard);
  try {
    if (await tx.commit(stamp.revision, hash, ["timesheet-review"])) return json({ saved: true, count: rows.length });
  } catch (error) {
    const detail = [String(error), error instanceof Error ? String(error.cause ?? "") : ""].join(" ");
    if (!detail.includes("workforce_write_checks")) throw error;
  }
  throw new AuthError(409, "Time records or access changed. Refresh and review the selected cards again.");
}

function reviewPeriod(value: unknown, now: number) {
  const period = workspacePeriod(value, now);
  if (period.end > addDays(period.start, 30)) throw new AuthError(400, "Choose a review range of at most 31 days.");
  return period;
}
