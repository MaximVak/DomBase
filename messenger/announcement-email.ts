import { sql } from "drizzle-orm";
import { newToken } from "../auth/crypto";
import { validEmail } from "../backup/email-config.mjs";
import { invitationEmailConfig } from "../team/email-config.mjs";
import type { InvitationEmailEnv } from "../team/email";
import type { Database } from "../workforce/context";
import { channelAudience, channelsEnabled } from "./channel-access";
import { announcementAddressHash, announcementEmailAllowed } from "./channels";

export type AnnouncementEmailEnv = InvitationEmailEnv & { STAGE6_ANNOUNCEMENT_EMAIL_ENABLED?: string };
export function announcementEmailAvailable(env: AnnouncementEmailEnv) {
  return env.STAGE6_ANNOUNCEMENT_EMAIL_ENABLED === "true" && invitationEmailConfig(env).configured;
}

export async function dispatchAnnouncementEmails(db: Database, env: AnnouncementEmailEnv, now = Date.now()) {
  if (!announcementEmailAvailable(env)) return;
  const config = invitationEmailConfig(env);
  const stamp = new Date(now).toISOString();
  await db.run(sql`UPDATE channel_announcement_recipients SET state='uncertain',lease_token=NULL,lease_until=NULL,updated_at=${stamp}
    WHERE state='sending' AND lease_until<=${stamp}`);
  await db.run(sql`UPDATE channel_announcement_recipients SET state='cancelled',updated_at=${stamp} WHERE state='pending' AND expires_at<=${stamp}`);
  const jobs = await db.all<{ postId: number; accountId: number }>(sql`SELECT post_id AS postId,account_id AS accountId
    FROM channel_announcement_recipients WHERE state='pending' ORDER BY updated_at,post_id,account_id LIMIT 8`);
  await Promise.all(jobs.map(async ({ postId, accountId }) => {
    const key = sql`post_id=${postId} AND account_id=${accountId}`;
    const token = newToken();
    const claim = await db.run(sql`UPDATE channel_announcement_recipients SET state='sending',lease_token=${token},
      lease_until=${new Date(now + 120_000).toISOString()},updated_at=${stamp}
      WHERE ${key} AND state='pending' AND expires_at>${stamp}`);
    if (!claim.meta.changes) return;
    const row = await db.get<{ email: string; hash: string; title: string; body: string; channel: string }>(sql`SELECT a.normalized_email AS email,
      r.destination_hash AS hash,p.title,p.body,p.channel FROM channel_announcement_recipients r JOIN channel_posts p ON p.id=r.post_id
      JOIN accounts a ON a.id=r.account_id WHERE r.post_id=${postId} AND r.account_id=${accountId} AND r.lease_token=${token}
      AND p.title IS NOT NULL AND ${channelsEnabled} AND ${channelAudience(sql`p.channel`)} AND ${announcementEmailAllowed}`);
    let state = "cancelled";
    if (row && validEmail(row.email) && announcementAddressHash(row.email) === row.hash) {
      state = "uncertain";
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const sent = await Promise.race([
          env.INVITATION_EMAIL!.send({ from: { name: "DomBase", email: config.sender! }, replyTo: config.replyTo!, to: row.email,
            subject: "DomBase announcement: " + row.title.replace(/[\r\n]+/g, " "),
            text: row.body + "\n\nOpen DomBase to confirm that you read it.\n" + config.origin + "/messages/channels?channel=" + row.channel + "&post=" + postId }),
          new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 10000); }),
        ]);
        if (sent?.messageId) state = "accepted";
      } catch { /* An uncertain provider response is never retried. */ }
      finally { clearTimeout(timeout); }
    }
    await db.run(sql`UPDATE channel_announcement_recipients SET state=${state},lease_token=NULL,lease_until=NULL,updated_at=${stamp}
      WHERE ${key} AND lease_token=${token}`);
  }));
}
