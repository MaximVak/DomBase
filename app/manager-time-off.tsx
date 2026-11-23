"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { leaveCategories, leaveRequestMinutes, type LeaveCategory } from "../workforce/leave-duration";
import type { ManagerTimeOffFields, ManagerTimeOffOperation, ManagerTimeOffView } from "../workforce/manager-time-off";
import { useSharedWorkspace } from "./shared-workspace";

export type ManagerTimeOffTarget = { action: "add"; date: string } | { action: "edit" | "cancel"; requestId: number; employeeName: string };
type Person = { id: number; name: string };
const endpoint = "/api/workspace/time-off";
const labels = { add: "Add time off", edit: "Edit approved time off", cancel: "Cancel approved time off" };
const eventLabels = { added: "Added and approved", edited: "Edited", cancelled: "Cancelled", approved: "Approved", denied: "Denied" };
const changedLabels: Record<string, string> = { reason: "Reason updated", explanation: "Explanation updated" };
const requestId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function historyFor(id: number, signal: AbortSignal): Promise<ManagerTimeOffView> {
  const response = await fetch(endpoint + "?request=" + id, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load time-off history.");
  return body;
}

function useLeaveHistory(id?: number) {
  const [history, setHistory] = useState<ManagerTimeOffView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id === undefined) return;
    const controller = new AbortController();
    void historyFor(id, controller.signal).then(setHistory, reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load time-off history.");
    });
    return () => controller.abort();
  }, [id]);
  return { history, error };
}

function leaveDetails(leave: NonNullable<ManagerTimeOffView["history"][number]["before"]>) {
  const dates = leave.startDate === leave.endDate ? leave.startDate : [leave.startDate, leave.endDate].join(" to ");
  const time = leave.startTime && leave.endTime ? [leave.startTime, leave.endTime].join("–") : "Whole day";
  return [leaveCategories[leave.category], dates, time].join(" · ");
}

export function ManagerTimeOffHistory({ request }: { request: number }) {
  const { history, error } = useLeaveHistory(request);
  return <section className="manager-time-off-history" aria-label="Time-off history">
    <h3>History</h3>
    {error ? <p role="alert">{error}</p> : history ? <HistoryEntries entries={history.history} /> : <p role="status">Loading history…</p>}
  </section>;
}

function HistoryEntries({ entries }: { entries: ManagerTimeOffView["history"] }) {
  if (!entries.length) return <p>No recorded decisions yet.</p>;
  return <ol>{entries.map(entry => <li key={entry.id}>
    <strong>{eventLabels[entry.action]} by {entry.actor}</strong>
    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
    {entry.before ? <span>Previous · {leaveDetails(entry.before)}</span> : null}
    {entry.after ? <span>{leaveDetails(entry.after)}</span> : null}
    {entry.changed?.some(field => changedLabels[field]) ? <span>{entry.changed.flatMap(field => changedLabels[field] || []).join(" · ")}</span> : null}
  </li>)}</ol>;
}

export function ManagerTimeOffDialog({ target, people, close, restoreFocus, onSaved }: {
  target: ManagerTimeOffTarget;
  people: Person[];
  close: () => void;
  restoreFocus: HTMLElement | null;
  onSaved: (operation: ManagerTimeOffOperation) => void;
}) {
  const shared = useSharedWorkspace();
  const { history, error: loadError } = useLeaveHistory(target.action === "add" ? undefined : target.requestId);
  const modal = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const attempt = useRef<{ id: string; values: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = labels[target.action];

  useEffect(() => {
    const dialog = modal.current;
    const target = restoreFocus ?? document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    closeButton.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-time-off-focus]")?.focus({ preventScroll: true });
    };
  }, [restoreFocus]);

  async function save(operation: ManagerTimeOffOperation) {
    if (busy.current || shared.pending) return;
    const values = JSON.stringify(operation);
    if (attempt.current?.values !== values) attempt.current = { values, id: requestId() };
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...operation, id: attempt.current.id, revision: shared.data.revision }) });
      if (response.status === 401) { window.location.replace("/login"); return; }
      const data = await response.json();
      if (response.status === 409) await shared.refresh().catch(() => {});
      if (!response.ok) throw new Error(data.error || "Could not save time off.");
      if (data.saved !== true) throw new Error("Could not confirm the save. Try the same change again.");
      try { await shared.refresh(); } catch { shared.setError("Time off was saved. Reload to see the updated schedule and balances."); }
      onSaved(operation);
      close();
    } catch (error) {
      setError(error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) ? error.message : "Could not confirm the save. Try the same change again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const record = history?.record;
  const canAddExplanation = shared.data.permissions["team.read"] && shared.data.permissions["team.private.read"];
  const initial = target.action === "add" ? {
    category: "pto" as const, reason: "vacation" as const, startDate: target.date, endDate: target.date, startTime: null, endTime: null,
    explanation: canAddExplanation ? "" : undefined,
  } : record && {
    category: record.category, reason: record.reason, startDate: record.startDate, endDate: record.endDate,
    startTime: record.startTime, endTime: record.endTime, explanation: record.explanation,
  };
  return <dialog className="manager-time-off-dialog" ref={modal} aria-labelledby="manager-time-off-title" onCancel={event => { event.preventDefault(); if (!busy.current) close(); }}>
    <header className="modal-heading">
      <h2 id="manager-time-off-title">{title}</h2>
      <button type="button" ref={closeButton} disabled={saving} aria-label="Close time-off editor" onClick={close}>×</button>
    </header>
    {target.action !== "add" ? <p>{target.employeeName}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : !initial ? <p role="status">Loading the approved request…</p>
      : record && record.status !== "approved" ? <p role="alert">This request is no longer approved. Close and reload to see its current status.</p>
      : target.action === "cancel" && record ? <>
        <p>{leaveDetails(record)}</p><p>Cancel this request and update the schedule, timesheets, and leave balance?</p>
        <div className="hours-edit-actions"><button type="button" disabled={saving} onClick={close}>Keep request</button>
          <button type="button" className="danger-confirm" disabled={saving || shared.pending}
            onClick={() => void save({ action: "cancel", requestId: record.id, version: record.version })}>{saving ? "Saving…" : title}</button></div>
      </> : <LeaveForm initial={initial} people={people} record={record} saving={saving || shared.pending} onClose={close} onSubmit={(emp, details) => {
        void save(record ? { action: "edit", requestId: record.id, version: record.version, details } : { action: "add", employeeId: emp, details });
      }} />}
    {error ? <p role="alert" className="manager-time-off-error">{error}</p> : null}
    {history ? <section className="manager-time-off-history" aria-label="Time-off history"><h3>History</h3><HistoryEntries entries={history.history} /></section> : null}
  </dialog>;
}

