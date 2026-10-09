"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { addDays, localDate, weekStartFor } from "./timesheets-model";

export type TimesheetDateRange = { start: string; end: string };
type Preset = "current" | "previous" | "today" | "yesterday" | "custom";
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const presets: { id: Preset; label: string }[] = [
  { id: "current", label: "Current Payroll Period" }, { id: "previous", label: "Previous Payroll Period" },
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "custom", label: "Custom" },
];
export function shiftCalendarMonth(date: string, offset: number) {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  value.setMonth(value.getMonth() + offset);
  return localDate(value);
}
export function calendarMonthDays(month: string): (string | null)[] {
  const first = `${month.slice(0, 7)}-01`;
  const leading = new Date(`${first}T12:00:00`).getDay();
  const days = new Date(new Date(`${first}T12:00:00`).getFullYear(), new Date(`${first}T12:00:00`).getMonth() + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => index >= leading && index < leading + days ? addDays(first, index - leading) : null);
}
export function calendarPresetRange(preset: Exclude<Preset, "custom">, today: string, weekStart: number): TimesheetDateRange {
  const current = weekStartFor(today, weekStart);
  if (preset === "current") return { start: current, end: addDays(current, 6) };
  if (preset === "previous") return { start: addDays(current, -7), end: addDays(current, -1) };
  const day = preset === "today" ? today : addDays(today, -1);
  return { start: day, end: day };
}
export function validCalendarRange(start: string, end: string) {
  return Boolean(start && end && start <= end && end <= addDays(start, 30));
}
const dateName = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

type Props = {
  start: string; end: string; today: string; weekStart: number; singleDay: boolean;
  onApply: (range: TimesheetDateRange) => void; onCancel: () => void;
};
export function TimesheetsCalendar(props: Props) {
  const [selection, setSelection] = useState<TimesheetDateRange>({ start: props.start, end: props.end });
  const [preset, setPreset] = useState<Preset>(() => presets.find(option => { if (option.id === "custom") return false; const range = calendarPresetRange(option.id, props.today, props.weekStart); return range.start === props.start && range.end === props.end; })?.id ?? "custom");
  const [month, setMonth] = useState(`${props.start.slice(0, 7)}-01`);
  const [focusedDate, setFocusedDate] = useState(props.start);
  const [message, setMessage] = useState("");
  const calendarRef = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(true);
  useEffect(() => {
    if (focusRequested.current) calendarRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus();
    focusRequested.current = false;
  }, [focusedDate, month]);
  const changed = selection.start !== props.start || selection.end !== props.end;
  const valid = validCalendarRange(selection.start, selection.end);
  function choosePreset(value: Preset) {
    setPreset(value); setMessage("");
    if (value === "custom") return;
    const range = calendarPresetRange(value, props.today, props.weekStart);
    setSelection(range); setMonth(`${range.start.slice(0, 7)}-01`); setFocusedDate(range.start);
  }
  function chooseDate(date: string) {
    setPreset("custom"); setMessage(""); setFocusedDate(date);
    if (props.singleDay) { setSelection({ start: date, end: date }); return; }
    if (selection.end) { setSelection({ start: date, end: "" }); return; }
    const range = date < selection.start ? { start: date, end: selection.start } : { start: selection.start, end: date };
    if (!validCalendarRange(range.start, range.end)) { setMessage("Choose a range of up to 31 days."); return; }
    setSelection(range);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    let next = "";
    if (event.key === "ArrowLeft") next = addDays(date, -1);
    if (event.key === "ArrowRight") next = addDays(date, 1);
    if (event.key === "ArrowUp") next = addDays(date, -7);
    if (event.key === "ArrowDown") next = addDays(date, 7);
    if (event.key === "Home") next = addDays(date, -weekday);
    if (event.key === "End") next = addDays(date, 6 - weekday);
    if (event.key === "PageUp" || event.key === "PageDown") {
      const target = shiftCalendarMonth(date, event.key === "PageUp" ? -1 : 1);
      const last = addDays(shiftCalendarMonth(target, 1), -1);
      next = `${target.slice(0, 8)}${String(Math.min(Number(date.slice(-2)), Number(last.slice(-2)))).padStart(2, "0")}`;
    }
    if (!next) return;
    event.preventDefault(); focusRequested.current = true;
    if (next < month || next >= shiftCalendarMonth(month, 2)) setMonth(`${next.slice(0, 7)}-01`);
    setFocusedDate(next);
  }
  function moveMonth(offset: number) {
    const next = shiftCalendarMonth(month, offset);
    setMonth(next); setFocusedDate(next);
  }
  return <div className="ts-popover ts-calendar-popover" role="dialog" aria-label="Choose timesheet dates" ref={calendarRef}>
    <div className="ts-calendar-content"><nav className="ts-calendar-presets" aria-label="Date shortcuts">{presets.map(option => <button type="button" key={option.id} className={preset === option.id ? "active" : ""} aria-pressed={preset === option.id} title={option.id === "current" || option.id === "previous" ? "Based on your saved work week" : undefined} onClick={() => choosePreset(option.id)}><span>{option.label}{option.id === "custom" ? <small>{props.singleDay ? "Select a day" : "1-month max range"}</small> : null}</span>{preset === option.id ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m4 12 5 5L20 6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</button>)}</nav>
      <div className="ts-calendar-months">{[month, shiftCalendarMonth(month, 1)].map((value, index) => {
        const days = calendarMonthDays(value);
        const name = new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
        return <section className="ts-calendar-month" key={`month-${index}`} aria-label={name}>
          <div className="ts-calendar-month-heading">{index === 0 ? <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous calendar month">‹</button> : <span />}<h3>{name}</h3>{index === 1 ? <button type="button" onClick={() => moveMonth(1)} aria-label="Next calendar month">›</button> : <span />}</div>
          <div className="ts-calendar-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
          <div className="ts-calendar-days">{days.map((date, dayIndex) => {
            if (!date) return <span key={`blank-${dayIndex}`} />;
            const inRange = date >= selection.start && date <= (selection.end || selection.start);
            const endpoint = date === selection.start || date === selection.end;
            const rowStart = date === selection.start || dayIndex % 7 === 0 || !days[dayIndex - 1];
            const rowEnd = date === selection.end || !selection.end || dayIndex % 7 === 6 || !days[dayIndex + 1];
            return <button type="button" key={date} data-date={date} className={[inRange ? "in-range" : "", endpoint ? "endpoint" : "", rowStart ? "range-start" : "", rowEnd ? "range-end" : "", date === props.today ? "today" : ""].join(" ")} tabIndex={date === focusedDate ? 0 : -1} aria-label={dateName(date)} aria-pressed={inRange} aria-current={date === props.today ? "date" : undefined} onKeyDown={event => navigate(event, date)} onClick={() => chooseDate(date)}><span>{Number(date.slice(-2))}</span></button>;
          })}</div>
        </section>;
      })}</div>
    </div>
    <div className="ts-calendar-footer"><p role="status">{message || (!selection.end ? "Select the end date." : "")}</p><button type="button" className="ts-calendar-cancel" onClick={props.onCancel}>Cancel</button><button type="button" className="ts-primary" disabled={!changed || !valid} onClick={() => props.onApply(selection)}>Apply</button></div>
  </div>;
}
