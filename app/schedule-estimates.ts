import { hourlyRate, rateFor, plusDays } from "../team/rules";
import type { WageRate } from "../team/rules";
import type { ScheduleEnforcement } from "./schedule-enforcement";

export type PlannedShift = { id: number; employeeId: number; date: string; start: string; end: string; role: string; shiftType?: string };
export type MealSettings = Pick<ScheduleEnforcement, "mandatoryMealBreak" | "mealBreakAfterHours" | "mealBreakMinutes">;
export type ScheduleEstimate = { shiftId: number; employeeId: number; date: string; grossMinutes: number; unpaidMinutes: number; paidMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number; wagesCents: number | null; issues: string[] };
const time = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
export function scheduleWeekStart(date: string, start: number) {
  const weekday = new Date(`${date}T12:00Z`).getUTCDay();
  return plusDays(date, -((weekday - start + 7) % 7));
}

// Forecast an unpaid meal allowance, never an edit to a punch or a record that
// a meal was actually taken. Adjacent role changes share one meal allowance;
// an existing gap at least as long as the meal resets the continuous block.
export function scheduledPaidMinutes(shifts: PlannedShift[], settings: MealSettings): ScheduleEstimate[] {
  const rows = shifts.map(shift => ({ shiftId: shift.id, employeeId: shift.employeeId, date: shift.date, grossMinutes: shift.shiftType === "day_off" ? 0 : Math.max(0, time(shift.end) - time(shift.start)) || 0, unpaidMinutes: 0, paidMinutes: 0, overtimeMinutes: 0, doubleTimeMinutes: 0, wagesCents: null, issues: [] as string[] }));
  const groups = new Map<string, number[]>();
  shifts.forEach((shift, i) => { if (rows[i].grossMinutes) { const key = `${shift.employeeId}:${shift.date}`; groups.set(key, [...groups.get(key) ?? [], i]); } });
  for (const indexes of groups.values()) {
    indexes.sort((a, b) => time(shifts[a].start) - time(shifts[b].start) || shifts[a].id - shifts[b].id);
    const blocks: number[][] = [];
    for (const index of indexes) {
      const block = blocks.at(-1), previous = block?.at(-1);
      if (previous === undefined || time(shifts[index].start) - time(shifts[previous].end) >= settings.mealBreakMinutes) blocks.push([index]);
      else block!.push(index);
    }
    for (const block of blocks) {
      const gross = block.reduce((sum, index) => sum + rows[index].grossMinutes, 0);
      const threshold = settings.mealBreakAfterHours * 60, duration = settings.mealBreakMinutes;
      // A second meal is needed only when the remaining work exceeds another
      // threshold. At a short boundary, allow the full meal before that boundary.
      const count = settings.mandatoryMealBreak ? Math.min(Math.floor(gross / duration), Math.max(0, Math.ceil((gross - threshold) / (threshold + duration)))) : 0;
      const breaks = Array.from({ length: count }, (_, i) => {
        const start = Math.min((i + 1) * threshold + i * duration, gross - (count - i) * duration);
        return { start, end: start + duration };
      });
      let offset = 0;
      for (const index of block) {
        const row = rows[index];
        row.unpaidMinutes = breaks.reduce((sum, meal) => sum + Math.max(0, Math.min(offset + row.grossMinutes, meal.end) - Math.max(offset, meal.start)), 0);
        row.paidMinutes = row.grossMinutes - row.unpaidMinutes;
        offset += row.grossMinutes;
      }
    }
  }
  return rows;
}

// California's standard 8/12 daily, 40 weekly and seventh-day forecast. Premiums
// are additional pay: base paid hours + .5 * OT + 1 * double time. No tips/PTO.
// Wage selection follows the role and the date of the shift, never today's rate.
export function estimateSchedule(shifts: PlannedShift[], employees: { id: number; wageRates?: WageRate[] }[], settings: MealSettings & { workWeekStart: number }, context: { start: string; end: string; allDepartments: boolean }): ScheduleEstimate[] {
  const rows = scheduledPaidMinutes(shifts, settings);
  const weeks = new Map<string, number[]>();
  rows.forEach((row, i) => { if (row.paidMinutes) { const key = `${row.employeeId}:${scheduleWeekStart(row.date, settings.workWeekStart)}`; weeks.set(key, [...weeks.get(key) ?? [], i]); } });
  for (const indexes of weeks.values()) {
    indexes.sort((a, b) => shifts[a].date.localeCompare(shifts[b].date) || shifts[a].start.localeCompare(shifts[b].start) || shifts[a].id - shifts[b].id);
    const rates = employees.find(employee => employee.id === rows[indexes[0]].employeeId)?.wageRates ?? [];
    const selected = indexes.map(i => rateFor(rates, shifts[i].role, shifts[i].date));
    const hourly = selected.map(hourlyRate);
    const complete = hourly.every(rate => rate !== null);
    const exempt = selected.every(rate => rate?.basis === "annual_salary" && rate.overtimeExempt);
    const mixedExemption = !exempt && selected.some(rate => rate?.basis === "annual_salary" && rate.overtimeExempt);
    const week = scheduleWeekStart(rows[indexes[0]].date, settings.workWeekStart);
    const fullContext = context.allDepartments && context.start <= week && context.end >= plusDays(week, 6);
    const hours = indexes.reduce((sum, i) => sum + rows[i].paidMinutes / 60, 0);
    const weighted = complete ? indexes.reduce((sum, i, j) => sum + rows[i].paidMinutes / 60 * hourly[j]!, 0) / hours : 0;
    const days = new Set(indexes.map(i => rows[i].date));
    const daily = new Map<string, number>(); let weeklyRegular = 0;
    indexes.forEach((i, j) => {
      const row = rows[i], prior = daily.get(row.date) ?? 0;
      const seventh = days.size === 7 && row.date === plusDays(week, 6);
      const regularLimit = seventh ? 0 : 480, doubleLimit = seventh ? 480 : 720;
      const dailyRegular = Math.max(0, Math.min(row.paidMinutes, regularLimit - prior));
      const regular = Math.min(dailyRegular, Math.max(0, 2400 - weeklyRegular));
      row.doubleTimeMinutes = exempt ? 0 : Math.max(0, row.paidMinutes - Math.max(0, doubleLimit - prior));
      row.overtimeMinutes = exempt ? 0 : row.paidMinutes - regular - row.doubleTimeMinutes;
      daily.set(row.date, prior + row.paidMinutes); weeklyRegular += regular;
      if (!complete) row.issues.push("Missing effective wage rate in this workweek");
      if (!fullContext) row.issues.push("Full workweek and department access required for a wage estimate");
      if (mixedExemption) row.issues.push("Exemption changes in this workweek require review");
      row.wagesCents = complete && fullContext && !mixedExemption ? Math.round((row.paidMinutes / 60 * hourly[j]! + weighted * (row.overtimeMinutes / 120 + row.doubleTimeMinutes / 60)) * 100) : null;
    });
  }
  return rows;
}
