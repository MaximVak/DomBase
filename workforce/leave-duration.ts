export const fullDayLeaveMinutes = 8 * 60;
const dayMilliseconds = 86400000;
export const leaveCategories = { pto: "Paid time off", sick: "Paid sick leave", unpaid: "Unpaid time off" } as const;
export type LeaveCategory = keyof typeof leaveCategories;
export type LeaveDates = { startDate: string; endDate: string; startTime?: string | null; endTime?: string | null };

export function leaveCategory(request: { category?: LeaveCategory | null; compensation: string }): LeaveCategory {
  return request.category ?? (request.compensation === "unpaid" ? "unpaid" : "pto");
}

type Interval = [start: number, end: number];
const timeMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function partialDayInterval({ startDate, endDate, startTime, endTime }: LeaveDates): Interval | null {
  return startDate === endDate && startTime && endTime ? [timeMinutes(startTime), timeMinutes(endTime)] : null;
}

export function leaveRequestMinutes(request: LeaveDates): number {
  const interval = partialDayInterval(request);
  if (interval) return Math.max(0, interval[1] - interval[0]);
  const days = (Date.parse(request.endDate) - Date.parse(request.startDate)) / dayMilliseconds + 1;
  return Number.isFinite(days) ? Math.max(0, days) * fullDayLeaveMinutes : 0;
}

// Callers supply approved requests eligible for their view or balance.
export function approvedLeaveMinutesByDay(requests: LeaveDates[], period: { start: string; end: string }): Map<string, number> {
  const days = new Map<string, Interval[] | null>();
  for (const request of requests) {
    const start = request.startDate < period.start ? period.start : request.startDate;
    const end = Date.parse(request.endDate > period.end ? period.end : request.endDate);
    const interval = partialDayInterval(request);
    for (let day = Date.parse(start); day <= end; day += dayMilliseconds) {
      const date = new Date(day).toISOString().slice(0, 10);
      if (days.get(date) === null) continue;
      if (!interval) days.set(date, null);
      else {
        const entries = days.get(date) ?? [];
        entries.push(interval);
        days.set(date, entries);
      }
    }
  }
  const totals = new Map<string, number>();
  for (const [date, intervals] of days) {
    let minutes = intervals ? 0 : fullDayLeaveMinutes;
    let previousEnd = 0;
    for (const [start, end] of intervals?.sort(([a], [b]) => a - b) ?? []) {
      minutes += Math.max(0, end - Math.max(start, previousEnd));
      previousEnd = Math.max(previousEnd, end);
    }
    totals.set(date, minutes);
  }
  return totals;
}
