import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { permissionsFor } from "../access/policy";
import type { AccessLevel } from "../access/policy";
import { employeeScope, roleScope } from "../access/service";
import type { DepartmentScope } from "../access/service";
import { newToken } from "../auth/crypto";
import { validEmail } from "../backup/email-config.mjs";
import type { managerEmailDeliveries } from "../db/schema";
import { clockPolicy, workplaceDate } from "../kiosk/break-actions";
import { invitationEmailConfig } from "../team/email-config.mjs";
import type { InvitationEmailEnv } from "../team/email";
import type { Database } from "./context";
import { managerOvertimePlans } from "./employee-reminders";
import { managerEmailEvents } from "./notification-preferences-model";
import type { ManagerEmailEvent } from "./notification-preferences-model";
import { managerNotificationAccess } from "./notification-preferences";
import { offsetDate, weekStart } from "./period";
import { zonedTimestamp } from "./time";

export type ManagerEmailEnv = InvitationEmailEnv & { STAGE6_MANAGER_EMAIL_ENABLED?: string };
type OutboxRow = typeof managerEmailDeliveries.$inferSelect;
type Delivery = Pick<OutboxRow, "accountId" | "event" | "occurrence" | "target" | "destinationHash">;
type Candidate = Pick<OutboxRow, "event" | "occurrence" | "target" | "expiresAt">;
type OptIn = {
  id: number; employeeId: number | null; email: string; level: AccessLevel;
  grants: string; departments: string; enabled: string; accessRevision: string; version: number;
};
type Manager = DepartmentScope & Pick<OptIn, "id" | "employeeId" | "email"> & {
  events: ManagerEmailEvent[]; scopeVersion: string;
};
type AlertEvent = "lateArrival" | "noShow" | "timeOffRequest";
type Alert = { id: string; employee: string; title: string; occurredAt: number };
type Email = { subject: string; text: string };
const minute = 60_000;
const alertWindow = 30 * minute;
const stamp = (at: number) => new Date(at).toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function managerEmailAvailable(env: ManagerEmailEnv) {
  return env.STAGE6_MANAGER_EMAIL_ENABLED === "true" && invitationEmailConfig(env).configured;
}

async function optedInManagers(db: Database, after: number, only?: number) {
  const rows = await db.all<OptIn>(sql`SELECT a.id,a.employee_id AS employeeId,a.normalized_email AS email,a.access_level AS level,
    a.access_revision AS accessRevision,a.session_version AS version,
    (SELECT json_group_object(g.permission,g.allowed) FROM account_permissions g WHERE g.account_id=a.id) AS grants,
    (SELECT json_group_array(id) FROM (SELECT d.id FROM department_managers m JOIN departments d ON d.id=m.department_id
      WHERE m.account_id=a.id AND d.archived=0 ORDER BY d.id)) AS departments,
    (SELECT json_group_array(e.key) FROM json_each(p.choices,'$.events') e
      WHERE e.key IN (${sql.join(managerEmailEvents.map(event => sql`${event}`), sql`,`)}) AND json_extract(e.value,'$.email')=1) AS enabled
    FROM accounts a JOIN account_notification_preferences p ON p.account_id=a.id
    WHERE a.id>${after} AND (${only ?? null} IS NULL OR a.id=${only ?? null})
      AND a.login_enabled=1 AND a.disabled_at IS NULL AND a.access_level IN ('owner','general_manager','manager')
      AND (a.employee_id IS NULL OR EXISTS (SELECT 1 FROM employees e WHERE e.id=a.employee_id AND e.active=1 AND e.terminated=0))
    ORDER BY a.id LIMIT 50`);
  const managers = rows.flatMap<Manager>(row => {
    const departmentIds = JSON.parse(row.departments) as number[];
    const allDepartments = row.level !== "manager";
    if ((!allDepartments && !departmentIds.length) || !validEmail(row.email)) return [];
    const grants = Object.entries(JSON.parse(row.grants) as Record<string, number>).map(([permission, allowed]) => ({ permission, allowed: !!allowed }));
    const access = managerNotificationAccess(permissionsFor(row.level, grants));
    const events = (JSON.parse(row.enabled) as ManagerEmailEvent[]).filter(event => event === "timeOffRequest" ? access.timeOff : access.attendance);
    if (!events.length) return [];
    return [{ id: row.id, employeeId: row.employeeId, email: row.email, allDepartments, departmentIds, events,
      scopeVersion: JSON.stringify([row.version, row.accessRevision, row.level, row.employeeId, row.email, departmentIds]) }];
  });
  return { managers, next: rows.length === 50 ? rows.at(-1)!.id : null };
}

