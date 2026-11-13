import { sql } from "drizzle-orm";
import { AuthError, json } from "../auth/http";
import type { createAccessService } from "../access/service";
import type { drizzle } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import type { BackupService } from "./schedule";

export type BackupAlert = { id: string; kind: "failed" | "stale"; detectedAt: string; expectedDay: string; attemptAt?: string };
export type BackupRecovery = { incidentId: string; kind: "failed" | "stale"; detectedAt: string; recoveredAt: string };
export type BackupEmailStatus = { configured: boolean; recipient: string | null; state: "not_configured" | "ready" | "pending" | "accepted" | "retrying" | "unavailable"; lastAcceptedAt?: string };
export type BackupStatus = {
  configured: boolean; schedule?: string; retention?: string; encrypted?: boolean; stale?: boolean; checkedAt?: string;
  lastSuccess?: { localDay: string; createdAt: string; tables: number; migrations: number; rows: number; objects: number; encryptedBytes: number; fingerprint: string } | null;
  lastAttempt?: { at: string; state: "running" | "succeeded" | "failed"; localDay: string; category?: string } | null;
  alerts?: { active: BackupAlert | null; lastRecovery: BackupRecovery | null };
  email?: BackupEmailStatus;
};
function safeEmail(value: BackupEmailStatus | undefined): BackupEmailStatus | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value.configured !== "boolean" || !["not_configured", "ready", "pending", "accepted", "retrying", "unavailable"].includes(value.state)
    || (value.recipient !== null && (typeof value.recipient !== "string" || value.recipient.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[A-Za-z]{2,}$/.test(value.recipient)))
    || (value.lastAcceptedAt !== undefined && (typeof value.lastAcceptedAt !== "string" || !Number.isFinite(Date.parse(value.lastAcceptedAt))))) throw new Error("Invalid backup email status.");
  return { configured: value.configured, recipient: value.recipient, state: value.state, ...(value.lastAcceptedAt ? { lastAcceptedAt: value.lastAcceptedAt } : {}) };
}
function safeAlerts(value: BackupStatus["alerts"]): BackupStatus["alerts"] {
  if (value === undefined) return undefined; // Rolling deployment of the backup service.
  if (!value || typeof value !== "object") throw new Error("Invalid backup alerts.");
  const { active, lastRecovery } = value;
  const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
  const id = (v: unknown): v is string => typeof v === "string" && /^backup-(failed|stale)-[0-9TZ:.+-]{10,80}$/.test(v);
  const kind = (v: unknown) => v === "failed" || v === "stale";
  if (active && (!id(active.id) || !kind(active.kind) || !time(active.detectedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(active.expectedDay) || (active.kind === "failed" && !time(active.attemptAt)))) throw new Error("Invalid backup alert.");
  if (lastRecovery && (!id(lastRecovery.incidentId) || !kind(lastRecovery.kind) || !time(lastRecovery.detectedAt) || !time(lastRecovery.recoveredAt))) throw new Error("Invalid backup recovery.");
  return { active: active ? { id: active.id, kind: active.kind, detectedAt: active.detectedAt, expectedDay: active.expectedDay, ...(active.kind === "failed" ? { attemptAt: active.attemptAt } : {}) } : null,
    lastRecovery: lastRecovery ? { incidentId: lastRecovery.incidentId, kind: lastRecovery.kind, detectedAt: lastRecovery.detectedAt, recoveredAt: lastRecovery.recoveredAt } : null };
}
export async function readBackupStatus(service?: BackupService): Promise<BackupStatus> {
  if (!service) return { configured: false };
  const response = await service.fetch(new Request("https://backup.internal/status"));
  if (!response.ok) throw new Error("Backup status unavailable.");
  const body = await response.json() as BackupStatus;
  if (body.configured !== true || typeof body.stale !== "boolean" || typeof body.checkedAt !== "string" || !Number.isFinite(Date.parse(body.checkedAt))) throw new Error("Invalid backup status.");
  const success = body.lastSuccess;
  const attempt = body.lastAttempt;
  if (success && (!/^\d{4}-\d{2}-\d{2}$/.test(success.localDay) || !Number.isFinite(Date.parse(success.createdAt)) || ![success.tables, success.migrations, success.rows, success.objects, success.encryptedBytes].every(value => Number.isSafeInteger(value) && value >= 0) || !/^[0-9a-f]{64}$/.test(success.fingerprint))) throw new Error("Invalid completed backup status.");
  if (attempt && (!["running", "succeeded", "failed"].includes(attempt.state) || !Number.isFinite(Date.parse(attempt.at)) || !/^\d{4}-\d{2}-\d{2}$/.test(attempt.localDay))) throw new Error("Invalid backup attempt status.");
  // Only counts/times/status cross into the dashboard; never archive keys,
  // credential envelopes, SQL, document names or application secrets.
  const alerts = safeAlerts(body.alerts);
  const email = safeEmail(body.email);
  return { configured: true, schedule: "Daily after 2:00 AM Pacific time", retention: "All backups kept; no automatic deletion", encrypted: true, stale: body.stale, checkedAt: body.checkedAt, ...(alerts ? { alerts } : {}), ...(email ? { email } : {}),
    lastSuccess: success ? { localDay: success.localDay, createdAt: success.createdAt, tables: success.tables, migrations: success.migrations, rows: success.rows, objects: success.objects, encryptedBytes: success.encryptedBytes, fingerprint: success.fingerprint } : null,
    lastAttempt: attempt ? { at: attempt.at, state: attempt.state, localDay: attempt.localDay, ...(attempt.category && ["configuration", "database", "files", "archive", "completion"].includes(attempt.category) ? { category: attempt.category } : {}) } : null };
}
export function createBackupStatusService(db: ReturnType<typeof drizzle<typeof schema>>, access: ReturnType<typeof createAccessService>, service?: BackupService) {
  return { async handle(request: Request) {
    try {
      const actor = await access.authorize(request, "settings.manage");
      if (actor.account.accessLevel !== "owner") throw new AuthError(403, "Only an Owner can view backup status.");
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
      const state = await readBackupStatus(service);
      if (!await db.get(sql`SELECT 1 WHERE ${actor.activeActor()}`)) throw new AuthError(401, "Sign in again.");
      return json(state);
    } catch (error) { return error instanceof AuthError ? json({ error: error.message }, error.status) : json({ error: "Backup status is unavailable. Retry shortly; a missing daily backup needs attention." }, 503); }
  } };
}
