import { plusDays } from "./rules";
import { zonedTimestamp } from "../workforce/time";
import type { StaffState } from "../workforce/model";

export const shoutoutCategories = [{ id: "teamwork", label: "Teamwork" }, { id: "helpfulness", label: "Helping hand" }, { id: "customer_service", label: "Customer care" }, { id: "great_work", label: "Great work" }] as const;
export function certificateStatus(expires: string | undefined | null, today: string) {
  if (!expires) return "No expiry";
  return expires < today ? "Expired" : expires === today ? "Expires today" : expires <= plusDays(today, 10) ? "Due within 10 days" : "Current";
}
export function certificationStatusFor(entry: { name: string; expirationDate?: string | null }, all: { name: string; expirationDate?: string | null }[], today: string) {
  const name = entry.name.trim().toLowerCase();
  if (entry.expirationDate && all.some(other => other.name.trim().toLowerCase() === name && other.expirationDate && other.expirationDate > entry.expirationDate!)) return "Superseded";
  return certificateStatus(entry.expirationDate, today);
}
function addMonths(date: string, months: number) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 + months;
  const end = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(Number(date.slice(8)), end), 12)).toISOString().slice(0, 10);
}
export type Milestone = { id: string; employeeId: number; name: string; date: string; kind: "birthday" | "anniversary"; label: string };
export function milestonesFor(person: { id: number; name: string; startDate: string; birthdayMonthDay?: string }, start: string, end: string): Milestone[] {
  const result: Milestone[] = [];
  if (person.startDate) {
    const maxMonths = Math.max(12, (Number(end.slice(0, 4)) - Number(person.startDate.slice(0, 4)) + 1) * 12);
    for (let months = 3; months <= maxMonths; months = months < 12 ? months + 3 : months + 12) {
      const date = addMonths(person.startDate, months);
      if (date >= start && date <= end) result.push({ id: `anniversary:${person.id}:${date}`, employeeId: person.id, name: person.name, date, kind: "anniversary", label: months < 12 ? `${months} months` : `${months / 12} ${months === 12 ? "year" : "years"}` });
    }
  }
  if (person.birthdayMonthDay) for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    const md = person.birthdayMonthDay === "02-29" && new Date(Date.UTC(year, 2, 0)).getUTCDate() === 28 ? "02-28" : person.birthdayMonthDay;
    const date = `${year}-${md}`;
    if (date >= start && date <= end) result.push({ id: `birthday:${person.id}:${date}`, employeeId: person.id, name: person.name, date, kind: "birthday", label: "Birthday" });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
export type ShiftScore = { shiftId: number; employeeId: number; name: string; date: string; role: string; scheduledStart: string; scheduledEnd: string; clockIn: string | null; clockOut: string | null; minutesLate: number | null; status: "On time" | "Late" | "No show" | "Excused" | "In progress" | "Upcoming"; score: number | null; workedHours: number; missingClockOut: boolean; automaticClockOut: boolean; missedBreak: boolean };
type ReliabilityInput = { employees: { id: number; name: string; terminated?: boolean; terminationDate?: string }[]; shifts: StaffState["shifts"]; clockEvents: StaffState["clockEvents"]; ptoRequests: Pick<StaffState["ptoRequests"][number], "employeeId" | "status" | "startDate" | "endDate" | "startTime" | "endTime">[] };
export function reliabilityFor(state: ReliabilityInput, start: string, end: string, now: number, settings: { lateMinutes: number; mandatoryMealBreak: boolean; mealBreakAfterHours: number }, zone = "America/Los_Angeles") {
  const rows: ShiftScore[] = [];
  for (const person of state.employees) {
    const shifts = state.shifts.filter(s => s.employeeId === person.id);
    const sessions: { start: string; end: string | null; breaks: number; automatic: boolean; shiftId?: number }[] = [];
    let current: typeof sessions[number] | null = null, breaking: number | null = null;
    for (const event of state.clockEvents.filter(e => e.employeeId === person.id && Date.parse(e.at) <= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id)) {
      const time = Date.parse(event.at);
      if (event.type === "in") {
        current = { start: event.at, end: null, breaks: 0, automatic: false };
        const candidates = shifts.map(s => ({ s, begin: zonedTimestamp(s.date, s.start, zone), finish: zonedTimestamp(s.end <= s.start ? plusDays(s.date, 1) : s.date, s.end, zone) })).filter(s => time >= s.begin - 12 * 3600000 && time <= s.finish).sort((a, b) => Math.abs(a.begin - time) - Math.abs(b.begin - time));
        current.shiftId = candidates[0]?.s.id; sessions.push(current); breaking = null;
      } else if (current) {
        if (event.type === "break" && breaking === null) breaking = time;
        if (event.type === "break_end" && breaking !== null) { current.breaks += Math.max(0, time - breaking); breaking = null; }
        if (event.type === "out") { if (breaking !== null) current.breaks += Math.max(0, time - breaking); current.end = event.at; current.automatic = !!event.automatic; current = null; breaking = null; }
      }
    }
    for (const shift of shifts.filter(s => s.date >= start && s.date <= end)) {
      const begin = zonedTimestamp(shift.date, shift.start, zone), finish = zonedTimestamp(shift.end <= shift.start ? plusDays(shift.date, 1) : shift.date, shift.end, zone);
      const worked = sessions.filter(s => s.shiftId === shift.id), first = worked[0];
      const excused = (person.terminated && person.terminationDate && shift.date > person.terminationDate) || state.ptoRequests.some(p => p.employeeId === person.id && p.status === "approved" && p.startDate <= shift.date && p.endDate >= shift.date && (!p.startTime || !p.endTime || (zonedTimestamp(p.startDate, p.startTime, zone) < finish && zonedTimestamp(p.endDate, p.endTime, zone) > begin)));
      const completed = finish <= now, late = first ? Date.parse(first.start) >= begin + settings.lateMinutes * 60000 : false;
      const workedMs = worked.reduce((sum, s) => sum + (s.end ? Math.max(0, Date.parse(s.end) - Date.parse(s.start) - s.breaks) : 0), 0);
      const status = !completed ? begin > now ? "Upcoming" : "In progress" : excused && !first ? "Excused" : !first ? "No show" : late ? "Late" : "On time";
      rows.push({ shiftId: shift.id, employeeId: person.id, name: person.name, date: shift.date, role: shift.role, scheduledStart: shift.start, scheduledEnd: shift.end,
        clockIn: first?.start ?? null, clockOut: worked.length && worked.every(s => s.end) ? worked.at(-1)!.end : null,
        minutesLate: first ? Math.max(0, Math.round((Date.parse(first.start) - begin) / 60000 * 100) / 100) : null,
        status, score: status === "On time" ? 100 : status === "Late" || status === "No show" ? 0 : null, workedHours: Math.round(workedMs / 3600000 * 100) / 100,
        missingClockOut: completed && worked.some(s => !s.end), automaticClockOut: worked.some(s => s.automatic),
        missedBreak: completed && !!first && settings.mandatoryMealBreak && workedMs >= settings.mealBreakAfterHours * 3600000 && worked.reduce((sum, s) => sum + s.breaks, 0) < 30 * 60000 });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.shiftId - b.shiftId);
}
export function reliabilityTotals(rows: ShiftScore[]) {
  const eligible = rows.filter(r => r.score !== null), worked = eligible.filter(r => r.clockIn), onTime = eligible.filter(r => r.status === "On time").length;
  return { eligible: eligible.length, worked: worked.length, onTime, late: eligible.filter(r => r.status === "Late").length, noShows: eligible.filter(r => r.status === "No show").length,
    attendanceRate: eligible.length ? Math.round(worked.length / eligible.length * 100) : null, punctualityRate: worked.length ? Math.round(onTime / worked.length * 100) : null,
    onTimeShiftScore: eligible.length ? Math.round(onTime / eligible.length * 100) : null, missingClockOuts: rows.filter(r => r.missingClockOut).length, missedBreaks: rows.filter(r => r.missedBreak).length };
}
export function earnedAchievements(rows: ShiftScore[], received: number) {
  const completed = rows.filter(r => r.clockIn && r.clockOut && r.score !== null).length;
  const badges = [1, 10, 50, 100].filter(n => completed >= n).map(n => ({ id: `shifts:${n}`, label: n === 1 ? "First completed shift" : `${n} completed shifts`, detail: "Based on recorded, completed scheduled shifts." }));
  if (received >= 1) badges.push({ id: "appreciation:1", label: "Appreciated by a teammate", detail: "Received a visible teammate shout-out." });
  if (received >= 5) badges.push({ id: "appreciation:5", label: "Five teammate shout-outs", detail: "Received five visible teammate shout-outs." });
  return badges;
}
