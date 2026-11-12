import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newRecordId } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope, roleFor } from "./records";
import * as v from "./validation";
import { zonedTimestamp } from "./time";

type Shift = { id: number; employeeId: number; date: string; start: string; end: string; role: string; station: string; notes?: string };
async function validateShift(r: RecordContext, value: unknown): Promise<Shift> {
  const row = v.object(value); v.keys(row, ["id", "employeeId", "date", "start", "end", "role", "station", "notes"]);
  const id = v.integer(row.id); const employeeId = v.integer(row.employeeId); const employee = await employeeInScope(r, employeeId);
  if (!employee.active || employee.terminated) throw new AuthError(400, "Choose an active employee.");
  const role = roleFor(r, row.role);
  const assigned = await r.db.get(sql`SELECT 1 FROM employee_roles WHERE employee_id = ${employeeId} AND role_id = ${role.id} AND active = 1`);
  // A role assigned by another operation in this batch is checked again at commit.
  if (!assigned && r.view.state.employees.find(e => e.id === employeeId)?.role !== role.name) throw new AuthError(400, "The job role is not assigned to this employee.");
  const date = v.date(row.date); const start = v.time(row.start); const end = v.time(row.end);
  if (start >= end) throw new AuthError(400, "Shift end must follow its start.");
  const notes = v.text(row.notes ?? "", 500);
  const old = r.view.state.shifts.find(shift => shift.id === id);
  if (!old && await r.db.get(sql`SELECT 1 FROM shifts WHERE id = ${id}`)) throw new AuthError(403, "Select the shift's date range before editing it.");
  if (!r.ctx.permissions["schedule.notes.manage"] && notes !== (old?.notes ?? "")) throw new AuthError(403, "You cannot change shift notes.");
  if (old) {
    const now = Date.parse(r.tx.stamp);
    const oldStart = zonedTimestamp(old.date, old.start); const oldEnd = zonedTimestamp(old.date, old.end);
    if (now >= oldEnd) throw new AuthError(409, "This shift has ended and can no longer be changed.");
    if (now >= oldStart && (employeeId !== old.employeeId || date !== old.date || start !== old.start || role.name !== old.role || notes !== (old.notes ?? "") || zonedTimestamp(date, end) <= now)) throw new AuthError(409, "Once a shift starts, only a future clock-out time can be changed.");
  }
  return { id, employeeId, date, start, end, role: role.name, station: v.text(row.station ?? "Floor", 100), notes };
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
    const upserts = await Promise.all(v.list(row.upsertedShifts, 100).map(value => validateShift(r, value)));
    const deleted = v.list(row.deletedShiftIds, 100).map(id => v.integer(id));
    if (new Set(upserts.map(s => s.id)).size !== upserts.length || new Set(deleted).size !== deleted.length) throw new AuthError(400, "Duplicate draft entries.");
    for (const id of deleted) if (!r.view.state.shifts.some(shift => shift.id === id)) throw new AuthError(404, "A deleted shift is outside your access or no longer exists.");
    const merged = [...r.view.state.shifts.filter(s => !deleted.includes(s.id) && !upserts.some(u => u.id === s.id)), ...upserts];
    const unique = new Set<string>(); for (const shift of merged) { const key = `${shift.employeeId}:${shift.date}`; if (unique.has(key)) throw new AuthError(409, "An employee already has a shift on that date."); unique.add(key); }
    const [publication] = await r.db.select().from(s.schedulePublications).orderBy(sql`version DESC`).limit(1);
    const draftId = stored?.id ?? newRecordId();
    if (stored) r.tx.update(s.scheduleDrafts, { version: stored.version + 1, basePublicationVersion: publication?.version ?? 0, updatedAt: r.tx.stamp }, sql`id = ${draftId} AND version = ${stored.version}`);
    else r.tx.insert(s.scheduleDrafts, { id: draftId, ownerAccountId: r.ctx.account.id, basePublicationVersion: publication?.version ?? 0 });
    r.tx.remove(s.scheduleDraftChanges, sql`draft_id = ${draftId}`); r.tx.remove(s.scheduleDraftEmployees, sql`draft_id = ${draftId}`);
    for (const shift of upserts) {
      const original = r.view.state.shifts.find(s => s.id === shift.id);
      if (original) roleFor(r, original.role);
      const role = roleFor(r, shift.role);
      r.tx.insert(s.scheduleDraftChanges, { draftId, clientKey: String(shift.id), operation: "upsert", shiftId: original ? shift.id : null, employeeId: shift.employeeId, roleId: role.id, roleName: role.name, date: shift.date, startTime: shift.start, endTime: shift.end, station: shift.station, notes: shift.notes ?? "" });
    }
    for (const id of deleted) { const shift = r.view.state.shifts.find(s => s.id === id)!; const role = roleFor(r, shift.role); r.tx.insert(s.scheduleDraftChanges, { draftId, clientKey: String(id), operation: "delete", shiftId: id, roleId: role.id }); }
    const affected = new Set([...upserts.map(s => s.employeeId), ...deleted.map(id => r.view.state.shifts.find(s => s.id === id)!.employeeId)]);
    for (const employeeId of affected) r.tx.insert(s.scheduleDraftEmployees, { draftId, employeeId });
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
  const publicationId = newRecordId(); const version = (last?.version ?? 0) + 1;
  r.tx.insert(s.schedulePublications, { id: publicationId, version, publishedByAccountId: r.ctx.account.id, publishedAt: r.tx.stamp });
  for (const item of changes) {
    if (item.operation === "delete") {
      const existing = r.view.state.shifts.find(shift => shift.id === item.shiftId);
      if (!existing) throw new AuthError(403, "A draft shift is outside your access."); roleFor(r, existing.role);
      r.tx.update(s.shifts, { archivedAt: r.tx.stamp, publicationId }, sql`id = ${item.shiftId} AND archived_at IS NULL`); continue;
    }
    const shift = await validateShift(r, { id: item.shiftId ?? Number(item.clientKey), employeeId: item.employeeId, date: item.date, start: item.startTime, end: item.endTime, role: item.roleName, station: item.station ?? "Floor", notes: item.notes ?? "" });
    const role = roleFor(r, shift.role);
    const values = { employeeId: shift.employeeId, roleId: role.id, roleName: role.name, date: shift.date, startTime: shift.start, endTime: shift.end, station: shift.station, ...(!item.shiftId || r.ctx.permissions["schedule.notes.manage"] ? { notes: shift.notes ?? "" } : {}), publicationId };
    const guard = sql`EXISTS (SELECT 1 FROM employees e JOIN employee_roles er ON er.employee_id = e.id WHERE e.id = ${shift.employeeId} AND e.active = 1 AND e.terminated = 0 AND er.role_id = ${role.id} AND er.active = 1)
      AND NOT EXISTS (SELECT 1 FROM shifts sh WHERE sh.employee_id = ${shift.employeeId} AND sh.date = ${shift.date} AND sh.id <> ${shift.id} AND sh.archived_at IS NULL)`;
    if (item.shiftId) r.tx.update(s.shifts, values, sql`id = ${item.shiftId} AND archived_at IS NULL AND ${guard}`);
    else r.tx.insert(s.shifts, { ...values, id: shift.id }, guard);
  }
  if (r.view.settings.notifyScheduleChanges) {
    const employeeIds = new Set(changes.map(row => row.employeeId ?? r.view.state.shifts.find(s => s.id === row.shiftId)?.employeeId).filter((id): id is number => !!id));
    for (const id of employeeIds) r.tx.write(sql`INSERT INTO notifications (id, employee_id, source_key, kind, title, detail, occurred_at, publication_id)
      SELECT ${`schedule-${publicationId}-${id}`}, e.id, ${`publication:${publicationId}`}, 'schedule', 'New schedule published', ${`${r.ctx.account.displayName} published a schedule update.`}, ${r.tx.stamp}, ${publicationId}
      FROM employees e LEFT JOIN employee_settings es ON es.employee_id = e.id WHERE e.id = ${id} AND e.active = 1 AND COALESCE(es.send_location_alerts, 1) = 1 AND ${r.tx.receipt}`);
  }
  const remaining = allChanges.filter(item => !changes.some(selected => selected.id === item.id));
  for (const item of changes) r.tx.remove(s.scheduleDraftChanges, sql`id = ${item.id} AND draft_id = ${stored.id}`);
  r.tx.remove(s.scheduleDraftEmployees, sql`draft_id = ${stored.id}`);
  if (remaining.length) {
    r.tx.update(s.scheduleDrafts, { basePublicationVersion: version, version: stored.version + 1, updatedAt: r.tx.stamp }, sql`id = ${stored.id} AND version = ${stored.version}`);
    for (const employeeId of new Set(remaining.map(row => row.employeeId ?? r.view.state.shifts.find(shift => shift.id === row.shiftId)?.employeeId).filter((id): id is number => !!id))) r.tx.insert(s.scheduleDraftEmployees, { draftId: stored.id, employeeId });
  } else r.tx.remove(s.scheduleDrafts, sql`id = ${stored.id}`);
}
