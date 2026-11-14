import { shiftLayoutError } from "./shift-builder";
import { scheduleWeekStart } from "./schedule-estimates";
import type { ScheduleDraft, Shift } from "../workforce/model";
import type { ConflictAssessment } from "./schedule-conflicts";

export const maxScheduleEntries = 500;
export type ScheduleSelection = { departmentId: number | null; roleId: number | null; employeeIds: number[] | null };
export type ScheduleSource = { kind: "week"; weekStart: string } | { kind: "template"; id: number };
export type ScheduleToolChoice = { revision: number; source: ScheduleSource; targets: string[]; selection: ScheduleSelection; mode: "add" | "replace"; includeNotes: boolean };
export type TemplateSummary = { id: number; name: string; version: number; entries: number; archived: boolean };
export type ScheduleToolRole = { id: number; name: string; departmentId: number | null };
export type ScheduleToolList = { roles: ScheduleToolRole[]; revision: number; templates: TemplateSummary[]; nextCursor: number | null };
export type ScheduleToolPreview = { revision: number; reviewToken: string; added: number; replaced: number; targets: string[]; shifts: Shift[]; warnings: ConflictAssessment; issues: string[] };
export type ScheduleToolResult = { saved: true; revision: number; added?: number; replaced?: number; templateId?: number };
export const offsetScheduleDate = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function repeatScheduleWeeks(week: string, count: number) { return Array.from({ length: count }, (_, i) => offsetScheduleDate(week, (i + 1) * 7)); }
export function weekFor(date: string, start: number) { return scheduleWeekStart(date, start); }
export function workingPlan(shifts: Shift[], draft: ScheduleDraft | null | undefined): Shift[] {
  const removed = new Set([...(draft?.deletedShiftIds ?? []), ...(draft?.upsertedShifts.map(shift => shift.id) ?? [])]);
  return [...shifts.filter(shift => !removed.has(shift.id)), ...(draft?.upsertedShifts ?? [])];
}
// Add never removes work. Replacement is restricted to the caller's explicit
// selection in the target weeks; other dates and draft changes remain intact.
export function buildScheduleToolPlan(input: { source: Shift[]; targets: string[]; weekStart: number; published: Shift[]; draft?: ScheduleDraft | null; mode: "add" | "replace"; selected: (shift: Shift) => boolean; nextId: () => number; includeNotes: boolean }) {
  const { draft } = input;
  const inTargets = (shift: Shift) => input.targets.includes(weekFor(shift.date, input.weekStart)) && input.selected(shift);
  const current = workingPlan(input.published, draft);
  const removed = input.mode === "replace" ? current.filter(inTargets) : [];
  const removeIds = new Set(removed.map(shift => shift.id));
  const copied = input.targets.flatMap(week => input.source.map(shift => ({ ...shift, id: input.nextId(), date: offsetScheduleDate(week, (new Date(`${shift.date}T12:00:00Z`).getUTCDay() - input.weekStart + 7) % 7), notes: input.includeNotes ? shift.notes ?? "" : "" })));
  const upsertedShifts = [...(draft?.upsertedShifts ?? []).filter(shift => !removeIds.has(shift.id)), ...copied];
  const publishedIds = new Set(input.published.map(shift => shift.id));
  const deletedShiftIds = [...new Set([...(draft?.deletedShiftIds ?? []), ...removed.filter(shift => publishedIds.has(shift.id)).map(shift => shift.id)])];
  const plan = workingPlan(input.published, { upsertedShifts, deletedShiftIds, affectedEmployeeIds: [] });
  const issues: string[] = [];
  const layoutError = shiftLayoutError(plan); if (layoutError) issues.push(layoutError);
  if (upsertedShifts.length > maxScheduleEntries || deletedShiftIds.length > maxScheduleEntries) issues.push(`A draft can contain up to ${maxScheduleEntries} additions/edits and ${maxScheduleEntries} removals. Publish or reduce this draft first.`);
  if (!copied.length) issues.push("No shifts match this source and selection.");
  return { copied, removed, plan, issues, draft: { upsertedShifts, deletedShiftIds, affectedEmployeeIds: [...new Set([...upsertedShifts.map(shift => shift.employeeId), ...removed.map(shift => shift.employeeId), ...(draft?.affectedEmployeeIds ?? [])])] } };
}
