"use client";

import { addDays, totalMetrics } from "./timesheets-model";
import type { Rounding, TimeCard, TimesheetEmployee, TimesheetPto, TimesheetShift } from "./timesheets-model";

export type DayRow = {
  employee: TimesheetEmployee; cards: TimeCard[]; scheduled: TimesheetShift[];
  elapsedMinutes: number; mealMinutes: number; varianceMinutes: number | null; issues: string[]; notes: string[];
};
export function buildDayRows(input: {
  employees: TimesheetEmployee[]; cards: TimeCard[]; shifts: TimesheetShift[]; pto: TimesheetPto[];
  date: string; now: number; showEmpty: boolean;
}): DayRow[] {
  const dayStart = Date.parse(`${input.date}T00:00:00`), dayEnd = Date.parse(`${addDays(input.date, 1)}T00:00:00`);
  return input.employees.flatMap(employee => {
    const cards = input.cards.filter(card => card.employeeId === employee.id && card.date === input.date);
    if (!cards.length && !input.showEmpty) return [];
    const scheduled = input.shifts.filter(shift => {
      if (shift.employeeId !== employee.id || ![input.date, addDays(input.date, -1)].includes(shift.date)) return false;
      const start = Date.parse(`${shift.date}T${shift.start}`);
      let end = Date.parse(`${shift.date}T${shift.end}`);
      if (end <= start) end = Date.parse(`${addDays(shift.date, 1)}T${shift.end}`);
      return start < dayEnd && end > dayStart;
    });
    const totals = totalMetrics(cards);
    const clocked = cards.some(card => card.start);
    const approvedLeave = input.pto.some(request => request.employeeId === employee.id && request.status === "approved" && request.startDate <= input.date && request.endDate >= input.date);
    const noShow = !clocked && !approvedLeave && !cards.some(card => card.adjustment) && scheduled.some(shift => {
      let end = Date.parse(`${shift.date}T${shift.end}`);
      if (end <= Date.parse(`${shift.date}T${shift.start}`)) end = Date.parse(`${addDays(shift.date, 1)}T${shift.end}`);
      return end <= input.now;
    });
    const elapsedMinutes = Math.round((clocked ? totals.spread ?? 0 : totals.actual ?? 0) * 60);
    return [{ employee, cards, scheduled, elapsedMinutes, mealMinutes: Math.round((totals.breaks ?? 0) * 60),
      varianceMinutes: clocked && scheduled.length && cards.filter(card => card.start).every(card => card.end) ? elapsedMinutes - Math.round((totals.scheduled ?? 0) * 60) : null,
      issues: [...new Set([...cards.flatMap(card => card.issues), ...(noShow ? ["No-Show"] : [])])],
      notes: [...new Set(cards.flatMap(card => card.notes))],
    }];
  });
}
export type DaySort = "first" | "last" | "start";
export function sortDayRows(rows: DayRow[], sort: DaySort, date: string): DayRow[] {
  const dayStart = Date.parse(`${date}T00:00:00`);
  const startTime = (row: DayRow) => {
    const clocked = row.cards.filter(card => card.start).map(card => Math.max(dayStart, Date.parse(card.start!)));
    const scheduled = row.scheduled.map(shift => Math.max(dayStart, Date.parse(`${shift.date}T${shift.start}`)));
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
const clock = (date: string) => new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
export function dayClockLabel(card: TimeCard, date: string, now: number) {
  if (!card.start) return "--:-- – --:--";
  const dayStart = Date.parse(`${date}T00:00:00`), dayEnd = Date.parse(`${addDays(date, 1)}T00:00:00`);
  const start = Math.max(Date.parse(card.start), dayStart), end = Math.min(card.end ? Date.parse(card.end) : now, dayEnd);
  return `${clock(new Date(start).toISOString())} – ${!card.end && end < dayEnd ? "Open" : end === dayEnd ? "12:00 am (+1)" : clock(new Date(end).toISOString())}`;
}
function scheduledLabel(shifts: TimesheetShift[]) {
  return shifts.map(shift => `${clock(`${shift.date}T${shift.start}`)} – ${clock(`${shift.date}T${shift.end}`)}${shift.end <= shift.start ? " (+1)" : ""}`).join(", ");
}

type Props = {
  rows: DayRow[]; date: string; now: number; manager: boolean; rounding?: Rounding;
  onOpenCard: (card: TimeCard, button: HTMLButtonElement) => void;
  onAdd: (employeeId: number | undefined, button: HTMLButtonElement) => void;
};
export function TimesheetsDay(props: Props) {
  return <div className="ts-day-ledger-scroll"><table className="ts-day-ledger"><thead><tr><th scope="col">Team member</th><th scope="col">Worked</th><th scope="col">Rest breaks</th><th scope="col">Meal breaks</th><th scope="col">Issues</th></tr></thead><tbody>{props.rows.map(row => <tr key={row.employee.id}>
    <th scope="row"><div className="ts-day-member"><span className="ts-day-avatar" aria-hidden="true">{row.employee.name[0]}</span><div><strong>{row.employee.name}</strong><span>{[...new Set(row.cards.map(card => card.role))].join(", ") || row.employee.role}</span></div>{row.notes.length ? <span className="ts-day-note" title={row.notes.join("\n")} aria-label={`${row.notes.length} notes`}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 8 0 1 1 18 0Z" fill="currentColor" /></svg>{row.notes.length}</span> : null}</div></th>
    <td><div className="ts-day-worked">{row.cards.some(card => card.start) ? row.cards.filter(card => card.start).map(card => <button type="button" className="ts-day-clock" key={card.id} aria-label={`Open ${row.employee.name} time card ${dayClockLabel(card, props.date, props.now)}`} onClick={event => props.onOpenCard(card, event.currentTarget)}>{dayClockLabel(card, props.date, props.now)}</button>) : props.manager ? <button type="button" className="ts-day-clock" aria-label={`Add time card for ${row.employee.name}`} onClick={event => props.onAdd(row.employee.id, event.currentTarget)}>--:-- – --:--</button> : <span>--:-- – --:--</span>}
      {row.cards.some(card => card.start || card.adjustment) ? <small>Total: {dayDuration(row.elapsedMinutes)}{row.varianceMinutes ? <span className={row.varianceMinutes > 0 ? "ts-day-over" : "ts-day-under"}>{row.varianceMinutes > 0 ? "↑" : "↓"} {Math.abs(row.varianceMinutes)} min {row.varianceMinutes > 0 ? "over" : "under"}</span> : null}</small> : row.scheduled.length ? <small>Scheduled: {scheduledLabel(row.scheduled)}</small> : <small>{row.cards.some(card => (card.metrics.pto ?? 0) > 0) ? "Paid time off" : "No time card"}</small>}{props.rounding && props.rounding !== "actual" && row.cards.some(card => card.start || card.adjustment) ? <small>Paid: {dayDuration(Math.round((totalMetrics(row.cards).paid ?? 0) * 60))} · rounded to {props.rounding} min</small> : null}</div></td>
    <td>0 min</td><td>{row.mealMinutes} min</td><td><div className="ts-issues">{row.issues.map(issue => props.manager ? <button type="button" className="ts-day-issue" key={issue} onClick={event => { const card = row.cards.find(card => card.issues.includes(issue)) ?? row.cards[0]; if (card) props.onOpenCard(card, event.currentTarget); else props.onAdd(row.employee.id, event.currentTarget); }} aria-label={`Resolve ${issue} for ${row.employee.name}`}>{issue}</button> : <span key={issue}>{issue}</span>)}</div></td>
  </tr>)}</tbody>{props.manager ? <tfoot><tr><td colSpan={5}><button type="button" className="ts-day-add" onClick={event => props.onAdd(undefined, event.currentTarget)}><span aria-hidden="true">＋</span>Add time card</button></td></tr></tfoot> : null}</table>{!props.rows.length ? <div className="ts-empty-state"><h3>No time cards or scheduled shifts for this day</h3><p>Choose another day to see time cards and scheduled shifts.</p></div> : null}</div>;
}
