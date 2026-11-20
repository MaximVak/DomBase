import { sql } from "drizzle-orm";
import type { Database } from "./context";
import type { InvitationEmailEnv } from "../team/email";
import { invitationEmailConfig } from "../team/email-config.mjs";
import { validEmail } from "../backup/email-config.mjs";

export async function dispatchClockReminderEmails(db: Database, env: InvitationEmailEnv, now = Date.now()) {
  const config = invitationEmailConfig(env);
  if (!config.configured) return;
  const stamp = new Date(now).toISOString();
  const stale = new Date(now - 120000).toISOString();
  await db.run(sql`UPDATE notifications SET clock_email_state='uncertain' WHERE clock_email_state='sending' AND clock_email_claimed_at<=${stale}`);
  const pending = await db.all<{ id: string }>(sql`SELECT id FROM notifications WHERE clock_email_state='pending' AND source_key LIKE 'clock-out-%' ORDER BY occurred_at,id LIMIT 8`);
  await Promise.all(pending.map(async ({ id }) => {
    const claimed = await db.run(sql`UPDATE notifications SET clock_email_state='sending',clock_email_claimed_at=${stamp} WHERE id=${id} AND clock_email_state='pending'`);
    if (!claimed.meta.changes) return;
    const recipient = await db.get<{ email: string }>(sql`SELECT trim(e.email) AS email FROM notifications n JOIN employees e ON e.id=n.employee_id
      JOIN shifts sh ON n.event_target_id='clock-attendance-' || sh.id AND sh.employee_id=e.id
      JOIN location_settings ls ON ls.business_id=1 LEFT JOIN employee_settings es ON es.employee_id=e.id
      JOIN clock_events latest ON latest.id=(SELECT MAX(c.id) FROM clock_events c WHERE c.employee_id=e.id)
      WHERE n.id=${id} AND n.clock_email_state='sending' AND ls.clock_out_reminders=1 AND ls.clock_out_reminder_email=1
        AND e.active=1 AND e.terminated=0 AND COALESCE(es.send_location_alerts,1)=1 AND sh.archived_at IS NULL
        AND latest.shift_id=sh.id AND latest.event_type!='out' AND n.occurred_at >= COALESCE((
          SELECT occurred_at FROM clock_events WHERE employee_id=e.id AND event_type='in' ORDER BY id DESC LIMIT 1),'')`);
    let state = "cancelled";
    if (recipient?.email && validEmail(recipient.email)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      state = "uncertain";
      try {
        const delivered = await Promise.race([
          env.INVITATION_EMAIL!.send({ to: recipient.email, from: { email: config.sender!, name: "DomBase time clock" },
            replyTo: config.replyTo!, subject: "DomBase clock-out reminder",
            text: `Your scheduled shift has ended. Use the time clock to record or report when you finished.\n\n${config.origin}/me/schedule\n` }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Email provider timeout")), 10000); }),
        ]);
        if (delivered?.messageId) state = "accepted";
      } catch { /* Provider errors can include private addresses. An uncertain send is never retried. */ }
      finally { clearTimeout(timer); }
    }
    await db.run(sql`UPDATE notifications SET clock_email_state=${state} WHERE id=${id} AND clock_email_state='sending' AND clock_email_claimed_at=${stamp}`);
  }));
}
