import { sql } from "drizzle-orm";
import * as s from "../db/schema";
import type { ClockEvent } from "./model";
import { timeCardNotes } from "./timecard-notes";

// SQLite CURRENT_TIMESTAMP is UTC but omits its zone; never let a browser treat it as local time.
export const timestamp = (value: string) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + ".000Z" : value;

// Superseded punches never reappear when a correction changes department scope.
export const currentRawPunch = sql`NOT EXISTS (SELECT 1 FROM time_cards tc JOIN time_card_edits ed ON ed.card_id = tc.id
    JOIN json_each(ed.before, '$.eventIds') removed
    WHERE tc.employee_id = ${s.clockEvents.employeeId} AND removed.value = ${s.clockEvents.id})`;

type RawClock = { event: typeof s.clockEvents.$inferSelect; assistance: typeof s.assistedClockReports.$inferSelect | null; photoEventId?: number | null };
type ClockEdit = Pick<typeof s.timeCardEdits.$inferSelect, "before" | "after" | "cardId"> & { photoEventId?: number | null };
export function projectClockEvents(rawClocks: RawClock[], edits: ClockEdit[], showShift = false): ClockEvent[] {
  const projected: ClockEvent[] = rawClocks.map(({ event: row, assistance, photoEventId }) => {
    const resolved = assistance && (assistance.status !== "pending" || row.eventType === "in");
    const clockAt = resolved ? assistance.decidedTime ?? assistance.requestedAt : row.occurredAt;
    const explanation = assistance?.reason ?? row.explanation;
    return { id: row.id, employeeId: row.employeeId, type: row.eventType, at: timestamp(clockAt),
      role: row.roleName || undefined, explanation: explanation || undefined, automatic: row.automatic,
      ...(explanation && (assistance || row.source === "kiosk" || row.source === "offline") ? { noteAuthor: "employee" as const } : {}),
      cardId: row.cardId ?? undefined, ...(showShift && row.shiftId !== null ? { shiftId: row.shiftId } : {}), ...(row.clockDetails ? { clockDetails: row.clockDetails } : {}),
      ...(assistance ? { assistedStatus: assistance.status } : {}), ...(photoEventId ? { photoEventId } : {}) };
  });
  const revisedCards = new Map<number, ClockEvent[]>();
  for (const edit of edits) {
    if (!Array.isArray(edit.before.eventIds) || !Array.isArray(edit.after.events)) continue;
    const events = [...edit.after.events as ClockEvent[]];
    const photoEventId = edit.photoEventId ?? revisedCards.get(edit.cardId)?.[0]?.photoEventId;
    if (events.length && photoEventId) events[0] = { ...events[0], photoEventId };
    if (events.length && !events[0].carriedNotes) {
      const before = Array.isArray(edit.before.events) ? edit.before.events as ClockEvent[] : [];
      const notes = timeCardNotes([...(revisedCards.get(edit.cardId) ?? []), ...before]);
      if (notes.length) events[0] = { ...events[0], carriedNotes: notes };
    }
    revisedCards.set(edit.cardId, events);
  }
  for (const events of revisedCards.values()) projected.push(...events);
  return projected.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
}
