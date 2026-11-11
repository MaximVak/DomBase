import { sql } from "drizzle-orm";
import { atomicBatch } from "../kiosk/database";
import type { Database } from "./context";
import { nextDate, zonedTimestamp } from "./time";
export async function runClockMaintenance(db: Database, now = Date.now()) {
  const settings = await db.get<{ enabled: number; delay: number; zone: string }>(sql`SELECT ls.automatic_clock_out AS enabled, ls.automatic_clock_out_minutes AS delay, b.time_zone AS zone FROM location_settings ls JOIN business b ON b.id = ls.business_id LIMIT 1`);
  if (!settings?.enabled) return 0;
  const candidates = await db.all<{ eventId: number; employeeId: number; shiftId: number; cardId: number | null; roleName: string; lastEventId: number; lastAt: string; date: string; start: string; end: string }>(sql`SELECT ce.id AS eventId, ce.employee_id AS employeeId, sh.id AS shiftId, ce.card_id AS cardId, ce.role_name AS roleName, (SELECT MAX(id) FROM clock_events WHERE employee_id = ce.employee_id) AS lastEventId, (SELECT occurred_at FROM clock_events WHERE employee_id = ce.employee_id ORDER BY id DESC LIMIT 1) AS lastAt, sh.date AS date, sh.start_time AS start, sh.end_time AS end
    FROM clock_events ce JOIN shifts sh ON sh.id = ce.shift_id
    WHERE ce.event_type = 'in' AND ce.id = (SELECT MAX(last.id) FROM clock_events last WHERE last.employee_id = ce.employee_id AND last.event_type IN ('in','out'))
    AND sh.publication_id IS NOT NULL ORDER BY ce.id LIMIT 500`);
  let count = 0;
  for (const row of candidates) {
    let threshold: number;
    try { threshold = zonedTimestamp(row.end <= row.start ? nextDate(row.date) : row.date, row.end, settings.zone) + settings.delay * 60000; }
    catch { continue; }
    if (threshold > now) continue;
    const latestAt = Date.parse(row.lastAt); if (!Number.isFinite(latestAt) || latestAt > now) continue;
    const occurredAt = new Date(Math.max(threshold, latestAt + 1)).toISOString(); const receivedAt = new Date(now).toISOString();
    const results = await atomicBatch(db, [
      sql`INSERT INTO clock_events (employee_id, event_type, occurred_at, shift_id, card_id, role_name, explanation, automatic, source, received_at, idempotency_key)
        SELECT ${row.employeeId}, 'out', ${occurredAt}, ${row.shiftId}, ${row.cardId}, ${row.roleName}, 'Automatically clocked out after the scheduled shift and configured grace period.', 1, 'system', ${receivedAt}, ${`automatic-out:${row.eventId}:${row.shiftId}`}
        WHERE NOT EXISTS (SELECT 1 FROM clock_events WHERE idempotency_key = ${`automatic-out:${row.eventId}:${row.shiftId}`})
        AND (SELECT MAX(id) FROM clock_events WHERE employee_id = ${row.employeeId} AND event_type IN ('in','out')) = ${row.eventId}
        AND (SELECT MAX(id) FROM clock_events WHERE employee_id = ${row.employeeId}) = ${row.lastEventId}
        AND EXISTS (SELECT 1 FROM shifts WHERE id = ${row.shiftId} AND date = ${row.date} AND start_time = ${row.start} AND end_time = ${row.end} AND archived_at IS NULL)
        AND EXISTS (SELECT 1 FROM location_settings ls JOIN business b ON b.id = ls.business_id WHERE ls.automatic_clock_out = 1 AND ls.automatic_clock_out_minutes = ${settings.delay})`,
      sql`INSERT INTO audit_log (employee_id, action, entity_type, entity_id, created_at) SELECT ${row.employeeId}, 'clock.automatic_out', 'clock_event', ${String(row.eventId)}, ${receivedAt} WHERE changes() = 1`,
    ]);
    count += results[0].meta.changes;
  }
  return count;
}

// One immutable, non-personal receipt per hour proves scheduled execution without
// an open dashboard or access to Cloudflare's live-log permission.
export async function runScheduledMaintenance(db: Database, now = Date.now()) {
  const recorded = await runClockMaintenance(db, now);
  const hour = new Date(now); hour.setUTCMinutes(0, 0, 0);
  await db.run(sql`INSERT INTO audit_log (action, entity_type, entity_id, metadata, created_at)
    SELECT 'maintenance.scheduled', 'system', 'scheduled-workforce', ${JSON.stringify({ recorded })}, ${new Date(now).toISOString()}
    WHERE COALESCE((SELECT created_at FROM audit_log WHERE entity_type = 'system'
      AND entity_id = 'scheduled-workforce' AND action = 'maintenance.scheduled' ORDER BY id DESC LIMIT 1), '') < ${hour.toISOString()}`);
  return recorded;
}
