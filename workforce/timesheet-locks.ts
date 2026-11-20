import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { AuthError, json, readAuthBody } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import * as s from "../db/schema";
import { defaultPayCalendar, periodFor } from "../team/rules";
import { workDate } from "../app/timesheets-model";
import { canonical } from "./contract";
import type { Context, Database } from "./context";
import { workspacePeriod, offsetDate } from "./period";
import type { WorkspacePeriod } from "./period";
import { requireOtherEmployee } from "./self-edit";
import { zonedTimestamp } from "./time";
import { activeTimesheetLock, periodLockByDate, requireTimesheetUnlocked } from "./timesheet-lock-guards";
import type { LockEvent, TimesheetLocks } from "./timesheet-lock-types";
import { clockReviewGuard, readTimesheetReviewState } from "./timesheet-review";
import { reviewBatchLimit } from "./timesheet-review-types";
import { WorkspaceTransaction } from "./transaction";
import * as v from "./validation";

type Options = { secret: string; fieldKey: string; now: number };
type LockRow = Omit<typeof s.timesheetLockEvents.$inferInsert, "id" | "actorAccountId" | "action" | "createdAt">;
type StoredLocks = TimesheetLocks & { active: (LockEvent & { roleId: number | null })[] };
const scope = (ctx: Context) => sql`(l.employee_id IS NULL OR (${ctx.employeeFilter(sql`l.employee_id`)} AND ${ctx.roleFilter(sql`l.role_id`)}))`;
const periodKey = ({ start, end }: WorkspacePeriod) => `period:${start}:${end}`;
const canManageLocks = (ctx: Context) => ctx.permissions["timesheets.lock"] && ctx.permissions["timesheets.manage"];

async function readLocks(db: Database, ctx: Context, range: WorkspacePeriod, now: number): Promise<StoredLocks> {
  const locks = alias(s.timesheetLockEvents, "l");
  const [state, calendar, business, rows] = await db.batch([
    db.select({ revision: s.workforceState.revision }).from(s.workforceState).limit(1),
    db.select({ payPeriod: s.teamSettings.payPeriod, anchorDate: s.teamSettings.anchorDate }).from(s.teamSettings).limit(1),
    db.select({ zone: s.business.timeZone }).from(s.business).limit(1),
    db.select({ id: locks.id, targetKey: locks.targetKey, employeeId: locks.employeeId, roleId: locks.roleId,
      startDate: locks.startDate, endDate: locks.endDate, startsAt: locks.startsAt, endsAt: locks.endsAt,
      action: locks.action, actor: s.accounts.displayName, at: locks.createdAt, locked: sql<number>`CASE WHEN ${activeTimesheetLock} THEN 1 ELSE 0 END` })
      .from(locks).innerJoin(s.accounts, eq(s.accounts.id, locks.actorAccountId))
      .where(sql`((${locks.startDate} <= ${range.end} AND ${locks.endDate} >= ${range.start}) OR
        (${locks.employeeId} IS NULL AND ${locks.startDate} <= ${offsetDate(range.end, 1)} AND ${locks.endDate} >= ${offsetDate(range.start, -1)}))
        AND ${scope(ctx)}`).orderBy(sql`${locks.id} DESC`),
  ]);
  const { payPeriod, anchorDate } = calendar[0] ?? defaultPayCalendar;
  const scheduled = periodFor(range.start, payPeriod, anchorDate);
  const today = workDate(now, business[0]?.zone ?? "America/Los_Angeles");
  const canLockPeriod = canManageLocks(ctx) && ctx.allDepartments && range.start === scheduled.start && range.end === scheduled.end && range.end < today;
  const history = rows.filter(row => row.startDate <= range.end && row.endDate >= range.start)
    .map(({ id, targetKey, employeeId, startDate, endDate, startsAt, endsAt, action, actor, at }) =>
      ({ id, targetKey, employeeId, startDate, endDate, startsAt, endsAt, action, actor, at }));
  return { revision: state[0]?.revision ?? 0, canLockPeriod, active: rows.filter(row => row.locked), history };
}

