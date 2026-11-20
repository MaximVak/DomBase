import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { rateKey, tokenHash, tokenIsValid } from "../auth/crypto";
import { AuthError } from "../auth/http";
import * as schema from "../db/schema";
import { atomicBatch } from "./database";
import type { KioskOperatorDatabase } from "./database";
import type { RegisteredDevice } from "./device";
import { exactKeys, positiveId } from "./security";
import { parseActionDetails } from "./break-actions";
import type { ActionDetails, ClockDetails } from "./break-rules";
import { insertAssistance } from "./assistance";

export type ClockType = typeof schema.clockEvents.$inferSelect.eventType;
export type ClockDraft = { eventType: ClockType; roleId: number | null; explanation: string; details?: ActionDetails };
type Ticket = { interactionId: string; previousId: number };
type Plan = { roleId: number | null; roleName: string; shift: typeof schema.shifts.$inferSelect | null; requiresApproval: boolean; details: ClockDetails | null };
type ClockEvent = typeof schema.clockEvents.$inferSelect;

export const eventAllowed = (last: ClockType | null, next: ClockType, assisted = false) => last === null || last === "out" ? next === "in"
  : last === "break" ? next === "break_end" || (assisted && next === "out") : next === "out" || next === "break";

export function clockDraft(body: Record<string, unknown>): ClockDraft {
  const type = body.eventType;
  if (type !== "in" && type !== "out" && type !== "break" && type !== "break_end") throw new AuthError(400, "Choose a clock action.");
  if (typeof body.explanation !== "string" || body.explanation.length > 1000) throw new AuthError(400, "Use an explanation of up to 1,000 characters.");
  if (type !== "in" && body.roleId !== undefined && body.roleId !== null) throw new AuthError(400, "A job role is chosen only when clocking in.");
  const details = parseActionDetails(type, body.details);
  return { eventType: type, roleId: type === "in" ? positiveId(body.roleId) : null, explanation: body.explanation.trim(), ...(details ? { details } : {}) };
}

export function makeReplayTicket(secret: string, device: RegisteredDevice, interactionId: string, previousId: number) {
  const data = `${interactionId}.${previousId}`;
  return `${data}.${rateKey(secret, `kiosk-replay:${device.session.id}:${data}`)}`;
}

export function readReplayTicket(secret: string, device: RegisteredDevice, value: unknown): Ticket {
  const fields = typeof value === "string" && value.length <= 125 ? value.split(".") : [];
  const [interactionId, previous, signature] = fields;
  const previousId = Number(previous);
  if (fields.length !== 3 || !tokenIsValid(interactionId) || !Number.isSafeInteger(previousId) || previousId < 0 || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new AuthError(403, "Invalid clock sync request.");
  }
  const expected = makeReplayTicket(secret, device, interactionId, previousId);
  if (typeof value !== "string" || value.length !== expected.length || !timingSafeEqual(Buffer.from(value), Buffer.from(expected))) {
    throw new AuthError(403, "Invalid clock sync request.");
  }
  return { interactionId, previousId };
}

