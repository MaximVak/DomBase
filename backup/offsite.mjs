import { b2Config, createB2Client, offsitePrefix } from "./b2.mjs";
import { readJson, putJson } from "./control.mjs";
import { backupCalendar, validateCompletion, hostedLimits } from "./hosted-format.mjs";
import { expectedBackupDay, previousBackupDay, nextBackupAlerts } from "./alerts.mjs";
import { hash } from "./snapshot.mjs";
import { deliverBackupEmail } from "./email.mjs";

const stateKey = "control/offsite.json", leaseMs = 10 * 60000;
const encode = value => new TextEncoder().encode(JSON.stringify(value));
function destination(env) { return b2Config(env.BACKUP_B2); }
export function copyDays(now) {
  const days = []; let day = backupCalendar(now).day;
  for (let i = 0; i < 30; i++) { days.push(day); day = previousBackupDay(day); }
  return days;
}
export async function offsiteStatus(env, now = Date.now()) {
  if (!env.BACKUP_B2) return { configured: false, state: "not_configured" };
  let config;
  try { config = destination(env); } catch { config = { identity: "invalid" }; }
  const saved = (await readJson(env.BACKUPS, stateKey))?.value;
  const state = saved?.destination === config.identity ? saved : {};
  const alerts = nextBackupAlerts(state, now);
  return { configured: true, state: alerts.active ? "failed" : state.lease?.expiresAt > now ? "copying" : state.lastSuccess ? "ready" : "pending", stale: !state.lastSuccess || state.lastSuccess.localDay < expectedBackupDay(now),
    lastSuccess: state.lastSuccess ?? null, alerts };
}

// Bounded, resumable work on the existing minute cron. Only complete encrypted
// archives are eligible. No DB/FILES binding or recovery key is read here.
export async function runOffsiteCopy(env, { now = Date.now(), clientFactory = createB2Client, maxParts = 4 } = {}) {
  if (!env.BACKUP_B2) return { skipped: true };
  let token, config, state, prior;
  const started = Date.now(), logicalNow = () => now + Math.max(0, Date.now() - started);
  async function save(next) {
    const current = await readJson(env.BACKUPS, stateKey);
    if (current?.value.lease?.token !== token || current.value.lease.expiresAt <= logicalNow()) throw new Error("Off-site lease expired.");
    if (!await putJson(env.BACKUPS, stateKey, next, current.etag)) throw new Error("Off-site status changed.");
    state = next;
  }
  try {
    prior = await readJson(env.BACKUPS, stateKey);
    if (prior?.value.lease?.expiresAt > now || prior?.value.retryAt > now) return { skipped: true };
    try { config = destination(env); } catch { config = { identity: "invalid" }; }
    const days = copyDays(now);
    state = prior?.value.destination === config.identity ? prior.value : { destination: config.identity };
    token = crypto.randomUUID();
    state = { ...state, copies: (state.copies ?? []).filter(copy => days.includes(copy.day)), lease: { token, expiresAt: now + leaseMs }, retryAt: 0 };
    if (!await putJson(env.BACKUPS, stateKey, state, prior?.etag ?? null)) return { skipped: true };
    if (config.identity === "invalid") throw new Error("Invalid configuration.");
    const client = clientFactory(config);
    for (const day of days) {
      const complete = await readJson(env.BACKUPS, `daily/${day}.json`);
      if (!complete) continue;
      const receipt = complete.value, root = validateCompletion(receipt);
      if (receipt.localDay !== day) throw new Error("Archive date differs.");
      let copy = state.copies.find(item => item.day === day);
      if (copy && copy.id !== receipt.id) throw new Error("Completed source archive changed.");
      if (copy?.completedAt) continue;
      copy = copy ?? { day, id: receipt.id, next: 0 };
      await save({ ...state, copies: [...state.copies.filter(item => item.day !== day), copy], lastAttempt: { at: new Date(now).toISOString(), state: "running", localDay: day } });
      const keys = [root + "manifest.bin", ...Array.from({ length: receipt.objects }, (_, index) => root + `object-${String(index).padStart(4, "0")}.bin`)];
      for (let count = 0; copy.next < keys.length && count < maxParts; count++) {
        const key = keys[copy.next], object = await env.BACKUPS.get(key);
        const limit = copy.next === 0 ? hostedLimits.manifestBytes + 16 : hostedLimits.objectBytes + 16;
        if (!object || object.size > limit) throw new Error("Encrypted archive part is missing.");
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (bytes.length !== object.size || copy.next === 0 && (bytes.length !== receipt.manifest.size || hash(bytes) !== receipt.manifest.sha256)) throw new Error("Encrypted archive part is damaged.");
        await client.copy(offsitePrefix + key, bytes);
        copy = { ...copy, next: copy.next + 1 };
        await save({ ...state, copies: state.copies.map(item => item.day === day ? copy : item) });
      }
      if (copy.next === keys.length) {
        // Publication marker is last. An interrupted archive cannot be mistaken
        // for a complete recovery point in the independent provider.
        await client.copy(offsitePrefix + `daily/${day}.json`, encode(receipt));
        const at = new Date(logicalNow()).toISOString(); copy = { ...copy, completedAt: at };
        const success = !state.lastSuccess || day >= state.lastSuccess.localDay ? { localDay: day, createdAt: at } : state.lastSuccess;
        await save({ ...state, copies: state.copies.map(item => item.day === day ? copy : item), lastSuccess: success, lastSuccessConfirmedAt: at, lastAttempt: { at, state: "succeeded", localDay: day } });
      }
      break; // One daily archive per invocation, independent of its file count.
    }
    await save({ ...state, alerts: nextBackupAlerts(state, logicalNow()) });
    return { completed: true };
  } catch {
    // Never log B2 keys, request URLs, provider bodies or employee information.
    if (token && state) try {
      const failed = { ...state, lastAttempt: { at: new Date(logicalNow()).toISOString(), state: "failed", localDay: backupCalendar(now).day }, retryAt: logicalNow() + 15 * 60000 };
      await save({ ...failed, alerts: nextBackupAlerts(failed, logicalNow()) });
    } catch { /* A missing completion still becomes stale. */ }
    return { failed: true };
  } finally {
    if (token) {
      const current = await readJson(env.BACKUPS, stateKey);
      if (current?.value.lease?.token === token) await putJson(env.BACKUPS, stateKey, { ...current.value, lease: null }, current.etag);
    }
  }
}

export async function monitorOffsite(env, now = Date.now()) {
  const status = await offsiteStatus(env, now);
  if (status.configured && status.alerts) await deliverBackupEmail(env, status.alerts, status.lastSuccess, now, { scope: "offsite" });
}
