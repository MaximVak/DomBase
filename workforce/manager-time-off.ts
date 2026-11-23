import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { AuthError, json, readAuthBody } from "../auth/http";
import * as s from "../db/schema";
import type { Context, Database } from "./context";
import { canonical, newRecordId } from "./contract";
import { leaveCategory, type LeaveCategory } from "./leave-duration";
import type { PtoRequest } from "./model";
import { timeOffDates } from "./time-off";
import { activeTimesheetLock, periodLockByDate, requireTimesheetUnlocked } from "./timesheet-lock-guards";
import { WorkspaceTransaction } from "./transaction";
import * as v from "./validation";

type Row = typeof s.ptoRequests.$inferSelect;
type LeaveSummary = { category: LeaveCategory; startDate: string; endDate: string; startTime: string | null; endTime: string | null };
type ManagerAction = "added" | "edited" | "cancelled";
type Revision = {
  id: string;
  action: ManagerAction | "approved" | "denied";
  actor: string;
  at: string;
  before?: LeaveSummary;
  after?: LeaveSummary;
  changed?: string[];
};
export type ManagerTimeOffRecord = LeaveSummary & {
  id: number; employeeId: number; status: PtoRequest["status"]; version: number; reason: PtoRequest["reason"]; explanation?: string;
};
export type ManagerTimeOffView = { record: ManagerTimeOffRecord; history: Revision[] };
export type ManagerTimeOffFields = LeaveSummary & { reason: PtoRequest["reason"]; explanation?: string };
export type ManagerTimeOffOperation = { action: "add"; employeeId: number; details: ManagerTimeOffFields }
  | { action: "edit"; requestId: number; version: number; details: ManagerTimeOffFields }
  | { action: "cancel"; requestId: number; version: number };

const historyActions = ["time_off.added", "time_off.edited", "time_off.cancelled"] as const;
const utcStamp = (value: string) => value.includes("T") ? value : value.replace(" ", "T") + "Z";
const summarize = (row: Pick<Row, "startDate" | "endDate" | "startTime" | "endTime" | "category" | "compensation">): LeaveSummary => ({
  category: leaveCategory(row), startDate: row.startDate, endDate: row.endDate, startTime: row.startTime, endTime: row.endTime,
});
const canReadExplanation = (ctx: Context, employeeId: number) =>
  ctx.account.employeeId === employeeId || (ctx.permissions["team.read"] && ctx.permissions["team.private.read"]);
const visibleRequest = (ctx: Context, id: number) => and(
  eq(s.ptoRequests.id, id), isNull(s.ptoRequests.archivedAt), ctx.employeeFilter(s.ptoRequests.employeeId), ctx.activeActor(),
)!;

async function readHistory(db: Database, ctx: Context, requestId: number): Promise<ManagerTimeOffView> {
  const scope = visibleRequest(ctx, requestId);
  const guarded = sql`EXISTS (SELECT 1 FROM pto_requests WHERE ${scope})`;
  const [[row], audit, decisions] = await db.batch([
    db.select().from(s.ptoRequests).where(scope).limit(1),
    db.select({ id: s.auditLog.id, actor: s.accounts.displayName, action: s.auditLog.action,
      at: s.auditLog.createdAt, metadata: s.auditLog.metadata, accountId: s.auditLog.actorAccountId }).from(s.auditLog)
      .leftJoin(s.accounts, eq(s.accounts.id, s.auditLog.actorAccountId))
      .where(and(eq(s.auditLog.entityType, "pto-request"), eq(s.auditLog.entityId, String(requestId)), inArray(s.auditLog.action, historyActions), guarded))
      .orderBy(desc(s.auditLog.id)).limit(50),
    db.select({ id: s.ptoDecisions.id, actor: s.accounts.displayName, at: s.ptoDecisions.createdAt,
      action: s.ptoDecisions.status, accountId: s.ptoDecisions.actorAccountId }).from(s.ptoDecisions)
      .leftJoin(s.accounts, eq(s.accounts.id, s.ptoDecisions.actorAccountId))
      .where(and(eq(s.ptoDecisions.requestId, requestId), guarded)).orderBy(desc(s.ptoDecisions.id)).limit(50),
  ]);
  if (!row) throw new AuthError(404, "Time off is outside your access or unavailable.");
  const history: Revision[] = audit.map(({ id, actor, action, at, metadata }) => ({
    id: `change-${id}`, actor: actor || "Former account", action: action.slice("time_off.".length) as ManagerAction, at: utcStamp(at),
    before: metadata.before as LeaveSummary | undefined, after: metadata.after as LeaveSummary | undefined,
    changed: metadata.changed as string[] | undefined,
  }));
  for (const decision of decisions) {
    if (audit.some(change => change.at === decision.at && change.accountId === decision.accountId &&
      ((change.action === "time_off.added" && decision.action === "approved") || (change.action === "time_off.cancelled" && decision.action === "cancelled")))) continue;
    history.push({ id: `decision-${decision.id}`, actor: decision.actor || "Former account", at: utcStamp(decision.at), action: decision.action });
  }
  history.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { record: { ...summarize(row), id: row.id, employeeId: row.employeeId, version: row.version, status: row.status,
    reason: row.reason, explanation: canReadExplanation(ctx, row.employeeId) ? row.explanation : undefined }, history };
}

