import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { newToken } from "../auth/crypto";
import { decryptSsn } from "../workforce/private";
import { permissionCatalog } from "../access/policy";
import { validEmail } from "../backup/email-config.mjs";
import { invitationEmailConfig } from "./email-config.mjs";
import type { Database } from "../workforce/context";

export type InvitationEmailEnv = {
  INVITATION_EMAIL?: { send: (message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string }) => Promise<{ messageId: string }> };
  INVITATION_EMAIL_FROM?: string; INVITATION_EMAIL_REPLY_TO?: string; INVITATION_EMAIL_ORIGIN?: string;
  AUTH_PRIVATE_FIELD_KEY?: string;
};

// Recheck the issuer's current grants and department scope at delivery, not just
// when the invitation was queued. No browser session or client-supplied role.
export function deliverableInvitation(id: string, stamp: string) {
  const grants = ["team.read", "team.invite", "team.contact.read"].map(permission => {
    const defaults = permissionCatalog.find(p => p.id === permission)!;
    return sql`(a.access_level = 'owner' OR COALESCE((SELECT allowed FROM account_permissions WHERE account_id = a.id AND permission = ${permission}), CASE WHEN a.access_level = 'general_manager' THEN ${Number(defaults.generalManager)} ELSE ${Number(defaults.manager)} END) = 1)`;
  });
  return sql`EXISTS (SELECT 1 FROM team_invitations i JOIN employees e ON e.id = i.employee_id JOIN accounts a ON a.id = i.issued_by_account_id
    WHERE i.id = ${id} AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ${stamp}
    AND e.active = 1 AND e.terminated = 0 AND (i.channel <> 'email' OR lower(trim(e.email)) = lower(i.recipient))
    AND a.session_version = i.issuer_version AND a.login_enabled = 1 AND a.disabled_at IS NULL AND a.access_level IN ('owner','general_manager','manager')
    AND ${sql.join(grants, sql` AND `)}
    AND (a.access_level <> 'manager' OR EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id JOIN departments d ON d.id = r.department_id JOIN department_managers dm ON dm.department_id = d.id
      WHERE er.employee_id = e.id AND er.active = 1 AND r.archived = 0 AND d.archived = 0 AND dm.account_id = a.id))
    AND NOT EXISTS (SELECT 1 FROM accounts existing WHERE existing.employee_id = e.id OR (i.channel = 'email' AND existing.normalized_email = lower(i.recipient))))`;
}

export async function dispatchInvitationEmails(db: Database, env: InvitationEmailEnv, now = Date.now(), limit = 10) {
  const config = invitationEmailConfig(env);
  if (!config.configured || !env.AUTH_PRIVATE_FIELD_KEY) return { accepted: 0, failed: 0 };
  const stamp = new Date(now).toISOString();
  const due = sql`state IN ('pending','sending') AND next_attempt_at <= ${stamp} AND (lease_until IS NULL OR lease_until <= ${stamp})`;
  const rows = await db.select().from(s.invitationEmails).where(due).orderBy(s.invitationEmails.nextAttemptAt).limit(Math.min(10, Math.max(1, limit)));
  const results = await Promise.all(rows.map(async row => {
    const token = newToken(); const valid = deliverableInvitation(row.invitationId, stamp);
    const exhausted = row.attempts >= 4;
    if (exhausted) {
      await db.run(sql`UPDATE invitation_emails SET state = 'failed', lease_token = NULL, lease_until = NULL, updated_at = ${stamp} WHERE invitation_id = ${row.invitationId} AND ${due} AND attempts >= 4`);
      return "failed";
    }
    const claimed = await db.run(sql`UPDATE invitation_emails SET state = 'sending', attempts = attempts + 1, lease_token = ${token}, lease_until = ${new Date(now + 120000).toISOString()}, updated_at = ${stamp}
      WHERE invitation_id = ${row.invitationId} AND ${due} AND attempts < 4 AND ${valid}`);
    if (!claimed.meta.changes) {
      await db.run(sql`UPDATE invitation_emails SET state = 'cancelled', lease_token = NULL, lease_until = NULL, updated_at = ${stamp} WHERE invitation_id = ${row.invitationId} AND ${due} AND NOT (${valid})`);
      return "skipped";
    }
    const [invitation] = await db.select().from(s.teamInvitations).where(and(eq(s.teamInvitations.id, row.invitationId), valid)).limit(1);
    if (!invitation) {
      await db.run(sql`UPDATE invitation_emails SET state = 'cancelled', lease_token = NULL, lease_until = NULL, updated_at = ${stamp} WHERE invitation_id = ${row.invitationId} AND lease_token = ${token}`);
      return "skipped";
    }
    let accepted = false; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!validEmail(invitation.recipient) || invitation.channel !== "email") throw new Error("Invalid email.");
      const secret = decryptSsn(invitation.localTokenEncrypted, invitation.employeeId, env.AUTH_PRIVATE_FIELD_KEY!, `invitation:${invitation.id}`);
      const [person] = await db.select({ name: s.employees.name }).from(s.employees).where(eq(s.employees.id, invitation.employeeId)).limit(1);
      const link = `${config.origin}/invite#token=${secret}`;
      const expires = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(invitation.expiresAt));
      const response = await Promise.race([
        env.INVITATION_EMAIL!.send({ to: invitation.recipient, from: { email: config.sender!, name: "Molding Mart" }, replyTo: config.replyTo!, subject: "Molding Mart: your DomBase invitation",
          text: `Hello ${person?.name ?? "there"},\n\nMolding Mart invited you to set up your employee profile in DomBase, our team scheduling and time clock app.\n\nUse this private link to choose your password:\n${link}\n\nThe link expires ${expires} (Pacific time) and works once. If your manager resends the invitation, use the newest email. Do not forward this link.\n\nIf you were not expecting this invitation, ignore it. No account is created until you accept. Reply to this email if you need help.\n\nMolding Mart\nSacramento, California\n` }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Email service timed out.")), 10000); }),
      ]);
      accepted = typeof response?.messageId === "string" && Boolean(response.messageId);
    } catch { /* Never log provider errors: they can include addresses and tokens. */ }
    finally { clearTimeout(timer); }
    const attempts = row.attempts + 1;
    await db.run(sql`UPDATE invitation_emails SET state = ${accepted ? "accepted" : attempts >= 4 ? "failed" : "pending"}, accepted_at = ${accepted ? stamp : null},
      next_attempt_at = ${new Date(now + [60000, 300000, 900000, 900000][attempts - 1]).toISOString()}, lease_token = NULL, lease_until = NULL, updated_at = ${stamp}
      WHERE invitation_id = ${row.invitationId} AND lease_token = ${token}`);
    // Provider acceptance is not Inbox delivery. Ambiguous timeouts can cause a
    // duplicate on retry; retries always use the same one-use invitation.
    return accepted ? "accepted" : "failed";
  }));
  return { accepted: results.filter(r => r === "accepted").length, failed: results.filter(r => r === "failed").length };
}
