import { mkdir, mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { configPath, persistPath, projectRoot } from "./local-db.mjs";
import { loadServerModule } from "./server-runtime.mjs";
import { containedBackup, createBackup, readBackup, readLocalSecrets, recoveryKey, privateFile, restoreIntoEmpty, invalidateRecoveredAccess, rowsOf, writePrivateJson } from "./backup-core.mjs";
const directory = join(projectRoot, ".wrangler/backups/local");
const keyPath = join(projectRoot, ".wrangler/backup-keys/local-recovery.key");
const args = process.argv.slice(2); const action = args.shift();
if (!["create", "daily", "verify"].includes(action) || action === "verify" && (args.length !== 2 || args[0] !== "--file") || action !== "verify" && args.length) throw new Error("Use create or daily without overrides, or verify --file PRIVATE_LOCAL_BACKUP. No remote or restore-target overrides are allowed.");
const { getPlatformProxy } = await import("wrangler"); let source;
async function verify(file, key) {
  const payload = await readBackup(file, key);
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const temporary = await mkdtemp(join(projectRoot, ".wrangler/recovery-check-")); let platform;
  try {
    platform = await getPlatformProxy({ configPath, persist: { path: join(temporary, "v3") }, remoteBindings: false, envFiles: [] });
    const database = platform.env.DB;
    const result = await restoreIntoEmpty({ database, bucket: platform.env.FILES, payload });
    const { decryptSsn } = await loadServerModule("workforce/private.ts");
    const encryptedProfiles = rowsOf(payload.snapshot, "employee_profiles").filter(profile => profile.ssn_encrypted);
    for (const profile of encryptedProfiles) decryptSsn(profile.ssn_encrypted, profile.employee_id, payload.secrets.AUTH_PRIVATE_FIELD_KEY);
    await invalidateRecoveredAccess(database);
    const queries = ["SELECT COUNT(*) AS count FROM account_sessions WHERE revoked_at IS NULL", "SELECT COUNT(*) AS count FROM account_setup_tokens WHERE used_at IS NULL", "SELECT COUNT(*) AS count FROM device_sessions WHERE revoked_at IS NULL", "SELECT COUNT(*) AS count FROM kiosk_devices WHERE revoked_at IS NULL", "SELECT COUNT(*) AS count FROM kiosk_interactions WHERE ended_at IS NULL", "SELECT COUNT(*) AS count FROM kiosk_approval_sessions WHERE used_at IS NULL", "SELECT COUNT(*) AS count FROM kiosk_clock_requests WHERE completed_at IS NULL AND cancelled_at IS NULL"];
    const security = await database.batch(queries.map(query => database.prepare(query)));
    if (security.some(row => row.results[0].count)) throw new Error("Restored session invalidation was not complete.");
    if (rowsOf(payload.snapshot, "audit_log").length) {
      let protectedAudit = false; try { await database.prepare("UPDATE audit_log SET action=action WHERE id=(SELECT MIN(id) FROM audit_log)").run(); } catch { protectedAudit = true; }
      if (!protectedAudit) throw new Error("Restored audit protection is unavailable.");
    }
    const sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
    const report = { backup: basename(file), verifiedAt: new Date().toISOString(), createdAt: payload.createdAt, localDay: payload.localDay, sha256, ...result, privateFields: { matchingKeysIncluded: true, encryptedRecordsVerified: encryptedProfiles.length }, oldSessions: "revoked in isolated copy", auditProtection: "passed", sourceModified: false, isolatedRestore: true };
    await writePrivateJson(file + ".verified.json", report);
    return report;
  } finally { try { await platform?.dispose(); } finally { await rm(temporary, { recursive: true, force: true }); } }
}
try {
  if (action === "verify") {
    await privateFile(keyPath); const key = await readFile(keyPath); if (key.length !== 32) throw new Error("Recovery key is invalid; it was not changed.");
    console.log(JSON.stringify(await verify(await containedBackup(resolve(args[1]), directory), key)));
  } else {
    // Never silently replace a lost key when prior encrypted archives exist.
    let existing = []; try { existing = (await readdir(directory)).filter(name => name.endsWith(".dombase")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing.length) await privateFile(keyPath);
    const key = await recoveryKey(keyPath);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    let prior;
    if (action === "daily") for (const name of existing.sort().reverse()) {
      try {
        const file = await containedBackup(join(directory, name), directory); await privateFile(file + ".verified.json");
        const report = JSON.parse(await readFile(file + ".verified.json", "utf8"));
        if (report.localDay === today && report.isolatedRestore === true && report.sha256 === createHash("sha256").update(await readFile(file)).digest("hex")) {
          const payload = await readBackup(file, key);
          if (payload.localDay !== today || payload.createdAt !== report.createdAt) continue;
          prior = name; break;
        }
      } catch { /* An unverified/damaged archive cannot satisfy today's daily job. */ }
    }
    if (prior) console.log(JSON.stringify({ skipped: true, localDay: today, verifiedBackup: prior, reason: "An authenticated, restore-verified local backup already exists for this day." }));
    else {
      const secrets = await readLocalSecrets(join(projectRoot, ".dev.vars"));
      source = await getPlatformProxy({ configPath, persist: { path: join(persistPath, "v3") }, remoteBindings: false, envFiles: [] });
      const backup = await createBackup({ database: source.env.DB, bucket: source.env.FILES, secrets, directory, key });
      const report = await verify(backup.file, key);
      console.log(JSON.stringify({ ...backup, ...report, recoveryKey: keyPath, encrypted: true, scheduled: false }));
    }
  }
} catch (error) {
  // Low-level driver errors can contain private SQL parameters; report phase only.
  const safe = /^(?:Backup authentication failed|A published or retained document|Document bytes|Restored |Recovery requires|Choose an encrypted|Backup inputs|Invalid local recovery|Local backup|The matching local|ENOENT)/.test(error.message);
  console.error(safe ? error.message : `Local backup/recovery failed (${error.code ?? error.name ?? "error"}); private database, file and key contents withheld.`); process.exitCode = 1;
} finally { await source?.dispose(); }
