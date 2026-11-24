import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { newToken, rateKey, tokenHash, tokenIsValid } from "../auth/crypto";
import { AuthError } from "../auth/http";
import type { RegisteredDevice } from "./device";
import type { KioskOperatorDatabase } from "./database";
import { offlineAccessMs, offlineActionPayload } from "./offline-contract";
import type { OfflineAuthorization, OfflineEntry } from "./offline-contract";
import { clockDraft, makeReplayTicket } from "./replay";
import { exactKeys } from "./security";

const invalid = () => new AuthError(403, "Invalid clock sync request.");
const matches = (value: unknown, expected: string) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
  && timingSafeEqual(Buffer.from(value), Buffer.from(expected));

export function offlineDeviceTag(secret: string, device: RegisteredDevice) {
  return rateKey(secret, `kiosk-offline-device:${device.session.id}`);
}

export function prepareOfflineAuthorization(secret: string, device: RegisteredDevice, employeeId: number, pinVersion: number,
  previousId: number, now: number, idleSeconds: number): OfflineAuthorization {
  const id = newToken();
  const expiresAt = Math.min(now + offlineAccessMs, Date.parse(device.session.expiresAt));
  const payload = [id, employeeId, pinVersion, previousId, now, expiresAt].join(".");
  const token = payload + "." + rateKey(secret, `kiosk-offline-grant:${device.session.id}:${payload}`);
  return { token, id, key: keyFor(secret, token), issuedAt: now, expiresAt, idleSeconds };
}

const keyFor = (secret: string, token: string) => rateKey(secret, `kiosk-offline-action:${token}`);
const interactionFor = (secret: string, grant: string, action: string) =>
  Buffer.from(rateKey(secret, `kiosk-offline-interaction:${grant}:${action}`), "hex").toString("base64url");

export async function prepareOfflineReplay(db: KioskOperatorDatabase, device: RegisteredDevice, activeDevice: SQL, secret: string,
  now: number, body: Record<string, unknown>) {
  exactKeys(body, ["ticket", "attemptedAt", "eventType", "roleId", "explanation", "details", "offline"]);
  const offline = body.offline;
  if (!offline || typeof offline !== "object" || Array.isArray(offline)) throw invalid();
  const { token, previous, proof } = offline as Record<string, unknown>;
  exactKeys(offline as Record<string, unknown>, ["token", "previous", "proof"]);
  if (typeof token !== "string" || token.length > 220 || !tokenIsValid(body.ticket)) throw invalid();
  if (previous !== null && (typeof previous !== "string" || !/^(online|offline)\.[A-Za-z0-9_-]{43}$/.test(previous))) throw invalid();
  const pieces = token.split(".");
  const [grant, employee, version, baseline, issued, expiry, signature] = pieces;
  const [employeeId, pinVersion, previousId, issuedAt, expiresAt] = [employee, version, baseline, issued, expiry].map(Number);
  if (pieces.length !== 7 || !tokenIsValid(grant) || ![employeeId, pinVersion, previousId, issuedAt, expiresAt].every(Number.isSafeInteger)
    || employeeId < 1 || pinVersion < 1 || previousId < 0 || issuedAt > now || expiresAt <= issuedAt
    || !matches(signature, rateKey(secret, `kiosk-offline-grant:${device.session.id}:${pieces.slice(0, -1).join(".")}`))) throw invalid();
  const attempted = body.attemptedAt;
  if (typeof attempted !== "number" || !Number.isSafeInteger(attempted) || attempted < issuedAt || attempted >= expiresAt || attempted > now) {
    throw new AuthError(422, "The queued time needs manual review. Ask a manager.");
  }
  clockDraft(body);
  if (!matches(proof, rateKey(keyFor(secret, token), offlineActionPayload(body as OfflineEntry, previous)))) throw invalid();

  const interactionId = interactionFor(secret, grant, body.ticket);
  let anchor = previousId;
  if (previous) {
    const [kind, id] = previous.split(".");
    const predecessor = kind === "offline" ? interactionFor(secret, grant, id) : id;
    if (predecessor === interactionId) throw invalid();
    const found = await db.get<{ eventId: number }>(sql`
      SELECT ce.id AS eventId FROM kiosk_interactions ki
      LEFT JOIN kiosk_clock_replays cr ON cr.interaction_id = ki.id
      JOIN clock_events ce ON ce.id = cr.event_id OR ce.idempotency_key = ki.id
      WHERE ki.id = ${predecessor} AND ki.device_session_id = ${device.session.id} AND ki.employee_id = ${employeeId}
        AND ce.employee_id = ${employeeId} AND ce.occurred_at <= ${new Date(attempted).toISOString()}
      LIMIT 1`);
    // An absent or unresolved predecessor cannot authorize an automatic write.
    anchor = found?.eventId ?? -1;
  }
  const recorded = new Date(attempted).toISOString();
  await db.run(sql`INSERT INTO kiosk_interactions (id,device_session_id,employee_id,pin_version,token_hash,created_at,expires_at,ended_at)
    SELECT ${interactionId}, ${device.session.id}, id, ${pinVersion}, ${tokenHash(interactionId)},
      ${new Date(issuedAt).toISOString()}, ${new Date(expiresAt).toISOString()}, ${recorded}
    FROM employees WHERE id = ${employeeId} AND ${activeDevice}
    ON CONFLICT(id) DO NOTHING`);
  const { eventType, roleId, explanation, details } = body;
  return { eventType, roleId, explanation, details, attemptedAt: attempted, ticket: makeReplayTicket(secret, device, interactionId, Math.max(anchor, 0)), ...(anchor < 0 ? { forceReview: true } : {}) };
}
