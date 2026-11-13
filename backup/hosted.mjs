import { Buffer } from "node:buffer";
import { snapshotDatabase, rowsOf, checkSecrets, checkFileInventory, hash } from "./snapshot.mjs";
import { backupCalendar, hostedFormat, hostedLimits, encryptPart, wrapDataKey, publicFingerprint, validateCompletion } from "./hosted-format.mjs";
import { expectedBackupDay, nextBackupAlerts } from "./alerts.mjs";
import { readJson, putJson } from "./control.mjs";
import { backupEmailStatus, deliverBackupEmail } from "./email.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const leaseKey = "control/daily-lease.json";
const stateKey = "control/status.json";
async function setStatus(bucket, attempt, success, now = Date.now()) {
  for (let tries = 0; tries < 5; tries++) {
    const prior = await readJson(bucket, stateKey);
    const state = prior?.value ?? {};
    if (attempt && (!state.lastAttempt || Date.parse(attempt.at) >= Date.parse(state.lastAttempt.at)
      || success && attempt.state === "succeeded" && success.localDay >= state.lastAttempt.localDay)) state.lastAttempt = attempt;
    if (success && (!state.lastSuccess || success.localDay >= state.lastSuccess.localDay)) {
      state.lastSuccess = success;
      state.lastSuccessConfirmedAt = new Date(now).toISOString();
    }
    if (await putJson(bucket, stateKey, state, prior?.etag ?? null)) return;
  }
  throw new Error("Could not record backup status.");
}
function publicReceipt(receipt) {
  return { localDay: receipt.localDay, createdAt: receipt.createdAt, tables: receipt.tables, migrations: receipt.migrations, rows: receipt.rows, objects: receipt.objects, encryptedBytes: receipt.encryptedBytes, fingerprint: receipt.fingerprint };
}
export async function backupStatus(bucket, now = Date.now()) {
  const state = (await readJson(bucket, stateKey))?.value ?? {};
  const success = state.lastSuccess ?? null;
  const expected = expectedBackupDay(now);
  const stale = !success || success.localDay < expected;
  return { configured: true, schedule: "Daily after 2:00 AM America/Los_Angeles; automatic retries every 15 minutes", retention: "All completed backups retained; no automatic deletion", encrypted: true, lastSuccess: success, lastAttempt: state.lastAttempt ?? null, stale, checkedAt: new Date(now).toISOString(), alerts: nextBackupAlerts(state, now) };
}
export async function recordBackupAlerts(bucket, now = Date.now()) {
  for (let tries = 0; tries < 5; tries++) {
    const prior = await readJson(bucket, stateKey), state = prior?.value ?? {};
    const alerts = nextBackupAlerts(state, now);
    if (JSON.stringify(state.alerts) === JSON.stringify(alerts)) return alerts;
    if (await putJson(bucket, stateKey, { ...state, alerts }, prior?.etag ?? null)) return alerts;
  }
  throw new Error("Could not record backup alert state.");
}
async function monitorBackup(env, now) {
  const alerts = await recordBackupAlerts(env.BACKUPS, now);
  try { await deliverBackupEmail(env, alerts, (await backupStatus(env.BACKUPS, now)).lastSuccess, now); }
  catch { console.error("Backup email delivery could not be confirmed."); }
}
async function writeEncrypted(bucket, key, encrypted) {
  const written = await bucket.put(key, encrypted.bytes, { httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" }, sha256: await crypto.subtle.digest("SHA-256", encrypted.bytes), onlyIf: { etagDoesNotMatch: "*" } });
  if (!written || written.size !== encrypted.bytes.length) throw new Error("Encrypted archive write did not complete.");
  return { key, iv: encrypted.iv, sha256: encrypted.sha256, size: encrypted.size };
}
export async function runDueBackup(env, secrets, { now = Date.now() } = {}) {
  const started = Date.now(); const logicalNow = () => now + Math.max(0, Date.now() - started);
  const { day, hour } = backupCalendar(now);
  if (hour < 2) return { skipped: true, reason: "before daily start", localDay: day };
  const stamp = new Date(now).toISOString(); const completeKey = `daily/${day}.json`;
  const completed = await readJson(env.BACKUPS, completeKey);
  if (completed) {
    validateCompletion(completed.value);
    // Repair a status-write failure after an archive was already completed;
    // do not leave a false failed/running banner or create a duplicate archive.
    await setStatus(env.BACKUPS, { at: completed.value.createdAt, state: "succeeded", localDay: day }, publicReceipt(completed.value), now);
    return { skipped: true, reason: "already completed", localDay: day };
  }
  const lease = await readJson(env.BACKUPS, leaseKey);
  if (lease?.value.expiresAt > now) return { skipped: true, reason: "running or retry cooldown", localDay: day };
  const id = crypto.randomUUID(); const expiresAt = now + 15 * 60000;
  const acquired = await putJson(env.BACKUPS, leaseKey, { id, expiresAt }, lease?.etag ?? null);
  if (!acquired) return { skipped: true, reason: "another runner acquired lease", localDay: day };
  const root = `runs/${day}/${id}/`; let phase = "configuration"; let failed = true;
  try {
    secrets = checkSecrets(secrets);
    const publicKey = JSON.parse(env.BACKUP_PUBLIC_KEY); const fingerprint = publicFingerprint(publicKey);
    const key = crypto.getRandomValues(new Uint8Array(32)); const wrappedKey = await wrapDataKey(key, publicKey);
    await setStatus(env.BACKUPS, { at: stamp, state: "running", localDay: day }, null, now);
    phase = "database";
    const snapshot = await snapshotDatabase(env.DB);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > hostedLimits.manifestBytes - 65536) throw new Error("Database exceeds reviewed backup limit.");
    phase = "files"; const files = []; const seen = new Set(); let cursor; let total = 0; let encryptedBytes = 0;
    do {
      const page = await env.FILES.list({ ...(cursor ? { cursor } : {}), limit: 1000 });
      for (const entry of page.objects) {
        if (seen.has(entry.key) || files.length >= hostedLimits.objects || entry.size > hostedLimits.objectBytes || (total += entry.size) > hostedLimits.totalObjectBytes) throw new Error("File inventory exceeds reviewed backup limit.");
        seen.add(entry.key);
        const object = await env.FILES.get(entry.key);
        if (!object || object.size !== entry.size) throw new Error("A source file changed during backup.");
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (bytes.length !== entry.size) throw new Error("Incomplete source file read.");
        const index = files.length; const encrypted = await encryptPart(bytes, key, id, index);
        const part = await writeEncrypted(env.BACKUPS, root + `object-${String(index).padStart(4, "0")}.bin`, encrypted); encryptedBytes += part.size;
        files.push({ key: entry.key, size: bytes.length, sha256: hash(bytes), httpMetadata: JSON.parse(JSON.stringify(object.httpMetadata ?? {})), customMetadata: object.customMetadata ?? {}, part });
      }
      if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error("File pagination did not advance.");
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    checkFileInventory(snapshot, files);
    phase = "archive";
    const payload = { version: 1, source: "hosted", createdAt: stamp, localDay: day, snapshot, files, secrets };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.length > hostedLimits.manifestBytes) throw new Error("Backup manifest exceeds reviewed limit.");
    const manifest = await writeEncrypted(env.BACKUPS, root + "manifest.bin", await encryptPart(bytes, key, id, "manifest")); encryptedBytes += manifest.size;
    const receipt = { format: hostedFormat, id, createdAt: stamp, localDay: day, fingerprint, wrappedKey, manifest, tables: snapshot.tables.length - 1, migrations: rowsOf(snapshot, "d1_migrations").length, rows: snapshot.tables.reduce((n, t) => n + t.rows.length, 0), objects: files.length, encryptedBytes };
    phase = "completion";
    const active = await readJson(env.BACKUPS, leaseKey);
    if (active?.value.id !== id || active.value.expiresAt <= logicalNow()) throw new Error("Backup lease expired before completion.");
    if (!await putJson(env.BACKUPS, completeKey, receipt, null)) throw new Error("Another backup already completed this day.");
    await setStatus(env.BACKUPS, { at: new Date(now).toISOString(), state: "succeeded", localDay: day }, publicReceipt(receipt), logicalNow());
    failed = false;
    return { completed: true, ...publicReceipt(receipt) };
  } catch {
    // Driver/provider errors may contain SQL, file keys or private input.
    try { await setStatus(env.BACKUPS, { at: stamp, state: "failed", localDay: day, category: phase }, null, now); } catch { /* Staleness still surfaces a missing daily completion. */ }
    console.error("Daily backup failed", { category: phase });
    return { completed: false, failed: true, category: phase };
  } finally {
    const current = await readJson(env.BACKUPS, leaseKey);
    if (current?.value.id === id) await putJson(env.BACKUPS, leaseKey, { id: null, expiresAt: failed ? now + 15 * 60000 : 0 }, current.etag);
  }
}
export function createBackupWorker(env, clock = Date.now) {
  return { async fetch(request) {
    const path = new URL(request.url).pathname;
    let dailyAccepted = false;
    try {
      if (path === "/status" && request.method === "GET") return json({ ...await backupStatus(env.BACKUPS, clock()), email: await backupEmailStatus(env) });
      if (path !== "/daily" || request.method !== "POST") return json({ error: "Not found." }, 404);
      if (Number(request.headers.get("content-length") ?? 0) > 2048) return json({ error: "Invalid request." }, 413);
      const text = await request.text(); if (text.length > 2048) return json({ error: "Invalid request." }, 413);
      const body = JSON.parse(text);
      if (Object.keys(body).sort().join(",") !== "AUTH_PRIVATE_FIELD_KEY,AUTH_RATE_LIMIT_SECRET") return json({ error: "Invalid request." }, 400);
      dailyAccepted = true;
      const result = await runDueBackup(env, checkSecrets(body), { now: clock() });
      await monitorBackup(env, clock());
      return json(result, result.failed ? 503 : 200);
    } catch {
      if (dailyAccepted) {
        try {
          const now = clock();
          await setStatus(env.BACKUPS, { at: new Date(now).toISOString(), state: "failed", localDay: backupCalendar(now).day, category: "completion" }, null);
          await monitorBackup(env, now);
        } catch { /* The app shows monitoring unavailable if storage cannot be read. */ }
      }
      return json({ error: "Backup service is temporarily unavailable." }, 503);
    }
  } };
}
