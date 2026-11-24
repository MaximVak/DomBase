import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import type { Database } from "./context";
import { newToken } from "../auth/crypto";
import { invitationEmailConfig } from "../team/email-config.mjs";
import type { InvitationEmailEnv } from "../team/email";
import { validEmail } from "../backup/email-config.mjs";
import { employeeNotificationAllowed } from "./notification-preferences";

export function deliverableScheduleEmail(id: string) {
  const legacy = sql`COALESCE(prefs.email,1)`;
  return sql`EXISTS (SELECT 1 FROM schedule_publication_recipients target JOIN employees e ON e.id=target.employee_id
    JOIN schedule_emails queued ON queued.id=target.email_id
    JOIN schedule_publications publication ON publication.id=queued.publication_id
    LEFT JOIN employee_settings es ON es.employee_id=e.id LEFT JOIN schedule_notification_preferences prefs ON prefs.employee_id=e.id
    JOIN location_settings company ON company.business_id=1
    WHERE queued.id=${id} AND lower(trim(e.email))=queued.recipient AND e.active=1 AND e.terminated=0
    AND target.email_requested=1 AND COALESCE(es.send_location_alerts,1)=1 AND company.notify_schedule_changes=1
    AND CASE WHEN publication.shift_exchange=1 THEN ${employeeNotificationAllowed(sql`e.id`, "shiftExchange", "email", legacy)}
      WHEN publication.notice_type='open_shift_request' THEN ${employeeNotificationAllowed(sql`e.id`, "openShift", "email", legacy)} ELSE ${legacy}=1 END)`;
}
export function scheduleEmailMessage(origin: string, publicationId: number, noticeType = "schedule") {
  if (noticeType === "shift_exchange") return { subject: "Molding Mart: shift trade or cover request update", text: `A shift trade or cover request needs your attention or has a new decision in DomBase.\n\nSign in to review your requests and schedule:\n${origin}/me/schedule\n\nTo change future schedule alerts, open My schedule, then My schedule alert preferences.\n\nReference: ${publicationId}\n\nMolding Mart\nSacramento, California\n` };
  if (noticeType === "open_shift_request") return { subject: "Molding Mart: open shift request update", text: `Your open shift request has been updated in DomBase.\n\nSign in to review your request and schedule:\n${origin}/me/schedule\n\nTo change future schedule alerts, open My schedule, then My schedule alert preferences.\n\nReference: ${publicationId}\n\nMolding Mart\nSacramento, California\n` };
  return { subject: "Molding Mart: schedule update", text: `Your published schedule has been updated in DomBase.\n\nSign in to view your schedule:\n${origin}/me/schedule\n\nTo change future schedule alerts, open My schedule, then My schedule alert preferences.\n\nPublication reference: ${publicationId}\n\nMolding Mart\nSacramento, California\n` };
}
export async function dispatchScheduleEmails(db: Database, env: InvitationEmailEnv, now = Date.now(), limit = 10) {
  const config = invitationEmailConfig(env); if (!config.configured) return { accepted: 0, uncertain: 0, cancelled: 0 };
  const stamp = new Date(now).toISOString();
  // A lost provider acknowledgement cannot safely be retried without risking a
  // duplicate. Surface uncertainty instead of claiming delivery or sending twice.
  await db.run(sql`UPDATE schedule_emails SET state='uncertain',lease_token=NULL,lease_until=NULL,updated_at=${stamp} WHERE state='sending' AND lease_until<=${stamp}`);
  const rows = await db.select().from(s.scheduleEmails).where(eq(s.scheduleEmails.state, "pending")).orderBy(s.scheduleEmails.createdAt).limit(Math.min(10, Math.max(1, limit)));
  const results = await Promise.all(rows.map(async row => {
    const token = newToken(), valid = deliverableScheduleEmail(row.id);
    const claimed = await db.run(sql`UPDATE schedule_emails SET state='sending',lease_token=${token},lease_until=${new Date(now + 120000).toISOString()},updated_at=${stamp} WHERE id=${row.id} AND state='pending' AND ${valid}`);
    if (!claimed.meta.changes) { await db.run(sql`UPDATE schedule_emails SET state='cancelled',updated_at=${stamp} WHERE id=${row.id} AND state='pending' AND NOT (${valid})`); return "cancelled"; }
    const [current] = await db.select({ recipient: s.scheduleEmails.recipient, publicationId: s.scheduleEmails.publicationId, noticeType: s.schedulePublications.noticeType, shiftExchange: s.schedulePublications.shiftExchange })
      .from(s.scheduleEmails).innerJoin(s.schedulePublications, eq(s.schedulePublications.id, s.scheduleEmails.publicationId)).where(and(eq(s.scheduleEmails.id, row.id), eq(s.scheduleEmails.leaseToken, token), valid)).limit(1);
    if (!current || !validEmail(current.recipient)) { await db.run(sql`UPDATE schedule_emails SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=${stamp} WHERE id=${row.id} AND lease_token=${token}`); return "cancelled"; }
    let accepted = false, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([env.INVITATION_EMAIL!.send({ to: current.recipient, from: { email: config.sender!, name: "Molding Mart" }, replyTo: config.replyTo!, ...scheduleEmailMessage(config.origin!, current.publicationId, current.shiftExchange ? "shift_exchange" : current.noticeType) }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Email response timed out.")), 10000); })]);
      accepted = typeof response?.messageId === "string" && !!response.messageId;
    } catch { /* Provider errors may contain private addresses; never log them. */ }
    finally { clearTimeout(timer); }
    await db.run(sql`UPDATE schedule_emails SET state=${accepted ? "accepted" : "uncertain"},accepted_at=${accepted ? stamp : null},lease_token=NULL,lease_until=NULL,updated_at=${stamp} WHERE id=${row.id} AND lease_token=${token}`);
    return accepted ? "accepted" : "uncertain";
  }));
  return { accepted: results.filter(result => result === "accepted").length, uncertain: results.filter(result => result === "uncertain").length, cancelled: results.filter(result => result === "cancelled").length };
}
