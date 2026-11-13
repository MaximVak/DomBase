import type { Shift } from "../workforce/model";

export const shiftColors = ["blue", "green", "amber", "red", "violet", "gray"] as const;
export type ShiftColor = typeof shiftColors[number];
export type ShiftType = "work" | "day_off";
export function isWorkShift(shift: { shiftType?: string }) { return shift.shiftType !== "day_off"; }
export function shiftLayoutError(shifts: Pick<Shift, "id" | "employeeId" | "date" | "start" | "end" | "shiftType">[]) {
  const days = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const key = `${shift.employeeId}:${shift.date}`, prior = days.get(key) ?? [];
    if (prior.some(other => !isWorkShift(other) || !isWorkShift(shift))) return "A day off cannot share a date with another entry for this employee.";
    if (prior.some(other => other.start < shift.end && other.end > shift.start)) return "This employee has overlapping shifts. Choose separate time ranges.";
    days.set(key, [...prior, shift]);
  }
  return "";
}
