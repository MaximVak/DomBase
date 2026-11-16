import { scheduleWeekStart } from "./schedule-estimates";
import { offsetScheduleDate } from "../self/schedule-model";
import type { Shift, ScheduleDraft, PtoRequest } from "../workforce/model";
import type { ScheduleEvent } from "./schedule-events";
import type { OpenSchedule } from "./open-shifts-model";
import { workingOpenShifts } from "./open-shifts-model";

export type PrintView = "day" | "week" | "month";
export type PrintEntry = { text: string; detail: string; station: string; draft: boolean };
export type PrintRow = { name: string; continued: boolean; cells: PrintEntry[][] };
export type SchedulePrintDocument = {
  location: string; timeZone: string; start: string; end: string; capturedAt: string;
  draft: boolean; canPrintDraft: boolean; scope: string;
  sections: { dates: string[]; rows: PrintRow[] }[];
};
export function printPeriod(date: string, view: PrintView, weekStart: number) {
  const start = view === "week" ? scheduleWeekStart(date, weekStart) : view === "month" ? date.slice(0, 7) + "-01" : date;
  const end = view === "week" ? offsetScheduleDate(start, 6) : view === "month" ? offsetScheduleDate(offsetScheduleDate(start, 32).slice(0, 7) + "-01", -1) : date;
  return { start, end };
}
export function printTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
export function printShiftTime(shift: Pick<Shift, "shiftType" | "start" | "end">) {
  return shift.shiftType === "day_off" ? "Day off" : `${printTime(shift.start)} - ${printTime(shift.end)}${shift.end <= shift.start ? " (ends next day)" : ""}`;
}
// Only scheduling labels enter a printable document, even when the caller has
// access to private profiles, wages, leave explanations or shift/event notes.
export function schedulePrintDocument(input: {
  location: string; timeZone: string; start: string; end: string; weekStart: number;
  capturedAt: string; draft: boolean; canPrintDraft: boolean; scope: string;
  employees: { id: number; name: string }[]; shifts: Shift[]; draftChanges?: ScheduleDraft;
  open?: OpenSchedule; events?: ScheduleEvent[]; leave?: PtoRequest[];
}): SchedulePrintDocument {
  const draft = input.draft && input.canPrintDraft;
  const changes = draft ? input.draftChanges : undefined;
  const changed = new Set(changes?.upsertedShifts.map(row => row.id) ?? []);
  const replaced = new Set([...changed, ...changes?.deletedShiftIds ?? []]);
  const shifts = [...input.shifts.filter(row => !replaced.has(row.id)), ...changes?.upsertedShifts ?? []]
    .filter(row => row.date >= input.start && row.date <= input.end).sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const open = input.open ? workingOpenShifts({ ...input.open, draft: draft ? input.open.draft : null }) : [];
  const openDraftIds = new Set(draft ? input.open?.draft?.upserted.map(row => row.id) : []);
  const dates: string[] = [];
  for (let date = input.start; date <= input.end; date = offsetScheduleDate(date, 1)) dates.push(date);
  const weeks = new Map<string, string[]>();
  for (const date of dates) { const key = scheduleWeekStart(date, input.weekStart); weeks.set(key, [...weeks.get(key) ?? [], date]); }
  const entry = (row: Pick<Shift, "shiftType" | "start" | "end" | "role" | "station">, isDraft: boolean): PrintEntry => ({ text: printShiftTime(row), detail: row.shiftType === "day_off" ? "" : row.role || "Shift", station: row.shiftType === "day_off" ? "" : row.station, draft: isDraft });
  const sections = [...weeks.values()].map(days => {
    const rows: PrintRow[] = [];
    // Bound a cell's height without truncating any work or long label. Continued
    // rows repeat the person/date headings in both screen and native printing.
    const append = (name: string, cells: PrintEntry[][]) => {
      const count = Math.max(1, ...cells.map(cell => Math.ceil(cell.length / 2)));
      for (let i = 0; i < count; i++) rows.push({ name, continued: i > 0, cells: cells.map(cell => cell.slice(i * 2, i * 2 + 2)) });
    };
    if (input.events?.some(row => days.includes(row.date))) append("Events", days.map(date => input.events!.filter(row => row.date === date).map(row => ({ text: row.title, detail: "", station: "", draft: false }))));
    if (open.some(row => days.includes(row.date))) append("Open shifts (unassigned)", days.map(date => open.filter(row => row.date === date).map(row => entry(row, openDraftIds.has(row.id)))));
    for (const person of input.employees) append(person.name, days.map(date => [
      ...shifts.filter(row => row.employeeId === person.id && row.date === date).map(row => entry(row, changed.has(row.id))),
      ...(input.leave ?? []).filter(row => row.employeeId === person.id && row.status === "approved" && row.startDate <= date && row.endDate >= date)
        .map(row => ({ text: "Approved time off", detail: row.startTime && row.endTime ? `${printTime(row.startTime)} - ${printTime(row.endTime)}` : "All day", station: "", draft: false })),
    ]));
    if (!rows.length) append("No team members selected", days.map(() => []));
    return { dates: days, rows };
  });
  return { location: input.location, timeZone: input.timeZone, start: input.start, end: input.end, capturedAt: input.capturedAt, draft, canPrintDraft: input.canPrintDraft, scope: input.scope, sections };
}