function pendingAlert(db: Database, manager: Manager, event: AlertEvent, now: number, source?: string) {
  const occurrence = event === "timeOffRequest" ? sql`CAST(p.id AS TEXT)` : sql`n.id`;
  const time = event === "timeOffRequest" ? sql`p.requested_at` : sql`n.occurred_at`;
  const wanted = sql`julianday(${time}) BETWEEN julianday(${stamp(now - alertWindow)}) AND julianday(${stamp(now)})
    AND ${source === undefined ? sql`NOT EXISTS (SELECT 1 FROM manager_email_deliveries m WHERE m.account_id=${manager.id}
      AND m.event=${event} AND m.occurrence=${occurrence})` : sql`${occurrence}=${source}`}`;
  const select = sql`SELECT ${occurrence} AS id,e.name AS employee,
    CAST(ROUND((julianday(${time})-2440587.5)*86400000) AS INTEGER) AS occurredAt`;
  if (event === "timeOffRequest") {
    return db.all<Alert>(sql`${select},'Time off request' AS title FROM pto_requests p JOIN employees e ON e.id=p.employee_id
      WHERE p.status='pending' AND p.archived_at IS NULL AND e.active=1 AND e.terminated=0 AND e.id IS NOT ${manager.employeeId}
        AND ${employeeScope(manager, sql`e.id`)} AND ${wanted} ORDER BY p.requested_at,p.id LIMIT 50`);
  }
  const late = event === "lateArrival";
  return db.all<Alert>(sql`${select},n.title AS title FROM notifications n
    JOIN shifts sh ON n.event_target_id=('clock-attendance-' || sh.id) AND sh.employee_id=n.employee_id
    JOIN employees e ON e.id=n.employee_id JOIN location_settings s ON s.business_id=1
    WHERE ${late ? sql`n.source_key LIKE 'clock-manager-late-%' AND s.late_attendance_alerts=1`
      : sql`n.source_key LIKE 'clock-manager-no-show-%' AND s.no_show_alerts=1
        AND NOT EXISTS (SELECT 1 FROM clock_events c WHERE c.employee_id=e.id AND c.shift_id=sh.id AND c.event_type='in')`}
      AND sh.archived_at IS NULL AND sh.publication_id IS NOT NULL AND sh.shift_type='work'
      AND julianday(sh.updated_at)<=julianday(n.occurred_at)
      AND NOT EXISTS (SELECT 1 FROM pto_requests p WHERE p.employee_id=e.id AND p.status='approved'
        AND p.archived_at IS NULL AND sh.date BETWEEN p.start_date AND p.end_date
        AND (p.start_time IS NULL OR p.end_time IS NULL OR (p.start_time<=sh.start_time AND p.end_time>sh.start_time)))
      AND e.active=1 AND e.terminated=0 AND ${roleScope(manager, sql`sh.role_id`)} AND ${employeeScope(manager, sql`e.id`)}
      AND ${wanted} ORDER BY n.occurred_at,n.id LIMIT 50`);
}

