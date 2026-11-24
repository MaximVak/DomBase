import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { clockPolicy, workplaceDate } from "../kiosk/break-actions";
import type { ClockPolicy } from "../kiosk/break-actions";
import { shiftBounds } from "../kiosk/assistance";
import { atomicBatch } from "../kiosk/database";
import type { Context, Database } from "./context";
import { offsetDate } from "./period";
import { countAssistedClocks } from "./assisted-clock";
import { accountNotificationAllowed, employeeNotificationAllowed } from "./notification-preferences";

type Candidate = {
  id: number; employeeId: number; employee: string; role: string; date: string; startTime: string; endTime: string;
  sessionInId: number | null; clockIn: string | null; lastId: number | null; lastShift: number | null; lastRole: string | null;
  lastType: string | null; lastTime: string | null; excused: number;
};
const minute = 60000;
const alertPrefix = "clock-attendance-";

async function candidates(db: Database, now: number, policy: ClockPolicy, scope: SQL, after = 0) {
  const day = workplaceDate(now, policy.zone);
  return db.all<Candidate>(sql`SELECT sh.id,staff.id AS employeeId,staff.name AS employee,r.name AS role,sh.date,
      sh.start_time AS startTime,sh.end_time AS endTime,
      CASE WHEN session.event_type='in' AND session.shift_id=sh.id THEN session.id END AS sessionInId,
      COALESCE(resolve.decided_time,resolve.requested_at,arrival.occurred_at) AS clockIn,
      latest.id AS lastId,latest.shift_id AS lastShift,latest.role_name AS lastRole,latest.event_type AS lastType,latest.occurred_at AS lastTime,
      EXISTS(SELECT 1 FROM pto_requests leave WHERE leave.status='approved' AND leave.archived_at IS NULL AND leave.employee_id=staff.id AND leave.start_date<=sh.date AND leave.end_date>=sh.date
        AND (leave.start_time IS NULL OR leave.end_time IS NULL OR (leave.start_time<=sh.start_time AND leave.end_time>sh.start_time))) AS excused
    FROM shifts sh JOIN employees staff ON staff.id=sh.employee_id JOIN roles r ON r.id=sh.role_id JOIN departments dep ON dep.id=r.department_id
    LEFT JOIN clock_events arrival ON arrival.id=(SELECT MIN(c.id) FROM clock_events c WHERE c.employee_id=staff.id AND c.shift_id=sh.id AND c.event_type='in')
    LEFT JOIN assisted_clock_reports resolve ON resolve.event_id=arrival.id
    LEFT JOIN clock_events latest ON latest.id=(SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=staff.id)
    LEFT JOIN clock_events session ON session.id=(SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=staff.id AND c.event_type IN ('in','out'))
    WHERE sh.shift_type='work' AND sh.publication_id IS NOT NULL AND sh.archived_at IS NULL
      AND staff.active=1 AND staff.terminated=0 AND r.archived=0 AND dep.archived=0
      AND (sh.date BETWEEN ${offsetDate(day, -1)} AND ${day}
        OR (latest.shift_id=sh.id AND latest.event_type IN ('in','break','break_end')))
      AND sh.id>${after} AND ${scope}
    ORDER BY sh.id LIMIT 500`);
}

function summarize(row: Candidate, now: number, policy: ClockPolicy) {
  let start: number, end: number;
  try { ({ start, end } = shiftBounds(row, policy.zone)); } catch { return null; }
  const raw = Date.parse(row.lastTime ?? "");
  const fallback = row.lastShift === null && row.lastRole === row.role && raw >= start - policy.earlyClockInMinutes * minute && raw <= end;
  const active = (row.lastShift === row.id || fallback) && row.lastType !== null && row.lastType !== "out";
  const seen = row.clockIn !== null || fallback;
  const late = row.clockIn ? Date.parse(row.clockIn) >= start + policy.lateMinutes * minute : now >= start + policy.lateMinutes * minute;
  const status = active ? row.lastType === "break" ? "On break" : "On shift" : seen ? "Finished" : row.excused ? "Excused"
    : now >= start + policy.noShowMinutes * minute ? "No show" : late ? "Late" : "Scheduled";
  return { start, end, active, seen, late, status };
}

