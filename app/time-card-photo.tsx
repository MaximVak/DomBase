"use client";

import { useState } from "react";

export function ClockInPhoto({ eventId }: { eventId: number }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="ts-clock-photo">
    <button type="button" className="ts-text-button" aria-expanded={open} onClick={() => { setOpen(!open); setFailed(false); }}>{open ? "Hide clock-in photo" : "Show clock-in photo"}</button>
    {open && (failed ? <p role="status">The clock-in photo could not be loaded.</p> :
      // Use the authenticated browser request directly for private files.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/workspace/clock-photo?event=${eventId}`} alt="Employee at clock-in" onError={() => setFailed(true)} />)}
  </div>;
}
