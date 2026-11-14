import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { canonical } from "../workforce/contract";
import { WorkspaceTransaction } from "../workforce/transaction";
import type { Database } from "../workforce/context";
import * as v from "../workforce/validation";
import { atomicBatch } from "../kiosk/database";
import { validEmail } from "../backup/email-config.mjs";
export type SchedulePreferenceContext = { account: { id: number; employeeId: number | null }; guard: SQL; contextToken: string };
export async function readSchedulePreferences(db: Database, ctx: SchedulePreferenceContext) {
  const [row] = await db.select({ revision: s.workforceState.revision, version: s.scheduleNotificationPreferences.version, inApp: s.scheduleNotificationPreferences.inApp, email: s.scheduleNotificationPreferences.email, address: s.employees.email, alerts: s.employeeSettings.sendLocationAlerts, companyAlerts: s.locationSettings.notifyScheduleChanges }).from(s.employees)
    .innerJoin(s.workforceState, eq(s.workforceState.id, 1)).innerJoin(s.locationSettings, eq(s.locationSettings.businessId, 1)).leftJoin(s.employeeSettings, eq(s.employeeSettings.employeeId, s.employees.id)).leftJoin(s.scheduleNotificationPreferences, eq(s.scheduleNotificationPreferences.employeeId, s.employees.id))
    .where(and(eq(s.employees.id, ctx.account.employeeId ?? -1), ctx.guard)).limit(1);
  if (!row) throw new AuthError(401, "Your active employee profile is unavailable.");
  return { revision: row.revision, contextToken: ctx.contextToken, version: row.version ?? 0, inApp: row.inApp ?? true, email: row.email ?? true, hasEmail: validEmail(row.address.trim()), masterEnabled: row.alerts !== false && row.companyAlerts };
}
export async function saveSchedulePreferences(db: Database, ctx: SchedulePreferenceContext, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["id", "contextToken", "revision", "version", "inApp", "email"]);
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
  if (body.contextToken !== ctx.contextToken) throw new AuthError(409, "Your sign-in changed. Reload alert preferences.");
  const revision = v.integer(body.revision, 0), version = v.integer(body.version, 0), inApp = v.boolean(body.inApp), email = v.boolean(body.email), hash = `schedule-preferences:${rateKey(secret, canonical(body))}`;
  const current = await readSchedulePreferences(db, ctx);
  const [prior] = await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id, body.id), ctx.guard)).limit(1);
  if (prior) { if (prior.accountId !== ctx.account.id || prior.bodyHash !== hash) throw new AuthError(409, "This save identifier is already in use."); return { saved: true, revision: prior.revision }; }
  if (current.revision !== revision || current.version !== version) throw new AuthError(409, "Preferences or shared data changed. Reload before saving.");
  const stamp = new Date(now).toISOString(), tx = new WorkspaceTransaction(db, { account: ctx.account, activeActor: () => ctx.guard }, body.id, stamp);
  if (version) tx.update(s.scheduleNotificationPreferences, { inApp, email, version: version + 1, updatedAt: stamp }, sql`employee_id=${ctx.account.employeeId} AND version=${version}`);
  else tx.insert(s.scheduleNotificationPreferences, { employeeId: ctx.account.employeeId, inApp, email, version: 1, createdAt: stamp, updatedAt: stamp });
  tx.insert(s.auditLog, { actorAccountId: ctx.account.id, employeeId: ctx.account.employeeId, action: "schedule.preferences_changed", entityType: "employee", entityId: String(ctx.account.employeeId), metadata: { inApp, email }, createdAt: stamp });
  if (!await tx.commit(revision, hash, ["schedule-notification-preferences"])) throw new AuthError(409, "Your access or shared data changed. Reload before saving.");
  return { saved: true, revision: revision + 1 };
}
export async function readScheduleAlerts(db: Database, ctx: SchedulePreferenceContext, url: URL) {
  if ([...url.searchParams.keys()].some(key => key !== "cursor") || url.searchParams.getAll("cursor").length > 1) throw new AuthError(400, "Schedule alerts do not accept employee selectors.");
  await readSchedulePreferences(db, ctx);
  const cursor = url.searchParams.get("cursor"); let position = sql`1=1`;
  if (cursor) { const id = v.text(cursor, 200, true); const [row] = await db.select({ id: s.notifications.id, at: s.notifications.occurredAt }).from(s.notifications).where(and(eq(s.notifications.id, id), eq(s.notifications.employeeId, ctx.account.employeeId!), eq(s.notifications.kind, "schedule"), ctx.guard)).limit(1); if (!row) throw new AuthError(404, "Alert page is unavailable."); position = sql`(julianday(${s.notifications.occurredAt})<julianday(${row.at}) OR (julianday(${s.notifications.occurredAt})=julianday(${row.at}) AND ${s.notifications.id}<${row.id}))`; }
  const rows = await db.select({ id: s.notifications.id, title: s.notifications.title, detail: s.notifications.detail, at: s.notifications.occurredAt, opened: s.notificationReceipts.openedAt, weekStart: s.schedulePublications.periodStart }).from(s.notifications)
    .leftJoin(s.notificationReceipts, and(eq(s.notificationReceipts.accountId, ctx.account.id), eq(s.notificationReceipts.sourceKey, sql`'schedule-' || ${s.notifications.id}`))).leftJoin(s.schedulePublications, eq(s.schedulePublications.id, s.notifications.publicationId))
    .where(and(eq(s.notifications.employeeId, ctx.account.employeeId!), eq(s.notifications.kind, "schedule"), isNull(s.notificationReceipts.dismissedAt), position, ctx.guard)).orderBy(desc(sql`julianday(${s.notifications.occurredAt})`), desc(s.notifications.id)).limit(51);
  return { contextToken: ctx.contextToken, notices: rows.slice(0, 50).map(row => ({ ...row, opened: !!row.opened })), nextCursor: rows.length > 50 ? rows[49].id : null };
}
export async function saveScheduleAlertReceipt(db: Database, ctx: SchedulePreferenceContext, body: Record<string, unknown>, now: number) {
  v.keys(body, ["notificationId", "action", "contextToken"]); const id = v.text(body.notificationId, 200, true), action = v.oneOf(body.action, ["read", "dismiss"]);
  if (body.contextToken !== ctx.contextToken) throw new AuthError(409, "Your sign-in changed. Reload your alerts.");
  await readSchedulePreferences(db, ctx);
  const own = sql`EXISTS (SELECT 1 FROM notifications n WHERE n.id=${id} AND n.employee_id=${ctx.account.employeeId} AND n.kind='schedule')`;
  if (!await db.get(sql`SELECT 1 WHERE ${own} AND ${ctx.guard}`)) throw new AuthError(404, "Alert is unavailable.");
  const stamp = new Date(now).toISOString(), sourceKey = `schedule-${id}`;
  await atomicBatch(db, [sql`INSERT INTO notification_receipts (account_id,source_key,opened_at,dismissed_at) SELECT ${ctx.account.id},${sourceKey},${stamp},${action === "dismiss" ? stamp : null} WHERE ${own} AND ${ctx.guard}
    ON CONFLICT(account_id,source_key) DO UPDATE SET opened_at=COALESCE(notification_receipts.opened_at,excluded.opened_at),dismissed_at=COALESCE(notification_receipts.dismissed_at,excluded.dismissed_at)
    WHERE ${ctx.guard} AND (notification_receipts.opened_at IS NULL OR (${action === "dismiss" ? 1 : 0}=1 AND notification_receipts.dismissed_at IS NULL))`,
    sql`INSERT INTO audit_log (actor_account_id,employee_id,action,entity_type,entity_id,metadata,created_at) SELECT ${ctx.account.id},${ctx.account.employeeId},${action === "dismiss" ? "schedule.alert_dismissed" : "schedule.alert_read"},'notification',${id},'{}',${stamp} WHERE changes()=1 AND ${ctx.guard}`]);
  if (!await db.get(sql`SELECT 1 WHERE ${ctx.guard}`)) throw new AuthError(401, "Sign in to continue.");
  return { saved: true };
}
