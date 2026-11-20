import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newRecordId } from "./contract";
import type { Change, StaffState } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope, roleFor } from "./records";
import * as v from "./validation";
import { requireOtherEmployee } from "./self-edit";
import { timeCardNotes } from "./timecard-notes";
import type { ClockDetails } from "../kiosk/break-rules";
import { periodLockByDate, periodLockByTime, requireTimesheetUnlocked } from "./timesheet-lock-guards";
import { timesheetCardKey } from "./timesheet-lock-types";

type Event = StaffState["clockEvents"][number];
type Card = typeof s.timeCards.$inferSelect;
const cardDate = (at: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(at));

function completeSelection(events: Event[], selected: Event[]) {
  const first = selected[0];
  if (first?.type !== "in") return false;
  const start = events.findIndex(event => event.id === first.id);
  let end = start + 1;
  while (end < events.length && events[end].type !== "in" && events[end].type !== "out") end++;
  if (events[end]?.type === "out") end++;
  const session = events.slice(start, end);
  return session.length === selected.length && session.every((event, index) => event.id === selected[index].id);
}

function describe(events: Event[]) {
  return [events[0]?.role, ...events.map(event => `${event.type}: ${event.at}`)].filter(Boolean).join(" · ").slice(0, 4000);
}

async function appendRevision(r: RecordContext, id: number, employeeId: number, date: string, existing: Card | undefined,
  before: Event[], events: Event[], role: { id: number | null; name: string }, reason: string, deleted = false) {
  const key = before[0] ? timesheetCardKey(employeeId, before[0].id, existing?.id) : "";
  const bounds = [before, events].filter(sequence => sequence.length).map(sequence => periodLockByTime(
    sequence[0].at, sequence.at(-1)?.type === "out" ? sequence.at(-1)!.at : r.tx.stamp));
  await requireTimesheetUnlocked(r.db, sql.join([sql`l.target_key = ${key}`, periodLockByDate(date), ...bounds.map(bound => sql`(${bound})`)], sql` OR `));
  const cardId = existing?.id ?? newRecordId();
  const revision = (existing?.version ?? 0) + 1;
  const lastPunch = await r.db.get<{ id: number }>(sql`SELECT COALESCE(MAX(id),0) AS id FROM clock_events WHERE employee_id = ${employeeId}`);
  const unchanged = sql`COALESCE((SELECT MAX(id) FROM clock_events WHERE employee_id = ${employeeId}),0) = ${lastPunch?.id ?? 0}`;
  if (existing) r.tx.update(s.timeCards, { version: revision, roleId: role.id, roleName: role.name, updatedAt: r.tx.stamp }, sql`id = ${cardId} AND employee_id = ${employeeId} AND version = ${existing.version} AND ${unchanged}`);
  else r.tx.insert(s.timeCards, { id: cardId, employeeId, workDate: date, roleId: role.id, roleName: role.name, source: before.length ? "punch" : "manual", version: revision }, unchanged);
  r.tx.insert(s.timeCardEdits, {
    id, cardId, employeeId, revision, actorAccountId: r.ctx.account.id, reason,
    before: { eventIds: before.map(event => event.id), events: before, description: describe(before) },
    after: { events: events.map(event => ({ ...event, cardId })), description: deleted ? "Time card deleted" : describe(events), ...(deleted ? { deleted: true } : {}) },
    createdAt: r.tx.stamp,
  });
}

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
    await requireTimesheetUnlocked(r.db, sql`(${periodLockByDate(date)}) OR (l.employee_id = ${employeeId} AND ${date} BETWEEN l.start_date AND l.end_date)`);
    const employee = r.view.state.employees.find(e => e.id === employeeId); const role = employee?.role ? roleFor(r, employee.role) : null; const cardId = newRecordId();
    r.tx.insert(s.timeCards, { id: cardId, employeeId, workDate: date, roleId: role?.id ?? null, roleName: role?.name ?? "", source: "manual" });
    r.tx.insert(s.hoursAdjustments, { id: change.id, employeeId, date, adjustmentSeconds: seconds, actorAccountId: r.ctx.account.id, reason: "Manual hours adjustment" });
    r.tx.insert(s.timeCardEdits, { id: newRecordId(), cardId, employeeId, revision: 1, actorAccountId: r.ctx.account.id, reason: "Manual hours adjustment", before: { description: "Existing recorded hours" }, after: { description: `Manual hours adjustment: ${seconds / 3600} hours`, adjustmentSeconds: seconds }, createdAt: r.tx.stamp });
    return;
  }
  r.ctx.requirePermission("timesheets.read");
  v.keys(data, ["employeeId", "date", "eventIds", "events", "cardId", "reason", "description", "operation"]);
  const deleted = data.operation === undefined ? false : v.oneOf(data.operation, ["delete"]) === "delete";
  const employeeId = v.integer(data.employeeId); const employee = await employeeInScope(r, employeeId);
  const removed = v.list(data.eventIds, 100).map(id => v.integer(id)); if (new Set(removed).size !== removed.length) throw new AuthError(400, "Duplicate time-card event.");
  const employeeEvents = r.view.state.clockEvents.filter(event => event.employeeId === employeeId);
  const beforeEvents = employeeEvents.filter(event => removed.includes(event.id));
  if (beforeEvents.length !== removed.length) throw new AuthError(403, "The selected time-card events are outside your access.");
  if (removed.length && !completeSelection(employeeEvents, beforeEvents)) throw new AuthError(409, "Reload and select one complete time card.");
  const originalIn = beforeEvents[0];
  const requestedCardId = data.cardId === undefined ? undefined : v.integer(data.cardId);
  if (originalIn && requestedCardId !== undefined && requestedCardId !== (originalIn.cardId ?? originalIn.id)) throw new AuthError(403, "Time-card identity does not match the selected clock-in.");
  const [existing] = originalIn?.cardId ? await r.db.select().from(s.timeCards).where(eq(s.timeCards.id, originalIn.cardId)) : [];
  if (originalIn?.cardId && (!existing || existing.employeeId !== employeeId)) throw new AuthError(403, "Time-card identity is outside your access.");
  const inScope = (roleId: number | null) => r.ctx.allDepartments || r.roles.some(role => role.id === roleId && r.ctx.departmentIds.includes(role.departmentId ?? -1));
  if (existing && !inScope(existing.roleId)) throw new AuthError(403, "This time card is outside your departments.");
  const date = selectedDate;
  if (existing && existing.workDate !== date) throw new AuthError(400, "Keep the original time-card date. Add a separate card for another date.");
  const values = v.list(data.events, 100);
  if (deleted) {
    if (!originalIn || beforeEvents.at(-1)?.type !== "out" || values.length) throw new AuthError(400, "Select a closed time card to delete.");
    if (cardDate(originalIn.at, r.view.basicInfo.timeZone) !== date) throw new AuthError(400, "Select the original clock-in date to delete this card.");
    const rawRole = r.roles.find(role => role.name === originalIn.role) ?? r.roles.find(role => role.id === employee.roleId);
    const role = existing ? { id: existing.roleId, name: existing.roleName } : { id: rawRole?.id ?? null, name: originalIn.role ?? rawRole?.name ?? "" };
    if (!inScope(role.id)) throw new AuthError(403, "This time card is outside your departments.");
    if (!existing && !r.ctx.allDepartments) {
      const last = beforeEvents.at(-1)!;
      const raw = await r.db.all<{ id: number }>(sql`SELECT id FROM clock_events WHERE employee_id = ${employeeId} AND id BETWEEN ${originalIn.id} AND ${last.id}`);
      if (raw.length !== removed.length || raw.some(event => !removed.includes(event.id))) throw new AuthError(403, "A company-wide manager must review this time card.");
    }
    const reason = v.text(data.reason || "Time card deleted", 1000, true);
    await appendRevision(r, change.id, employeeId, date, existing, beforeEvents, [], role, reason, true);
    return;
  }
  if (values.length < 2) throw new AuthError(400, "A corrected card needs a clock-in and clock-out.");
  const events: StaffState["clockEvents"] = values.map(value => {
    const event = v.object(value); v.keys(event, ["id", "employeeId", "type", "at", "role", "explanation", "automatic", "cardId", "durationMinutes", "durationSeconds", "clockDetails"]);
    if (event.employeeId !== employeeId || event.automatic) throw new AuthError(403, "Time-card identity must match the selected employee.");
    const at = v.text(event.at, 35, true); if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || Date.parse(at) > Date.parse(r.tx.stamp) + 1000) throw new AuthError(400, "Use a valid timestamp that is not in the future.");
    const type = v.oneOf(event.type, ["in", "out", "break", "break_end"]);
    let clockDetails: ClockDetails | undefined;
    if (event.clockDetails !== undefined) {
      const details = v.object(event.clockDetails);
      if (type === "in" && details.california === true && r.view.settings.breakPremiums) {
        v.keys(details, ["california"]);
        clockDetails = { california: true };
      } else {
        v.keys(details, ["breakKind"]);
        if (type !== "break") throw new AuthError(400, "A break type requires a break start.");
        clockDetails = { breakKind: v.oneOf(details.breakKind, ["rest", "meal"] as const) };
      }
    }
    return { id: v.integer(event.id), employeeId, type, at, ...(event.role ? { role: v.text(event.role, 100) } : {}), ...(event.explanation ? { explanation: v.text(event.explanation, 1000), noteAuthor: "manager" } : {}), ...(clockDetails ? { clockDetails } : {}) };
  });
  if (new Set(events.map(event => event.id)).size !== events.length || events[0].type !== "in" || events.at(-1)!.type !== "out") throw new AuthError(400, "Invalid time-card sequence.");
  let previous = -Infinity; let breaking = false;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]; const at = Date.parse(event.at);
    const immediateExit = event.type === "out" && events[index - 1]?.type === "break_end" && at === previous;
    if (at < previous || (at === previous && !immediateExit) || (index > 0 && event.type === "in") || (index < events.length - 1 && event.type === "out")) throw new AuthError(400, "Time-card events must follow their actual order.");
    if (event.type === "break") { if (breaking) throw new AuthError(400, "Breaks cannot overlap."); breaking = true; }
    if (event.type === "break_end") { if (!breaking) throw new AuthError(400, "A break end needs a break start."); breaking = false; }
    previous = at;
  }
  if (breaking || Date.parse(events.at(-1)!.at) - Date.parse(events[0].at) > 24 * 3600000) throw new AuthError(400, "Use a complete time card of up to 24 hours.");
  // Only an original clock action can supply a waiver, early-work report or overage attestation.
  const original = beforeEvents;
  const originalOut = original.find(event => event.type === "out");
  const notes = timeCardNotes(original);
  if (notes.length) events[0].carriedNotes = notes;
  if (originalIn?.clockDetails) events[0].clockDetails = { ...events[0].clockDetails, ...originalIn.clockDetails };
  if (originalOut?.clockDetails) events[events.length - 1].clockDetails = originalOut.clockDetails;
  for (let index = 1; index < events.length - 1; index += 2) {
    const start = events[index], end = events[index + 1];
    const previousIndex = original.findIndex(event => event.type === "break" && event.at === start.at);
    const previous = original[previousIndex], previousEnd = original[previousIndex + 1];
    if (previousIndex < 0 || previousEnd?.type !== "break_end" || previousEnd.at !== end.at) continue;
    if ((previous.clockDetails?.breakKind ?? "meal") !== (start.clockDetails?.breakKind ?? previous.clockDetails?.breakKind ?? "meal")) continue;
    if (previous.clockDetails) start.clockDetails = previous.clockDetails;
    if (previousEnd.clockDetails) end.clockDetails = previousEnd.clockDetails;
  }
  const role = roleFor(r, events[0].role);
  const actualDate = cardDate(events[0].at, r.view.basicInfo.timeZone);
  if (date !== actualDate) throw new AuthError(400, "Time-card date must match the location's clock-in date.");
  const other = employeeEvents.filter(event => !removed.includes(event.id));
  let start: number | null = null;
  const a = Date.parse(events[0].at); const b = Date.parse(events.at(-1)!.at);
  for (const event of other) {
    if (event.type === "in") start = Date.parse(event.at);
    if (event.type === "out" && start !== null) { if (Math.max(a, start) < Math.min(b, Date.parse(event.at))) throw new AuthError(409, "This time card overlaps another recorded card."); start = null; }
  }
  if (start !== null && Math.max(a, start) < Math.min(b, Date.parse(r.tx.stamp))) throw new AuthError(409, "This time card overlaps an active recorded card.");
  await appendRevision(r, change.id, employeeId, date, existing, beforeEvents, events, role, v.text(data.reason || "Time card corrected", 1000, true));
}
