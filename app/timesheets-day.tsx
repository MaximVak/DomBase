"use client";

import { addDays, totalMetrics, workDate, workTimestamp } from "./timesheets-model";
import type { TimeCard, TimesheetEmployee, TimesheetPto, TimesheetShift } from "./timesheets-model";

export type DayRow = {
  employee: TimesheetEmployee; cards: TimeCard[]; scheduled: TimesheetShift[];
  elapsedMinutes: number; mealMinutes: number; restMinutes: number; mealPremium: number; restPremium: number;
  overtimeMinutes: number; doubleTimeMinutes: number;
  varianceMinutes: number | null; issues: string[]; notes: string[];
};
export function buildDayRows(input: {
  employees: TimesheetEmployee[]; cards: TimeCard[]; shifts: TimesheetShift[]; pto: TimesheetPto[];
  date: string; now: number; showEmpty: boolean; timeZone?: string;
}): DayRow[] {
  const stamp = (date: string, time: string) => workTimestamp(date, time, input.timeZone);
  const dayStart = stamp(input.date, "00:00"), dayEnd = stamp(addDays(input.date, 1), "00:00");
  return input.employees.flatMap(employee => {
    const cards = input.cards.filter(card => card.employeeId === employee.id && card.date === input.date);
    if (!cards.length && !input.showEmpty) return [];
    const scheduled = input.shifts.filter(shift => {
      if (shift.employeeId !== employee.id || ![input.date, addDays(input.date, -1)].includes(shift.date)) return false;
      const start = stamp(shift.date, shift.start);
      let end = stamp(shift.date, shift.end);
      if (end <= start) end = stamp(addDays(shift.date, 1), shift.end);
      return start < dayEnd && end > dayStart;
    });
    const totals = totalMetrics(cards);
    const clocked = cards.some(card => card.start);
    const approvedLeave = input.pto.some(request => request.employeeId === employee.id && request.status === "approved" && request.startDate <= input.date && request.endDate >= input.date);
    const noShow = !clocked && !approvedLeave && !cards.some(card => card.adjustment) && scheduled.some(shift => {
      let end = stamp(shift.date, shift.end);
      if (end <= stamp(shift.date, shift.start)) end = stamp(addDays(shift.date, 1), shift.end);
      return end <= input.now;
    });
    const elapsedMinutes = Math.round((clocked ? totals.spread ?? 0 : totals.actual ?? 0) * 60);
    return [{ employee, cards, scheduled, elapsedMinutes, mealMinutes: Math.round((totals.breaks ?? 0) * 60),
      restMinutes: Math.round((totals.restBreaks ?? 0) * 60), mealPremium: totals.mealPremium ?? 0, restPremium: totals.restPremium ?? 0,
      overtimeMinutes: Math.round((totals.ot ?? 0) * 60), doubleTimeMinutes: Math.round((totals.doubleOt ?? 0) * 60),
      varianceMinutes: clocked && scheduled.length && cards.filter(card => card.start).every(card => card.end) ? Math.round(((totals.actual ?? 0) - (totals.scheduled ?? 0)) * 60) : null,
      issues: [...new Set([...cards.flatMap(card => card.issues), ...(noShow ? ["No-Show"] : [])])],
      notes: [...new Set(cards.flatMap(card => card.notes))],
    }];
  });
}
export type DaySort = "first" | "last" | "start";
export function sortDayRows(rows: DayRow[], sort: DaySort, date: string, timeZone?: string): DayRow[] {
  const dayStart = workTimestamp(date, "00:00", timeZone);
  const startTime = (row: DayRow) => {
    const clocked = row.cards.filter(card => card.start).map(card => Math.max(dayStart, Date.parse(card.start!)));
    const scheduled = row.scheduled.map(shift => Math.max(dayStart, workTimestamp(shift.date, shift.start, timeZone)));
    return Math.min(...(clocked.length ? clocked : scheduled));
  };
  return [...rows].sort((a, b) => {
    if (sort === "start") {
      const aStart = startTime(a), bStart = startTime(b);
      if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    }
    const name = (row: DayRow) => sort === "last" ? row.employee.name.trim().split(/\s+/).slice(-1)[0] : row.employee.name;
    return name(a).localeCompare(name(b), undefined, { sensitivity: "base" }) || a.employee.name.localeCompare(b.employee.name, undefined, { sensitivity: "base" }) || a.employee.id - b.employee.id;
  });
}
export const dayDuration = (minutes: number) => `${Math.floor(Math.max(0, minutes) / 60)} hrs ${Math.max(0, minutes) % 60} min`;
const clock = (date: string, timeZone?: string) => new Date(date).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).toLowerCase();
export function roundedClockLabel(card: TimeCard, timeZone?: string) {
  if (!card.roundedStart) return "—";
  const label = (at: string) => {
    const date = workDate(at, timeZone);
    const suffix = date === card.date ? "" : date === addDays(card.date, 1) ? " (+1)" : date === addDays(card.date, -1) ? " (−1)" : ` (${date})`;
    return clock(at, timeZone) + suffix;
  };
  return `${label(card.roundedStart)} – ${card.roundedEnd ? label(card.roundedEnd) : "Open"}`;
}
export function dayClockLabel(card: TimeCard, date: string, now: number, timeZone?: string) {
  if (!card.start) return "--:-- – --:--";
  const dayStart = workTimestamp(date, "00:00", timeZone), dayEnd = workTimestamp(addDays(date, 1), "00:00", timeZone);
  const start = Math.max(Date.parse(card.start), dayStart), end = Math.min(card.end ? Date.parse(card.end) : now, dayEnd);
  return `${clock(new Date(start).toISOString(), timeZone)} – ${!card.end && end < dayEnd ? "Open" : end === dayEnd ? "12:00 am (+1)" : clock(new Date(end).toISOString(), timeZone)}`;
}
function scheduledLabel(shifts: TimesheetShift[]) {
  return shifts.map(shift => `${clock(`${shift.date}T${shift.start}`)} – ${clock(`${shift.date}T${shift.end}`)}${shift.end <= shift.start ? " (+1)" : ""}`).join(", ");
}

