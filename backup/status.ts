import { sql } from "drizzle-orm";
import { AuthError, json } from "../auth/http";
import type { createAccessService } from "../access/service";
import type { drizzle } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import type { BackupService } from "./schedule";

export type BackupStatus = {
  configured: boolean; schedule?: string; retention?: string; encrypted?: boolean; stale?: boolean; checkedAt?: string;
  lastSuccess?: { localDay: string; createdAt: string; tables: number; migrations: number; rows: number; objects: number; encryptedBytes: number; fingerprint: string } | null;
  lastAttempt?: { at: string; state: "running" | "succeeded" | "failed"; localDay: string; category?: string } | null;
};
export async function readBackupStatus(service?: BackupService): Promise<BackupStatus> {
  if (!service) return { configured: false };
  const response = await service.fetch(new Request("https://backup.internal/status"));
  if (!response.ok) throw new Error("Backup status unavailable.");
  const body = await response.json() as BackupStatus;
  if (body.configured !== true || typeof body.stale !== "boolean") throw new Error("Invalid backup status.");
  const success = body.lastSuccess;
  const attempt = body.lastAttempt;
  if (success && (!/^\d{4}-\d{2}-\d{2}$/.test(success.localDay) || !Number.isFinite(Date.parse(success.createdAt)) || ![success.tables, success.migrations, success.rows, success.objects, success.encryptedBytes].every(value => Number.isSafeInteger(value) && value >= 0) || !/^[0-9a-f]{64}$/.test(success.fingerprint))) throw new Error("Invalid completed backup status.");
  if (attempt && (!["running", "succeeded", "failed"].includes(attempt.state) || !Number.isFinite(Date.parse(attempt.at)) || !/^\d{4}-\d{2}-\d{2}$/.test(attempt.localDay))) throw new Error("Invalid backup attempt status.");
  // Only counts/times/status cross into the dashboard; never archive keys,
  // credential envelopes, SQL, document names or application secrets.
  return { configured: true, schedule: "Daily after 2:00 AM Pacific time", retention: "All backups kept; no automatic deletion", encrypted: true, stale: body.stale, checkedAt: body.checkedAt,
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
