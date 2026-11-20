import { sql } from "drizzle-orm";
import { AuthError } from "../auth/http";
import { clockPolicy } from "../kiosk/break-actions";
import { parseReportedTime } from "../kiosk/assistance";
import { atomicBatch } from "../kiosk/database";
import type { Context, Database } from "./context";
import * as v from "./validation";

const reportScope = (ctx: Context) => sql`${ctx.employeeFilter(sql`e.employee_id`)}
  AND ${ctx.roleFilter(sql`COALESCE(sh.role_id, (SELECT CASE WHEN COUNT(*)=1 THEN MIN(r.id) END FROM roles r WHERE r.name=e.role_name))`)}
  AND ${ctx.activeActor()} AND (${ctx.account.accessLevel === "owner" ? 1 : 0}=1 OR e.employee_id IS NOT ${ctx.account.employeeId})`;
const notReplaced = sql`NOT EXISTS (SELECT 1 FROM time_card_edits edit, json_each(edit."before",'$.eventIds') removed
  WHERE edit.employee_id=e.employee_id AND removed.value=e.id)`;
const reviewFrom = sql`FROM assisted_clock_reports a JOIN clock_events e ON e.id=a.event_id
  JOIN employees staff ON staff.id=e.employee_id LEFT JOIN shifts sh ON sh.id=e.shift_id`;

type Row = { id: number; employee: string; kind: "in" | "out"; requestedAt: string; submittedAt: string; rawAt: string; reason: string };

export async function countAssistedClocks(db: Database, ctx: Context) {
  ctx.requirePermission("timesheets.read"); ctx.requirePermission("timesheets.manage");
  const result = await db.get<{ count: number }>(sql`SELECT COUNT(*) AS count ${reviewFrom}
    WHERE a.status='pending' AND ${reportScope(ctx)} AND ${notReplaced}`);
  return result?.count ?? 0;
}

export async function readAssistedClocks(db: Database, ctx: Context) {
  ctx.requirePermission("timesheets.read"); ctx.requirePermission("timesheets.manage");
  const [rows, policy] = await Promise.all([
    db.all<Row>(sql`SELECT e.id,staff.name AS employee,e.event_type AS kind,a.requested_at AS requestedAt,a.submitted_at AS submittedAt,e.occurred_at AS rawAt,a.reason
      ${reviewFrom} WHERE a.status='pending' AND ${reportScope(ctx)} AND ${notReplaced}
      ORDER BY a.submitted_at DESC,e.id DESC LIMIT 100`),
    clockPolicy(db),
  ]);
  return { requests: rows, zone: policy.zone };
}

export async function decideAssistedClock(db: Database, ctx: Context, body: Record<string, unknown>, now: number) {
  ctx.requirePermission("timesheets.read"); ctx.requirePermission("timesheets.manage");
  v.keys(body, ["id", "action", "actual"]);
  const id = v.integer(body.id);
  const action = v.oneOf(body.action, ["approve", "edit"] as const);
  if (action === "approve" && body.actual !== undefined) throw new AuthError(400, "Choose edit to change a reported time.");
  const row = await db.get<{ requestedAt: string }>(sql`SELECT a.requested_at AS requestedAt ${reviewFrom}
    WHERE e.id=${id} AND a.status='pending' AND ${reportScope(ctx)} AND ${notReplaced}`);
  if (!row) throw new AuthError(404, "This clock report is unavailable or already reviewed.");
  const zone = (await clockPolicy(db)).zone;
  const chosen = action === "edit" ? parseReportedTime(body.actual, zone) : Date.parse(row.requestedAt);
  if (!Number.isFinite(chosen) || chosen > now) throw new AuthError(422, "Choose a valid time before now.");
  const time = new Date(chosen).toISOString();
  const stamp = new Date(now).toISOString();
  const effective = sql`COALESCE(CASE WHEN other.status!='pending' OR adjacent.event_type='in' THEN COALESCE(other.decided_time,other.requested_at) END,adjacent.occurred_at)`;
  const neighbor = (before: boolean) => sql`(SELECT julianday(${effective}) FROM clock_events adjacent LEFT JOIN assisted_clock_reports other ON other.event_id=adjacent.id
    WHERE adjacent.employee_id=e.employee_id AND adjacent.id ${before ? sql.raw("<") : sql.raw(">")} e.id
    ORDER BY adjacent.id ${before ? sql.raw("DESC") : sql.raw("ASC")} LIMIT 1)`;
  const [updated] = await atomicBatch(db, [
    sql`UPDATE assisted_clock_reports SET status=${action === "edit" ? "edited" : "approved"},decided_time=${time},decided_at=${stamp},decided_by_account_id=${ctx.account.id}
      WHERE event_id=${id} AND status='pending' AND EXISTS (
        SELECT 1 FROM clock_events e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE e.id=${id} AND ${reportScope(ctx)} AND ${notReplaced}
        AND julianday(${time}) > COALESCE(${neighbor(true)},julianday(e.occurred_at)-1.5)
        AND julianday(${time}) < COALESCE(${neighbor(false)},julianday(${stamp})+0.001))`,
    sql`INSERT INTO audit_log (actor_account_id,employee_id,action,entity_type,entity_id,created_at)
      SELECT ${ctx.account.id},employee_id,${"clock.assisted_" + (action === "edit" ? "edited" : "approved")},'clock_event',${String(id)},${stamp}
      FROM clock_events WHERE id=${id} AND changes()=1`,
    sql`UPDATE workforce_state SET revision=revision+1 WHERE id=1 AND changes()=1`,
  ]);
  if (!updated.meta.changes) throw new AuthError(409, "The report changed or the selected time overlaps another clock entry. Refresh and review the time card.");
  return { saved: true };
}