export async function readAttendance(db: Database, ctx: Context, now: number) {
  ctx.requirePermission("timesheets.read"); ctx.requirePermission("schedule.read");
  const policy = await clockPolicy(db);
  const scope = sql`${ctx.roleFilter(sql`sh.role_id`)} AND ${ctx.employeeFilter(sql`sh.employee_id`)} AND ${ctx.activeActor()}`;
  const raw = await candidates(db, now, policy, scope);
  const [alerts, unscheduled, review] = await Promise.all([
    db.all<{ id: string; title: string; employee: string; occurredAt: string }>(sql`SELECT n.id,n.title,staff.name AS employee,n.occurred_at AS occurredAt
      FROM notifications n JOIN shifts sh ON n.event_target_id=('clock-attendance-' || sh.id) AND sh.employee_id=n.employee_id
      JOIN employees staff ON staff.id=sh.employee_id
      WHERE n.source_key LIKE 'clock-manager-%' AND sh.publication_id IS NOT NULL AND sh.archived_at IS NULL AND ${scope}
        AND CASE WHEN n.source_key LIKE 'clock-manager-late-%' THEN ${policy.lateAttendanceAlerts} AND ${accountNotificationAllowed(ctx.account.id, "lateArrival", "inApp")}
          ELSE ${policy.noShowAlerts} AND ${accountNotificationAllowed(ctx.account.id, "noShow", "inApp")} END
        AND n.occurred_at >= ${new Date(now - 24 * 3600000).toISOString()} ORDER BY n.occurred_at DESC,n.id LIMIT 50`),
    db.all<{ id: number; employee: string; role: string; status: string }>(sql`SELECT c.id,e.name AS employee,c.role_name AS role,
      CASE WHEN c.event_type='break' THEN 'On break' ELSE 'On shift' END AS status
      FROM employees e JOIN clock_events c ON c.id=(SELECT MAX(last.id) FROM clock_events last WHERE last.employee_id=e.id)
      WHERE e.active=1 AND e.terminated=0 AND c.shift_id IS NULL AND c.event_type!='out'
        AND ${ctx.employeeFilter(sql`e.id`)} AND ${ctx.roleFilter(sql`(SELECT CASE WHEN COUNT(*)=1 THEN MIN(id) END FROM roles WHERE name=c.role_name)`)}
        AND ${ctx.activeActor()} ORDER BY e.name,c.id LIMIT 100`),
    ctx.permissions["timesheets.manage"] ? countAssistedClocks(db, ctx) : 0,
  ]);
  const day = workplaceDate(now, policy.zone);
  const matchedWithoutShift = new Set<number>();
  const rows = raw.flatMap(row => {
    const current = summarize(row, now, policy);
    if (!current || (row.date !== day && current.end < now && !current.active)) return [];
    if (current.active && row.lastShift === null && row.lastId) matchedWithoutShift.add(row.lastId);
    return [{ id: "shift-" + row.id, employee: row.employee, role: row.role,
      start: new Date(current.start).toISOString() as string | null, status: current.status, lateArrival: row.clockIn !== null && current.late }];
  });
  rows.push(...unscheduled.filter(row => !matchedWithoutShift.has(row.id)).map(row => ({
    id: "clock-" + row.id, employee: row.employee, role: row.role, start: null,
    status: row.status === "On break" ? "On break" as const : "On shift" as const, lateArrival: false,
  })));
  return { rows: rows.sort((a, b) => a.employee.localeCompare(b.employee)), alerts, pendingReports: review, zone: policy.zone };
}

