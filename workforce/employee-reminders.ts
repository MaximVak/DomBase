import { sql } from "drizzle-orm";
import { clockPolicy, workplaceDate } from "../kiosk/break-actions";
import type { ClockPolicy } from "../kiosk/break-actions";
import { inspectBreaks, requiredBreaks } from "../kiosk/break-rules";
import type { BreakEvent, ClockDetails } from "../kiosk/break-rules";
import { shiftBounds } from "../kiosk/assistance";
import { allocateWorkedTime } from "../app/timesheets-overtime";
import { rateFor } from "../team/rules";
import type { WageRate } from "../team/rules";
import type { Database } from "./context";
import { offsetDate, weekStart } from "./period";
import { zonedTimestamp } from "./time";
import { employeeNotificationAllowed } from "./notification-preferences";
import { employeeReminderLeadMinutes, shiftStartLeadMinutes } from "./employee-notice-model";
import type { EmployeeReminderEvent } from "./employee-notice-model";

const minute = 60_000;
const reminderWindow = employeeReminderLeadMinutes * minute;
const catchUpWindow = 5 * minute;
const channels = ["shiftStart", "shiftEnd", "clockOut", "breakReminder", "overtimeReminder"] as const;

type Candidate = {
  id: number; employeeId: number; roleId: number; role: string; date: string; startTime: string; endTime: string;
  email: string; phone: string; excused: number; checkedIn: number; sessionId: number | null;
  lastType: BreakEvent["type"] | null; lastShift: number | null; uncertainStart: number;
  reminderChannels: string;
};
type ReminderPlan = {
  event: EmployeeReminderEvent; occurrence: string; expiresAt: number; row: Candidate;
  email: boolean; sms: boolean;
};

async function reminderCandidates(db: Database, date: string, email: boolean, sms: boolean, after: number, only: number | undefined, managerOvertime: boolean) {
  const flags = channels.flatMap(event => [
    managerOvertime && event === "overtimeReminder" ? sql`1` : email && event !== "clockOut" ? employeeNotificationAllowed(sql`e.id`, event, "email") : sql`0`,
    sms ? employeeNotificationAllowed(sql`e.id`, event, "sms") : sql`0`,
  ]);
  return db.all<Candidate>(sql`SELECT sh.id,e.id AS employeeId,r.id AS roleId,r.name AS role,sh.date,sh.start_time AS startTime,sh.end_time AS endTime,e.email,e.phone,
    EXISTS (SELECT 1 FROM pto_requests p WHERE p.employee_id=e.id AND p.status='approved' AND p.archived_at IS NULL AND p.start_date<=sh.date AND p.end_date>=sh.date
      AND (p.start_time IS NULL OR p.end_time IS NULL OR (p.start_time<=sh.start_time AND p.end_time>sh.start_time))) AS excused,
    EXISTS (SELECT 1 FROM clock_events c WHERE c.employee_id=e.id AND c.shift_id=sh.id AND c.event_type='in') AS checkedIn,
    CASE WHEN session.event_type='in' AND session.shift_id=sh.id THEN session.id END AS sessionId,
    latest.event_type AS lastType,latest.shift_id AS lastShift,
    EXISTS (SELECT 1 FROM assisted_clock_reports a WHERE a.event_id=session.id AND a.status='pending') AS uncertainStart,
    json_array(${sql.join(flags, sql`,`)}) AS reminderChannels
    FROM shifts sh JOIN employees e ON e.id=sh.employee_id JOIN roles r ON r.id=sh.role_id JOIN departments d ON d.id=r.department_id
    LEFT JOIN employee_settings prefs ON prefs.employee_id=e.id
    LEFT JOIN clock_events latest ON latest.id=(SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=e.id)
    LEFT JOIN clock_events session ON session.id=(SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=e.id AND c.event_type IN ('in','out'))
    WHERE sh.shift_type='work' AND sh.publication_id IS NOT NULL AND sh.archived_at IS NULL AND sh.id>${after}
    AND (${only ?? null} IS NULL OR sh.id=${only ?? null}) AND e.active=1 AND e.terminated=0 AND r.archived=0 AND d.archived=0
    AND (${managerOvertime} AND session.event_type='in' AND session.shift_id=sh.id OR NOT ${managerOvertime} AND COALESCE(prefs.send_location_alerts,1)=1)
    AND (sh.date BETWEEN ${offsetDate(date, -1)} AND ${offsetDate(date, 1)} OR (session.event_type='in' AND session.shift_id=sh.id))
    ORDER BY sh.id LIMIT 400`);
}

