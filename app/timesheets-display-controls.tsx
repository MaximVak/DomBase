"use client";

import { useEffect, useId, useState } from "react";
import type { ClockDisplay, HoursDisplay } from "./timesheets-display";

type Preference = { clock: ClockDisplay; hours: HoursDisplay };
const defaults: Preference = { clock: "actual", hours: "decimal" };

export function useTimesheetDisplay(accountId?: number) {
  const key = accountId === undefined ? undefined : `dombase.timesheet-display.${accountId}`;
  const [preference, setPreference] = useState<Preference>(defaults);
  useEffect(() => {
    if (!key) return;
    const frame = requestAnimationFrame(() => {
      try {
        const stored = localStorage.getItem(key)?.split(":");
        setPreference({ clock: stored?.[0] === "schedule" ? "schedule" : "actual", hours: stored?.[1] === "minutes" ? "minutes" : "decimal" });
      } catch { /* Display controls also work without browser storage. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  function update(next: Preference) {
    setPreference(next);
    if (key) try { localStorage.setItem(key, `${next.clock}:${next.hours}`); } catch { /* Keep the selection in this tab. */ }
  }
  return { preference, update };
}

export function TimesheetDisplayControls({ preference, onChange }: { preference: Preference; onChange: (value: Preference) => void }) {
  const clockId = useId();
  const hoursId = useId();
  return <div className="ts-display-controls" role="group" aria-label="Timesheet display">
    <div><label htmlFor={clockId}>Clock display</label><select id={clockId} value={preference.clock} onChange={event => onChange({ ...preference, clock: event.target.value as ClockDisplay })}>
      <option value="actual">Actual time</option><option value="schedule">Rounded to schedule</option>
    </select></div>
    <div><label htmlFor={hoursId}>Hours format</label><select id={hoursId} value={preference.hours} onChange={event => onChange({ ...preference, hours: event.target.value as HoursDisplay })}>
      <option value="decimal">Hours</option><option value="minutes">Hours and minutes</option>
    </select></div>
  </div>;
}
