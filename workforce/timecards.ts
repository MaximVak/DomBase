import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newRecordId } from "./contract";
import type { Change, StaffState } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope, roleFor } from "./records";
import * as v from "./validation";
import { requireOtherEmployee } from "./self-edit";
export async function timecardChange(r: RecordContext, change: Change) {
  r.ctx.requirePermission("timesheets.manage");
  if (!change.after) throw new AuthError(400, "Time history cannot be removed.");
  const data = v.object(change.after);
  const selectedDate = v.date(data.date);
  if (r.view.period && (selectedDate < r.view.period.start || selectedDate > r.view.period.end)) throw new AuthError(400, "Select the time card's date range before editing it.");
  requireOtherEmployee(r.ctx, v.integer(data.employeeId));
  if (change.entity === "hours-adjustment") {
    if (change.before) throw new AuthError(400, "Add a compensating adjustment instead of changing history.");
    if (!r.ctx.allDepartments) throw new AuthError(403, "A General Manager or Owner must make a department-independent hours adjustment.");
    v.keys(data, ["id", "employeeId", "date", "hours"]); const employeeId = v.integer(data.employeeId); await employeeInScope(r, employeeId);
    const date = v.date(data.date); const seconds = Math.round(v.number(data.hours, -744, 744) * 3600); if (!seconds) throw new AuthError(400, "Enter a non-zero adjustment.");
    const employee = r.view.state.employees.find(e => e.id === employeeId); const role = employee?.role ? roleFor(r, employee.role) : null; const cardId = newRecordId();
    r.tx.insert(s.timeCards, { id: cardId, employeeId, workDate: date, roleId: role?.id ?? null, roleName: role?.name ?? "", source: "manual" });
    r.tx.insert(s.hoursAdjustments, { id: change.id, employeeId, date, adjustmentSeconds: seconds, actorAccountId: r.ctx.account.id, reason: "Manual hours adjustment" });
    r.tx.insert(s.timeCardEdits, { id: newRecordId(), cardId, employeeId, revision: 1, actorAccountId: r.ctx.account.id, reason: "Manual hours adjustment", before: { description: "Existing recorded hours" }, after: { description: `Manual hours adjustment: ${seconds / 3600} hours`, adjustmentSeconds: seconds }, createdAt: r.tx.stamp });
    return;
  }
  v.keys(data, ["employeeId", "date", "eventIds", "events", "cardId", "reason", "description"]);
  const employeeId = v.integer(data.employeeId); await employeeInScope(r, employeeId);
  const removed = v.list(data.eventIds, 100).map(id => v.integer(id)); if (new Set(removed).size !== removed.length) throw new AuthError(400, "Duplicate time-card event.");
  const beforeEvents = r.view.state.clockEvents.filter(event => removed.includes(event.id));
  if (beforeEvents.length !== removed.length || beforeEvents.some(event => event.employeeId !== employeeId)) throw new AuthError(403, "The selected time-card events are outside your access.");
  const values = v.list(data.events, 100); if (values.length < 2) throw new AuthError(400, "A corrected card needs a clock-in and clock-out.");
  const events: StaffState["clockEvents"] = values.map(value => {
    const event = v.object(value); v.keys(event, ["id", "employeeId", "type", "at", "role", "explanation", "automatic", "cardId", "durationMinutes", "durationSeconds"]);
    if (event.employeeId !== employeeId || event.automatic) throw new AuthError(403, "Time-card identity must match the selected employee.");
    const at = v.text(event.at, 35, true); if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || Date.parse(at) > Date.parse(r.tx.stamp) + 1000) throw new AuthError(400, "Use a valid timestamp that is not in the future.");
    return { id: v.integer(event.id), employeeId, type: v.oneOf(event.type, ["in", "out", "break", "break_end"]), at, ...(event.role ? { role: v.text(event.role, 100) } : {}), ...(event.explanation ? { explanation: v.text(event.explanation, 1000) } : {}) };
  });
  if (new Set(events.map(event => event.id)).size !== events.length || events[0].type !== "in" || events.at(-1)!.type !== "out") throw new AuthError(400, "Invalid time-card sequence.");
  let previous = -Infinity; let breaking = false;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]; const at = Date.parse(event.at);
    if (at <= previous || (index > 0 && event.type === "in") || (index < events.length - 1 && event.type === "out")) throw new AuthError(400, "Time-card events must follow their actual order.");
    if (event.type === "break") { if (breaking) throw new AuthError(400, "Breaks cannot overlap."); breaking = true; }
    if (event.type === "break_end") { if (!breaking) throw new AuthError(400, "A break end needs a break start."); breaking = false; }
    previous = at;
  }
  if (breaking || Date.parse(events.at(-1)!.at) - Date.parse(events[0].at) > 24 * 3600000) throw new AuthError(400, "Use a complete time card of up to 24 hours.");
  const role = roleFor(r, events[0].role); const date = v.date(data.date);
  const actualDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(events[0].at));
  if (date !== actualDate) throw new AuthError(400, "Time-card date must match the location's clock-in date.");
  const other = r.view.state.clockEvents.filter(event => event.employeeId === employeeId && !removed.includes(event.id)).sort((a, b) => a.at.localeCompare(b.at));
  let start: number | null = null;
  const a = Date.parse(events[0].at); const b = Date.parse(events.at(-1)!.at);
  for (const event of other) {
    if (event.type === "in") start = Date.parse(event.at);
    if (event.type === "out" && start !== null) { if (Math.max(a, start) < Math.min(b, Date.parse(event.at))) throw new AuthError(409, "This time card overlaps another recorded card."); start = null; }
  }
  if (start !== null && Math.max(a, start) < Math.min(b, Date.parse(r.tx.stamp))) throw new AuthError(409, "This time card overlaps an active recorded card.");
  let existing: typeof s.timeCards.$inferSelect | undefined = data.cardId ? ( await r.db.select().from(s.timeCards).where(eq(s.timeCards.id, v.integer(data.cardId))))[0] : undefined;
  if (existing && existing.employeeId !== employeeId) {
    if (beforeEvents.some(event => event.id === data.cardId && !event.cardId)) existing = undefined;
    else throw new AuthError(403, "Time-card identity is outside your access.");
  }
  if (existing && existing.workDate !== date) throw new AuthError(400, "Keep the original time-card date. Add a separate card for another date.");
  const cardId = existing?.id ?? newRecordId(); const revision = (existing?.version ?? 0) + 1;
  const lastPunch = await r.db.get<{ id: number }>(sql`SELECT COALESCE(MAX(id),0) AS id FROM clock_events WHERE employee_id = ${employeeId}`);
  const unchanged = sql`COALESCE((SELECT MAX(id) FROM clock_events WHERE employee_id = ${employeeId}),0) = ${lastPunch?.id ?? 0}`;
  if (existing) r.tx.update(s.timeCards, { version: revision, roleId: role.id, roleName: role.name, updatedAt: r.tx.stamp }, sql`id = ${cardId} AND employee_id = ${employeeId} AND version = ${existing.version} AND ${unchanged}`);
  else r.tx.insert(s.timeCards, { id: cardId, employeeId, workDate: date, roleId: role.id, roleName: role.name, source: removed.length ? "punch" : "manual", version: revision }, unchanged);
  const afterEvents = events.map(event => ({ ...event, cardId }));
  r.tx.insert(s.timeCardEdits, { id: change.id, cardId, employeeId, revision, actorAccountId: r.ctx.account.id, reason: v.text(data.reason || "Time card corrected", 1000, true), before: { eventIds: removed, events: beforeEvents, description: beforeEvents.map(event => `${event.type}: ${event.at}`).join("; ") }, after: { events: afterEvents, description: v.text(data.description || afterEvents.map(event => `${event.type}: ${event.at}`).join("; "), 4000) }, createdAt: r.tx.stamp });
}
