import { and, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import type { RecordContext } from "./records";
import { roleFor } from "./records";
import * as v from "./validation";
import { shiftColors, shiftLayoutError, type ShiftColor, type ShiftType } from "../app/shift-builder";
export type Shift = { shiftType: ShiftType; color: ShiftColor; id: number; employeeId: number; date: string; start: string; end: string; role: string; station: string; notes?: string };
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
export async function validateShifts(r: RecordContext, values: unknown[]): Promise<Shift[]> {
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
export async function validatePlan(r: RecordContext, upserts: Shift[], deleted: number[]) {
  if (!upserts.length) return;
  const existing = await r.db.select().from(s.shifts).where(sql`archived_at IS NULL AND employee_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(upserts.map(s => s.employeeId))])})) AND date IN (SELECT value FROM json_each(${JSON.stringify([...new Set(upserts.map(s => s.date))])}))`).limit(2001);
  if (existing.length > 2000) throw new AuthError(400, "Too many shifts in this plan. Choose fewer employees or dates.");
  const replaced = new Set([...deleted, ...upserts.map(s => s.id)]);
  const error = shiftLayoutError([...existing.filter(s => !replaced.has(s.id)).map(s => ({ ...s, start: s.startTime, end: s.endTime })), ...upserts]);
  if (error) throw new AuthError(409, error);
}
