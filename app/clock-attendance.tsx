"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { readAssistedClocks } from "../workforce/assisted-clock";
import type { readAttendance } from "../workforce/attendance";

type Attendance = Awaited<ReturnType<typeof readAttendance>>;
type Reports = Awaited<ReturnType<typeof readAssistedClocks>>;

async function readClockData<T>(path: string, options?: RequestInit) {
  const response = await fetch("/api/workspace/" + path, { cache: "no-store", ...options });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The time clock could not load this request.");
  return body as T;
}

function displayTime(value: string, timeZone: string, includeDate = false) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone, ...(includeDate ? { month: "short", day: "numeric" } : {}), hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function localInputTime(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(({ type }) => type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function AttendancePanel({ onReview }: { onReview?: () => void }) {
  const [data, setData] = useState<Attendance>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await readClockData<Attendance>("attendance", { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  return (
    <section className="panel clock-attendance-panel" aria-labelledby="live-attendance-title">
      <div className="panel-heading clock-attendance-heading">
        <h2 id="live-attendance-title">Live attendance</h2>
        {onReview && <button type="button" className="secondary-action" onClick={onReview}>Review reported clock times{data?.pendingReports ? ` (${data.pendingReports})` : ""}</button>}
      </div>
      {error && <p role="status">Attendance could not refresh. The dashboard will retry.</p>}
      {!data && !error && <p role="status">Loading attendance…</p>}
      {data && <>
        {data.rows.length ? (
          <div className="clock-attendance-table">
            <table aria-label="Live employee attendance">
              <thead><tr><th scope="col">Employee</th><th scope="col">Job</th><th scope="col">Scheduled start</th><th scope="col">Status</th></tr></thead>
              <tbody>{data.rows.map(row => (
                <tr key={row.id}>
                  <th scope="row">{row.employee}</th><td>{row.role}</td>
                  <td>{row.start ? displayTime(row.start, data.zone) : "Unscheduled"}</td>
                  <td><strong className={row.lateArrival || row.status === "Late" || row.status === "No show" ? "clock-attendance-flag" : undefined}>{row.status}</strong>{row.lateArrival && <span className="clock-late-note"> · Late arrival</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>No published shifts or active clock-ins in your view today.</p>}
        {data.alerts.length > 0 && <details className="clock-attendance-alerts" open>
          <summary>Attendance alerts ({data.alerts.length})</summary>
          <ul>{data.alerts.map(alert => <li key={alert.id}><strong>{alert.title}</strong> · {alert.employee} · <time dateTime={alert.occurredAt}>{displayTime(alert.occurredAt, data.zone, true)}</time></li>)}</ul>
        </details>}
      </>}
    </section>
  );
}

export function AssistedClockReview({ onSaved }: { onSaved: () => Promise<void> }) {
  const [data, setData] = useState<Reports>();
  const [editing, setEditing] = useState<{ id: number; value: string }>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const editInput = useRef<HTMLInputElement>(null);
  const editedId = editing?.id;
  useEffect(() => { if (editedId !== undefined) editInput.current?.focus(); }, [editedId]);
  useEffect(() => {
    const controller = new AbortController();
    readClockData<Reports>("assisted-clocks", { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load reported clock times.");
    });
    return () => controller.abort();
  }, [version]);

  function refresh() {
    setError("");
    setEditing(undefined);
    setVersion(value => value + 1);
  }

  async function decide(id: number, action: "approve" | "edit", value = "") {
    if (pending) return;
    const [date, time] = value.split("T");
    setPending(true);
    setError("");
    setMessage("");
    try {
      await readClockData("assisted-clocks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...(action === "edit" ? { actual: { date, time } } : {}) }),
      });
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError)
        ? reason.message : "Could not confirm the decision. Refresh the reports before trying again.");
      setPending(false);
      return;
    }
    setMessage(action === "approve" ? "Reported time approved." : "Corrected time saved.");
    setData(current => current && ({ ...current, requests: current.requests.filter(report => report.id !== id) }));
    refresh();
    try { await onSaved(); }
    catch { setError("The decision was saved. Timesheets will refresh automatically."); }
    finally { setPending(false); }
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing) void decide(editing.id, "edit", editing.value);
  }

  return (
    <section className="panel clock-attendance-panel" aria-labelledby="assisted-clocks-title">
      <div className="panel-heading clock-attendance-heading">
        <h2 id="assisted-clocks-title">Reported clock times</h2>
        <button type="button" className="secondary-action" disabled={pending} onClick={refresh}>Refresh reports</button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading reports…</p>}
      {data && !data.requests.length && <p>No clock times waiting for review.</p>}
      {data && data.requests.length > 0 && <ul className="assisted-clock-list">
        {data.requests.map(report => <li key={report.id}>
          <strong>{report.employee} · {report.kind === "in" ? "Missed clock-in" : "Missed clock-out"}</strong>
          <div>Reported time <time dateTime={report.requestedAt}>{displayTime(report.requestedAt, data.zone, true)}</time> · Raw entry <time dateTime={report.rawAt}>{displayTime(report.rawAt, data.zone, true)}</time></div>
          <p>{report.reason}</p>
          {editing?.id === report.id ? <form className="assisted-clock-controls" onSubmit={saveEdit}>
            <label>Corrected time ({data.zone})<input ref={editInput} type="datetime-local" step={1} required value={editing.value} onChange={event => setEditing({ id: report.id, value: event.target.value })} /></label>
            <button type="submit" className="primary-action" disabled={pending}>Save corrected time</button>
            <button type="button" className="secondary-action" disabled={pending} onClick={() => setEditing(undefined)}>Cancel</button>
          </form> : <div className="assisted-clock-controls">
            <button type="button" className="primary-action" disabled={pending} onClick={() => void decide(report.id, "approve")}>Approve time</button>
            <button type="button" className="secondary-action" disabled={pending} onClick={() => setEditing({ id: report.id, value: localInputTime(report.requestedAt, data.zone) })}>Edit time</button>
          </div>}
        </li>)}
      </ul>}
    </section>
  );
}
