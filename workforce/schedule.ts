import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newRecordId } from "./contract";
import { maxScheduleEntries } from "../app/schedule-tools-model";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { roleFor } from "./records";
import * as v from "./validation";
import { validateShifts, validatePlan } from "./shift-plan";
import { publishSchedule } from "./schedule-publication";

export async function scheduleChange(r: RecordContext, change: Change) {
  r.ctx.requirePermission("schedule.manage");
  if (change.entity === "schedule-event") {
    if (!r.view.settings.enableScheduleEvents) throw new AuthError(403, "Schedule events are disabled.");
    if (change.after === null) { r.tx.remove(s.scheduleEvents, sql`id = ${change.id}`); return; }
    const row = v.object(change.after); v.keys(row, ["id", "date", "title", "notes"]);
    const notes = v.text(row.notes ?? "", 500);
    if (!r.ctx.permissions["schedule.notes.manage"] && notes !== (change.before ? v.object(change.before).notes : "")) throw new AuthError(403, "You cannot change event notes.");
    const values = { date: v.date(row.date), title: v.text(row.title, 100, true), notes };
    if (change.before) r.tx.update(s.scheduleEvents, { date: values.date, title: values.title, ...(r.ctx.permissions["schedule.notes.manage"] ? { notes } : {}), updatedAt: r.tx.stamp }, sql`id = ${change.id}`);
    else r.tx.insert(s.scheduleEvents, { id: change.id, ...values, createdByAccountId: r.ctx.account.id });
    return;
  }
  const [stored] = await r.db.select().from(s.scheduleDrafts).where(eq(s.scheduleDrafts.ownerAccountId, r.ctx.account.id));
  if (change.entity === "schedule-draft") {
    if (change.after === null) { if (stored) { r.tx.remove(s.scheduleDraftChanges, sql`draft_id = ${stored.id}`); r.tx.remove(s.scheduleDraftEmployees, sql`draft_id = ${stored.id}`); r.tx.remove(s.scheduleDrafts, sql`id = ${stored.id}`); } return; }
    const row = v.object(change.after); v.keys(row, ["upsertedShifts", "deletedShiftIds", "affectedEmployeeIds"]);
    const upserts = await validateShifts(r, v.list(row.upsertedShifts, maxScheduleEntries));
    const deleted = v.list(row.deletedShiftIds, maxScheduleEntries).map(id => v.integer(id));
    if (new Set(upserts.map(s => s.id)).size !== upserts.length || new Set(deleted).size !== deleted.length) throw new AuthError(400, "Duplicate draft entries.");
    for (const id of deleted) if (!r.view.state.shifts.some(shift => shift.id === id)) throw new AuthError(404, "A deleted shift is outside your access or no longer exists.");
    await validatePlan(r, upserts, deleted);
    const [publication] = await r.db.select().from(s.schedulePublications).orderBy(sql`version DESC`).limit(1);
    const draftId = stored?.id ?? newRecordId();
    if (stored) r.tx.update(s.scheduleDrafts, { version: stored.version + 1, basePublicationVersion: publication?.version ?? 0, updatedAt: r.tx.stamp }, sql`id = ${draftId} AND version = ${stored.version}`);
    else r.tx.insert(s.scheduleDrafts, { id: draftId, ownerAccountId: r.ctx.account.id, basePublicationVersion: publication?.version ?? 0 });
    r.tx.remove(s.scheduleDraftChanges, sql`draft_id = ${draftId}`); r.tx.remove(s.scheduleDraftEmployees, sql`draft_id = ${draftId}`);
    const draftRows: Record<string, unknown>[] = [];
    for (const shift of upserts) {
      const original = r.view.state.shifts.find(s => s.id === shift.id);
      if (original) roleFor(r, original.role);
      const role = roleFor(r, shift.role);
      draftRows.push({ draftId, clientKey: String(shift.id), operation: "upsert", shiftId: original ? shift.id : null, employeeId: shift.employeeId, roleId: role.id, roleName: role.name, date: shift.date, startTime: shift.start, endTime: shift.end, station: shift.station, shiftType: shift.shiftType, color: shift.color, notes: shift.notes ?? "" });
    }
    for (const id of deleted) { const shift = r.view.state.shifts.find(s => s.id === id)!; const role = roleFor(r, shift.role); draftRows.push({ draftId, clientKey: String(id), operation: "delete", shiftId: id, roleId: role.id, employeeId: null, roleName: null, date: null, startTime: null, endTime: null, station: null, shiftType: "work", color: "blue", notes: null }); }
    r.tx.insertRows(s.scheduleDraftChanges, draftRows);
    const affected = new Set([...upserts.map(s => s.employeeId), ...deleted.map(id => r.view.state.shifts.find(s => s.id === id)!.employeeId)]);
    r.tx.insertRows(s.scheduleDraftEmployees, [...affected].map(employeeId => ({ draftId, employeeId })));
    return;
  }
  await publishSchedule(r, change);
}
