import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { AuthError } from "../auth/http";
import type * as schema from "../db/schema";
import { nextDate, zonedTimestamp } from "../workforce/time";
import type { KioskOperatorDatabase } from "./database";
import type { ClockDraft } from "./replay";
import type { ClockPolicy } from "./break-actions";

export type ReportedTime = { date: string; time: string };
export type PlannedAssistance = { requestedAt: string; status: "pending" | "approved"; targetEventId?: number };
type Event = typeof schema.clockEvents.$inferSelect;
type Shift = typeof schema.shifts.$inferSelect;
const hour = 3600000;

export function parseReportedTime(value: unknown, zone: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthError(400, "Enter the actual date and time.");
  const { date, time } = value as Partial<ReportedTime>;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw new AuthError(400, "Enter the actual date and time.");
  try {
    if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error();
    return zonedTimestamp(date, time.slice(0, 5), zone) + Number(time.slice(6) || 0) * 1000;
  } catch { throw new AuthError(400, "Enter a valid local date and time."); }
}

export function shiftBounds(shift: Pick<Shift, "date" | "startTime" | "endTime">, zone: string) {
  const endDate = shift.endTime <= shift.startTime ? nextDate(shift.date) : shift.date;
  return { start: zonedTimestamp(shift.date, shift.startTime, zone), end: zonedTimestamp(endDate, shift.endTime, zone) };
}

export const isAutomaticRecovery = (previous: Event | null, draft: ClockDraft) => previous?.eventType === "out" && previous.automatic && draft.eventType === "out" && !!draft.details?.assisted;

export async function planAssistance(db: KioskOperatorDatabase, employeeId: number, previous: Event | null, draft: ClockDraft, at: number, policy: ClockPolicy, shift: Shift | null): Promise<PlannedAssistance | undefined> {
  const submitted = draft.details?.assisted;
  if (!submitted) return;
  const when = parseReportedTime(submitted, policy.zone);
  if (!draft.explanation.trim()) throw new AuthError(422, "Tell your manager why the clock time needs correction.");
  if (when > at || when < at - 36 * hour) throw new AuthError(422, "Enter a recent time before this submission.");
  const bounds = shift ? shiftBounds(shift, policy.zone) : null;
  if (draft.eventType === "in") {
    if (!policy.assistedClockIn || !bounds || at < bounds.start + policy.lateMinutes * 60000 || at >= bounds.end) {
      throw new AuthError(422, "Assisted clock-in is unavailable for this shift.");
    }
    const previousCorrection = previous && await db.get<{ at: string }>(sql`SELECT COALESCE(decided_time,requested_at) AS at
      FROM assisted_clock_reports WHERE event_id=${previous.id} AND status IN ('approved','edited')`);
    if (when < bounds.start - 12 * hour || (previous && when <= Date.parse(previousCorrection?.at ?? previous.occurredAt))) {
      throw new AuthError(422, "This time overlaps another clock entry.");
    }
    return { requestedAt: new Date(when).toISOString(), status: "pending" };
  }
  if (!policy.assistedClockOut || !previous) throw new AuthError(422, "Assisted clock-out is unavailable.");
  const recovery = isAutomaticRecovery(previous, draft);
  const [prior, work] = await Promise.all([
    recovery ? db.get<{ at: string }>(sql`SELECT COALESCE(CASE WHEN a.status != 'pending' OR e.event_type='in' THEN COALESCE(a.decided_time,a.requested_at) END,e.occurred_at) AS at
      FROM clock_events e LEFT JOIN assisted_clock_reports a ON a.event_id=e.id WHERE e.employee_id=${employeeId} AND e.id<${previous.id} ORDER BY e.id DESC LIMIT 1`) : null,
    db.get<{ at: string }>(sql`SELECT COALESCE(a.decided_time,a.requested_at,e.occurred_at) AS at FROM clock_events e
      LEFT JOIN assisted_clock_reports a ON a.event_id=e.id WHERE e.employee_id=${employeeId} AND e.event_type='in' AND e.id <= ${previous.id} ORDER BY e.id DESC LIMIT 1`),
  ]);
  const lower = Math.max(work ? Date.parse(work.at) : 0, previous.eventType === "in" ? 0 : Date.parse(prior?.at ?? previous.occurredAt));
  if (!work || when <= lower || (recovery && at - Date.parse(previous.occurredAt) > 36 * hour)) {
    throw new AuthError(422, "This time overlaps another clock entry.");
  }
  const approved = bounds && at >= bounds.end && at <= bounds.end + 15 * 60000;
  return { requestedAt: new Date(when).toISOString(), status: approved ? "approved" : "pending", ...(recovery ? { targetEventId: previous.id } : {}) };
}

export function insertAssistance(plan: PlannedAssistance, requestId: string, submittedAt: string, reason: string, event: SQL, guard = sql`1=1`) {
  return sql`INSERT INTO assisted_clock_reports (event_id,request_id,requested_at,submitted_at,reason,status,decided_at)
    SELECT id,${requestId},${plan.requestedAt},${submittedAt},${reason},${plan.status},${plan.status === "approved" ? submittedAt : null}
    FROM clock_events WHERE ${event} AND ${guard} ON CONFLICT DO NOTHING`;
}
