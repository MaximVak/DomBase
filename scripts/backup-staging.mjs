import { readFile, writeFile, mkdtemp, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingBucket, stagingBackupName, stagingConfig, stagingPath, projectRoot, wrangler } from "./staging.mjs";
import { privateDirectory, privateFile, restoreIntoEmpty, invalidateRecoveredAccess, writePrivateJson } from "./backup-core.mjs";
import { publicFingerprint, wrapDataKey, unwrapDataKey } from "../backup/hosted-format.mjs";
import { recoverHostedBundle } from "../backup/recovery.mjs";
import { rowsOf, hash } from "../backup/snapshot.mjs";
import { configPath } from "./local-db.mjs";
import { loadServerModule } from "./server-runtime.mjs";

const configFile = resolve(projectRoot, "wrangler.backup.jsonc");
const keyFile = resolve(projectRoot, ".wrangler/backup-keys/staging-recovery.json");
const [action, ...args] = process.argv.slice(2);
if (!["configure", "deploy", "status", "verify"].includes(action) || action !== "verify" && args.length || action === "verify" && (args.length !== 2 || args[0] !== "--day" || !/^\d{4}-\d{2}-\d{2}$/.test(args[1]))) throw new Error("Use configure, deploy or status without overrides; verify requires --day YYYY-MM-DD. No restore target or account overrides.");
const app = await readStagingConfig();
const { backupEmailConfigBlock } = await import("../backup/email-config.mjs");
let emailConfig = {};
try { emailConfig = backupEmailConfigBlock(JSON.parse(await readFile(configFile, "utf8"))); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const expected = {
  $schema: "./node_modules/wrangler/config-schema.json", name: stagingBackupName, account_id: stagingAccount,
  main: "./backup/worker.mjs", compatibility_date: "2026-05-15", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  d1_databases: app.d1_databases,
  r2_buckets: [{ binding: "FILES", bucket_name: stagingBucket }, { binding: "BACKUPS", bucket_name: stagingBackupName }],
  limits: { cpu_ms: 30000 }, observability: { enabled: true },
  ...emailConfig,
};
async function validateRecovery(recovery) {
  if (recovery?.version !== 1 || !recovery.privateKey?.d || publicFingerprint(recovery.publicKey) !== recovery.fingerprint || recovery.privateKey.n !== recovery.publicKey.n) throw new Error("Invalid recovery key file; it was not replaced.");
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const recovered = await unwrapDataKey(await wrapDataKey(probe, recovery.publicKey), recovery.privateKey);
  if (probe.some((value, index) => value !== recovered[index])) throw new Error("Recovery key pair verification failed.");
}
async function privateBucket() {
  const result = await cloudflare(`/accounts/${stagingAccount}/r2/buckets`); const buckets = result.buckets ?? result;
  if (!Array.isArray(buckets)) throw new Error("Unexpected R2 inventory.");
  if (!buckets.some(row => row.name === stagingBackupName)) return { exists: false };
  const base = `/accounts/${stagingAccount}/r2/buckets/${stagingBackupName}`;
  const [managed, custom, lifecycle] = await Promise.all([cloudflare(base + "/domains/managed"), cloudflare(base + "/domains/custom"), cloudflare(base + "/lifecycle")]);
  const domains = custom.domains ?? custom;
  if (managed.enabled !== false || !Array.isArray(domains) || domains.some(d => d.enabled !== false)) throw new Error("Backup bucket must have no public access.");
  const rules = lifecycle.rules ?? [];
  if (!Array.isArray(rules) || rules.some(rule => rule.enabled !== false && /deleteObjects|expiration|expireObjects/i.test(JSON.stringify(rule)))) throw new Error("Automatic backup object deletion must remain disabled.");
  return { exists: true, private: true, automaticDeletion: false };
}
async function download(key, file) {
  if (!/^(?:daily\/\d{4}-\d{2}-\d{2}\.json|control\/status\.json|runs\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/(?:manifest|object-\d{4})\.bin)$/.test(key)) throw new Error("Unexpected backup object key.");
  await writeFile(file, "", { mode: 0o600, flag: "wx" });
  try { await wrangler(["r2", "object", "get", `${stagingBackupName}/${key}`, "--remote", "--config", configFile, "--file", file], { capture: true }); }
  catch { await rm(file, { force: true }); throw new Error("Could not download the private backup object; check scheduled completion and access."); }
  await chmod(file, 0o600); return new Uint8Array(await readFile(file));
}
let phase = "configuration";
try {
  if (action === "configure") {
    let storage = await privateBucket(); let recovery;
    try { await privateFile(keyFile); recovery = JSON.parse(await readFile(keyFile, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (storage.exists) throw new Error("The backup bucket exists but its separate private recovery key is missing. Restore the key; it will not be replaced.");
      const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
      const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
      recovery = { version: 1, createdAt: new Date().toISOString(), publicKey, privateKey, fingerprint: publicFingerprint(publicKey), purpose: "Private DomBase staging backup recovery key. Store outside this Mac and share privately with the company Owner. Never commit, email publicly or paste into a task." };
      await privateDirectory(resolve(keyFile, "..")); await writePrivateJson(keyFile, recovery);
    }
    await validateRecovery(recovery);
    if (!storage.exists) { await wrangler(["r2", "bucket", "create", stagingBackupName, "--config", stagingPath], { capture: true }); storage = await privateBucket(); }
    await writeFile(configFile, JSON.stringify(expected, null, 2) + "\n");
    await writeFile(stagingPath, JSON.stringify(stagingConfig(app.d1_databases[0].database_id, { files: true, maintenance: true, backups: true }), null, 2) + "\n");
    console.log(JSON.stringify({ storage, configurationPrepared: true, deployed: false, recoveryFile: keyFile, publicFingerprint: recovery.fingerprint }));
  } else {
    const configured = JSON.parse(await readFile(configFile, "utf8"));
    if (JSON.stringify(configured) !== JSON.stringify(expected)) throw new Error("Backup Worker configuration differs from the pinned staging target.");
    phase = "storage-and-key-check"; await privateBucket(); await privateFile(keyFile); const recovery = JSON.parse(await readFile(keyFile, "utf8"));
    await validateRecovery(recovery);
    if (action === "deploy") {
      phase = "worker-deploy"; await wrangler(["deploy", "--config", configFile], { capture: true });
      phase = "public-key-configuration"; await wrangler(["secret", "put", "BACKUP_PUBLIC_KEY", "--config", configFile], { input: JSON.stringify(recovery.publicKey) + "\n", capture: true });
      phase = "private-service-check"; const exposure = await cloudflare(`/accounts/${stagingAccount}/workers/scripts/${stagingBackupName}/subdomain`);
      if (exposure.enabled || exposure.previews_enabled) throw new Error("Backup service must not have public Workers or preview URLs.");
      console.log(JSON.stringify({ deployed: true, privateServiceOnly: true, privateKeyUploaded: false, publicFingerprint: recovery.fingerprint }));
    } else if (action === "status") {
      const dir = resolve(projectRoot, ".wrangler/backups/hosted"); await privateDirectory(dir); const temp = await mkdtemp(join(dir, "status-"));
      try { await download("control/status.json", join(temp, "status.json")); const status = JSON.parse(await readFile(join(temp, "status.json"), "utf8")); console.log(JSON.stringify({ bucketPrivate: true, ...status })); }
      finally { await rm(temp, { recursive: true, force: true }); }
    } else {
      const directory = resolve(projectRoot, ".wrangler/backups/hosted"); await privateDirectory(directory); const archive = await mkdtemp(join(directory, `${args[1]}-`));
      await download(`daily/${args[1]}.json`, join(archive, "complete.json")); const receipt = JSON.parse(await readFile(join(archive, "complete.json"), "utf8"));
      if (receipt.localDay !== args[1] || receipt.fingerprint !== recovery.fingerprint) throw new Error("Backup date/key do not match the requested recovery.");
      let number = 0;
      const payload = await recoverHostedBundle(receipt, async (key, size) => { const bytes = await download(key, join(archive, `part-${number++}.bin`)); if (bytes.length !== size) throw new Error("Downloaded encrypted part is incomplete."); return bytes; }, recovery.privateKey);
      const temp = await mkdtemp(resolve(projectRoot, ".wrangler/hosted-recovery-")); let platform;
      try {
        const { getPlatformProxy } = await import("wrangler");
        platform = await getPlatformProxy({ configPath, persist: { path: join(temp, "v3") }, remoteBindings: false, envFiles: [] });
        const result = await restoreIntoEmpty({ database: platform.env.DB, bucket: platform.env.FILES, payload });
        const { decryptSsn } = await loadServerModule("workforce/private.ts"); const profiles = rowsOf(payload.snapshot, "employee_profiles").filter(row => row.ssn_encrypted);
        for (const row of profiles) decryptSsn(row.ssn_encrypted, row.employee_id, payload.secrets.AUTH_PRIVATE_FIELD_KEY);
        await invalidateRecoveredAccess(platform.env.DB);
        const checks = await platform.env.DB.batch(["SELECT count(*) AS n FROM account_sessions WHERE revoked_at IS NULL", "SELECT count(*) AS n FROM device_sessions WHERE revoked_at IS NULL", "SELECT count(*) AS n FROM account_setup_tokens WHERE used_at IS NULL", "SELECT count(*) AS n FROM kiosk_interactions WHERE ended_at IS NULL", "SELECT count(*) AS n FROM kiosk_approval_sessions WHERE used_at IS NULL"].map(sql => platform.env.DB.prepare(sql)));
        if (checks.some(r => r.results[0].n)) throw new Error("Recovered access invalidation failed.");
        let auditProtected = false;
        try { await platform.env.DB.prepare("UPDATE audit_log SET action=action WHERE id=(SELECT min(id) FROM audit_log)").run(); } catch { auditProtected = true; }
        if (!auditProtected) throw new Error("Recovered audit protection failed.");
        const ready = rowsOf(payload.snapshot, "files").find(row => row.status === "ready"); let freshLoginAndDownload = false;
        if (ready) {
          const { drizzle } = await import("drizzle-orm/d1"); const schema = await loadServerModule("db/schema.ts"); const db = drizzle(platform.env.DB, { schema });
          const { createAuthService, issueSetupToken, createAccessService, createDocumentService, newToken } = await loadServerModule("tests/support/workforce-runtime.ts");
          const auth = createAuthService(db, { secret: payload.secrets.AUTH_RATE_LIMIT_SECRET }); const origin = "http://localhost:3000";
          const req = (path, cookie = "", body) => new Request(origin + path, { headers: { Cookie: cookie, ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
          const email = `recovery-check-${newToken()}@example.test`.toLowerCase(); const password = `Private isolated recovery ${newToken()}`;
          const grant = await issueSetupToken(db, { email, displayName: "Isolated recovered-copy verification", accessLevel: "owner" });
          if ((await auth.handle(req("/api/auth/setup", "", { token: grant.token, password }))).status !== 200) throw new Error("Recovered fake account setup failed.");
          const signed = await auth.handle(req("/api/auth/login", "", { email, password })); if (signed.status !== 200) throw new Error("Recovered fresh sign-in failed.");
          const cookie = signed.headers.get("set-cookie").split(";")[0]; const documents = createDocumentService(db, createAccessService(db, auth), { secret: payload.secrets.AUTH_RATE_LIMIT_SECRET, bucket: platform.env.FILES });
          const response = await documents.handle(req(`/api/documents/${ready.id}/download`, cookie));
          if (response.status !== 200 || hash(new Uint8Array(await response.arrayBuffer())) !== ready.sha256) throw new Error("Recovered authorized document download failed.");
          freshLoginAndDownload = true;
        }
        const report = { verifiedAt: new Date().toISOString(), localDay: receipt.localDay, backupId: receipt.id, fingerprint: recovery.fingerprint, ...result, decryptedProfiles: profiles.length, oldAccessRevoked: true, auditProtected, freshLoginAndDownload, isolatedRestore: true, sourceModified: false, encryptedArchiveDirectory: archive };
        await writePrivateJson(join(archive, "verified.json"), report); console.log(JSON.stringify(report));
      } finally { await platform?.dispose(); await rm(temp, { recursive: true, force: true }); }
    }
  }
} catch (error) {
  // Never print provider/driver errors, payloads, private JWKs, SQL or object keys.
  console.error(`Hosted backup operation failed during ${phase} (${error.code ?? error.name ?? "error"}); private details withheld.`); process.exitCode = 1;
}