async function clockHistory(db: Database, employeeIds: number[], week: string, today: string, policy: ClockPolicy, now: number) {
  if (!employeeIds.length) return { events: new Map<number, BreakEvent[]>(), wages: new Map<number, WageRate[]>() };
  const ids = JSON.stringify(employeeIds);
  const start = new Date(zonedTimestamp(offsetDate(week, -1), "00:00", policy.zone)).toISOString();
  const [punches, wages] = await Promise.all([
    db.all<{ employeeId: number; type: BreakEvent["type"]; at: string; automatic: number; details: string | null }>(sql`
      SELECT c.employee_id AS employeeId,c.event_type AS type,
      COALESCE(CASE WHEN a.status!='pending' THEN COALESCE(a.decided_time,a.requested_at) END,c.occurred_at) AS at,
      c.automatic,c.clock_details AS details FROM clock_events c LEFT JOIN assisted_clock_reports a ON a.event_id=c.id
      WHERE c.employee_id IN (SELECT value FROM json_each(${ids})) AND c.occurred_at>=${start}
      AND julianday(c.occurred_at)<=julianday(${new Date(now).toISOString()}) ORDER BY julianday(at),c.id LIMIT 20001`),
    db.all<WageRate & { employeeId: number }>(sql`SELECT w.id,w.employee_id AS employeeId,w.role_id AS roleId,COALESCE(r.name,'') AS role,w.amount_cents AS amountCents,
      w.basis,w.effective_date AS effectiveDate,w.overtime_exempt AS overtimeExempt FROM wage_rates w LEFT JOIN roles r ON r.id=w.role_id
      WHERE w.employee_id IN (SELECT value FROM json_each(${ids})) AND w.effective_date<=${today}
      AND NOT EXISTS (SELECT 1 FROM wage_rates newer WHERE newer.employee_id=w.employee_id AND newer.role_id IS w.role_id
        AND newer.effective_date<=${today} AND (newer.effective_date>w.effective_date OR (newer.effective_date=w.effective_date AND newer.id>w.id)))
      LIMIT 10001`),
  ]);
  if (punches.length > 20000 || wages.length > 10000) throw new Error("Employee reminder history exceeded its batch limit.");
  const history = new Map<number, BreakEvent[]>(), rates = new Map<number, WageRate[]>();
  for (const punch of punches) {
    const at = Date.parse(punch.at);
    if (!Number.isFinite(at) || at > now) continue;
    const events = history.get(punch.employeeId) ?? [];
    events.push({ type: punch.type, at, automatic: !!punch.automatic, details: punch.details ? JSON.parse(punch.details) as ClockDetails : null });
    history.set(punch.employeeId, events);
  }
  for (const wage of wages) {
    const rows = rates.get(wage.employeeId) ?? [];
    rows.push({ ...wage, overtimeExempt: !!wage.overtimeExempt });
    rates.set(wage.employeeId, rows);
  }
  return { events: history, wages: rates };
}