async function applyChange(db: Database, ctx: Context, body: Record<string, unknown>, secret: string, now: number) {
  ctx.requirePermission("time_off.approve");
  const action = v.oneOf(body.action, ["add", "edit", "cancel"]);
  v.keys(body, ["id", "revision", "action", ...(action === "add" ? ["employeeId", "details"] : action === "edit" ? ["requestId", "version", "details"] : ["requestId", "version"])]);
  if (action === "add") ctx.requirePermission("schedule.read");
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
  const id = body.id;
  const revision = v.integer(body.revision, 0);
  const workerId = action === "add" ? v.integer(body.employeeId) : null;
  const requestedId = action === "add" ? null : v.integer(body.requestId);
  const version = action === "add" ? null : v.integer(body.version);
  const details = action === "cancel" ? null : v.object(body.details);
  if (details) v.keys(details, ["category", "startDate", "endDate", "startTime", "endTime", "reason", "explanation"]);
  const dates = details ? timeOffDates(details) : null;
  const category = details ? v.oneOf(details.category, ["pto", "sick", "unpaid"]) : null;
  const reason = details ? v.oneOf(details.reason, ["sick_emergency", "vacation"]) : null;
  const explanation = details?.explanation === undefined ? undefined : v.text(details.explanation, 1000);
  const hash = `manager-time-off:${rateKey(secret, canonical({ action, workerId, requestedId, version, dates, category, reason, explanation }))}`;
  async function saved() {
    const [receipt] = await db.select({ accountId: s.workforceCommits.accountId, bodyHash: s.workforceCommits.bodyHash }).from(s.workforceCommits)
      .where(and(eq(s.workforceCommits.id, id), ctx.activeActor())).limit(1);
    if (!receipt) return false;
    if (receipt.accountId !== ctx.account.id || receipt.bodyHash !== hash) throw new AuthError(409, "This save identifier is already in use.");
    return true;
  }
  if (await saved()) return { saved: true };
  const stored = requestedId === null ? null : (await db.select().from(s.ptoRequests).where(visibleRequest(ctx, requestedId)).limit(1))[0];
  if (requestedId !== null && !stored) throw new AuthError(404, "Time off is outside your access or unavailable.");
  if (stored && (stored.status !== "approved" || stored.version !== version)) throw new AuthError(409, "This approved request changed. Reload it before saving.");
  const employeeId = stored?.employeeId ?? workerId!;
  const [person] = await db.select({ active: s.employees.active, terminated: s.employees.terminated }).from(s.employees)
    .where(and(eq(s.employees.id, employeeId), ctx.employeeFilter(s.employees.id), ctx.activeActor())).limit(1);
  if (!person) throw new AuthError(404, "Employee is outside your access or unavailable.");
  if (action === "add" && (!person.active || person.terminated)) throw new AuthError(409, "Choose an active employee.");
  if (ctx.account.employeeId === employeeId && ctx.account.accessLevel !== "owner") throw new AuthError(403, "Ask another authorized manager to change your time off.");
  if (explanation !== undefined && stored && !canReadExplanation(ctx, employeeId)) throw new AuthError(403, "You do not have access to change the employee’s explanation.");
  const compensation = category === null ? null : category === "unpaid" ? "unpaid" : "paid";
  const previous = stored ? summarize(stored) : undefined;
  const next = dates && category ? { ...dates, category } : undefined;
  const changeFields = stored && next ? [
    ...Object.keys(next).filter(key => next[key as keyof LeaveSummary] !== previous?.[key as keyof LeaveSummary]),
    ...(reason !== stored.reason ? ["reason"] : []),
    ...(explanation !== undefined && explanation !== stored.explanation ? ["explanation"] : []),
  ] : undefined;
  if (action === "edit" && !changeFields?.length) throw new AuthError(400, "Change a request detail before saving.");

  // Either paid version makes both the original and proposed ranges relevant.
  const lock = stored?.compensation === "paid" || compensation === "paid" ? or(
    stored ? periodLockByDate(stored.startDate, stored.endDate) : undefined,
    dates ? periodLockByDate(dates.startDate, dates.endDate) : undefined,
  ) : undefined;
  if (lock) await requireTimesheetUnlocked(db, lock);
  const unlocked = lock ? sql`NOT EXISTS (SELECT 1 FROM timesheet_lock_events l WHERE (${lock}) AND ${activeTimesheetLock})` : sql`1 = 1`;
  const tx = new WorkspaceTransaction(db, { account: ctx.account, activeActor: () => sql`${ctx.activeActor()} AND ${unlocked}
    AND NOT EXISTS (SELECT 1 FROM workforce_commits WHERE id = ${id})` }, id, new Date(now).toISOString());
  const requestId = stored?.id ?? newRecordId();
  const editable = sql`id = ${requestId} AND version = ${version} AND status = 'approved' AND archived_at IS NULL AND ${ctx.employeeFilter(s.ptoRequests.employeeId)}`;
  const decision = action === "add" ? "approved" : action === "cancel" ? "cancelled" : null;
  if (!stored) {
    tx.insert(s.ptoRequests, { ...dates, id: requestId, employeeId, compensation, category, reason, explanation: explanation ?? "",
      status: "approved", requestedAt: tx.stamp, decidedAt: tx.stamp, decidedByAccountId: ctx.account.id },
      sql`EXISTS (SELECT 1 FROM employees WHERE id = ${employeeId} AND active = 1 AND terminated = 0 AND ${ctx.employeeFilter(s.employees.id)})`);
  } else if (action === "edit") {
    tx.update(s.ptoRequests, { ...dates, category, compensation, reason, ...(explanation !== undefined ? { explanation } : {}), version: stored.version + 1 }, editable);
  } else {
    tx.update(s.ptoRequests, { status: "cancelled", decidedAt: tx.stamp, decidedByAccountId: ctx.account.id, version: stored.version + 1 }, editable);
  }
  if (decision) tx.insert(s.ptoDecisions, { requestId, status: decision, actorAccountId: ctx.account.id, createdAt: tx.stamp });
  tx.insert(s.auditLog, { actorAccountId: ctx.account.id, employeeId, action: action === "add" ? "time_off.added" : action === "edit" ? "time_off.edited" : "time_off.cancelled",
    entityType: "pto-request", entityId: String(requestId), metadata: { before: previous, after: next, changed: changeFields }, createdAt: tx.stamp });
  if (await tx.commit(revision, hash, ["pto-request"]) || await saved()) return { saved: true };
  if (lock) await requireTimesheetUnlocked(db, lock);
  throw new AuthError(409, "Shared data changed. Reload the latest data before saving.");
}

export async function handleManagerTimeOff(db: Database, ctx: Context, request: Request, secret: string, now: number) {
  ctx.requirePermission("time_off.read");
  const params = new URL(request.url).searchParams;
  if (request.method === "GET") {
    if (params.size !== 1 || params.getAll("request").length !== 1) throw new AuthError(400, "Choose one time-off request.");
    return json(await readHistory(db, ctx, v.integer(Number(params.get("request")))));
  }
  if (request.method === "POST") {
    if (params.size) throw new AuthError(400, "Choose the time-off action in the request body.");
    return json(await applyChange(db, ctx, await readAuthBody(request, 8192), secret, now));
  }
  return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
}
