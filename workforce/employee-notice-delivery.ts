import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as s from "../db/schema";
import { newToken } from "../auth/crypto";
import { validEmail } from "../backup/email-config.mjs";
import { normalizePhone } from "../team/rules";
import { invitationEmailConfig } from "../team/email-config.mjs";
import type { InvitationEmailEnv } from "../team/email";
import type { Database } from "./context";
import { employeeNotificationAllowed } from "./notification-preferences";
import { employeeReminderPlans } from "./employee-reminders";
import { employeeNoticeText } from "./employee-notice-model";
import type { EmployeeNoticeChannel, EmployeeNoticeEvent } from "./employee-notice-model";

type SmsBinding = { fetch(request: Request): Promise<Response> };
export type EmployeeNoticeEnv = InvitationEmailEnv & { STAGE6_SMS?: SmsBinding };
type Delivery = typeof s.employeeNoticeDeliveries.$inferSelect;
type NewDelivery = Omit<typeof s.employeeNoticeDeliveries.$inferInsert, "createdAt" | "updatedAt">;
const minute = 60_000;
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

export function smsAvailable(env: unknown): boolean {
  const config = env as EmployeeNoticeEnv | undefined;
  return typeof config?.STAGE6_SMS?.fetch === "function" && !!invitationEmailConfig(config).origin;
}

function deliveryId(employeeId: number, event: EmployeeNoticeEvent, channel: EmployeeNoticeChannel, occurrence: string) {
  return fingerprint(JSON.stringify([employeeId, event, channel, occurrence]));
}

export function scheduleTextDelivery(employeeId: number, publicationId: number, address: string, now: number): NewDelivery {
  return { id: deliveryId(employeeId, "schedule", "sms", String(publicationId)), employeeId, publicationId, shiftId: null,
    event: "schedule", channel: "sms", destinationHash: fingerprint(address), expiresAt: new Date(now + 24 * 60 * minute).toISOString() };
}

function destination(channel: EmployeeNoticeChannel, value: string) {
  if (channel === "sms") return normalizePhone(value) || "";
  const email = value.trim().toLowerCase();
  return validEmail(email) ? email : "";
}

export async function queueEmployeeReminders(db: Database, now: number, email: boolean, sms: boolean) {
  const plans = await employeeReminderPlans(db, now, email, sms);
  const jobs: NewDelivery[] = [];
  for (const plan of plans) {
    for (const channel of ["email", "sms"] as const) {
      if (!plan[channel]) continue;
      const address = destination(channel, channel === "sms" ? plan.row.phone : plan.row.email);
      if (!address) continue;
      jobs.push({ id: deliveryId(plan.row.employeeId, plan.event, channel, plan.occurrence), employeeId: plan.row.employeeId,
        publicationId: null, shiftId: plan.row.id, event: plan.event, channel, destinationHash: fingerprint(address), expiresAt: new Date(plan.expiresAt).toISOString() });
    }
  }
  // Each write is a single bounded D1 statement. Dispatched occurrences stay
  // idempotent across cron overlap, subsequent runs and lost acknowledgements.
  const stamp = new Date(now).toISOString();
  for (let index = 0; index < jobs.length; index += 100) {
    await db.run(sql`INSERT INTO employee_notice_deliveries (id,employee_id,shift_id,event,channel,destination_hash,expires_at,created_at,updated_at)
      SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.employeeId'),json_extract(j.value,'$.shiftId'),json_extract(j.value,'$.event'),
        json_extract(j.value,'$.channel'),json_extract(j.value,'$.destinationHash'),json_extract(j.value,'$.expiresAt'),${stamp},${stamp}
      FROM json_each(${JSON.stringify(jobs.slice(index, index + 100))}) j WHERE 1 ON CONFLICT(id) DO NOTHING`);
  }
}

