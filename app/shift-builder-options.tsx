"use client";
import { useEffect, useState } from "react";
import { shiftColors, type ShiftColor, type ShiftType } from "./shift-builder";

type Suggestion = { start: string; end: string; role: string; color: ShiftColor; count: number };
type Appearance = { shiftType?: ShiftType; color?: ShiftColor };
export function ShiftBuilderOptions({ value, onChange, employeeId, date, suggest = false }: {
  value: Appearance; onChange: (patch: Appearance & Partial<Omit<Suggestion, "count">>) => void;
  employeeId: number; date: string; suggest?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]), [message, setMessage] = useState("");
  useEffect(() => {
    if (!suggest || !employeeId || !date) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/frequent-shifts?${new URLSearchParams({ employeeId: String(employeeId), date })}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) { setSuggestions(body.suggestions); setMessage(body.suggestions.length ? "" : "No frequent shifts in the previous 8 weeks."); }
      } catch { if (!controller.signal.aborted) { setSuggestions([]); setMessage("Frequent shifts are unavailable. You can still enter a shift."); } }
    })();
    return () => controller.abort();
  }, [employeeId, date, suggest]);
  return <>
    <label className="shift-edit-field"><span>Entry type</span><select aria-label="Shift type" value={value.shiftType ?? "work"} onChange={event => onChange({ shiftType: event.target.value as ShiftType })}>
      <option value="work">Work shift</option><option value="day_off">Day off</option>
    </select></label>
    {!value.shiftType || value.shiftType === "work" ? null : <p className="shift-time-lock-note">Day off has no working hours and does not change PTO balances.</p>}
    <label className="shift-edit-field"><span>Shift color</span><select aria-label="Shift color" value={value.color ?? "blue"} onChange={event => onChange({ color: event.target.value as ShiftColor })}>
      {shiftColors.map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
    </select></label>
    {suggest ? <section className="shift-frequent" aria-label="Frequent shifts"><h3>Frequent shifts</h3><p>{message}</p>{suggestions.map(suggestion => <button type="button" key={`${suggestion.start}:${suggestion.end}:${suggestion.role}:${suggestion.color}`} onClick={() => onChange({ start: suggestion.start, end: suggestion.end, role: suggestion.role, color: suggestion.color, shiftType: "work" })}>
      {suggestion.start}–{suggestion.end} · {suggestion.role} <small>Used {suggestion.count} {suggestion.count === 1 ? "time" : "times"}</small>
    </button>)}</section> : null}
  </>;
}
