import { hourlyRate, rateFor } from "../team/rules";
import { defaultOvertimePolicy } from "./schedule-enforcement";
import type { OvertimePolicy } from "./schedule-enforcement";
import { priceWorkweek } from "./timesheets-overtime";
import type { WorkweekScope } from "./timesheets-overtime";
import type { WageRate } from "../team/rules";
import { scheduledPaidMinutes } from "./schedule-estimates";
import { inspectBreaks, requiredBreaks } from "../kiosk/break-rules";
import type { BreakIssue, BreakKind, BreakReport, ClockDetails } from "../kiosk/break-rules";
import { zonedTimestamp } from "../workforce/time";
import type { ClockEvent, HoursRounding, HoursRoundingMinutes, TimeCardNote } from "../workforce/model";
import { timeCardNotes } from "../workforce/timecard-notes";
export type TimesheetEmployee = { id: number; name: string; role: string; wage: string; active: boolean; terminated?: boolean; terminationDate?: string; wageRates?: WageRate[]; jobs?: { id: number; name: string }[]; payrollId?: string; legalFirstName?: string; legalMiddleName?: string; legalLastName?: string };
export type TimesheetEvent = Pick<ClockEvent, "id" | "employeeId" | "type" | "at" | "explanation" | "automatic" | "role" | "cardId" | "clockDetails" | "assistedStatus" | "noteAuthor" | "carriedNotes">;
export type TimesheetShift = { shiftType?: "work" | "day_off"; employeeId: number; date: string; start: string; end: string; role: string };
export type TimesheetAdjustment = { id: number; employeeId: number; date: string; hours: number };
export type TimesheetPto = { employeeId: number; startDate: string; endDate: string; compensation: string; status: string };
export type TimeCardBreak = { id: number; start: string; end: string; nextDay: boolean; kind?: BreakKind; confirmEnd?: boolean };
export type TimeCardDraft = { employeeId: number; date: string; start: string; end: string; nextDay: boolean; breakMinutes: number; role: string; note: string; eventIds: number[]; breaks?: TimeCardBreak[]; cardId?: number; timeZone?: string; confirmBreakRecord?: boolean };
export type TimeCardEdit = { id: number; employeeId: number; date: string; at: string; actor: string; before: string; after: string; cardId?: number; notes?: TimeCardNote[] };
export type Rounding = HoursRounding;
export const timesheetColumns = [
  { id: "role", label: "Role" }, { id: "wage", label: "Wage rate" }, { id: "card", label: "Time card" },
  { id: "roundedCard", label: "Rounded clock times (preview)" }, { id: "roundedHours", label: "Rounded hours (preview)" },
  { id: "issues", label: "Issues" }, { id: "scheduled", label: "Scheduled hours" }, { id: "actual", label: "Actual hours" },
  { id: "variance", label: "Actual vs. scheduled" }, { id: "paid", label: "Total paid hours" }, { id: "regular", label: "Regular hours" },
  { id: "mealPremium", label: "Meal premium hours" }, { id: "restPremium", label: "Rest premium hours" }, { id: "premiumPay", label: "Est. break premium pay" },
  { id: "breaks", label: "Meal breaks" }, { id: "ot", label: "OT hours" }, { id: "doubleOt", label: "Double OT" },
  { id: "qualifiedOt", label: "Qualified OT" }, { id: "spread", label: "Spread of hours" }, { id: "split", label: "Split shifts" },
  { id: "wages", label: "Est. Wages" }, { id: "cashTips", label: "Cash tips" }, { id: "creditTips", label: "Credit tips" },
  { id: "pto", label: "PTO" }, { id: "blueLaw", label: "Blue law hours" }, { id: "sick", label: "FFCRA – paid sick" },
  { id: "others", label: "FFCRA – others" }, { id: "child", label: "FFCRA – child" }, { id: "holiday", label: "Holiday pay" },
] as const;
export type ColumnId = typeof timesheetColumns[number]["id"];
export const defaultTimesheetColumns: ColumnId[] = ["role", "card", "roundedCard", "roundedHours", "issues", "scheduled", "regular", "breaks", "mealPremium", "restPremium", "premiumPay", "ot", "doubleOt", "qualifiedOt", "wages", "pto"];
export type TimeCard = {
  id: string; employeeId: number; date: string; role: string; start?: string; end?: string; eventIds: number[];
  roundedStart?: string; roundedEnd?: string;
  issues: string[]; notes: string[]; adjustment: number; metrics: Record<string, number | null>;
  wageLabel?: string;
};
const HOUR = 3600000;
export type BreakPremiumPolicy = { mealLimit: number; restLimit: number; companyWide: boolean; dataPeriod?: { start: string; end: string } };
export function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function workDate(value: number | string, zone?: string) {
  const date = new Date(value);
  return zone ? new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : localDate(date);
}
export function workTime(value: Date | string, timeZone?: string, exact = false) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(exact ? { second: "2-digit", fractionalSecondDigits: 3 } : {}),
  }).format(new Date(value));
}
export function workTimestamp(date: string, time: string, zone?: string) {
  if (!zone) return Date.parse(`${date}T${time}`);
  const parts = /^((?:[01]\d|2[0-3]):[0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(time);
  if (!parts) return NaN;
  try { return zonedTimestamp(date, parts[1], zone) + Number(parts[2] ?? 0) * 1000 + Number((parts[3] ?? "").padEnd(3, "0")); }
  catch { return NaN; }
}
export function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return localDate(value); }
export function weekStartFor(date: string, weekStart: number) { const value = new Date(`${date}T12:00:00`); return addDays(date, -((value.getDay() - weekStart + 7) % 7)); }
export function roundClockPunch(time: number, minutes: HoursRoundingMinutes) {
  const step = minutes * 60000;
  return Math.round(time / step) * step;
}
export function hourlyWage(value: string): number | null {
  if (!value.trim() || /salary|year|month|week|annual/i.test(value)) return null;
  const amount = Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
const overlap = (start: number, end: number, a: number, b: number) => Math.max(0, Math.min(end, b) - Math.max(start, a));
function metrics(): Record<string, number | null> { return { scheduled: 0, actual: 0, roundedHours: 0, variance: 0, paid: 0, regular: 0, breaks: 0, restBreaks: 0, mealPremium: 0, restPremium: 0, premiumPay: 0, ot: 0, doubleOt: 0, qualifiedOt: null, spread: 0, split: 0, wages: null, pto: 0 }; }
const premiumHours = (card: TimeCard) => (card.metrics.mealPremium ?? 0) + (card.metrics.restPremium ?? 0);
function cardWageRate(rates: WageRate[], card: TimeCard) {
  const ids = new Set(rates.filter(rate => rate.roleId !== null && rate.role === card.role && rate.effectiveDate <= card.date).map(rate => rate.roleId));
  return ids.size > 1 ? null : rateFor(rates, card.role, card.date);
}

function applyBreakPremiums(policy: BreakPremiumPolicy, employee: TimesheetEmployee, dayCards: TimeCard[], card: TimeCard, violations: BreakIssue[], reports: BreakReport[], uncertain: boolean) {
  if (!violations.length) return;
  const rates = dayCards.map(row => cardWageRate(employee.wageRates ?? [], row));
  if (rates.every(rate => rate?.basis === "annual_salary" && rate.overtimeExempt)) return;
  if (!policy.companyWide) { card.issues.push("Review premiums in company-wide Timesheets"); return; }
  if (rates.some(rate => rate?.basis === "annual_salary") || (!employee.wageRates?.length && /salary|year|annual/i.test(employee.wage))) {
    card.issues.push("Review salaried break premium");
    return;
  }
  if (rates.includes(null)) { card.issues.push("Review break premium wage rate"); return; }
  if (uncertain || violations.some(issue => reports.some(report => report.kind === issue.kind && report.slot === issue.slot && report.outcome === "unrecorded"))) {
    card.issues.push("Confirm time and breaks before calculating premiums");
    return;
  }
  card.metrics.mealPremium = Math.min(policy.mealLimit, violations.filter(issue => issue.kind === "meal").length);
  card.metrics.restPremium = Math.min(policy.restLimit, violations.filter(issue => issue.kind === "rest").length);
  if (card.metrics.mealPremium) card.notes.push(`Meal break premium: ${card.metrics.mealPremium} hr`);
  if (card.metrics.restPremium) card.notes.push(`Rest break premium: ${card.metrics.restPremium} hr`);
}
export function buildTimeCards(input: {
  employees: TimesheetEmployee[]; events: TimesheetEvent[]; shifts: TimesheetShift[]; adjustments: TimesheetAdjustment[]; pto: TimesheetPto[];
  start: string; end: string; now: number; rounding: Rounding; weekStart: number; mandatoryMealBreak: boolean; mealBreakAfterHours: number; mealBreakMinutes?: number;
  breakPremiumPolicy?: BreakPremiumPolicy; timeZone?: string;
  overtimePolicy?: OvertimePolicy; overtimeScope?: WorkweekScope;
}): TimeCard[] {
  const output: TimeCard[] = [];
  const contextStart = weekStartFor(input.start, input.weekStart);
  const contextEnd = addDays(weekStartFor(input.end, input.weekStart), 6);
  const clockDate = (value: number) => workDate(value, input.timeZone);
  const stamp = (date: string, time = "00:00") => workTimestamp(date, time, input.timeZone);
  for (const employee of input.employees) {
    const cards: TimeCard[] = [];
    const uncertainCards = new Set<TimeCard>();
    const events = input.events.filter(event => event.employeeId === employee.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
    let session: TimesheetEvent[] = [];
    const flush = (closed: boolean, boundary?: number) => {
      if (!session.length) return;
      const start = Date.parse(session[0].at);
      const end = closed ? Date.parse(session[session.length - 1].at) : boundary ?? input.now;
      const roundedStart = input.rounding === "actual" ? undefined : roundClockPunch(start, input.rounding);
      const roundedEnd = input.rounding === "actual" || !closed ? undefined : roundClockPunch(end, input.rounding);
      const breaks: { start: number; end: number; meal: boolean }[] = [];
      const rests: { start: number; end: number }[] = [];
      let breakStart: TimesheetEvent | null = null;
      const closeBreak = (until: number, endDetails?: ClockDetails) => {
        if (!breakStart) return;
        const from = Date.parse(breakStart.at);
        const meal = breakStart.clockDetails?.breakKind !== "rest";
        const unpaid = meal ? from : Math.max(from, until - (endDetails?.unpaidSeconds ?? 0) * 1000);
        if (until > unpaid) breaks.push({ start: unpaid, end: until, meal });
        if (!meal && unpaid > from) rests.push({ start: from, end: unpaid });
        breakStart = null;
      };
      for (const event of session) {
        if (event.type === "break" && !breakStart) breakStart = event;
        if (event.type === "break_end") closeBreak(Date.parse(event.at), event.clockDetails);
      }
      const unconfirmedBreak = !!breakStart && closed && session.at(-1)?.automatic === true;
      if (!unconfirmedBreak) closeBreak(end);
      const california = session.some(event => event.clockDetails?.california || event.clockDetails?.breakKind);
      const unconfirmedClock = !closed || session.some(event => event.assistedStatus === "pending"
        || (event.automatic && !event.assistedStatus));
      for (let date = clockDate(start) < contextStart ? contextStart : clockDate(start), endDate = clockDate(end); date <= contextEnd && date <= endDate; date = addDays(date, 1)) {
        if (date < contextStart) continue;
        const dayStart = stamp(date), dayEnd = stamp(addDays(date, 1));
        const elapsed = overlap(start, end, dayStart, dayEnd);
        if (!elapsed) continue;
        const breakMs = breaks.reduce((total, item) => total + overlap(Math.max(item.start, start), Math.min(item.end, end), dayStart, dayEnd), 0);
        const shift = input.shifts.find(shift => shift.shiftType !== "day_off" && shift.employeeId === employee.id && shift.date === date);
        const card: TimeCard = { id: `clock-${session[0].id}-${date}`, employeeId: employee.id, date, role: session[0].role || shift?.role || employee.role || "Unassigned", start: session[0].at, end: closed ? session[session.length - 1].at : undefined, eventIds: session.map(event => event.id), issues: [], notes: timeCardNotes(session).map(note => note.text), adjustment: 0, metrics: metrics() };
        card.metrics.actual = Math.max(0, elapsed - breakMs) / HOUR;
        if (roundedStart !== undefined) card.roundedStart = new Date(roundedStart).toISOString();
        if (roundedStart !== undefined && roundedEnd !== undefined) {
          card.roundedEnd = new Date(roundedEnd).toISOString();
          const previewUnpaid = breaks.reduce((total, item) => total
            + overlap(Math.max(item.start, roundedStart), Math.min(item.end, roundedEnd), dayStart, dayEnd), 0);
          card.metrics.roundedHours = Math.max(0, overlap(roundedStart, roundedEnd, dayStart, dayEnd) - previewUnpaid) / HOUR;
        }
        card.metrics.breaks = breaks.reduce((total, item) => total + (item.meal ? overlap(Math.max(item.start, start), Math.min(item.end, end), dayStart, dayEnd) : 0), 0) / HOUR;
        card.metrics.restBreaks = rests.reduce((total, item) => total + overlap(item.start, item.end, dayStart, dayEnd), 0) / HOUR;
        card.metrics.spread = elapsed / HOUR;
        if (!closed) card.issues.push("Missing clock-out");
        if (session.some(event => event.automatic)) card.issues.push("Automatic clock-out");
        if (unconfirmedBreak) card.issues.push("Confirm unfinished break");
        if (!california && input.mandatoryMealBreak && elapsed / HOUR >= input.mealBreakAfterHours && breakMs < 30 * 60000) card.issues.push("Missing breaks");
        if (session.some(event => event.clockDetails?.earlyWork)) card.issues.push("Early work reported");
        if (session.some(event => event.assistedStatus === "pending")) card.issues.push("Clock time needs review");
        for (const event of session) {
          for (const report of event.clockDetails?.reports ?? []) {
            const title = report.kind === "meal" ? "Meal" : "Rest break";
            if (report.outcome === "unrecorded") card.notes.push(`${title} ${report.slot} reported as taken: ${report.reason}`);
            if (report.outcome === "waived") card.notes.push(`Meal ${report.slot} waiver: ${report.reason}`);
          }
        }
        if (unconfirmedBreak || unconfirmedClock || !california) uncertainCards.add(card);
        cards.push(card);
      }
      session = [];
    };
    for (const event of events) {
      if (event.type === "in") { flush(false, Date.parse(event.at)); session = [event]; }
      else if (session.length) { session.push(event); if (event.type === "out") flush(true); }
    }
    flush(false);
    const typed = events.filter(event => event.clockDetails?.california || event.clockDetails?.breakKind);
    if (typed.length || input.breakPremiumPolicy) {
      const history = events.map(event => ({ type: event.type, at: Date.parse(event.at), automatic: event.automatic, details: event.clockDetails }));
      const typedIds = new Set(typed.map(event => event.id));
      const byDate = new Map<string, TimeCard>();
      for (const card of cards) if (card.end && (card.eventIds.some(id => typedIds.has(id)) || input.breakPremiumPolicy)) byDate.set(card.date, card);
      for (const [date, card] of byDate) {
        const dayStart = stamp(date);
        const dayEnd = Math.min(input.now, stamp(addDays(date, 1)));
        const policy = { mealBreakAfterHours: input.mealBreakAfterHours, mealBreakMinutes: input.mealBreakMinutes ?? 30 };
        const reports = history.filter(event => event.type === "out" && event.at > dayStart && event.at <= dayEnd).flatMap(event => event.details?.reports ?? []);
        const evidence = inspectBreaks(history, dayStart, dayEnd);
        const violations = requiredBreaks(evidence, policy, true).filter(issue => !issue.canWaive || !reports.some(
          report => report.kind === issue.kind && report.slot === issue.slot && report.outcome === "waived"));
        for (const issue of card.eventIds.some(id => typedIds.has(id)) ? violations : []) {
          const label = issue.kind === "meal" ? "Missing or noncompliant meal" : "Missing or short paid rest break";
          if (!card.issues.includes(label)) card.issues.push(label);
        }
        if (input.breakPremiumPolicy) {
          const dayCards = cards.filter(row => row.date === date);
          applyBreakPremiums(input.breakPremiumPolicy, employee, dayCards, card, violations, reports,
            dayCards.some(row => uncertainCards.has(row)));
        }
      }
    }
    const dayCard = (date: string, role = employee.role || "Unassigned") => {
      let card = cards.find(card => card.date === date && card.role === role);
      if (!card) { card = { id: `day-${employee.id}-${date}-${role}`, employeeId: employee.id, date, role, eventIds: [], issues: [], notes: [], adjustment: 0, metrics: metrics() }; cards.push(card); }
      return card;
    };
    const plannedShifts = input.shifts.filter(shift => shift.shiftType !== "day_off" && shift.employeeId === employee.id && shift.date >= contextStart && shift.date <= contextEnd).map((shift, id) => ({ ...shift, id }));
    const plannedMinutes = scheduledPaidMinutes(plannedShifts, { mandatoryMealBreak: input.mandatoryMealBreak, mealBreakAfterHours: input.mealBreakAfterHours, mealBreakMinutes: input.mealBreakMinutes ?? 30 });
    for (const shift of plannedShifts) {
      if (shift.end > shift.start) {
        const card = dayCard(shift.date, shift.role || employee.role);
        card.metrics.scheduled = (card.metrics.scheduled ?? 0) + plannedMinutes[shift.id].paidMinutes / 60;
        continue;
      }
      // Legacy overnight records retain their existing date allocation; the
      // current shift builder accepts same-day work shifts only.
      const start = stamp(shift.date, shift.start);
      let end = stamp(shift.date, shift.end);
      if (end <= start) end = stamp(addDays(shift.date, 1), shift.end);
      if (!Number.isFinite(end)) continue;
      for (let date = shift.date, endDate = clockDate(end); date <= endDate && date <= contextEnd; date = addDays(date, 1)) {
        const hours = overlap(start, end, stamp(date), stamp(addDays(date, 1))) / HOUR;
        if (hours) { const card = dayCard(date, shift.role || employee.role); card.metrics.scheduled = (card.metrics.scheduled ?? 0) + hours; }
      }
    }
    const adjustmentsByDate = new Map<string, number>();
    for (const adjustment of input.adjustments.filter(a => a.employeeId === employee.id && a.date >= contextStart && a.date <= contextEnd)) adjustmentsByDate.set(adjustment.date, (adjustmentsByDate.get(adjustment.date) ?? 0) + adjustment.hours);
    for (const [date, hours] of adjustmentsByDate) {
      const card = cards.find(card => card.date === date) ?? dayCard(date);
      card.adjustment = hours; card.notes.push(`Manual hours adjustment: ${hours >= 0 ? "+" : ""}${hours.toFixed(2)} hours`);
    }
    for (const request of input.pto.filter(request => request.employeeId === employee.id && request.status === "approved" && request.compensation === "paid")) {
      for (let date = request.startDate < contextStart ? contextStart : request.startDate; date <= request.endDate && date <= contextEnd; date = addDays(date, 1)) {
        // Existing DomBase requests count each calendar day as eight PTO hours.
        const card = cards.find(card => card.date === date) ?? dayCard(date);
        card.metrics.pto = 8;
      }
    }
    cards.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
    const byWorkDate = new Map<string, TimeCard[]>();
    for (const card of cards) {
      const day = byWorkDate.get(card.date) ?? [];
      day.push(card);
      byWorkDate.set(card.date, day);
    }
    const weeks = new Map<string, Parameters<typeof priceWorkweek>[0]>();
    const legacyRate = employee.wageRates === undefined ? hourlyWage(employee.wage) : null;
    for (const [date, day] of byWorkDate) {
      const adjustment = day.reduce((sum, card) => sum + card.adjustment, 0);
      let remaining = Math.max(0, day.reduce((sum, card) => sum + (card.metrics.actual ?? 0), 0) + adjustment);
      const week = weekStartFor(date, input.weekStart);
      const group = weeks.get(week) ?? [];
      for (const [index, card] of day.entries()) {
        // Apply positive adjustments once and distribute negative adjustments without going below zero.
        const raw = Math.min(remaining, Math.max(0, (card.metrics.actual ?? 0) + (index === 0 ? Math.max(0, adjustment) : 0)));
        remaining = Math.max(0, remaining - raw);
        card.metrics.actual = raw;
        card.metrics.paid = raw + (card.metrics.pto ?? 0) + premiumHours(card);
        card.metrics.variance = raw - (card.metrics.scheduled ?? 0);
        card.metrics.split = index === 0 ? Math.max(0, day.filter(other => other.start).length - 1) : 0;
        const rate = employee.wageRates ? cardWageRate(employee.wageRates, card) ?? null : undefined;
        group.push({ card, hours: raw, rate, hourly: rate === undefined ? legacyRate : hourlyRate(rate ?? undefined) });
      }
      weeks.set(week, group);
    }
    for (const [week, rows] of weeks) {
      priceWorkweek(rows, week, input.overtimePolicy ?? defaultOvertimePolicy, input.overtimeScope ?? input.breakPremiumPolicy);
    }
    output.push(...cards.filter(card => card.date >= input.start && card.date <= input.end));
  }
  return output;
}
export function timeCardReviews(cards: TimeCard[]) {
  const groups = new Map<string, TimeCard[]>();
  for (const card of cards) {
    const key = `${card.employeeId}:${card.eventIds[0] ?? card.id}`;
    const group = groups.get(key) ?? [];
    group.push(card); groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const affected = group.filter(card => card.issues.length);
    if (!affected.length) return [];
    const dates = group.map(card => card.date).sort();
    return [{ key, employeeId: group[0].employeeId, card: affected[0], startDate: dates[0], endDate: dates[dates.length - 1],
      workedMinutes: Math.round(group.reduce((total, card) => total + (card.metrics.actual ?? 0), 0) * 60),
      issues: [...new Set(affected.flatMap(card => card.issues))],
    }];
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.card.start ?? "").localeCompare(b.card.start ?? "") || a.employeeId - b.employeeId);
}
export function totalMetrics(cards: TimeCard[]) {
  const result = metrics();
  for (const key of Object.keys(result)) {
    const values = cards.map(card => card.metrics[key]);
    if (!values.length && result[key] === null) continue;
    result[key] = values.some(value => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return result;
}
export function timeCardBounds(draft: TimeCardDraft) {
  return {
    start: workTimestamp(draft.date, draft.start, draft.timeZone),
    end: workTimestamp(draft.nextDay ? addDays(draft.date, 1) : draft.date, draft.end, draft.timeZone),
  };
}
export function timeCardBreakIntervals(draft: TimeCardDraft): { start: number; end: number; kind?: BreakKind }[] {
  const bounds = timeCardBounds(draft);
  if (draft.breaks !== undefined) {
    return draft.breaks.map(entry => {
      const date = entry.nextDay ? addDays(draft.date, 1) : draft.date;
      const start = workTimestamp(date, entry.start, draft.timeZone);
      let end = workTimestamp(date, entry.end, draft.timeZone);
      if (end <= start && draft.nextDay) end = workTimestamp(addDays(date, 1), entry.end, draft.timeZone);
      return { start, end, ...(entry.kind ? { kind: entry.kind } : {}) };
    }).sort((a, b) => a.start - b.start);
  }
  // Older callers supplied only a duration. Keep their midpoint-break behavior.
  if (!draft.breakMinutes) return [];
  const start = bounds.start + (bounds.end - bounds.start - draft.breakMinutes * 60000) / 2;
  return [{ start, end: start + draft.breakMinutes * 60000 }];
}
export function timeCardPreview(draft: TimeCardDraft) {
  const { start, end } = timeCardBounds(draft);
  const elapsedMinutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : 0;
  let breakMinutes = 0;
  let restMinutes = 0;
  for (const entry of timeCardBreakIntervals(draft)) {
    const duration = Number.isFinite(entry.start) && Number.isFinite(entry.end) ? Math.max(0, entry.end - entry.start) / 60000 : 0;
    if (entry.kind === "rest") restMinutes += duration;
    else breakMinutes += duration;
  }
  return { elapsedMinutes, breakMinutes, restMinutes, workedMinutes: Math.max(0, elapsedMinutes - breakMinutes) };
}
export function validateTimeCard(draft: TimeCardDraft, events: TimesheetEvent[], now: number): string {
  if (!Number.isInteger(draft.employeeId) || draft.employeeId <= 0) return "Select an employee.";
  const { start, end } = timeCardBounds(draft);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "Clock-out must be after clock-in. Select Next day for an overnight card.";
  if (end > now) return "Time cards cannot end in the future.";
  if (!Number.isFinite(draft.breakMinutes) || draft.breakMinutes < 0 || draft.breakMinutes * 60000 >= end - start) return "Meal break must be shorter than the time card.";
  const breaks = timeCardBreakIntervals(draft);
  for (let index = 0; index < breaks.length; index++) {
    const entry = breaks[index];
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start) return "Enter a start and end time for each meal break.";
    if (entry.start < start || entry.end > end) return "Meal breaks must fall within the time card.";
    if (index > 0 && entry.start < breaks[index - 1].end) return "Meal breaks cannot overlap.";
  }
  if (timeCardPreview(draft).breakMinutes * 60000 >= end - start) return "Meal break must be shorter than the time card.";
  const other = events.filter(event => event.employeeId === draft.employeeId && !draft.eventIds.includes(event.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let open: number | null = null;
  for (const event of other) {
    if (event.type === "in") {
      if (open !== null && overlap(start, end, open, Date.parse(event.at)) > 0) return "This time card overlaps an open time card.";
      open = Date.parse(event.at);
    }
    if (event.type === "out" && open !== null) { if (overlap(start, end, open, Date.parse(event.at)) > 0) return "This time card overlaps an existing time card."; open = null; }
  }
  if (open !== null && overlap(start, end, open, now) > 0) return "This time card overlaps an open time card.";
  return "";
}
export function timeCardEvents(draft: TimeCardDraft, firstId: number): TimesheetEvent[] {
  const { start, end } = timeCardBounds(draft);
  const cardId = draft.cardId ?? draft.eventIds[0] ?? firstId;
  const events: TimesheetEvent[] = [{ id: firstId, employeeId: draft.employeeId, type: "in", at: new Date(start).toISOString(),
    role: draft.role, explanation: draft.note.trim() || undefined, cardId,
    ...(draft.confirmBreakRecord ? { clockDetails: { california: true } } : {}) }];
  for (const entry of timeCardBreakIntervals(draft)) {
    events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "break", at: new Date(entry.start).toISOString(), cardId, ...(entry.kind ? { clockDetails: { breakKind: entry.kind } } : {}) });
    events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "break_end", at: new Date(entry.end).toISOString(), cardId });
  }
  events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "out", at: new Date(end).toISOString(), cardId });
  return events;
}
export function timesheetCsv(rows: string[][]) {
  return "\uFEFF" + rows.map(row => row.map(value => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}