export async function queueManagerEmails(db: Database, now: number) {
  const policy = await clockPolicy(db);
  const today = workplaceDate(now, policy.zone);
  const week = weekStart(today, policy.workWeekStart);
  const summaryDue = now >= zonedTimestamp(today, "08:00", policy.zone) && now < zonedTimestamp(today, "12:00", policy.zone);
  const summaryExpires = summaryDue ? stamp(zonedTimestamp(today, "12:00", policy.zone)) : "";
  let overtime: Awaited<ReturnType<typeof managerOvertimePlans>> | undefined;
  let after: number | null = 0;
  while (after !== null) {
    const page = await optedInManagers(db, after);
    after = page.next;
    for (const manager of page.managers) {
      const jobs: Candidate[] = [];
      for (const event of manager.events) {
        if (event === "dailySummary" || event === "weeklySummary") {
          if (summaryDue && (event === "dailySummary" || today === week)) {
            const start = offsetDate(today, event === "dailySummary" ? -1 : -7);
            jobs.push({ event, occurrence: start, target: start, expiresAt: summaryExpires });
          }
        } else if (event === "managerOvertime") {
          overtime ??= await managerOvertimePlans(db, now);
          if (!overtime.length) continue;
          const scope = await db.all<{ id: number }>(sql`SELECT sh.id FROM shifts sh
            WHERE sh.id IN (SELECT value FROM json_each(${JSON.stringify(overtime.map(plan => plan.row.id))}))
            AND ${roleScope(manager, sql`sh.role_id`)} AND ${employeeScope(manager, sql`sh.employee_id`)}`);
          const visible = new Set(scope.map(row => row.id));
          for (const plan of overtime) {
            if (visible.has(plan.row.id)) jobs.push({ event, occurrence: plan.row.employeeId + ":" + plan.occurrence,
              target: String(plan.row.id), expiresAt: stamp(plan.expiresAt) });
          }
        } else {
          const rows = await pendingAlert(db, manager, event, now);
          for (const row of rows) jobs.push({ event, occurrence: row.id, target: row.id, expiresAt: stamp(row.occurredAt + alertWindow) });
        }
      }
      if (!jobs.length) continue;
      await db.run(sql`INSERT INTO manager_email_deliveries
        (account_id,event,occurrence,target,destination_hash,expires_at,created_at,updated_at)
        SELECT ${manager.id},json_extract(j.value,'$.event'),json_extract(j.value,'$.occurrence'),json_extract(j.value,'$.target'),
          ${hash(manager.email)},json_extract(j.value,'$.expiresAt'),${stamp(now)},${stamp(now)}
        FROM json_each(${JSON.stringify(jobs)}) j WHERE 1 ON CONFLICT DO NOTHING`);
    }
  }
}

async function summary(db: Database, manager: Manager, start: string, weekly: boolean): Promise<Email> {
  const end = weekly ? offsetDate(start, 6) : start;
  const today = offsetDate(end, 1);
  const shiftFilter = sql`sh.archived_at IS NULL AND sh.publication_id IS NOT NULL AND sh.shift_type='work'
    AND ${roleScope(manager, sql`sh.role_id`)} AND ${employeeScope(manager, sql`sh.employee_id`)}`;
  const counts = await db.get<{ shifts: number; cards: number; late: number; noShow: number; today: number }>(sql`SELECT
    (SELECT COUNT(*) FROM shifts sh WHERE sh.date BETWEEN ${start} AND ${end} AND ${shiftFilter}) AS shifts,
    (SELECT COUNT(*) FROM time_cards c WHERE c.work_date BETWEEN ${start} AND ${end}
      AND ${roleScope(manager, sql`c.role_id`)} AND ${employeeScope(manager, sql`c.employee_id`)}
      AND NOT COALESCE((SELECT json_extract(edit.after,'$.deleted')=1 FROM time_card_edits edit WHERE edit.card_id=c.id AND edit.revision=c.version),0)) AS cards,
    (SELECT COUNT(*) FROM notifications n JOIN shifts sh ON n.event_target_id=('clock-attendance-' || sh.id) AND sh.employee_id=n.employee_id
      WHERE n.source_key LIKE 'clock-manager-late-%' AND sh.date BETWEEN ${start} AND ${end} AND ${shiftFilter}) AS late,
    (SELECT COUNT(*) FROM notifications n JOIN shifts sh ON n.event_target_id=('clock-attendance-' || sh.id) AND sh.employee_id=n.employee_id
      WHERE n.source_key LIKE 'clock-manager-no-show-%' AND sh.date BETWEEN ${start} AND ${end} AND ${shiftFilter}) AS noShow,
    (SELECT COUNT(*) FROM shifts sh WHERE sh.date=${today} AND ${shiftFilter}) AS today`)!;
  const subject = weekly ? "Weekly team summary" : "Daily team summary";
  if (!counts) throw new Error("Manager summary is unavailable.");
  return { subject, text: [
    weekly ? `Workweek ${start} to ${end}` : `Previous day ${start}`,
    `Published work shifts: ${counts.shifts}`, `Time cards: ${counts.cards}`, `Late arrival or overdue clock-in flags: ${counts.late}`,
    `No-show flags: ${counts.noShow}`, ...(weekly ? [] : [`Published work shifts today (${today}): ${counts.today}`]),
  ].join("\n") };
}

