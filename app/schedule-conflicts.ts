import { availabilityForDate } from "./availability-model";
import { estimateSchedule, scheduleWeekStart } from "./schedule-estimates";
import type { PlannedShift } from "./schedule-estimates";
import type { AvailabilityRequest } from "../workforce/model";
import type { ScheduleEnforcement } from "./schedule-enforcement";
import type { WageRate } from "../team/rules";

export const conflictLabels = {
  unavailable: "Overlaps approved unavailable hours",
  overtime: "Workweek includes scheduled overtime",
  short_rest: "Short rest between workdays",
  availability_outdated: "Availability needs reconfirming",
  availability_missing: "No approved availability on this date",
  time_off: "Overlaps approved time off",
  time_review: "Location time needs review around a clock change",
} as const;
export type ConflictCode = keyof typeof conflictLabels;
export type ShiftConflict = { shiftId: number; codes: ConflictCode[] };
export type ConflictAssessment = { revision: number; availability: boolean; timeOff: boolean; warnings: ShiftConflict[] };
type Leave = { employeeId: number; startDate: string; endDate: string; startTime: string | null; endTime: string | null };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const overlaps = (a: number, b: number, c: number, d: number) => a < d && b > c;
const locationClock = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function clockKey(at: number) { const parts = locationClock.formatToParts(at), part = (key: string) => parts.find(p => p.type === key)!.value; return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`; }
function boundary(date: string, time: string) {
  const wanted = Date.parse(`${date}T${time}:00Z`); let at = wanted;
  for (let i = 0; i < 4; i++) {
    const actual = Date.parse(`${clockKey(at)}:00Z`);
    if (actual === wanted) {
      if (clockKey(at - 3600000) === `${date}T${time}` || clockKey(at + 3600000) === `${date}T${time}`) throw new Error("Ambiguous clock time");
      return at;
    }
    at += wanted - actual;
  }
  throw new Error("Location time does not exist");
}

// Pure advisory analysis. The server supplies complete scheduled hours privately
// and projects only codes for shifts the current actor may see, never wages or
// another department's shifts/notes. Approved leave/preferences never hide work.
export function scheduleConflicts(input: { shifts: PlannedShift[]; availability: AvailabilityRequest[]; leave: Leave[]; settings: ScheduleEnforcement; employees: { id: number; wageRates: WageRate[] }[]; availabilityAllowed: boolean; leaveAllowed: boolean }): ShiftConflict[] {
  const shifts = input.shifts.filter(shift => shift.shiftType !== "day_off" && shift.start < shift.end);
  const codes = new Map<number, Set<ConflictCode>>();
  const add = (id: number, code: ConflictCode) => { const set = codes.get(id) ?? new Set<ConflictCode>(); set.add(code); codes.set(id, set); };
  const edges = new Map<number, { start: number; end: number }>();
  const boundaries = new Map<string, number>();
  const edge = (date: string, time: string) => { const key = `${date}T${time}`; let at = boundaries.get(key); if (at === undefined) { at = boundary(date, time); boundaries.set(key, at); } return at; };
  for (const shift of shifts) {
    const start = minutes(shift.start), end = minutes(shift.end);
    try { const a = edge(shift.date, shift.start), b = edge(shift.date, shift.end); edges.set(shift.id, { start: a, end: b }); if (b - a !== (end - start) * 60000) add(shift.id, "time_review"); }
    catch { add(shift.id, "time_review"); }
    if (input.availabilityAllowed) {
      const { current, slots } = availabilityForDate(input.availability, shift.employeeId, shift.date);
      if (!current) add(shift.id, "availability_missing");
      else {
        if (slots.some(slot => slot.preference === "unavailable" && overlaps(start, end, slot.startHour * 60, slot.endHour * 60))) add(shift.id, "unavailable");
        const confirmedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(current.submittedAt));
        const age = (Date.parse(`${shift.date}T12:00:00Z`) - Date.parse(`${confirmedDate}T12:00:00Z`)) / 86400000;
        if (input.settings.availabilityReviewDays > 0 && age > input.settings.availabilityReviewDays) add(shift.id, "availability_outdated");
      }
    }
    if (input.leaveAllowed && input.leave.some(leave => leave.employeeId === shift.employeeId && leave.startDate <= shift.date && leave.endDate >= shift.date && overlaps(start, end, leave.startTime ? minutes(leave.startTime) : 0, leave.endTime ? minutes(leave.endTime) : 1440))) add(shift.id, "time_off");
  }
  const estimates = estimateSchedule(shifts, input.employees, input.settings, { start: "0001-01-01", end: "9998-12-31", allDepartments: true });
  const overtimeWeeks = new Set(estimates.filter(row => row.overtimeMinutes > 0 || row.doubleTimeMinutes > 0).map(row => `${row.employeeId}:${scheduleWeekStart(row.date, input.settings.workWeekStart)}`));
  for (const shift of shifts) if (overtimeWeeks.has(`${shift.employeeId}:${scheduleWeekStart(shift.date, input.settings.workWeekStart)}`)) add(shift.id, "overtime");
  if (input.settings.minRestHours > 0) {
    const employees = new Set(shifts.map(shift => shift.employeeId));
    for (const employeeId of employees) {
      const days = new Map<string, PlannedShift[]>();
      for (const shift of shifts.filter(s => s.employeeId === employeeId)) days.set(shift.date, [...days.get(shift.date) ?? [], shift]);
      const ordered = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1][1].reduce((a, b) => a.end > b.end ? a : b), next = ordered[i][1].reduce((a, b) => a.start < b.start ? a : b);
        const end = edges.get(previous.id)?.end, start = edges.get(next.id)?.start;
        if (end !== undefined && start !== undefined && start - end < input.settings.minRestHours * 3600000) { add(previous.id, "short_rest"); add(next.id, "short_rest"); }
      }
    }
  }
  return [...codes].map(([shiftId, values]) => ({ shiftId, codes: [...values] }));
}
