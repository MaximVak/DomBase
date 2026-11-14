import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newRecordId } from "./contract";
import { maxScheduleEntries } from "../app/schedule-tools-model";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { roleFor } from "./records";
import * as v from "./validation";
import { shiftColors, shiftLayoutError, type ShiftColor, type ShiftType } from "../app/shift-builder";

type Shift = { shiftType: ShiftType; color: ShiftColor; id: number; employeeId: number; date: string; start: string; end: string; role: string; station: string; notes?: string };
function validateShift(r: RecordContext, value: unknown, employees: typeof s.employees.$inferSelect[], assignments: Set<string>, collisions: Set<number>): Shift {
  const row = v.object(value); v.keys(row, ["id", "employeeId", "date", "start", "end", "role", "station", "notes", "shiftType", "color"]);
  const id = v.integer(row.id); const employeeId = v.integer(row.employeeId); const employee = employees.find(row => row.id === employeeId);
  if (!employee) throw new AuthError(404, "Employee is not available.");
  if (!employee.active || employee.terminated) throw new AuthError(400, "Choose an active employee.");
  const role = roleFor(r, row.role);
  const assigned = assignments.has(`${employeeId}:${role.id}`);
  // A role assigned by another operation in this batch is checked again at commit.
  if (!assigned && r.view.state.employees.find(e => e.id === employeeId)?.role !== role.name) throw new AuthError(400, "The job role is not assigned to this employee.");
  const date = v.date(row.date); const start = v.time(row.start); const end = v.time(row.end);
  const shiftType = v.oneOf(row.shiftType ?? "work", ["work", "day_off"]);
  const color = v.oneOf(row.color ?? "blue", shiftColors);
  if (shiftType === "day_off" && (start !== "00:00" || end !== "00:00")) throw new AuthError(400, "A day off has no working times.");
  if (shiftType === "work" && start >= end) throw new AuthError(400, "Shift end must follow its start.");
  const notes = v.text(row.notes ?? "", 500);
  const old = r.view.state.shifts.find(shift => shift.id === id);
  if (!old && collisions.has(id)) throw new AuthError(403, "Select the shift's date range before editing it.");
  if (!r.ctx.permissions["schedule.notes.manage"] && notes !== (old?.notes ?? "")) throw new AuthError(403, "You cannot change shift notes.");
  return { id, employeeId, date, start, end, shiftType, color, role: role.name, station: v.text(row.station ?? "Floor", 100), notes };
}
async function validateShifts(r: RecordContext, values: unknown[]): Promise<Shift[]> {
  const ids = values.map(value => v.integer(v.object(value).id)), employeeIds = values.map(value => v.integer(v.object(value).employeeId));
  const selected = sql`id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(employeeIds)])}))`;
  const [employees, assignments, collisions] = await r.db.batch([
    r.db.select().from(s.employees).where(and(selected, r.ctx.employeeFilter(s.employees.id), r.ctx.activeActor())),
    r.db.select({ employeeId: s.employeeRoles.employeeId, roleId: s.employeeRoles.roleId }).from(s.employeeRoles).where(sql`active = 1 AND employee_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(employeeIds)])})) AND ${r.ctx.activeActor()}`),
    r.db.select({ id: s.shifts.id }).from(s.shifts).where(sql`id IN (SELECT value FROM json_each(${JSON.stringify(ids)})) AND ${r.ctx.activeActor()}`),
  ]);
  const assigned = new Set(assignments.map(row => `${row.employeeId}:${row.roleId}`)), occupied = new Set(collisions.map(row => row.id));
  return values.map(value => validateShift(r, value, employees, assigned, occupied));
}
async function validatePlan(r: RecordContext, upserts: Shift[], deleted: number[]) {
  if (!upserts.length) return;
  const existing = await r.db.select().from(s.shifts).where(sql`archived_at IS NULL AND employee_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(upserts.map(s => s.employeeId))])})) AND date IN (SELECT value FROM json_each(${JSON.stringify([...new Set(upserts.map(s => s.date))])}))`).limit(2001);
  if (existing.length > 2000) throw new AuthError(400, "Too many shifts in this plan. Choose fewer employees or dates.");
  const replaced = new Set([...deleted, ...upserts.map(s => s.id)]);
  const error = shiftLayoutError([...existing.filter(s => !replaced.has(s.id)).map(s => ({ ...s, start: s.startTime, end: s.endTime })), ...upserts]);
  if (error) throw new AuthError(409, error);
}
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
  if (change.entity !== "schedule-publish" || !stored) throw new AuthError(409, "Save a draft before publishing.");
  const allChanges = await r.db.select().from(s.scheduleDraftChanges).where(eq(s.scheduleDraftChanges.draftId, stored.id));
  const selection = change.after ? v.object(change.after) : {};
  const departmentId = selection.departmentId === undefined ? null : v.integer(selection.departmentId);
  if (departmentId !== null && !r.view.state.departments.some(d => d.id === departmentId)) throw new AuthError(403, "Department is outside your access.");
  const changes = allChanges.filter(item => departmentId === null || r.roles.some(role => role.id === item.roleId && role.departmentId === departmentId));
  if (!changes.length) throw new AuthError(400, "No draft changes in that department.");
  const [last] = await r.db.select().from(s.schedulePublications).orderBy(sql`version DESC`).limit(1);
  if ((last?.version ?? 0) !== stored.basePublicationVersion) throw new AuthError(409, "Another manager published a schedule. Reload and review your draft before publishing.");
  const publishUpserts = await validateShifts(r, changes.filter(item => item.operation === "upsert").map(item => ({ id: item.shiftId ?? Number(item.clientKey), employeeId: item.employeeId, date: item.date, start: item.startTime, end: item.endTime, role: item.roleName, station: item.station ?? "Floor", notes: item.notes ?? "", shiftType: item.shiftType, color: item.color })));
  await validatePlan(r, publishUpserts, changes.filter(item => item.operation === "delete").map(item => item.shiftId!));
  const publicationId = newRecordId(); const version = (last?.version ?? 0) + 1;
  r.tx.insert(s.schedulePublications, { id: publicationId, version, publishedByAccountId: r.ctx.account.id, publishedAt: r.tx.stamp });
  const newRows: Record<string, unknown>[] = [], editedRows: Record<string, unknown>[] = [], auditRows: Record<string, unknown>[] = [], removedIds: number[] = [];
  for (const item of changes) {
    if (item.operation === "delete") {
      const existing = r.view.state.shifts.find(shift => shift.id === item.shiftId);
      if (!existing) throw new AuthError(403, "A draft shift is outside your access."); roleFor(r, existing.role);
      removedIds.push(item.shiftId!); continue;
    }
    const shift = publishUpserts.find(shift => shift.id === (item.shiftId ?? Number(item.clientKey)))!;
    const role = roleFor(r, shift.role);
    const values = { employeeId: shift.employeeId, roleId: role.id, roleName: role.name, date: shift.date, startTime: shift.start, endTime: shift.end, station: shift.station, shiftType: shift.shiftType, color: shift.color, updatedAt: r.tx.stamp, ...(!item.shiftId || r.ctx.permissions["schedule.notes.manage"] ? { notes: shift.notes ?? "" } : {}), publicationId };
    const before = r.view.state.shifts.find(row => row.id === shift.id);
    const planned = (row: typeof before) => row ? { employeeId: row.employeeId, date: row.date, start: row.start, end: row.end, role: row.role, shiftType: row.shiftType ?? "work", color: row.color ?? "blue" } : null;
    auditRows.push({ actorAccountId: r.ctx.account.id, employeeId: shift.employeeId, action: "schedule.shift_changed", entityType: "shift", entityId: String(shift.id), metadata: { before: planned(before), after: planned(shift), publicationId }, createdAt: r.tx.stamp });
    (item.shiftId ? editedRows : newRows).push({ ...values, id: shift.id });
  }
  const assignmentGuard = sql`EXISTS (SELECT 1 FROM employees e JOIN employee_roles er ON er.employee_id = e.id
    WHERE e.id = json_extract(entry.value, '$.employeeId') AND e.active = 1 AND e.terminated = 0
    AND er.role_id = json_extract(entry.value, '$.roleId') AND er.active = 1)`;
  if (removedIds.length) r.tx.update(s.shifts, { archivedAt: r.tx.stamp, publicationId }, sql`id IN (SELECT value FROM json_each(${JSON.stringify(removedIds)})) AND archived_at IS NULL`, removedIds.length);
  r.tx.insertRows(s.auditLog, auditRows);
  r.tx.updateRows(s.shifts, editedRows, "id", sql`archived_at IS NULL AND ${assignmentGuard}`);
  r.tx.insertRows(s.shifts, newRows, assignmentGuard);

  if (r.view.settings.notifyScheduleChanges) {
    const employeeIds = new Set(changes.map(row => row.employeeId ?? r.view.state.shifts.find(s => s.id === row.shiftId)?.employeeId).filter((id): id is number => !!id));
    r.tx.write(sql`INSERT INTO notifications (id, employee_id, source_key, kind, title, detail, occurred_at, publication_id)
      SELECT ${`schedule-${publicationId}-`} || e.id, e.id, ${`publication:${publicationId}`}, 'schedule', 'New schedule published', ${`${r.ctx.account.displayName} published a schedule update.`}, ${r.tx.stamp}, ${publicationId}
      FROM employees e LEFT JOIN employee_settings es ON es.employee_id = e.id WHERE e.id IN (SELECT value FROM json_each(${JSON.stringify([...employeeIds])})) AND e.active = 1 AND COALESCE(es.send_location_alerts, 1) = 1 AND ${r.tx.receipt}`);
  }
  const remaining = allChanges.filter(item => !changes.some(selected => selected.id === item.id));
  r.tx.remove(s.scheduleDraftChanges, sql`id IN (SELECT value FROM json_each(${JSON.stringify(changes.map(item => item.id))})) AND draft_id = ${stored.id}`);
  r.tx.remove(s.scheduleDraftEmployees, sql`draft_id = ${stored.id}`);
  if (remaining.length) {
    r.tx.update(s.scheduleDrafts, { basePublicationVersion: version, version: stored.version + 1, updatedAt: r.tx.stamp }, sql`id = ${stored.id} AND version = ${stored.version}`);
    r.tx.insertRows(s.scheduleDraftEmployees, [...new Set(remaining.map(row => row.employeeId ?? r.view.state.shifts.find(shift => shift.id === row.shiftId)?.employeeId).filter((id): id is number => !!id))].map(employeeId => ({ draftId: stored.id, employeeId })));
  } else r.tx.remove(s.scheduleDrafts, sql`id = ${stored.id}`);
}
