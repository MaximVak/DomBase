import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createBackupStatusService, readBackupStatus } from "./status";
import { json } from "../auth/http";
import type { BackupService } from "./schedule";
export async function handleBackupStatus(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const auth = createAuthService(db, { secret: String(env.AUTH_RATE_LIMIT_SECRET ?? "") });
    return createBackupStatusService(db, createAccessService(db, auth), env.BACKUP_SERVICE as BackupService | undefined).handle(request);
  } catch { return json({ error: "Backup status is temporarily unavailable." }, 503); }
}
export async function ownerBackupStatus() {
  const { env } = await import("cloudflare:workers");
  return readBackupStatus(env.BACKUP_SERVICE as BackupService | undefined);
}
