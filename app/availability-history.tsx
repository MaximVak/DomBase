"use client";
import { useState } from "react";
import type { AvailabilityRequest } from "../workforce/model";
import { availabilitySlotLabel, availabilityWeekdays, newestAvailability } from "./availability-model";

const timestamp = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function AvailabilityHistory({ requests, title = "Availability history", paginate = true }: { requests: AvailabilityRequest[]; title?: string; paginate?: boolean }) {
  const [limit, setLimit] = useState(50);
  const ordered = [...requests].sort(newestAvailability);
  return <section className="availability-history" aria-label={title}>
    <h3>{title}</h3><p>Each submission is a complete weekly version. Earlier versions and approval decisions are retained.</p>
    {!ordered.length ? <p>No availability submissions yet.</p> : ordered.slice(0, paginate ? limit : ordered.length).map(request => <details key={request.id}>
      <summary><strong>Effective {request.effectiveDate}</strong> · {request.status === "pending" ? "Pending approval" : request.status === "approved" ? "Approved" : "Rejected"}</summary>
      <p>Submitted {timestamp(request.submittedAt)} by {request.submittedByName || "Author not recorded (older submission)"}.</p>
      {request.decidedAt ? <p>{request.status === "rejected" ? "Rejected" : "Approved"} {timestamp(request.decidedAt)} · {request.decidedByName || (request.status === "approved" ? "Automatic approval or older decision without a recorded reviewer" : "Reviewer not recorded")}.</p> : null}
      {request.requestNote ? <p>Request note: {request.requestNote}</p> : null}
      {request.rejectionNote ? <p>Rejection reason: {request.rejectionNote}</p> : null}
      {request.slots.length ? <ul>{[...request.slots].sort((a, b) => availabilityWeekdays.indexOf(a.day) - availabilityWeekdays.indexOf(b.day) || a.startHour - b.startHour).map((slot, i) => <li key={i}>{slot.day} · {availabilitySlotLabel(slot)}</li>)}</ul> : <p>No preferred or unavailable periods recorded in this version.</p>}
    </details>)}
    {paginate && ordered.length > limit ? <button type="button" onClick={() => setLimit(n => n + 50)}>Show more loaded history</button> : null}
  </section>;
}
