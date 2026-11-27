import { clockInTiming } from "../app/schedule-enforcement";
import type { ScheduleEnforcement } from "../app/schedule-enforcement";
import { shiftBounds } from "../kiosk/assistance";
import type { ClockEvent, PublishedTimesheetShift } from "./model";
import type { WorkspacePeriod } from "./period";
import { zonedTimestamp } from "./time";

type Person = { id: number; name: string; terminated?: boolean; terminationDate?: string };
type ApprovedLeave = { employeeId: number; startDate: string; endDate: string; startTime: string | null; endTime: string | null };
type Session = { in: ClockEvent; out?: ClockEvent; pending: boolean; openBreak: boolean };
type Scheduled = PublishedTimesheetShift & { bounds: ReturnType<typeof shiftBounds> | null };
type Status = "On time" | "Late" | "No show" | "Excused" | "In progress" | "Upcoming" | "Needs review";

export type AttendanceRow = {
  shiftId: number;
  employeeId: number;
  name: string;
  role: string;
  date: string;
  scheduledStart: string;
  scheduledEnd: string;
  overnight: boolean;
  clockIn: string | null;
  clockOut: string | null;
  arrivalSeconds: number | null;
  departureSeconds: number | null;
  status: Status;
  review: string | null;
};

const minute = 60_000;
const unconfirmed = (event: ClockEvent) => event.assistedStatus === "pending" || Boolean(event.automatic && !event.assistedStatus);

function recordedSessions(events: ClockEvent[], now: number): Session[] {
  const sessions: Session[] = [];
  let current: Session | undefined;
  for (const event of events.toSorted((a, b) => a.at.localeCompare(b.at) || a.id - b.id)) {
    const stamp = Date.parse(event.at);
    if (!Number.isFinite(stamp) || stamp > now) continue;
    if (event.type === "in") {
      current = { in: event, pending: unconfirmed(event), openBreak: false };
      sessions.push(current);
    } else if (current) {
      current.pending ||= unconfirmed(event);
      if (event.type === "break") current.openBreak = true;
      if (event.type === "break_end") current.openBreak = false;
      if (event.type === "out") {
        current.out = event;
        current = undefined;
      }
    }
  }
  return sessions;
}

function matchesFor(shifts: Scheduled[], sessions: Session[], earlyMinutes: number) {
  const byId = new Map(shifts.map(shift => [shift.id, shift]));
  const matched = new Map<number, Session[]>();
  const ambiguous = new Set<number>();
  for (const session of sessions) {
    const { shiftId, role, at } = session.in;
    const stamp = Date.parse(at);
    const candidates = shiftId !== undefined ? [byId.get(shiftId)].filter(shift => shift !== undefined)
      : shifts.filter(({ role: shiftRole, bounds }) => (!role || role === shiftRole) && bounds
        && stamp >= bounds.start - earlyMinutes * minute && stamp < bounds.end);
    if (shiftId === undefined && (!role || candidates.length > 1)) {
      for (const shift of candidates) ambiguous.add(shift.id);
      continue;
    }
    const [shift] = candidates;
    if (shift) {
      const group = matched.get(shift.id) ?? [];
      group.push(session);
      matched.set(shift.id, group);
    }
  }
  return { matched, ambiguous };
}

function leaveCoversStart(leave: ApprovedLeave, shift: Scheduled, zone: string) {
  if (!shift.bounds || shift.date < leave.startDate || shift.date > leave.endDate) return false;
  if (!leave.startTime || !leave.endTime) return true;
  try {
    return zonedTimestamp(leave.startDate, leave.startTime, zone) <= shift.bounds.start
      && zonedTimestamp(leave.endDate, leave.endTime, zone) > shift.bounds.start;
  } catch { return false; }
}

export function attendanceRows(employees: Person[], shifts: PublishedTimesheetShift[], events: ClockEvent[], approvedLeave: ApprovedLeave[],
  period: WorkspacePeriod, settings: ScheduleEnforcement, zone: string, now: number): AttendanceRow[] {
  const shiftsByPerson = Map.groupBy(shifts, shift => shift.employeeId);
  const eventsByPerson = Map.groupBy(events, event => event.employeeId);
  const leaveByPerson = Map.groupBy(approvedLeave, leave => leave.employeeId);
  const rows: AttendanceRow[] = [];
  for (const person of employees) {
    const schedule: Scheduled[] = (shiftsByPerson.get(person.id) ?? []).map(shift => {
      try { return { ...shift, bounds: shiftBounds({ date: shift.date, startTime: shift.start, endTime: shift.end }, zone) }; }
      catch { return { ...shift, bounds: null }; }
    });
    const sessions = recordedSessions(eventsByPerson.get(person.id) ?? [], now);
    const { matched, ambiguous } = matchesFor(schedule, sessions, settings.earlyClockInMinutes);
    const leave = leaveByPerson.get(person.id) ?? [];
    for (const shift of schedule) {
      if (shift.date < period.start || shift.date > period.end) continue;
      const work = matched.get(shift.id) ?? [];
      const first = work[0];
      const closed = work.length > 0 && work.every(session => session.out);
      const clockIn = first?.in.at ?? null, clockOut = closed ? work.at(-1)!.out!.at : null;
      const inTime = clockIn === null ? null : Date.parse(clockIn);
      const bounds = shift.bounds;
      const review = !bounds ? "Scheduled time needs review" : ambiguous.has(shift.id) ? "Shift match needs review"
        : work.some(session => session.pending) ? "Clock time pending review"
        : work.some(session => session.out && session.openBreak) ? "Unfinished break"
        : first && !closed && now >= bounds.end ? "Missing clock-out" : null;
      const excused = !first && ((person.terminated && person.terminationDate && shift.date > person.terminationDate)
        || leave.some(request => leaveCoversStart(request, shift, zone)));
      let status: Status;
      if (review || !bounds) status = "Needs review";
      else if (excused) status = "Excused";
      else if (now < bounds.start) status = "Upcoming";
      else if (now < bounds.end || (inTime === null && now < bounds.start + settings.noShowMinutes * minute)) status = "In progress";
      else if (inTime === null) status = "No show";
      else status = clockInTiming(inTime, bounds.start, settings) === "late" ? "Late" : "On time";
      rows.push({ shiftId: shift.id, employeeId: person.id, name: person.name, role: shift.role, date: shift.date,
        scheduledStart: shift.start, scheduledEnd: shift.end, overnight: shift.end <= shift.start, clockIn, clockOut,
        arrivalSeconds: bounds && inTime !== null ? Math.round((inTime - bounds.start) / 1000) : null,
        departureSeconds: bounds && clockOut ? Math.round((Date.parse(clockOut) - bounds.end) / 1000) : null,
        status, review });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.scheduledStart.localeCompare(b.scheduledStart)
    || a.name.localeCompare(b.name) || a.shiftId - b.shiftId);
}

export function attendanceTotals(rows: AttendanceRow[]) {
  const byStatus = Map.groupBy(rows, row => row.status);
  const count = (status: Status) => byStatus.get(status)?.length ?? 0;
  const onTime = count("On time"), late = count("Late"), noShows = count("No show");
  const worked = onTime + late, eligible = worked + noShows;
  const percent = (n: number, d: number) => d ? Math.round(n / d * 100) : null;
  return { onTime, late, noShows, worked, eligible, excused: count("Excused"), needsReview: count("Needs review"),
    inProgress: count("In progress"), upcoming: count("Upcoming"),
    punctualityRate: percent(onTime, worked), attendanceRate: percent(worked, eligible), adherenceRate: percent(onTime, eligible) };
}