export async function syncClock(
  db: KioskOperatorDatabase, device: RegisteredDevice, activeDevice: SQL, secret: string, now: number, body: Record<string, unknown>,
  lastEvent: (employeeId: number) => Promise<ClockEvent | null>,
  planClock: (employeeId: number, previous: ClockEvent | null, draft: ClockDraft, time: number) => Promise<Plan>,
) {
  exactKeys(body, ["ticket", "eventType", "roleId", "explanation", "attemptedAt", "details"]);
  const { interactionId, previousId } = readReplayTicket(secret, device, body.ticket);
  const draft = clockDraft(body);
  const attempted = body.attemptedAt;
  const hash = tokenHash(JSON.stringify([draft, attempted]));
  const [interaction] = await db.select().from(schema.kioskInteractions).where(eq(schema.kioskInteractions.id, interactionId));
  if (!interaction || interaction.deviceSessionId !== device.session.id) throw new AuthError(403, "Invalid clock sync request.");
  const issued = Date.parse(interaction.createdAt), expiry = Date.parse(interaction.expiresAt);
  if (typeof attempted !== "number" || !Number.isSafeInteger(attempted) || attempted < issued || attempted >= expiry || attempted > now) {
    throw new AuthError(422, "The queued time needs manual review. Ask a manager.");
  }
  const time = new Date(now).toISOString();
  const attemptedAt = new Date(attempted).toISOString();
  const previous = await lastEvent(interaction.employeeId);
  let plan: Plan | null = null;
  try { plan = await planClock(interaction.employeeId, previous, draft, attempted); }
  catch (error) { if (!(error instanceof AuthError) || ![400, 403, 422].includes(error.status)) throw error; }
  const shift = plan?.shift;
  const roleId = plan?.roleId ?? null;
  const [priorRole] = draft.eventType !== "in" && previousId > 0
    ? await db.select({ id: schema.shifts.roleId }).from(schema.clockEvents).innerJoin(schema.shifts, eq(schema.shifts.id, schema.clockEvents.shiftId)).where(eq(schema.clockEvents.id, previousId))
    : [];
  const roleScope = roleId === null ? sql`1 = 1` : sql`EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id
    JOIN departments d ON d.id = r.department_id WHERE er.employee_id = ${interaction.employeeId} AND er.role_id = ${roleId}
    AND er.active = 1 AND r.archived = 0 AND d.archived = 0)`;
  const shiftScope = shift ? sql`EXISTS (SELECT 1 FROM shifts WHERE id = ${shift.id} AND employee_id = ${interaction.employeeId}
    AND role_id = ${roleId} AND publication_id = ${shift.publicationId} AND archived_at IS NULL AND shift_type = 'work'
    AND date = ${shift.date} AND start_time = ${shift.startTime} AND end_time = ${shift.endTime})` : sql`1 = 1`;
  const canAutoSave = plan && !plan.requiresApproval && (draft.eventType !== "in" || shift) && (previous?.id ?? 0) === previousId
    && eventAllowed(previous?.eventType ?? null, draft.eventType, !!draft.details?.assisted) && (!previous || Date.parse(previous.occurredAt) <= attempted)
    && attempted >= now - 72 * 3600000;
  const unsettled = sql`${activeDevice} AND NOT EXISTS (SELECT 1 FROM kiosk_clock_replays WHERE interaction_id = ${interactionId})
    AND NOT EXISTS (SELECT 1 FROM clock_events WHERE idempotency_key = ${interactionId})`;
  const assistance = plan?.details?.assistance;
  const target = assistance?.targetEventId;
  if (target && previousId === target && attempted >= now - 72 * 3600000) {
    await atomicBatch(db, [
      insertAssistance(assistance, interactionId, attemptedAt, draft.explanation, sql`id=${target} AND employee_id=${interaction.employeeId} AND event_type='out' AND automatic=1`,
        sql`${unsettled} AND (SELECT MAX(id) FROM clock_events WHERE employee_id=${interaction.employeeId})=${target}
          AND EXISTS (SELECT 1 FROM kiosk_interactions ki JOIN employees e ON e.id=ki.employee_id WHERE ki.id=${interactionId}
            AND ki.pin_version=e.pin_version AND e.active=1 AND e.terminated=0 AND e.pin_lookup IS NOT NULL
            AND (ki.ended_at IS NULL OR julianday(ki.ended_at)>=julianday(${attemptedAt})))`),
      sql`INSERT INTO kiosk_clock_replays (interaction_id,role_id,event_type,attempted_at,explanation,payload_hash,event_id,received_at,action_details)
        SELECT ${interactionId},${priorRole?.id ?? null},'out',${attemptedAt},${draft.explanation},${hash},${target},${time},${JSON.stringify(draft.details)}
        WHERE changes()=1`,
      sql`INSERT INTO audit_log (employee_id,device_id,action,entity_type,entity_id,created_at)
        SELECT ${interaction.employeeId},${device.device.id},'kiosk.assisted_out_reported','clock_event',${String(target)},${time} WHERE changes()=1`,
      sql`UPDATE kiosk_interactions SET ended_at=${time} WHERE id=${interactionId} AND ended_at IS NULL AND changes()=1`,
    ]);
  }
  const results = await atomicBatch(db, [
    sql`INSERT INTO clock_events (employee_id, event_type, occurred_at, shift_id, role_name, explanation, source, device_id, received_at, idempotency_key, clock_details)
      SELECT ${interaction.employeeId}, ${draft.eventType}, ${attemptedAt}, ${shift?.id ?? (draft.eventType === "in" ? null : previous?.shiftId ?? null)},
        ${plan?.roleName ?? ""}, ${draft.explanation}, 'offline', ${device.device.id}, ${time}, ${interactionId}, ${plan?.details ? JSON.stringify(plan.details) : null}
      WHERE ${canAutoSave ? 1 : 0} = 1 AND ${unsettled} AND ${roleScope} AND ${shiftScope}
      AND EXISTS (SELECT 1 FROM kiosk_interactions ki JOIN employees e ON e.id = ki.employee_id WHERE ki.id = ${interactionId}
        AND ki.pin_version = e.pin_version AND e.active = 1 AND e.terminated = 0 AND e.pin_lookup IS NOT NULL
        AND (ki.ended_at IS NULL OR julianday(ki.ended_at) >= julianday(${attemptedAt})))
      AND COALESCE((SELECT MAX(id) FROM clock_events WHERE employee_id = ${interaction.employeeId}), 0) = ${previousId}
      AND NOT EXISTS (SELECT 1 FROM time_card_edits WHERE employee_id = ${interaction.employeeId} AND julianday(created_at) >= julianday(${interaction.createdAt}))
      AND NOT EXISTS (SELECT 1 FROM kiosk_clock_requests WHERE interaction_id = ${interactionId} AND (completed_at IS NOT NULL OR requires_approval = 1))`,
    sql`INSERT INTO kiosk_clock_replays (interaction_id, role_id, event_type, attempted_at, explanation, payload_hash, event_id, received_at, action_details)
      SELECT ${interactionId}, ${roleId ?? priorRole?.id ?? null}, ${draft.eventType}, ${attemptedAt}, ${draft.explanation}, ${hash},
        (SELECT id FROM clock_events WHERE idempotency_key = ${interactionId} AND changes() = 1), ${time}, ${draft.details ? JSON.stringify(draft.details) : null}
      WHERE ${activeDevice} AND (changes() = 1 OR (${unsettled}))`,
    sql`INSERT INTO audit_log (employee_id, device_id, action, entity_type, entity_id, created_at)
      SELECT ${interaction.employeeId}, ${device.device.id}, CASE WHEN event_id IS NULL THEN 'kiosk.offline_review' ELSE 'kiosk.offline_recorded' END,
        'clock_replay', ${interactionId}, ${time} FROM kiosk_clock_replays WHERE interaction_id = ${interactionId} AND changes() = 1`,
    sql`UPDATE kiosk_interactions SET ended_at = ${time} WHERE id = ${interactionId} AND ended_at IS NULL AND changes() = 1`,
    ...(assistance && !target ? [insertAssistance(assistance, interactionId, attemptedAt, draft.explanation,
      sql`idempotency_key=${interactionId} AND source='offline'`,
      sql`EXISTS (SELECT 1 FROM kiosk_clock_replays WHERE interaction_id=${interactionId} AND event_id=clock_events.id AND payload_hash=${hash})`)] : []),
  ]);
  const [receipt] = await db.select().from(schema.kioskClockReplays).where(eq(schema.kioskClockReplays.interactionId, interactionId));
  if (receipt) {
    if (receipt.payloadHash !== hash) throw new AuthError(409, "This clock request already has a different result. Ask a manager.");
    return { outcome: receipt.eventId !== null ? "synced" : "review" } as const;
  }
  const [online] = await db.select().from(schema.kioskClockRequests).where(eq(schema.kioskClockRequests.id, interactionId));
  if (online?.completedAt && online.eventType === draft.eventType && online.roleId === draft.roleId && online.explanation === draft.explanation
    && JSON.stringify(online.actionDetails) === JSON.stringify(draft.details ?? null)) return { outcome: "synced" } as const;
  if (results[1].meta.changes === 0) throw new AuthError(409, "This clock request could not be reconciled. Ask a manager.");
  throw new Error("Clock replay receipt unavailable.");
}
