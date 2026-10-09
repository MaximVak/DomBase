export type TimesheetEmployee = { id: number; name: string; role: string; wage: string; active: boolean; payrollId?: string; legalFirstName?: string; legalMiddleName?: string; legalLastName?: string };
export type TimesheetEvent = { id: number; employeeId: number; type: "in" | "out" | "break" | "break_end"; at: string; explanation?: string; automatic?: boolean; role?: string; cardId?: number };
export type TimesheetShift = { employeeId: number; date: string; start: string; end: string; role: string };
export type TimesheetAdjustment = { id: number; employeeId: number; date: string; hours: number };
export type TimesheetPto = { employeeId: number; startDate: string; endDate: string; compensation: string; status: string };
export type TimeCardBreak = { id: number; start: string; end: string; nextDay: boolean };
export type TimeCardDraft = { employeeId: number; date: string; start: string; end: string; nextDay: boolean; breakMinutes: number; role: string; note: string; eventIds: number[]; breaks?: TimeCardBreak[]; cardId?: number };
export type TimeCardEdit = { id: number; employeeId: number; date: string; at: string; actor: string; before: string; after: string; cardId?: number };
export type Rounding = "actual" | 5 | 10 | 15;
export const timesheetColumns = [
  { id: "role", label: "Role" }, { id: "wage", label: "Wage rate" }, { id: "card", label: "Time card" },
  { id: "issues", label: "Issues" }, { id: "scheduled", label: "Scheduled hours" }, { id: "actual", label: "Actual hours" },
  { id: "variance", label: "Actual vs. scheduled" }, { id: "paid", label: "Total paid hours" }, { id: "regular", label: "Regular hours" },
  { id: "breaks", label: "Meal breaks" }, { id: "ot", label: "OT hours" }, { id: "doubleOt", label: "Double OT" },
  { id: "qualifiedOt", label: "Qualified OT" }, { id: "spread", label: "Spread of hours" }, { id: "split", label: "Split shifts" },
  { id: "wages", label: "Est. Wages" }, { id: "cashTips", label: "Cash tips" }, { id: "creditTips", label: "Credit tips" },
  { id: "pto", label: "PTO" }, { id: "blueLaw", label: "Blue law hours" }, { id: "sick", label: "FFCRA – paid sick" },
  { id: "others", label: "FFCRA – others" }, { id: "child", label: "FFCRA – child" }, { id: "holiday", label: "Holiday pay" },
] as const;
export type ColumnId = typeof timesheetColumns[number]["id"];
export const defaultTimesheetColumns: ColumnId[] = ["role", "card", "issues", "scheduled", "regular", "breaks", "ot", "doubleOt", "qualifiedOt", "wages", "pto"];
export type TimeCard = {
  id: string; employeeId: number; date: string; role: string; start?: string; end?: string; eventIds: number[];
  issues: string[]; notes: string[]; adjustment: number; metrics: Record<string, number | null>;
};
const HOUR = 3600000;
export function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return localDate(value); }
export function weekStartFor(date: string, weekStart: number) { const value = new Date(`${date}T12:00:00`); return addDays(date, -((value.getDay() - weekStart + 7) % 7)); }
export function roundTimeHours(hours: number, rounding: Rounding) { return rounding === "actual" ? hours : Math.round(hours * 60 / rounding) * rounding / 60; }
export function hourlyWage(value: string): number | null {
  if (!value.trim() || /salary|year|month|week|annual/i.test(value)) return null;
  const amount = Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
const overlap = (start: number, end: number, a: number, b: number) => Math.max(0, Math.min(end, b) - Math.max(start, a));
function metrics(): Record<string, number | null> { return { scheduled: 0, actual: 0, variance: 0, paid: 0, regular: 0, breaks: 0, ot: 0, doubleOt: 0, qualifiedOt: null, spread: 0, split: 0, wages: null, pto: 0 }; }
export function buildTimeCards(input: {
  employees: TimesheetEmployee[]; events: TimesheetEvent[]; shifts: TimesheetShift[]; adjustments: TimesheetAdjustment[]; pto: TimesheetPto[];
  start: string; end: string; now: number; rounding: Rounding; weekStart: number; mandatoryMealBreak: boolean; mealBreakAfterHours: number;
}): TimeCard[] {
  const output: TimeCard[] = [];
  const contextStart = weekStartFor(input.start, input.weekStart);
  for (const employee of input.employees) {
    const cards: TimeCard[] = [];
    const events = input.events.filter(event => event.employeeId === employee.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
    let session: TimesheetEvent[] = [];
    const flush = (closed: boolean, boundary?: number) => {
      if (!session.length) return;
      const start = Date.parse(session[0].at);
      const end = closed ? Date.parse(session[session.length - 1].at) : boundary ?? input.now;
      const breaks: [number, number][] = [];
      let breakStart: number | null = null;
      for (const event of session) {
        if (event.type === "break" && breakStart === null) breakStart = Date.parse(event.at);
        if (event.type === "break_end" && breakStart !== null) { breaks.push([breakStart, Date.parse(event.at)]); breakStart = null; }
      }
      if (breakStart !== null) breaks.push([breakStart, end]);
      for (let date = localDate(new Date(start)) < contextStart ? contextStart : localDate(new Date(start)); date <= input.end && date <= localDate(new Date(end)); date = addDays(date, 1)) {
        if (date < contextStart) continue;
        const dayStart = Date.parse(`${date}T00:00:00`), dayEnd = Date.parse(`${addDays(date, 1)}T00:00:00`);
        const elapsed = overlap(start, end, dayStart, dayEnd);
        if (!elapsed) continue;
        const breakMs = breaks.reduce((total, [a, b]) => total + overlap(Math.max(a, start), Math.min(b, end), dayStart, dayEnd), 0);
        const shift = input.shifts.find(shift => shift.employeeId === employee.id && shift.date === date);
        const card: TimeCard = { id: `clock-${session[0].id}-${date}`, employeeId: employee.id, date, role: session[0].role || shift?.role || employee.role || "Unassigned", start: session[0].at, end: closed ? session[session.length - 1].at : undefined, eventIds: session.map(event => event.id), issues: [], notes: session.flatMap(event => event.explanation ? [event.explanation] : []), adjustment: 0, metrics: metrics() };
        card.metrics.actual = Math.max(0, elapsed - breakMs) / HOUR;
        card.metrics.breaks = breakMs / HOUR;
        card.metrics.spread = elapsed / HOUR;
        if (!closed) card.issues.push("Missing clock-out");
        if (session.some(event => event.automatic)) card.issues.push("Automatic clock-out");
        if (input.mandatoryMealBreak && elapsed / HOUR >= input.mealBreakAfterHours && breakMs < 30 * 60000) card.issues.push("Missing breaks");
        cards.push(card);
      }
      session = [];
    };
    for (const event of events) {
      if (event.type === "in") { flush(false, Date.parse(event.at)); session = [event]; }
      else if (session.length) { session.push(event); if (event.type === "out") flush(true); }
    }
    flush(false);
    const dayCard = (date: string, role = employee.role || "Unassigned") => {
      let card = cards.find(card => card.date === date && card.role === role);
      if (!card) { card = { id: `day-${employee.id}-${date}-${role}`, employeeId: employee.id, date, role, eventIds: [], issues: [], notes: [], adjustment: 0, metrics: metrics() }; cards.push(card); }
      return card;
    };
    for (const shift of input.shifts.filter(shift => shift.employeeId === employee.id && shift.date >= contextStart && shift.date <= input.end)) {
      const start = Date.parse(`${shift.date}T${shift.start}`);
      let end = Date.parse(`${shift.date}T${shift.end}`);
      if (end <= start) end = Date.parse(`${addDays(shift.date, 1)}T${shift.end}`);
      for (let date = shift.date; date <= localDate(new Date(end)) && date <= input.end; date = addDays(date, 1)) {
        const hours = overlap(start, end, Date.parse(`${date}T00:00:00`), Date.parse(`${addDays(date, 1)}T00:00:00`)) / HOUR;
        if (hours) { const card = dayCard(date, shift.role || employee.role); card.metrics.scheduled = (card.metrics.scheduled ?? 0) + hours; }
      }
    }
    const adjustmentsByDate = new Map<string, number>();
    for (const adjustment of input.adjustments.filter(a => a.employeeId === employee.id && a.date >= contextStart && a.date <= input.end)) adjustmentsByDate.set(adjustment.date, (adjustmentsByDate.get(adjustment.date) ?? 0) + adjustment.hours);
    for (const [date, hours] of adjustmentsByDate) {
      const card = cards.find(card => card.date === date) ?? dayCard(date);
      card.adjustment = hours; card.notes.push(`Manual hours adjustment: ${hours >= 0 ? "+" : ""}${hours.toFixed(2)} hours`);
    }
    for (const request of input.pto.filter(request => request.employeeId === employee.id && request.status === "approved" && request.compensation === "paid")) {
      for (let date = request.startDate < contextStart ? contextStart : request.startDate; date <= request.endDate && date <= input.end; date = addDays(date, 1)) {
        // Existing DomBase requests count each calendar day as eight PTO hours.
        const card = cards.find(card => card.date === date) ?? dayCard(date);
        card.metrics.pto = 8;
      }
    }
    cards.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
    const dailyRemaining = new Map<string, number>();
    const weeklyRegular = new Map<string, number>();
    for (const card of cards) {
      if (!dailyRemaining.has(card.date)) {
        const dayCards = cards.filter(other => other.date === card.date);
        const adjusted = Math.max(0, dayCards.reduce((total, other) => total + (other.metrics.actual ?? 0) + other.adjustment, 0));
        dailyRemaining.set(card.date, adjusted);
      }
      const remaining = dailyRemaining.get(card.date) ?? 0;
      const dayCards = cards.filter(other => other.date === card.date);
      const adjustment = dayCards.reduce((total, other) => total + other.adjustment, 0);
      const index = dayCards.indexOf(card);
      // Apply positive adjustments once, and spread negative adjustments without losing hours or going below zero.
      const raw = Math.min(remaining, Math.max(0, (card.metrics.actual ?? 0) + (index === 0 ? Math.max(0, adjustment) : 0)));
      dailyRemaining.set(card.date, Math.max(0, remaining - raw));
      card.metrics.actual = raw;
      const hours = roundTimeHours(raw, input.rounding);
      const priorDaily = dayCards.slice(0, index).reduce((total, other) => total + (other.metrics.regular ?? 0) + (other.metrics.ot ?? 0) + (other.metrics.doubleOt ?? 0), 0);
      const week = weekStartFor(card.date, input.weekStart), usedWeekly = weeklyRegular.get(week) ?? 0;
      const regular = Math.max(0, Math.min(hours, 8 - priorDaily, 40 - usedWeekly));
      const doubleOt = Math.max(0, hours - Math.max(0, 12 - priorDaily));
      card.metrics.regular = regular;
      card.metrics.doubleOt = doubleOt;
      card.metrics.ot = Math.max(0, hours - regular - doubleOt);
      weeklyRegular.set(week, usedWeekly + regular);
      card.metrics.paid = hours + (card.metrics.pto ?? 0);
      card.metrics.variance = raw - (card.metrics.scheduled ?? 0);
      card.metrics.split = index === 0 ? Math.max(0, dayCards.filter(other => other.start).length - 1) : 0;
      const wage = hourlyWage(employee.wage);
      card.metrics.wages = wage === null ? null : wage * (regular + (card.metrics.ot ?? 0) * 1.5 + doubleOt * 2 + (card.metrics.pto ?? 0));
    }
    output.push(...cards.filter(card => card.date >= input.start));
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
    start: Date.parse(`${draft.date}T${draft.start}`),
    end: Date.parse(`${draft.nextDay ? addDays(draft.date, 1) : draft.date}T${draft.end}`),
  };
}
export function timeCardBreakIntervals(draft: TimeCardDraft): { start: number; end: number }[] {
  const bounds = timeCardBounds(draft);
  if (draft.breaks !== undefined) {
    return draft.breaks.map(entry => {
      const date = entry.nextDay ? addDays(draft.date, 1) : draft.date;
      const start = Date.parse(`${date}T${entry.start}`);
      let end = Date.parse(`${date}T${entry.end}`);
      if (end <= start && draft.nextDay) end = Date.parse(`${addDays(date, 1)}T${entry.end}`);
      return { start, end };
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
  const breakMinutes = timeCardBreakIntervals(draft).reduce((sum, entry) => {
    return sum + (Number.isFinite(entry.start) && Number.isFinite(entry.end) ? Math.max(0, entry.end - entry.start) / 60000 : 0);
  }, 0);
  return { elapsedMinutes, breakMinutes, workedMinutes: Math.max(0, elapsedMinutes - breakMinutes) };
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
  const events: TimesheetEvent[] = [{ id: firstId, employeeId: draft.employeeId, type: "in", at: new Date(start).toISOString(), role: draft.role, explanation: draft.note.trim() || undefined, cardId }];
  for (const entry of timeCardBreakIntervals(draft)) {
    events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "break", at: new Date(entry.start).toISOString(), cardId });
    events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "break_end", at: new Date(entry.end).toISOString(), cardId });
  }
  events.push({ id: firstId + events.length, employeeId: draft.employeeId, type: "out", at: new Date(end).toISOString(), cardId });
  return events;
}
export function timesheetCsv(rows: string[][]) {
  return "\uFEFF" + rows.map(row => row.map(value => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}