function LeaveForm({ initial, people, record, saving, onClose, onSubmit }: {
  initial: ManagerTimeOffFields;
  people: Person[];
  record?: ManagerTimeOffView["record"];
  saving: boolean;
  onClose: () => void;
  onSubmit: (employeeId: number, details: ManagerTimeOffFields) => void;
}) {
  const [person, setPerson] = useState(record?.employeeId ?? 0);
  const [details, setDetails] = useState(initial);
  const [wholeDay, setWholeDay] = useState(!initial.startTime);
  const dates = wholeDay ? { ...details, startTime: null, endTime: null }
    : { ...details, endDate: details.startDate, startTime: details.startTime ?? "", endTime: details.endTime ?? "" };
  const minutes = wholeDay || (dates.startTime && dates.endTime) ? leaveRequestMinutes(dates) : 0;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (person && minutes > 0) onSubmit(person, dates);
  }
  return <form className="my-time-off-form manager-time-off-form" onSubmit={submit}>
    <fieldset disabled={saving}>
      <legend>Request details</legend>
      {record ? null : <label>Employee<select value={person || ""} onChange={event => setPerson(Number(event.target.value))} required>
        <option value="">Choose an employee</option>{people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      <label>Category<select value={details.category} onChange={event => setDetails({ ...details, category: event.target.value as LeaveCategory })}>
        {Object.entries(leaveCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="my-time-off-whole-day"><input type="checkbox" checked={wholeDay} onChange={event => setWholeDay(event.target.checked)} />Whole day</label>
      <div className="my-time-off-fields">
        <label>{wholeDay ? "First day off" : "Date"}<input type="date" value={details.startDate} required onChange={event => {
          const startDate = event.target.value;
          setDetails({ ...details, startDate, endDate: details.endDate < startDate ? startDate : details.endDate });
        }} /></label>
        {wholeDay ? <label>Last day off<input type="date" value={details.endDate} min={details.startDate} onChange={event => setDetails({ ...details, endDate: event.target.value })} required /></label>
          : <><label>Start time<input type="time" value={details.startTime ?? ""} onChange={event => setDetails({ ...details, startTime: event.target.value })} required /></label>
            <label>End time<input type="time" value={details.endTime ?? ""} onChange={event => setDetails({ ...details, endTime: event.target.value })} required /></label></>}
      </div>
      <p aria-live="polite">{minutes > 0 ? (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " hours" : "Choose a valid date or time range."}{wholeDay ? " · 8 hours per day" : ""}</p>
      <label>Reason<select value={details.reason} onChange={event => setDetails({ ...details, reason: event.target.value as ManagerTimeOffFields["reason"] })}>
        <option value="vacation">Vacation / personal</option><option value="sick_emergency">Sick / emergency</option>
      </select></label>
      {details.explanation !== undefined ? <label>Explanation (optional)<textarea rows={3} value={details.explanation} maxLength={1000} onChange={event => setDetails({ ...details, explanation: event.target.value })} /></label> : null}
      <div className="hours-edit-actions"><button type="button" onClick={onClose}>Close</button>
        <button type="submit" disabled={!person || minutes <= 0}>{saving ? "Saving…" : record ? "Save changes" : "Add and approve"}</button></div>
    </fieldset>
  </form>;
}
