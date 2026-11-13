import type { BackupStatus } from "./status";

export function backupNotice(status: BackupStatus | null, unavailable: boolean, details = false) {
  if (unavailable) return { tone: "warning", title: "Backup monitoring unavailable", detail: "DomBase cannot confirm backup health. Check again shortly; this does not confirm that a backup succeeded." };
  if (!status) return null;
  if (!status.configured) return { tone: "warning", title: "Automatic backups are not configured", detail: "Automatic hosted backups are not configured in this environment." };
  const active = status.alerts?.active;
  if (active?.kind === "failed" || (!status.alerts && status.lastAttempt?.state === "failed")) return { tone: "warning", title: "Daily backup failed", detail: "A backup attempt failed. Automatic retries continue every 15 minutes. This warning stays until a completed backup confirms recovery." };
  if (active?.kind === "stale" || (!status.alerts && status.stale)) return { tone: "warning", title: "Daily backup is overdue", detail: "The expected daily backup has not completed. Check backup details. Automatic retries continue; previous completed backups remain available." };
  if (status.offsite?.state === "failed") return { tone: "warning", title: "Backblaze backup copy needs attention", detail: "The independent encrypted backup copy failed or is overdue. Cloudflare backup health is shown separately in Backups. Automatic retries continue." };
  const recovery = status.alerts?.lastRecovery;
  if (recovery && (details || Date.parse(status.checkedAt ?? "") - Date.parse(recovery.recoveredAt) < 86400000)) return { tone: "success", title: "Backup protection restored", detail: "A successful backup has cleared the previous warning." };
  if (!details) return null;
  if (status.lastAttempt?.state === "running") return { tone: "neutral", title: "Daily backup is running", detail: "The backup is in progress. Its completion will be checked automatically." };
  if (status.stale) return { tone: "neutral", title: "Today's backup is pending", detail: "The daily job starts after 2:00 AM Pacific. A missing completion raises an overdue alert at 4:00 AM; failures are reported immediately." };
  return { tone: "success", title: "Daily backup saved", detail: "The latest daily database and file backup completed successfully." };
}

export const formatBackupTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
