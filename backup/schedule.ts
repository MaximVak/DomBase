export type BackupService = { fetch(request: Request): Promise<Response> };
export type BackupScheduleEnv = {
  BACKUP_SERVICE?: BackupService;
  AUTH_RATE_LIMIT_SECRET?: unknown;
  AUTH_PRIVATE_FIELD_KEY?: unknown;
};

export async function scheduleHostedBackup(env: BackupScheduleEnv) {
  if (!env.BACKUP_SERVICE) return;
  const response = await env.BACKUP_SERVICE.fetch(new Request("https://backup.internal/daily", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ AUTH_RATE_LIMIT_SECRET: String(env.AUTH_RATE_LIMIT_SECRET ?? ""), AUTH_PRIVATE_FIELD_KEY: String(env.AUTH_PRIVATE_FIELD_KEY ?? "") }),
  }));
  if (!response.ok) throw new Error("The daily backup service reported a failure; check the Owner backup status.");
}
