import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, isLoopback, json, readAuthBody } from "../auth/http";
import { newToken, tokenHash, hashPassword, passwordIsValid } from "../auth/crypto";
import { atomicBatch } from "../kiosk/database";
import { registeredDevice } from "../kiosk/device";
import { attemptBudget } from "../kiosk/security";
import { encryptSsn, decryptSsn } from "../workforce/private";
import type { Database, Context } from "../workforce/context";
import type { WorkspaceTransaction } from "../workforce/transaction";
import * as v from "../workforce/validation";
export function invitation(tx: WorkspaceTransaction, employeeId: number, channel: "email" | "sms", recipient: string, key: string, time: number, issuerVersion: number) {
  const id = newToken(); const token = newToken();
  tx.write(sql`UPDATE team_invitations SET revoked_at = ${tx.stamp} WHERE employee_id = ${employeeId} AND used_at IS NULL AND revoked_at IS NULL AND ${tx.receipt}`);
  tx.insert(s.teamInvitations, { id, employeeId, channel, recipient, tokenHash: tokenHash(token), localTokenEncrypted: encryptSsn(token, employeeId, key, `invitation:${id}`), issuedByAccountId: tx.ctx.account.id, issuerVersion, expiresAt: new Date(time + 3600000).toISOString(), createdAt: tx.stamp, updatedAt: tx.stamp });
}
export async function localInbox(db: Database, ctx: Context, request: Request, key: string, time: number) {
  ctx.requirePermission("team.invite"); ctx.requirePermission("team.contact.read");
  if (!isLoopback(new URL(request.url).hostname)) throw new AuthError(403, "The local delivery inbox is available only on this computer.");
  const rows = await db.select().from(s.teamInvitations).where(and(ctx.employeeFilter(s.teamInvitations.employeeId), sql`used_at IS NULL AND revoked_at IS NULL AND expires_at > ${new Date(time).toISOString()} AND EXISTS (SELECT 1 FROM accounts issuer WHERE issuer.id = ${s.teamInvitations.issuedByAccountId} AND issuer.session_version = ${s.teamInvitations.issuerVersion} AND issuer.disabled_at IS NULL AND issuer.login_enabled = 1)`)).orderBy(s.teamInvitations.createdAt).limit(100);
  return { messages: rows.map(row => ({ id: row.id, employeeId: row.employeeId, channel: row.channel, recipient: row.recipient, expiresAt: row.expiresAt, status: "Captured locally; not sent", url: `${new URL(request.url).origin}/invite#token=${decryptSsn(row.localTokenEncrypted, row.employeeId, key, `invitation:${row.id}`)}` })) };
}
export function createInvitationService(db: Database, secret: string, now = Date.now) {
  async function handle(request: Request) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
      if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use a personal browser for an invitation.");
      const body = await readAuthBody(request); v.keys(body, url.pathname.endsWith("/accept") ? ["token", "email", "password"] : ["token"]);
      await attemptBudget(db, secret, `invitation-network:${isLoopback(url.hostname) ? "local" : request.headers.get("cf-connecting-ip") ?? "unknown"}`, 40, now());
      if (typeof body.token !== "string" || !/^[\w-]{43}$/.test(body.token)) throw new AuthError(401, "Invitation is invalid or expired.");
      await attemptBudget(db, secret, `invitation-token:${tokenHash(body.token)}`, 10, now());
      const [row] = await db.select({ invite: s.teamInvitations, person: s.employees }).from(s.teamInvitations).innerJoin(s.employees, eq(s.employees.id, s.teamInvitations.employeeId)).where(eq(s.teamInvitations.tokenHash, tokenHash(body.token))).limit(1);
      if (!row || row.invite.usedAt || row.invite.revokedAt || row.invite.expiresAt <= new Date(now()).toISOString() || !row.person.active || row.person.terminated || !await db.get(sql`SELECT 1 FROM accounts WHERE id = ${row.invite.issuedByAccountId} AND session_version = ${row.invite.issuerVersion} AND disabled_at IS NULL AND login_enabled = 1`)) throw new AuthError(401, "Invitation is invalid or expired.");
      if (url.pathname === "/api/invitations/inspect") return json({ name: row.person.name, email: row.invite.channel === "email" ? row.invite.recipient : "", channel: row.invite.channel });
      if (url.pathname !== "/api/invitations/accept") throw new AuthError(404, "Not found.");
      const email = v.text(body.email, 254, true).toLowerCase();
      if (!/^[\x21-\x7e]+$/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (row.invite.channel === "email" && email !== row.invite.recipient.toLowerCase())) throw new AuthError(400, "Use the invited email, or enter a valid sign-in email for a phone invitation.");
      if (!passwordIsValid(body.password)) throw new AuthError(400, "Use a password with 15–128 characters.");
      const hash = await hashPassword(body.password); const receipt = newToken(); const stamp = new Date(now()).toISOString();
      const result = await atomicBatch(db, [
        sql`UPDATE team_invitations SET used_at = ${stamp}, acceptance_receipt = ${receipt}, updated_at = ${stamp} WHERE id = ${row.invite.id} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ${stamp}
          AND EXISTS (SELECT 1 FROM employees WHERE id = ${row.person.id} AND active = 1 AND terminated = 0)
          AND EXISTS (SELECT 1 FROM accounts WHERE id = ${row.invite.issuedByAccountId} AND session_version = ${row.invite.issuerVersion} AND disabled_at IS NULL AND login_enabled = 1)
          AND NOT EXISTS (SELECT 1 FROM accounts WHERE normalized_email = ${email} OR employee_id = ${row.person.id})`,
        sql`INSERT INTO accounts (employee_id, email, normalized_email, display_name, access_level, password_hash, login_enabled)
          SELECT ${row.person.id}, ${email}, ${email}, ${row.person.name}, 'employee', ${hash}, 1 FROM team_invitations WHERE id = ${row.invite.id} AND acceptance_receipt = ${receipt}`,
        sql`INSERT INTO audit_log (actor_account_id, employee_id, action, entity_type, entity_id, created_at)
          SELECT a.id, ${row.person.id}, 'employee.invitation_accepted', 'invitation', ${row.invite.id}, ${stamp} FROM accounts a JOIN team_invitations i ON i.employee_id = a.employee_id
          WHERE i.id = ${row.invite.id} AND i.acceptance_receipt = ${receipt}`,
        sql`UPDATE team_invitations SET updated_at = ${stamp}, revoked_at = CASE WHEN id = ${row.invite.id} THEN revoked_at ELSE ${stamp} END
          WHERE employee_id = ${row.person.id} AND EXISTS (SELECT 1 FROM team_invitations WHERE id = ${row.invite.id} AND acceptance_receipt = ${receipt})`,
      ]);
      if (result[0].meta.changes !== 1) throw new AuthError(409, "The invitation changed or an account already exists. Sign in or ask an Owner to review access.");
      return json({ ready: true });
    } catch (error) { if (error instanceof AuthError) return json({ error: error.message }, error.status); console.error("Invitation request failed."); return json({ error: "Could not accept the invitation. Ask an Owner to review its status." }, 503); }
  }
  return { handle };
}
