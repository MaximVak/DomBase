import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { AuthError } from "../auth/http";
import type { Database } from "./context";

// Use the latest append-only entry per target. Scope affects who can see or
// remove a lock, never whether it protects the time.
export const activeTimesheetLock = sql`l.action = 'lock' AND NOT EXISTS (
  SELECT 1 FROM timesheet_lock_events newer WHERE newer.target_key = l.target_key AND newer.id > l.id)`;

export function periodLockByDate(start: string, end = start) {
  return sql`l.employee_id IS NULL AND l.start_date <= ${end} AND l.end_date >= ${start}`;
}

export function periodLockByTime(start: string | SQL, end: string | SQL) {
  return sql`l.employee_id IS NULL AND l.starts_at < ${end} AND l.ends_at > ${start}`;
}

export async function requireTimesheetUnlocked(db: Database, match: SQL) {
  const lock = await db.get<{ employeeId: number | null }>(sql`SELECT l.employee_id AS employeeId FROM timesheet_lock_events l
    WHERE (${match}) AND ${activeTimesheetLock} ORDER BY l.employee_id IS NOT NULL LIMIT 1`);
  if (lock) throw new AuthError(409, lock.employeeId === null ? "This pay period is locked. Unlock it before making changes." : "This time card is locked. Unlock it before making changes.");
}

// An out or break belongs to its session's clock-in, including overnight work.
// Compare both the submitted and effective clocks for assisted and offline time.
export function clockEntryUnlocked(employeeId: number | SQL, previousId: number | SQL, rawAt: string | SQL, effectiveAt: string | SQL = rawAt) {
  const first = sql`(SELECT id FROM clock_events WHERE employee_id = ${employeeId} AND id <= ${previousId}
    AND event_type = 'in' ORDER BY id DESC LIMIT 1)`;
  const firstTime = sql`(SELECT COALESCE(a.decided_time,a.requested_at,e.occurred_at) FROM clock_events e
    LEFT JOIN assisted_clock_reports a ON a.event_id = e.id WHERE e.id = ${first})`;
  const earliest = sql`MIN(${rawAt}, ${effectiveAt}, COALESCE(${firstTime}, ${rawAt}))`;
  const latest = sql`MAX(${rawAt}, ${effectiveAt}, COALESCE(${firstTime}, ${rawAt}))`;
  return sql`NOT EXISTS (SELECT 1 FROM timesheet_lock_events l WHERE ${activeTimesheetLock} AND (
    (l.employee_id IS NULL AND l.starts_at <= ${latest} AND l.ends_at > ${earliest})
    OR l.target_key = ('punch:' || ${employeeId} || ':' || ${first})))`;
}
