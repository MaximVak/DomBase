"use client";
import { useState } from "react";
import type { ActionDetails } from "../../kiosk/break-rules";

type Entry = { id: string; employee: string; role: string | null; eventType: keyof typeof labels; attemptedAt: string; explanation: string; details: ActionDetails | null };
const labels = { in: "Clock in", out: "Clock out", break: "Start break", break_end: "End break" };
const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "medium" });

export function OfflineClockReview({ entries, onReviewed }: { entries: Entry[]; onReviewed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function markReviewed(id: string) {
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/kiosk-admin/offline-review", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      if (response.status === 404) { onReviewed(); return; }
      if (!response.ok) throw new Error();
      onReviewed();
    } catch { setError("Could not mark this entry reviewed. Try again."); }
    finally { setBusy(null); }
  }
  return <section className="kiosk-admin-section" aria-labelledby="offline-review-heading">
    <h2 id="offline-review-heading">Offline clock entries</h2>
    {error ? <p className="kiosk-error" role="alert">{error}</p> : null}
    {entries.length ? <><p>Compare each entry with the employee’s time card. Make any needed correction in Timesheets before marking the entry reviewed.</p>
      <ul className="kiosk-device-list">{entries.map(entry => <li key={entry.id}>
        <div><strong>{entry.employee}{entry.role ? ` · ${entry.role}` : ""}</strong>
          <span>{labels[entry.eventType]} · {time.format(Date.parse(entry.attemptedAt))} Pacific</span>
          {entry.details?.breakKind ? <p>{entry.details.breakKind === "rest" ? "Paid rest break" : "Unpaid meal break"}</p> : null}
          {entry.details?.worked ? <p>Employee reported work had already started.</p> : null}
          {entry.details?.reports?.map(report => <p key={report.kind + report.slot}>{report.kind === "meal" ? "Meal" : "Rest"} {report.slot} · {report.outcome}{report.reason ? ` · ${report.reason}` : ""}</p>)}
          {entry.explanation ? <p>{entry.explanation}</p> : null}
        </div>
        <button type="button" disabled={busy !== null} onClick={() => void markReviewed(entry.id)}>{busy === entry.id ? "Saving…" : "Mark reviewed"}</button>
      </li>)}</ul>
    </> : <p>No offline entries need review.</p>}
  </section>;
}
