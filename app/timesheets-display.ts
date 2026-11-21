import type { HoursRoundingMinutes, PublishedTimesheetShift } from "../workforce/model";

export type ClockDisplay = "actual" | "schedule";
export type HoursDisplay = "decimal" | "minutes";
export const schedulePreviewLabel = "Schedule-rounded hours (preview)";
export const schedulePreviewNote = "Nearby punches can align to their published shift. The preview covers closed, confirmed cards. Wages, overtime, and break checks use recorded time.";

export function displayMetricKey(column: string, clock: ClockDisplay) {
  return column === "roundedHours" && clock === "schedule" ? "scheduleHours" : column;
}
const timeMetrics = new Set([
  "actual", "scheduled", "variance", "paid", "regular", "ot", "doubleOt", "qualifiedOt", "breaks", "restBreaks",
  "mealPremium", "restPremium", "roundedHours", "scheduleHours", "spread", "pto", "blueLaw", "sick", "others", "child", "holiday",
]);

export function formatHours(hours: number, display: HoursDisplay) {
  if (display === "decimal") return hours.toFixed(2);
  const minutes = Math.round(Math.abs(hours) * 60);
  return `${hours < 0 && minutes ? "−" : ""}${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function formatTimesheetMetric(column: string, value: number | null | undefined, display: HoursDisplay = "decimal") {
  if (value == null) return "—";
  if (column === "wages" || column === "premiumPay") return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return timeMetrics.has(column) ? formatHours(value, display) : value.toFixed(2);
}

type ShiftBounds = { id: number; role: string; start: number; end: number };
export function scheduleShiftBounds(shifts: PublishedTimesheetShift[], stamp: (date: string, time: string) => number, nextDate: (date: string) => string) {
  return shifts.map(shift => ({ id: shift.id, role: shift.role, start: stamp(shift.date, shift.start),
    end: stamp(shift.end <= shift.start ? nextDate(shift.date) : shift.date, shift.end) }))
    .filter(shift => Number.isFinite(shift.start) && Number.isFinite(shift.end) && shift.start < shift.end);
}

export function scheduleClockPreview(
  shifts: ShiftBounds[], punch: { start: number; end: number; shiftId?: number; role?: string }, minutes: HoursRoundingMinutes,
  dateOf: (value: number) => string, bounds: { earliestStart: number; latestEnd: number; firstBreak: number; lastBreak: number },
) {
  const { start, end, shiftId, role } = punch;
  const tolerance = minutes * 30000;
  const near = (actual: number, scheduled: number) => Math.abs(actual - scheduled) <= tolerance && dateOf(actual) === dateOf(scheduled);
  const eligible = shifts.filter(shift => (!role || role === shift.role) && shift.start < end && shift.end > start
    && (near(start, shift.start) || near(end, shift.end)));
  const match = shiftId === undefined ? eligible.length === 1 && role ? eligible[0] : undefined : eligible.find(shift => shift.id === shiftId);
  if (!match) return { start, end };
  const previewStart = near(start, match.start) && match.start >= bounds.earliestStart && match.start <= bounds.firstBreak ? match.start : start;
  const previewEnd = near(end, match.end) && match.end <= bounds.latestEnd && match.end >= bounds.lastBreak ? match.end : end;
  return previewStart < previewEnd ? { start: previewStart, end: previewEnd } : { start, end };
}