export async function handleTimesheetLocks(db: Database, ctx: Context, request: Request, options: Options): Promise<Response> {
  ctx.requirePermission("timesheets.read");
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.size !== 2) throw new AuthError(400, "Choose a start and end date for time-card locks.");
    const range = workspacePeriod({ start: url.searchParams.get("start"), end: url.searchParams.get("end") }, options.now);
    return json(await readLocks(db, ctx, range, options.now));
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  ctx.requirePermission("timesheets.manage");
  ctx.requirePermission("timesheets.lock");
  if (url.search) throw new AuthError(400, "Choose lock options in the request body.");
  const body = await readAuthBody(request, 200000);
  v.keys(body, ["id", "range", "action", "targets", "revision"]);
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid lock identifier.");
  const { id } = body;
  const action = v.oneOf(body.action, ["lock", "unlock"] as const);
  const revision = v.integer(body.revision, 0);
  const range = workspacePeriod(body.range, options.now);
  const targets = v.list(body.targets, reviewBatchLimit).map(value => v.text(value, 100, true));
  if (new Set(targets).size !== targets.length) throw new AuthError(400, "Choose each time card once.");
  if (targets.length && range.end > offsetDate(range.start, 30)) throw new AuthError(400, "Choose up to 31 days when locking or unlocking time cards.");
  if (!targets.length && !ctx.allDepartments) throw new AuthError(403, "Pay-period locks require company-wide access.");

  const hash = rateKey(options.secret, canonical(body));
  const [receipt] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, id)).limit(1);
  if (receipt) {
    if (receipt.accountId !== ctx.account.id || receipt.bodyHash !== hash) throw new AuthError(409, "This identifier is already in use.");
    return json({ saved: true, count: targets.length || 1 });
  }

  const state = await readLocks(db, ctx, range, options.now);
  if (state.revision !== revision) throw new AuthError(409, "Timesheets changed. Refresh the time cards before changing locks.");
  const active = new Map(state.active.map(row => [row.targetKey, row]));
  const period = active.get(periodKey(range));
  const tx = new WorkspaceTransaction(db, ctx, id, new Date(options.now).toISOString());
  let rows: LockRow[];
  let guard = sql`1 = 1`;
  if (action === "unlock") {
    rows = (targets.length ? targets.map(key => active.get(key)) : [period]).map(lock => {
      if (!lock || targets.length && lock.employeeId === null) throw new AuthError(409, "A selected time card or pay period is already unlocked or outside your access.");
      if (lock.employeeId !== null) requireOtherEmployee(ctx, lock.employeeId);
      return lock;
    });
  } else {
    if (!targets.length) {
      if (!state.canLockPeriod) throw new AuthError(409, "Select a completed company pay period to lock it.");
      await requireTimesheetUnlocked(db, periodLockByDate(range.start, range.end));
    }
    const { items, stamp, timeZone } = await readTimesheetReviewState(db, ctx, range, options, false);
    if (stamp.revision !== revision) throw new AuthError(409, "Timesheets changed. Refresh the time cards before changing locks.");
    guard = clockReviewGuard(stamp);
    if (targets.length) {
      const itemsByKey = new Map(items.map(item => [item.key, item]));
      const roles = new Map((await db.select({ id: s.roles.id, name: s.roles.name }).from(s.roles)).map(row => [row.name, row.id]));
      rows = targets.map(targetKey => {
        const item = itemsByKey.get(targetKey);
        if (!item) throw new AuthError(403, "A selected time card is unavailable or outside your access.");
        requireOtherEmployee(ctx, item.employeeId);
        if (active.has(targetKey)) throw new AuthError(409, "A selected time card is already locked. Refresh Timesheets.");
        if (!item.lockable || !item.end) throw new AuthError(409, "Close the time card and resolve pending clock reports before locking it.");
        const end = item.end;
        if (state.active.some(lock => lock.employeeId === null && lock.startsAt < end && lock.endsAt > item.start)) throw new AuthError(409, "The selected card is already protected by a locked pay period.");
        return { targetKey, employeeId: item.employeeId, roleId: roles.get(item.role) ?? null,
          startDate: workDate(item.start, timeZone), endDate: workDate(Date.parse(item.end) - 1, timeZone), startsAt: item.start, endsAt: item.end };
      });
    } else {
      if (items.some(item => !item.lockable)) throw new AuthError(409, "Close open time cards and resolve pending clock reports before locking this pay period.");
      rows = [{ targetKey: periodKey(range), employeeId: null, roleId: null, startDate: range.start, endDate: range.end,
        startsAt: new Date(zonedTimestamp(range.start, "00:00", timeZone)).toISOString(),
        endsAt: new Date(zonedTimestamp(offsetDate(range.end, 1), "00:00", timeZone)).toISOString() }];
    }
  }
  for (let index = 0; index < rows.length; index += 100) {
    tx.insertRows(s.timesheetLockEvents, rows.slice(index, index + 100).map(row => ({ targetKey: row.targetKey, employeeId: row.employeeId,
      roleId: row.roleId ?? null, startDate: row.startDate, endDate: row.endDate, startsAt: row.startsAt, endsAt: row.endsAt,
      actorAccountId: ctx.account.id, action, createdAt: tx.stamp })), guard);
  }
  try {
    if (await tx.commit(revision, hash, ["timesheet-lock"])) return json({ saved: true, count: rows.length });
  } catch (error) {
    if (!`${String(error)} ${error instanceof Error ? String(error.cause ?? "") : ""}`.includes("workforce_write_checks")) throw error;
  }
  throw new AuthError(409, "Time records or access changed. Refresh Timesheets before changing locks.");
}