function calculateReminderPlans(row: Candidate, policy: ClockPolicy, today: string, week: string, history: BreakEvent[], wages: WageRate[], now: number) {
  const result: ReminderPlan[] = [];
  const prefs = JSON.parse(row.reminderChannels) as number[];
  const hasChannel = (event: EmployeeReminderEvent) => prefs.slice(channels.indexOf(event) * 2, channels.indexOf(event) * 2 + 2).some(Boolean);
  let start: number, end: number;
  try { ({ start, end } = shiftBounds(row, policy.zone)); } catch { return result; }
  const add = (event: EmployeeReminderEvent, occurrence: string, expiresAt: number) => {
    const index = channels.indexOf(event) * 2;
    const email = !!prefs[index], sms = !!prefs[index + 1];
    if (expiresAt > now && (email || sms)) result.push({ event, occurrence, expiresAt, row, email, sms });
  };
  const shift = `${row.id}:${row.roleId}:${start}:${end}`;
  if (!row.excused && !row.checkedIn && now >= start - shiftStartLeadMinutes * minute && now < start) add("shiftStart", shift, start);
  if (!row.sessionId || row.lastShift !== row.id || row.lastType === "out") return result;
  if (now >= end - reminderWindow && now < end) add("shiftEnd", shift + ":" + row.sessionId, end);
  if (policy.clockOutReminders) {
    const slots = [policy.clockOutReminderFirst, policy.clockOutReminderSecond, policy.clockOutReminderThird];
    const slot = slots.findLastIndex(delay => end + delay * minute <= now);
    if (slot >= 0) add("clockOut", shift + ":" + row.sessionId + ":" + slot, end + slots[slot] * minute + catchUpWindow);
  }
  if (row.lastType === "break" || row.uncertainStart || !history.length || end <= now
    || (!hasChannel("breakReminder") && !hasChannel("overtimeReminder"))) return result;
  const dayStart = zonedTimestamp(today, "00:00", policy.zone);
  const dayEnd = zonedTimestamp(offsetDate(today, 1), "00:00", policy.zone);
  const future = Math.min(end, dayEnd, now + reminderWindow);
  const recent = Math.max(dayStart, now - catchUpWindow);
  if (future <= now || history.at(-1)?.type === "out" || history.at(-1)?.type === "break") return result;
  const pastWork = inspectBreaks(history, dayStart, recent);
  const projected = inspectBreaks(history, dayStart, future);
  if (hasChannel("breakReminder")) {
    const earlier = requiredBreaks(pastWork, policy);
    const reported = history.filter(event => event.type === "out" && event.at >= dayStart).flatMap(event => event.details?.reports ?? []);
    for (const issue of requiredBreaks(projected, policy)) {
      if (issue.kind === "meal" && !policy.mandatoryMealBreak) continue;
      if ([...earlier, ...reported].some(item => item.kind === issue.kind && item.slot === issue.slot)) continue;
      add("breakReminder", `${today}:${issue.kind}:${issue.slot}`, Math.min(end, dayEnd, now + catchUpWindow));
    }
  }
  if (hasChannel("overtimeReminder")) {
    const rate = rateFor(wages, row.role, today);
    if (rate?.basis !== "annual_salary" || !rate.overtimeExempt) {
      const prior: Parameters<typeof allocateWorkedTime>[0] = [];
      for (let day = week; day < today; day = offsetDate(day, 1)) {
        const before = zonedTimestamp(day, "00:00", policy.zone);
        const after = zonedTimestamp(offsetDate(day, 1), "00:00", policy.zone);
        const worked = inspectBreaks(history, before, after).worked;
        prior.push({ date: day, worked, hasActual: worked > 0 });
      }
      const overtime = (worked: number) => {
        const allocation = allocateWorkedTime([...prior, { date: today, worked, hasActual: worked > 0 }], week, policy).at(-1)!;
        return allocation.overtime + allocation.doubleTime;
      };
      if (!overtime(pastWork.worked) && overtime(projected.worked)) add("overtimeReminder", today, Math.min(end, dayEnd, now + catchUpWindow));
    }
  }
  return result;
}

async function reminderPlans(db: Database, now: number, email: boolean, sms: boolean, only?: number, managerOvertime = false): Promise<ReminderPlan[]> {
  if (!email && !sms && !managerOvertime) return [];
  const policy = await clockPolicy(db);
  const today = workplaceDate(now, policy.zone);
  const week = weekStart(today, policy.workWeekStart);
  const plans: ReminderPlan[] = [];
  let after = 0;
  for (let page = 0; page < (only ? 1 : 5); page++) {
    const rows = await reminderCandidates(db, today, email, sms, after, only, managerOvertime);
    const active = rows.filter(row => row.sessionId && row.lastShift === row.id && !row.uncertainStart
      && (JSON.parse(row.reminderChannels) as number[]).slice(6).some(Boolean));
    const history = await clockHistory(db, [...new Set(active.map(row => row.employeeId))], week, today, policy, now);
    for (const row of rows) plans.push(...calculateReminderPlans(row, policy, today, week, history.events.get(row.employeeId) ?? [], history.wages.get(row.employeeId) ?? [], now));
    if (rows.length < 400) break;
    after = rows.at(-1)!.id;
  }
  return plans;
}

export function employeeReminderPlans(db: Database, now: number, email: boolean, sms: boolean, only?: number) {
  return reminderPlans(db, now, email, sms, only);
}

export function managerOvertimePlans(db: Database, now: number, shiftId?: number) {
  return reminderPlans(db, now, false, false, shiftId, true);
}