type Props = {
  rows: DayRow[]; date: string; now: number; manager: boolean;
  groups?: { label: string; rows: DayRow[] }[];
  timeZone?: string;
  onOpenCard: (card: TimeCard, button: HTMLButtonElement) => void;
  onAdd: (employeeId: number | undefined, button: HTMLButtonElement) => void;
};
export function TimesheetsDay(props: Props) {
  const groups = props.groups ?? [{ label: "", rows: props.rows }];
  return <div className="ts-day-ledger-scroll"><table className="ts-day-ledger"><thead><tr><th scope="col">Team member</th><th scope="col">Worked</th><th scope="col">Rest breaks</th><th scope="col">Meal breaks</th><th scope="col">Issues</th></tr></thead>{groups.map(group => <tbody key={group.label}>
    {group.label && <tr className="ts-day-group"><th scope="rowgroup" colSpan={5}>{group.label}</th></tr>}{group.rows.map(row => <tr key={row.employee.id}>
    <th scope="row"><div className="ts-day-member"><span className="ts-day-avatar" aria-hidden="true">{row.employee.name[0]}</span><div><strong>{row.employee.name}</strong><span>{[...new Set(row.cards.map(card => card.role))].join(", ") || row.employee.role}</span></div>{row.notes.length ? <span className="ts-day-note" title={row.notes.join("\n")} aria-label={`${row.notes.length} notes`}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 8 0 1 1 18 0Z" fill="currentColor" /></svg>{row.notes.length}</span> : null}</div></th>
    <td><div className="ts-day-worked">{row.cards.some(card => card.start) ? row.cards.filter(card => card.start).map(card => <button type="button" className="ts-day-clock" key={card.id} aria-label={`Open ${row.employee.name} time card ${dayClockLabel(card, props.date, props.now, props.timeZone)}`} onClick={event => props.onOpenCard(card, event.currentTarget)}>{dayClockLabel(card, props.date, props.now, props.timeZone)}</button>) : props.manager ? <button type="button" className="ts-day-clock" aria-label={`Add time card for ${row.employee.name}`} onClick={event => props.onAdd(row.employee.id, event.currentTarget)}>--:-- – --:--</button> : <span>--:-- – --:--</span>}
      {row.cards.some(card => card.start || card.adjustment) ? <small>Total: {dayDuration(row.elapsedMinutes)}{row.varianceMinutes ? <span className={row.varianceMinutes > 0 ? "ts-day-over" : "ts-day-under"}>{row.varianceMinutes > 0 ? "↑" : "↓"} {Math.abs(row.varianceMinutes)} min {row.varianceMinutes > 0 ? "over" : "under"}</span> : null}</small> : row.scheduled.length ? <small>Scheduled: {scheduledLabel(row.scheduled)}</small> : <small>{row.cards.some(card => (card.metrics.pto ?? 0) > 0) ? "Paid time off" : "No time card"}</small>}{row.cards.filter(card => card.roundedStart).map(card => <small key={card.id}>Rounded preview: {roundedClockLabel(card, props.timeZone)}{card.roundedEnd ? ` · ${(card.metrics.roundedHours ?? 0).toFixed(2)} hr` : ""}</small>)}{row.overtimeMinutes > 0 && <small>Overtime: {dayDuration(row.overtimeMinutes)}</small>}{row.doubleTimeMinutes > 0 && <small>Double time: {dayDuration(row.doubleTimeMinutes)}</small>}{row.mealPremium || row.restPremium ? <small>Break premium hours: {row.mealPremium} meal · {row.restPremium} rest</small> : null}</div></td>
    <td>{row.restMinutes} min</td><td>{row.mealMinutes} min</td><td><div className="ts-issues">{row.issues.map(issue => props.manager ? <button type="button" className="ts-day-issue" key={issue} onClick={event => { const card = row.cards.find(card => card.issues.includes(issue)) ?? row.cards[0]; if (card) props.onOpenCard(card, event.currentTarget); else props.onAdd(row.employee.id, event.currentTarget); }} aria-label={`Resolve ${issue} for ${row.employee.name}`}>{issue}</button> : <span key={issue}>{issue}</span>)}</div></td>
  </tr>)}</tbody>)}{props.manager ? <tfoot><tr><td colSpan={5}><button type="button" className="ts-day-add" onClick={event => props.onAdd(undefined, event.currentTarget)}><span aria-hidden="true">＋</span>Add time card</button></td></tr></tfoot> : null}</table>{!props.rows.length ? <div className="ts-empty-state"><h3>No time cards or scheduled shifts for this day</h3><p>Choose another day to see time cards and scheduled shifts.</p></div> : null}</div>;
}