async function emailContent(db: Database, manager: Manager, row: Delivery, now: number): Promise<Email | undefined> {
  if (row.event === "dailySummary" || row.event === "weeklySummary") return summary(db, manager, row.target, row.event === "weeklySummary");
  if (row.event === "managerOvertime") {
    const [plan] = await managerOvertimePlans(db, now, Number(row.target));
    if (!plan || row.occurrence !== plan.row.employeeId + ":" + plan.occurrence) return;
    const employee = await db.get<{ name: string }>(sql`SELECT e.name FROM shifts sh JOIN employees e ON e.id=sh.employee_id
      WHERE sh.id=${plan.row.id} AND ${roleScope(manager, sql`sh.role_id`)} AND ${employeeScope(manager, sql`e.id`)}`);
    if (employee) return { subject: "Approaching overtime", text: `${employee.name} is approaching a configured overtime threshold. Open DomBase to review recorded time.` };
    return;
  }
  const [alert] = await pendingAlert(db, manager, row.event, now, row.target);
  if (alert) return { subject: alert.title, text: `${alert.employee} has a ${row.event === "timeOffRequest" ? "pending time off request" : "scheduled shift that needs attendance review"}. Open DomBase for details.` };
}

export async function dispatchManagerEmails(db: Database, env: ManagerEmailEnv, now: number) {
  if (!managerEmailAvailable(env)) return;
  const config = invitationEmailConfig(env);
  const at = stamp(now);
  await db.run(sql`UPDATE manager_email_deliveries SET state='uncertain',lease_token=NULL,lease_until=NULL,updated_at=${at}
    WHERE state='sending' AND lease_until<=${at}`);
  await db.run(sql`UPDATE manager_email_deliveries SET state='cancelled',updated_at=${at} WHERE state='pending' AND expires_at<=${at}`);
  const jobs = await db.all<Delivery>(sql`SELECT account_id AS accountId,event,occurrence,target,destination_hash AS destinationHash
    FROM manager_email_deliveries WHERE state='pending' ORDER BY created_at,account_id,event,occurrence LIMIT 8`);
  await Promise.all(jobs.map(async row => {
    const key = sql`account_id=${row.accountId} AND event=${row.event} AND occurrence=${row.occurrence}`;
    const token = newToken();
    const claimed = await db.run(sql`UPDATE manager_email_deliveries SET state='sending',lease_token=${token},
      lease_until=${stamp(now + 2 * minute)},updated_at=${at} WHERE ${key} AND state='pending' AND expires_at>${at}`);
    if (!claimed.meta.changes) return;
    const recipient = async () => (await optedInManagers(db, 0, row.accountId)).managers.find(manager =>
      manager.events.includes(row.event) && hash(manager.email) === row.destinationHash);
    const manager = await recipient();
    const message = manager && await emailContent(db, manager, row, now);
    let state: OutboxRow["state"] = "cancelled";
    if (manager && message && (await recipient())?.scopeVersion === manager.scopeVersion) {
      state = "uncertain";
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const receipt = await Promise.race([
          env.INVITATION_EMAIL!.send({ to: manager.email, from: { email: config.sender!, name: "DomBase" },
            replyTo: config.replyTo!, subject: `DomBase: ${message.subject}`, text: `${message.text}\n\nSign in to DomBase: ${config.origin}/\n` }),
          new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 10000); }),
        ]);
        if (receipt?.messageId) state = "accepted";
      } catch { /* Provider errors can contain contact information. A lost receipt must not resend the message. */ }
      finally { clearTimeout(timeout); }
    }
    await db.run(sql`UPDATE manager_email_deliveries SET state=${state},lease_token=NULL,lease_until=NULL,updated_at=${at}
      WHERE ${key} AND lease_token=${token}`);
  }));
}

export async function runManagerEmailDelivery(db: Database, env: ManagerEmailEnv, now: number) {
  if (!managerEmailAvailable(env)) return;
  await queueManagerEmails(db, now);
  await dispatchManagerEmails(db, env, now);
}
