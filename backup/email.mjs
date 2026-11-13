import { readJson, putJson } from "./control.mjs";
import { backupEmailConfig } from "./email-config.mjs";

const key = "control/email-delivery.json";
const retryMs = 15 * 60000, leaseMs = 5 * 60000;
function eventFor(alerts, now) {
  if (alerts.active) return { id: `${alerts.active.id}:warning`, kind: alerts.active.kind, at: alerts.active.detectedAt };
  const recovered = alerts.lastRecovery;
  if (recovered && now - Date.parse(recovered.recoveredAt) < 86400000) return { id: `${recovered.incidentId}:recovery`, kind: "recovered", at: recovered.recoveredAt };
  return null;
}
function message(config, event, success) {
  const title = event.kind === "failed" ? "Daily backup failed" : event.kind === "stale" ? "Daily backup is overdue" : "Backup protection restored";
  return { to: config.recipient, from: config.sender, subject: `DomBase backup: ${title}`,
    text: `${title}.\n\n${event.kind === "recovered" ? "A successful backup has cleared the previous warning." : "Automatic backup retries continue. Check the Backups page in DomBase."}\n\nDetected: ${event.at}\nLast successful backup: ${success?.createdAt ?? "No completed backup confirmed"}\n\nOpen DomBase and choose Backups from your account menu. This email contains operational status only; no employee data or recovery keys.\n` };
}
export async function backupEmailStatus(env) {
  const config = backupEmailConfig(env);
  if (!config.configured) return { configured: false, recipient: config.recipient, state: "not_configured" };
  try {
    const saved = (await readJson(env.BACKUPS, key))?.value ?? {};
    const state = saved.recipient === config.recipient ? saved : {};
    return { configured: true, recipient: config.recipient, state: state.retry ? "retrying" : state.lease ? "pending" : state.lastAcceptedAt ? "accepted" : "ready", ...(state.lastAcceptedAt ? { lastAcceptedAt: state.lastAcceptedAt } : {}) };
  } catch { return { configured: true, recipient: config.recipient, state: "unavailable" }; }
}
async function finish(bucket, token, event, now, accepted) {
  for (let i = 0; i < 5; i++) {
    const prior = await readJson(bucket, key), state = prior?.value;
    if (!state || state.lease?.token !== token) return;
    const next = { ...state, lease: null, retry: accepted ? null : { eventId: event.id, at: now + retryMs } };
    if (accepted) { next.sent = [...(state.sent ?? []), event.id].slice(-20); next.lastAcceptedAt = new Date(now).toISOString(); }
    if (await putJson(bucket, key, next, prior.etag)) return;
  }
  throw new Error("Could not record email acknowledgement.");
}
export async function deliverBackupEmail(env, alerts, success, now = Date.now()) {
  const config = backupEmailConfig(env), event = eventFor(alerts, now);
  if (!config.configured) return;
  if (!event) {
    for (let i = 0; i < 5; i++) {
      const prior = await readJson(env.BACKUPS, key), state = prior?.value;
      if (!state || state.lease?.expiresAt > now || (!state.retry && !state.lease)) return;
      if (await putJson(env.BACKUPS, key, { ...state, lease: null, retry: null }, prior.etag)) return;
    }
    throw new Error("Could not clear an obsolete email retry.");
  }
  for (let i = 0; i < 5; i++) {
    const prior = await readJson(env.BACKUPS, key), state = prior?.value ?? {};
    // Configuration changes never inherit an acknowledgement for a different
    // recipient. Concurrent cron calls share one bounded sending lease.
    const sameRecipient = state.recipient === config.recipient;
    if (sameRecipient && state.sent?.includes(event.id)) return;
    if (state.lease?.expiresAt > now || (sameRecipient && state.retry?.eventId === event.id && state.retry.at > now)) return;
    const token = crypto.randomUUID();
    const claimed = { ...(sameRecipient ? state : {}), recipient: config.recipient, lease: { token, eventId: event.id, expiresAt: now + leaseMs } };
    if (!await putJson(env.BACKUPS, key, claimed, prior?.etag ?? null)) continue;
    let accepted = false;
    let timer;
    try {
      const result = await Promise.race([
        env.BACKUP_EMAIL.send(message(config, event, success)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Email acknowledgement timed out.")), 15000); }),
      ]);
      if (typeof result?.messageId !== "string" || !result.messageId) throw new Error("No provider acknowledgement.");
      accepted = true;
    } catch { /* Provider errors may contain addresses or credentials. Never log them. */ }
    finally { clearTimeout(timer); }
    // A send acknowledgement is not proof of inbox receipt. A provider timeout
    // after acceptance can cause a duplicate on retry; no exactly-once claim.
    await finish(env.BACKUPS, token, event, now, accepted);
    return;
  }
  throw new Error("Could not acquire email delivery lease.");
}