export async function createAttendanceNotices(db: Database, now = Date.now()) {
  const policy = await clockPolicy(db);
  if (!policy.lateAttendanceAlerts && !policy.noShowAlerts && !policy.clockOutReminders) return;
  if (!await db.get(sql`SELECT 1 FROM location_settings WHERE business_id=1`)) return;
  const stamp = new Date(now).toISOString();
  let cursor = 0;
  for (let page = 0; page < 4; page++) {
    const batch = await candidates(db, now, policy, sql`1=1`, cursor);
    const inserts: SQL[] = [];
    for (const row of batch) {
      const current = summarize(row, now, policy);
      if (!current || now < current.start) continue;
      const target = alertPrefix + row.id;
      const guard = sql`EXISTS(SELECT 1 FROM shifts sh WHERE sh.id=${row.id} AND sh.employee_id=${row.employeeId}
        AND sh.publication_id IS NOT NULL AND sh.archived_at IS NULL AND sh.start_time=${row.startTime} AND sh.end_time=${row.endTime})
        AND (SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=${row.employeeId}) IS ${row.lastId}`;
      const queue = (id: string, title: string, detail: string, allow: SQL, inApp = sql`1`, email = sql`0`) => {
        inserts.push(sql`INSERT INTO notifications (id,employee_id,source_key,kind,title,detail,occurred_at,event_target_id,in_app,clock_email_state)
          SELECT ${id},${row.employeeId},${id},'alert',${title},${detail},${stamp},${target},${inApp},CASE WHEN ${email} THEN 'pending' END
          WHERE ${guard} AND ${allow} AND (${inApp} OR ${email}) ON CONFLICT DO NOTHING`);
      };
      if (!row.excused && now <= current.end + 24 * 3600000) {
        if (policy.lateAttendanceAlerts && current.late && (current.status === "Late" || row.clockIn)) {
          queue("clock-manager-late-" + row.id, row.clockIn ? "Late arrival" : "Clock-in overdue", "Check attendance for the scheduled shift.",
            sql`EXISTS(SELECT 1 FROM location_settings WHERE late_attendance_alerts=1)`);
        }
        if (policy.noShowAlerts && current.status === "No show") {
          queue("clock-manager-no-show-" + row.id, "No-show", "No clock-in has been recorded for the scheduled shift.",
            sql`EXISTS(SELECT 1 FROM location_settings WHERE no_show_alerts=1)`);
        }
      }
      if (policy.clockOutReminders && row.sessionInId && current.active && row.lastShift === row.id) {
        const employeeId = sql`${row.employeeId}`;
        const inApp = employeeNotificationAllowed(employeeId, "clockOut", "inApp");
        const email = sql`EXISTS(SELECT 1 FROM location_settings WHERE business_id=1 AND clock_out_reminder_email=1)
          AND ${employeeNotificationAllowed(employeeId, "clockOut", "email")}`;
        const intervals = [policy.clockOutReminderFirst, policy.clockOutReminderSecond, policy.clockOutReminderThird];
        for (const [slot, delay] of intervals.entries()) {
          const due = current.end + delay * minute;
          if (now < due || now > due + 24 * 3600000) continue;
          queue(`clock-out-${row.sessionInId}-${slot}`, "Clock-out reminder", "Your scheduled shift has ended. Use the time clock to clock out.",
            sql`EXISTS(SELECT 1 FROM location_settings WHERE clock_out_reminders=1)
              AND NOT EXISTS(SELECT 1 FROM employee_settings WHERE employee_id=${row.employeeId} AND send_location_alerts=0)`, inApp, email);
        }
      }
    }
    for (let index = 0; index < inserts.length; index += 20) {
      const slice = inserts.slice(index, index + 20);
      await atomicBatch(db, [slice[0], ...slice.slice(1)]);
    }
    if (batch.length < 500) break;
    cursor = batch.at(-1)!.id;
  }
}
