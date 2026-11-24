import type { PlannedAssistance, ReportedTime } from "./assistance";
export type BreakKind = "rest" | "meal";
export type BreakIssue = { kind: BreakKind; slot: number; canWaive?: boolean };
export type BreakReport = { kind: BreakKind; slot: number; outcome: "missed" | "unrecorded" | "waived"; reason?: string };
export type ActionDetails = { assisted?: ReportedTime; breakKind?: BreakKind; worked?: boolean; offDutyExtension?: boolean; reports?: BreakReport[] };
export type ClockDetails = { assistance?: PlannedAssistance; california?: true; breakKind?: BreakKind; minimumMinutes?: number; unpaidSeconds?: number; earlyWork?: boolean; scheduledStart?: string; reports?: BreakReport[] };
export const accountantEarlyWindowMs = 5 * 60_000;
export type BreakEvent = { type: "in" | "out" | "break" | "break_end"; at: number; automatic?: boolean; details?: ClockDetails | null };
const minute = 60000;

export function inspectBreaks(events: BreakEvent[], dayStart: number, dayEnd: number) {
  const overlap = (start: number, end: number) => Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
  let workStart: number | null = null;
  let startBreak: BreakEvent | null = null;
  let work = 0, unpaid = 0;
  const meals: { before: number; duration: number }[] = [];
  let unconfirmedMeal = false;
  let rests = 0;
  for (const event of events) {
    if (event.type === "in") {
      if (workStart !== null) work += overlap(workStart, event.at);
      workStart = event.at;
      startBreak = null;
    } else if (event.type === "break" && workStart !== null && !startBreak) {
      startBreak = event;
    } else if ((event.type === "break_end" || event.type === "out") && startBreak && workStart !== null) {
      const duration = overlap(startBreak.at, event.at);
      if (event.type === "out" && event.automatic) {
        if (duration > 0 && startBreak.details?.breakKind !== "rest") unconfirmedMeal = true;
      } else if (startBreak.details?.breakKind === "rest") {
        if (duration >= 10 * minute) rests++;
        unpaid += overlap(Math.max(startBreak.at, event.at - (event.details?.unpaidSeconds ?? 0) * 1000), event.at);
      } else {
        if (duration > 0) meals.push({ before: work + overlap(workStart, startBreak.at) - unpaid, duration });
        unpaid += duration;
      }
      startBreak = null;
    }
    if (event.type === "out" && workStart !== null) {
      work += overlap(workStart, event.at);
      workStart = null;
    }
  }
  if (workStart !== null) work += overlap(workStart, dayEnd);
  return { worked: Math.max(0, work - unpaid), rests, meals, unconfirmedMeal };
}

export function requiredBreaks(day: ReturnType<typeof inspectBreaks>, policy: { mealBreakAfterHours: number; mealBreakMinutes: number }, allowWaiver = false): BreakIssue[] {
  const { worked, meals, rests } = day;
  const canWaive = allowWaiver && !day.unconfirmedMeal;
  const firstDeadline = Math.min(policy.mealBreakAfterHours, 5) * 60 * minute;
  const secondDeadline = 10 * 60 * minute;
  const fullMeals = meals.filter(meal => meal.duration >= Math.max(30, policy.mealBreakMinutes) * minute);
  const first = fullMeals.findIndex(meal => meal.before <= firstDeadline);
  const second = fullMeals.some((meal, index) => index > 0 && meal.before <= secondDeadline);
  const result: BreakIssue[] = [];
  if (worked > firstDeadline && first < 0) result.push({ kind: "meal", slot: 1, canWaive: canWaive && worked > 5 * 60 * minute && worked <= 6 * 60 * minute && meals.length === 0 });
  if (worked > secondDeadline && !second) result.push({ kind: "meal", slot: 2, canWaive: canWaive && first >= 0 && worked <= 12 * 60 * minute && meals.length === 1 });
  const requiredRest = worked < 210 * minute ? 0 : Math.max(1, Math.ceil((worked - 120 * minute) / (240 * minute)));
  for (let slot = rests + 1; slot <= requiredRest; slot++) result.push({ kind: "rest", slot });
  return result;
}
