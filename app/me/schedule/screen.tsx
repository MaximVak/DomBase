"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { offsetScheduleDate, type EmployeeSchedule } from "../../../self/schedule-model";

function dayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}
function timeLabel(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function EmployeeScheduleScreen() {
  const [data, setData] = useState<EmployeeSchedule | null>(null);
  const [date, setDate] = useState("");
  const [showTeam, setShowTeam] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setData(null); setError(""); setPending(true);
    try {
      const response = await fetch(`/api/self/schedule${date ? `?${new URLSearchParams({ date })}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { window.location.replace("/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load your schedule.");
      if (!controller.signal.aborted) { setData(body); if (body.ownOnly) setShowTeam(false); }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof TypeError)
        ? error.message : "Could not load your schedule. Check your connection and try reloading it.");
    } finally { if (!controller.signal.aborted) setPending(false); }
  }, [date]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => {
      if (document.visibilityState === "hidden") { activeRequest.current?.abort(); setData(null); }
      else void load();
    };
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 60000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(initial); activeRequest.current?.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  const shifts = data?.shifts.filter(shift => showTeam || shift.employeeId === data.employeeId) ?? [];
  return <main className="team-screen employee-schedule-screen">
    <header><div><a href="/me">← My profile</a> · <a href="/me/availability">My availability</a><h1>My schedule</h1><p>Published shifts for your workweek.</p></div><button type="button" disabled={pending} onClick={() => void load()}>Reload schedule</button></header>
    <div className="employee-week-toolbar">
      <button type="button" disabled={!data || pending} onClick={() => { if (data) setDate(offsetScheduleDate(data.startDate, -7)); }}>← Previous week</button>
      <label>Week containing<input type="date" min="0001-01-01" max="9998-12-31" value={date || data?.today || ""} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
      <button type="button" disabled={!data || pending} onClick={() => { if (data) setDate(offsetScheduleDate(data.startDate, 7)); }}>Next week →</button>
      <button type="button" disabled={pending} onClick={() => { if (date) setDate(""); else void load(); }}>This week</button>
    </div>
    {error ? <p role="alert">{error} Use Reload schedule to try again.</p> : null}
    {pending ? <p role="status">Loading your schedule…</p> : null}
    {data ? <>
      <p className="employee-schedule-context">{data.locationName} · All times in {data.timeZone}</p>
      <h2>{dayLabel(data.startDate)} – {dayLabel(data.endDate)}</h2>
      {data.ownOnly ? <p>Only your shifts are visible. Your company keeps individual schedules private.</p>
        : <label className="team-check"><input type="checkbox" checked={showTeam} onChange={event => setShowTeam(event.target.checked)} />Show team schedule</label>}
      {!shifts.length ? <p role="status">{showTeam ? "No published shifts this week." : "You have no published shifts this week."}</p> : null}
      <div className="employee-schedule-days">{Array.from({ length: 7 }, (_, index) => {
        const day = offsetScheduleDate(data.startDate, index), dayShifts = shifts.filter(shift => shift.date === day);
        return <section className="employee-schedule-day" key={day} aria-labelledby={`day-${day}`}>
          <h3 id={`day-${day}`}><time dateTime={day}>{dayLabel(day)}</time>{day === data.today ? <span>Today</span> : null}</h3>
          {dayShifts.length ? <ul>{dayShifts.map(shift => <li key={shift.id} data-shift-color={shift.color}>
            <strong>{shift.shiftType === "day_off" ? "Day off" : <><time dateTime={`${shift.date}T${shift.start}`}>{timeLabel(shift.start)}</time> – <time dateTime={`${shift.date}T${shift.end}`}>{timeLabel(shift.end)}</time>{shift.end <= shift.start ? " (ends next day)" : ""}</>}</strong>
            {showTeam ? <span>{shift.employeeId === data.employeeId ? `${shift.employeeName} (you)` : shift.employeeName}</span> : null}
            <span>{shift.role || "Shift"}{shift.station ? ` · ${shift.station}` : ""}</span>
          </li>)}</ul> : <p>No shifts</p>}
        </section>;
      })}</div>
    </> : null}
  </main>;
}
