"use client";
import type { AvailabilityRequest } from "../workforce/model";
import { availabilityForDate, availabilitySlotLabel } from "./availability-model";
import { AvailabilityHistory } from "./availability-history";

export function ShiftAvailability({ requests, employeeId, date, permitted }: { requests: AvailabilityRequest[]; employeeId: number; date: string; permitted: boolean }) {
  if (!permitted) return <section className="shift-availability" aria-label="Employee availability"><h3>Availability</h3><p>Your permissions do not include viewing availability.</p></section>;
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return <p>Choose an employee and date to see availability.</p>;
  const own = requests.filter(request => request.employeeId === employeeId), { current, slots } = availabilityForDate(own, employeeId, date);
  const pending = own.filter(request => request.status === "pending").length;
  return <section className="shift-availability" aria-label="Employee availability">
    <h3>Availability · {date}</h3>
    {current ? <><p>Approved weekly version effective {current.effectiveDate}.</p>{slots.length ? <ul>{slots.map((slot, i) => <li key={i} data-preference={slot.preference}>{availabilitySlotLabel(slot)}</li>)}</ul> : <p>No preferred or unavailable periods recorded for this weekday.</p>}</> : <p>No approved availability effective on this date. Availability is unknown.</p>}
    {pending ? <p>{pending} pending {pending === 1 ? "request has" : "requests have"} not been applied.</p> : null}
    <p>Recorded preferences guide scheduling. They do not change or hide shifts.</p>
    <details><summary>View availability history</summary><AvailabilityHistory key={employeeId} requests={own} /></details>
  </section>;
}
