import type { AvailabilityRequest, AvailabilityRequestSlot } from "../workforce/model";

export const availabilityWeekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const newestAvailability = (a: AvailabilityRequest, b: AvailabilityRequest) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || b.id - a.id;
export function approvedAvailability(requests: AvailabilityRequest[], employeeId: number, date: string) {
  return requests.filter(request => request.employeeId === employeeId && request.status === "approved" && request.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || newestAvailability(a, b))[0];
}
export function availabilityForDate(requests: AvailabilityRequest[], employeeId: number, date: string) {
  const current = approvedAvailability(requests, employeeId, date);
  const day = availabilityWeekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return { current, slots: (current?.slots ?? []).filter(slot => slot.day === day).sort((a, b) => a.startHour - b.startHour) };
}
export function availabilityTime(hour: number) {
  const minutes = Math.round(hour * 60);
  return minutes === 1440 ? "24:00" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function availabilitySlotLabel(slot: AvailabilityRequestSlot) {
  return `${slot.preference === "preferred" ? "Preferred" : "Unavailable"}: ${slot.startHour === 0 && slot.endHour === 24 ? "All day" : `${availabilityTime(slot.startHour)}–${availabilityTime(slot.endHour)}`}`;
}