async function currentDestination(db: Database, row: Delivery, now: number) {
  if (row.shiftId !== null) {
    const current = await employeeReminderPlans(db, now, row.channel === "email", row.channel === "sms", row.shiftId);
    if (!current.some(plan => plan[row.channel] && plan.row.employeeId === row.employeeId
      && deliveryId(row.employeeId, plan.event, row.channel, plan.occurrence) === row.id)) return "";
  }
  const allowed = employeeNotificationAllowed(sql`e.id`, row.event, row.channel);
  const master = row.event === "schedule" ? sql`EXISTS(SELECT 1 FROM location_settings WHERE business_id=1 AND notify_schedule_changes=1)
    AND EXISTS(SELECT 1 FROM schedule_publications p WHERE p.id=${row.publicationId} AND p.notify_mode IN ('all','changed') AND p.shift_exchange=0)` : sql`1`;
  const employee = await db.get<{ address: string }>(sql`SELECT ${row.channel === "sms" ? sql`e.phone` : sql`e.email`} AS address
    FROM employees e LEFT JOIN employee_settings prefs ON prefs.employee_id=e.id
    WHERE e.id=${row.employeeId} AND e.active=1 AND e.terminated=0 AND COALESCE(prefs.send_location_alerts,1)=1 AND ${master} AND ${allowed}`);
  const address = destination(row.channel, employee?.address ?? "");
  return address && fingerprint(address) === row.destinationHash ? address : "";
}

async function dispatchSms(binding: SmsBinding, id: string, to: string, text: string, signal: AbortSignal) {
  const response = await binding.fetch(new Request("https://sms.internal/send", { method: "POST", redirect: "error", signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify({ to, text }) }));
  if (!response.ok) return false;
  const receipt = await response.json() as { accepted?: boolean };
  return receipt?.accepted === true;
}

export async function dispatchEmployeeNotices(db: Database, env: EmployeeNoticeEnv, now = Date.now(), scope: "all" | "schedule" = "all") {
  const email = invitationEmailConfig(env);
  const sms = smsAvailable(env);
  if (!(scope === "all" && email.configured) && !sms) return;
  const stamp = new Date(now).toISOString();
  const scopeFilter = scope === "schedule" ? sql`event='schedule'` : sql`1`;
  await db.run(sql`UPDATE employee_notice_deliveries SET state='uncertain',lease_token=NULL,lease_until=NULL,updated_at=${stamp}
    WHERE state='sending' AND lease_until<=${stamp} AND ${scopeFilter}`);
  await db.run(sql`UPDATE employee_notice_deliveries SET state='cancelled',updated_at=${stamp} WHERE state='pending' AND expires_at<=${stamp} AND ${scopeFilter}`);
  const work = await db.select().from(s.employeeNoticeDeliveries).where(and(eq(s.employeeNoticeDeliveries.state, "pending"), scopeFilter,
    sql`((channel='email' AND ${email.configured && scope === "all"}) OR (channel='sms' AND ${sms}))`))
    .orderBy(s.employeeNoticeDeliveries.createdAt, s.employeeNoticeDeliveries.id).limit(8);
  await Promise.all(work.map(async row => {
    const token = newToken();
    const receipt = await db.run(sql`UPDATE employee_notice_deliveries SET state='sending',lease_token=${token},lease_until=${new Date(now + 2 * minute).toISOString()},updated_at=${stamp}
      WHERE id=${row.id} AND state='pending' AND expires_at>${stamp}`);
    if (!receipt.meta.changes) return;
    let state: Delivery["state"] = "cancelled";
    const address = await currentDestination(db, row, now);
    if (address) {
      const message = employeeNoticeText[row.event];
      const text = `Molding Mart: ${message.text}\n\nSign in to DomBase: ${email.origin}/me/schedule`;
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      state = "uncertain";
      try {
        const send = row.channel === "sms"
          ? dispatchSms(env.STAGE6_SMS!, row.id, address, text, controller.signal)
          : env.INVITATION_EMAIL!.send({ to: address, from: { email: email.sender!, name: "Molding Mart" },
            replyTo: email.replyTo!, subject: `Molding Mart: ${message.subject}`, text }).then(result => !!result?.messageId);
        const accepted = await Promise.race([send, new Promise<boolean>(resolve => {
          timeout = setTimeout(() => { controller.abort(); resolve(false); }, 10_000);
        })]);
        if (accepted) state = "accepted";
      } catch { /* A lost acknowledgement cannot be safely resent. Provider errors can contain contact details. */ }
      finally { clearTimeout(timeout); }
    }
    await db.run(sql`UPDATE employee_notice_deliveries SET state=${state},lease_token=NULL,lease_until=NULL,updated_at=${stamp}
      WHERE id=${row.id} AND lease_token=${token}`);
  }));
}

export async function runEmployeeReminderDelivery(db: Database, env: EmployeeNoticeEnv, now: number) {
  const email = invitationEmailConfig(env);
  await queueEmployeeReminders(db, now, email.configured, smsAvailable(env));
  await dispatchEmployeeNotices(db, env, now);
}
