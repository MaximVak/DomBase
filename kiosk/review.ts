import { and, eq, isNull, sql } from "drizzle-orm";
import type { createAccessService } from "../access/service";
import { tokenIsValid } from "../auth/crypto";
import { AuthError, json, readAuthBody } from "../auth/http";
import { employees, kioskClockReplays as replays, kioskInteractions as interactions, roles } from "../db/schema";
import { atomicBatch } from "./database";
import type { KioskOperatorDatabase } from "./database";
import { exactKeys } from "./security";

export async function clockReview(request: Request, db: KioskOperatorDatabase, access: ReturnType<typeof createAccessService>) {
  const actor = await access.authorize(request, "timesheets.manage");
  const scope = and(actor.employeeFilter(interactions.employeeId), actor.roleFilter(replays.roleId), actor.activeActor(),
    actor.account.accessLevel === "owner" ? sql`1 = 1` : sql`${interactions.employeeId} IS NOT ${actor.account.employeeId}`);
  if (request.method === "GET") {
    const entries = await db.select({ id: replays.interactionId, employee: employees.name, role: roles.name,
      eventType: replays.eventType, attemptedAt: replays.attemptedAt, explanation: replays.explanation })
      .from(replays).innerJoin(interactions, eq(interactions.id, replays.interactionId))
      .innerJoin(employees, eq(employees.id, interactions.employeeId)).leftJoin(roles, eq(roles.id, replays.roleId))
      .where(and(isNull(replays.eventId), isNull(replays.reviewedAt), scope)).orderBy(replays.receivedAt, replays.interactionId).limit(100);
    return json({ entries });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  const body = await readAuthBody(request);
  exactKeys(body, ["id"]);
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Choose a queued clock entry.");
  const time = new Date().toISOString();
  const [updated] = await atomicBatch(db, [
    sql`UPDATE kiosk_clock_replays SET reviewed_at = ${time}, reviewed_by_account_id = ${actor.account.id}
      WHERE interaction_id = ${body.id} AND event_id IS NULL AND reviewed_at IS NULL
      AND EXISTS (SELECT 1 FROM kiosk_interactions WHERE id = ${body.id} AND ${scope})`,
    sql`INSERT INTO audit_log (actor_account_id, employee_id, action, entity_type, entity_id, created_at)
      SELECT ${actor.account.id}, employee_id, 'kiosk.offline_reviewed', 'clock_replay', id, ${time}
      FROM kiosk_interactions WHERE id = ${body.id} AND changes() = 1`,
  ]);
  if (updated.meta.changes !== 1) throw new AuthError(404, "This clock entry is no longer available for review.");
  return json({ reviewed: true });
}
