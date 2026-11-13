"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import type { AvailabilityRequestSlot } from "../workforce/model";
import { availabilityTime, availabilityWeekdays } from "./availability-model";

type Period = { key: string; day: string; preference: "preferred" | "unavailable"; start: string; end: string };
const hours = (value: string) => Number(value.slice(0, 2)) + Number(value.slice(3)) / 60;
export function AvailabilityEditor({ today, approvalRequired, initialSlots = [], disabled = false, onSave }: { today: string; approvalRequired: boolean; initialSlots?: AvailabilityRequestSlot[]; disabled?: boolean; onSave: (date: string, slots: AvailabilityRequestSlot[], note: string) => Promise<boolean> }) {
  const [date, setDate] = useState(today), [note, setNote] = useState("");
  const [periods, setPeriods] = useState<Period[]>(() => initialSlots.map((slot, i) => ({ key: String(i), day: slot.day, preference: slot.preference, start: availabilityTime(slot.startHour), end: slot.endHour === 24 ? "00:00" : availabilityTime(slot.endHour) })));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const signature = JSON.stringify({ date, periods, note });
  function change(key: string, patch: Partial<Period>) { setPeriods(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row)); setError(""); setMessage(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || disabled) return;
    setError(""); setMessage("");
    if (periods.some(row => !row.start || !row.end || (row.end !== "00:00" && row.start >= row.end))) { setError("Each period needs a start and a later end. Use 00:00 as the end for midnight at the end of the day."); return; }
    const slots = periods.map(row => ({ day: row.day, preference: row.preference, startHour: hours(row.start), endHour: row.end === "00:00" ? 24 : hours(row.end), location: "This location" }));
    if (slots.some((slot, i) => slots.slice(0, i).some(other => other.day === slot.day && other.startHour < slot.endHour && other.endHour > slot.startHour))) { setError("Availability periods on the same day must not overlap."); return; }
    setBusy(true);
    try { if (await onSave(date, slots, note)) { setSaved(signature); setMessage(approvalRequired ? "Availability submitted for approval. Your approved availability stays in effect until a manager approves the new version." : "Availability saved. The new weekly version applies from its effective date."); } }
    catch { setError("Could not confirm the save. Reload saved history before retrying."); }
    finally { setBusy(false); }
  }
  return <form className="availability-editor panel" onSubmit={submit} aria-label="New availability version">
    <h3>New weekly availability</h3><p>Start with the currently approved periods, then save a complete new version. All times use America/Los_Angeles. Unlisted periods have no recorded preference.</p>
    <fieldset disabled={busy || disabled}><label>Effective date<input type="date" required value={date} onChange={event => { setDate(event.target.value); setMessage(""); }} /></label>
    <p>Periods repeat each week from this date. End time 00:00 means midnight at the end of that weekday.</p>
    {periods.map((row, i) => <div className="availability-period" key={row.key}>
      <label>Day<select aria-label={`Period ${i + 1} day`} value={row.day} onChange={event => change(row.key, { day: event.target.value })}>{[...availabilityWeekdays.slice(1), "Sunday"].map(day => <option key={day}>{day}</option>)}</select></label>
      <label>Preference<select aria-label={`Period ${i + 1} preference`} value={row.preference} onChange={event => change(row.key, { preference: event.target.value as Period["preference"] })}><option value="preferred">Preferred</option><option value="unavailable">Unavailable</option></select></label>
      <label>Start<input aria-label={`Period ${i + 1} start`} type="time" required value={row.start} onChange={event => change(row.key, { start: event.target.value })} /></label>
      <label>End<input aria-label={`Period ${i + 1} end`} type="time" required value={row.end} onChange={event => change(row.key, { end: event.target.value })} /></label>
      <button type="button" onClick={() => change(row.key, { start: "00:00", end: "00:00" })} aria-label={`Make period ${i + 1} all day`}>All day</button>
      <button type="button" onClick={() => { setPeriods(rows => rows.filter(other => other.key !== row.key)); setMessage(""); }} aria-label={`Remove period ${i + 1}`}>Remove</button>
    </div>)}
    <button type="button" disabled={periods.length >= 100} onClick={() => { setPeriods(rows => [...rows, { key: crypto.randomUUID(), day: "Monday", preference: "preferred", start: "09:00", end: "17:00" }]); setMessage(""); }}>Add period</button>
    {!periods.length ? <p>This version has no recorded preferences. Saving it replaces earlier periods from the effective date.</p> : null}
    <label>Request note<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
    <button type="submit" disabled={saved === signature}>{busy ? "Saving…" : approvalRequired ? "Submit for approval" : "Save availability"}</button>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </form>;
}
