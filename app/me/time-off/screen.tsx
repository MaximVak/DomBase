"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MyTimeOff } from "../../../self/time-off";
import { leaveCategories, leaveRequestMinutes, type LeaveCategory } from "../../../workforce/leave-duration";

const endpoint = "/api/self/time-off";
const statuses = { pending: "Pending approval", approved: "Approved", denied: "Denied", cancelled: "Cancelled" };
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateLabel = (date: string) => dateFormat.format(new Date(`${date}T12:00:00Z`));
const hoursLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  return [hours ? `${hours} hr` : "", minutes % 60 ? `${minutes % 60} min` : ""].filter(Boolean).join(" ");
};
const balanceLabel = (seconds: number) => ((seconds / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " hours");
const requestId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function loadTimeOff(signal?: AbortSignal): Promise<MyTimeOff> {
  const response = await fetch(endpoint, { cache: "no-store", signal });
  if (response.status === 401 || response.status === 403) {
    window.location.replace("/me");
    throw new Error("Sign in again to view your time off.");
  }
  if (!response.ok) throw new Error("Could not load time off. Please try again.");
  return response.json();
}

export function MyTimeOffScreen() {
  const [data, setData] = useState<MyTimeOff | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadTimeOff(controller.signal).then(setData, reason => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, []);

  return <main className="my-profile-screen my-time-off-screen">
    <header><div><nav aria-label="My account"><a href="/me">← My profile</a> · <a href="/me/schedule">My schedule</a></nav><h1>Request time off</h1></div></header>
    {error ? <div className="my-profile-error"><p role="alert">{error}</p><button type="button" onClick={() => window.location.reload()}>Reload time off</button></div> : null}
    {data ? <section aria-labelledby="my-leave-balances" className="my-leave-balances">
      <h2 id="my-leave-balances">Available balances</h2>
      <dl>{(["pto", "sick"] as const).map(category => {
        const balance = data.balances.find(row => row.category === category);
        return <div key={category}><dt>{leaveCategories[category]}</dt>
          <dd>{balance ? balanceLabel(balance.availableSeconds) : "No policy assigned"}</dd>
          {balance && balance.usableFrom > data.today ? <dd>Available from {dateLabel(balance.usableFrom)}</dd> : null}
        </div>;
      })}</dl>
    </section> : null}
    {data ? <TimeOffForm key={data.contextToken} data={data} onLoad={setData} /> : !error ? <p role="status">Loading time off…</p> : null}
    {data ? <section aria-labelledby="my-time-off-requests">
      <h2 id="my-time-off-requests">Recent requests</h2>
      {data.requests.length ? <ul className="my-time-off-requests">{data.requests.map(request => <li key={request.id}>
        <strong>{leaveCategories[request.category]}</strong>
        <span>{dateLabel(request.startDate)}{request.endDate !== request.startDate ? ` – ${dateLabel(request.endDate)}` : ""} · {hoursLabel(request.minutes)}</span>
        <span>{statuses[request.status]}</span>
      </li>)}</ul> : <p>You have no time-off requests yet.</p>}
    </section> : null}
  </main>;
}

function TimeOffForm({ data, onLoad }: { data: MyTimeOff; onLoad: (data: MyTimeOff) => void }) {
  const [category, setCategory] = useState<LeaveCategory>("pto");
  const [startDate, setStartDate] = useState(data.today);
  const [endDate, setEndDate] = useState(data.today);
  const [wholeDay, setWholeDay] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("vacation");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const dates = wholeDay ? { startDate, endDate } : { startDate, endDate: startDate, startTime, endTime };
  const minutes = wholeDay || (startTime && endTime) ? leaveRequestMinutes(dates) : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setMessage("");
    if (!minutes) { setError("Choose a valid date range or enter an end time after the start time."); return; }
    const fields = { ...dates, category, reason, explanation: note.trim() };
    const serialized = JSON.stringify(fields);
    if (attempt.current?.fields !== serialized) attempt.current = { fields: serialized, id: requestId() };
    busy.current = true;
    setSaving(true);
    setError("");
    let saved = false;
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, id: attempt.current.id, revision: data.revision, contextToken: data.contextToken }) });
      if (response.status === 401 || response.status === 403) { window.location.replace("/me"); return; }
      const result = await response.json();
      if (response.status === 409) {
        onLoad(await loadTimeOff());
        setError("Time off was refreshed. Review recent requests and submit again if needed.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "Could not submit your request.");
      saved = true;
      setMessage("Request submitted for manager approval.");
      setNote("");
      attempt.current = null;
      onLoad(await loadTimeOff());
    } catch (reason) {
      setError(saved ? "Your request was submitted. Reload the page to update recent requests."
        : reason instanceof Error && !(reason instanceof TypeError || reason instanceof SyntaxError) ? reason.message
        : "Could not confirm submission. Try submitting the same request again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <form className="my-time-off-form" onSubmit={submit}>
    <fieldset disabled={saving}>
      <legend>Request details</legend>
      <label>Category<select value={category} onChange={event => {
        const value = event.target.value as LeaveCategory;
        setCategory(value);
        setReason(value === "sick" ? "sick_emergency" : "vacation");
      }}>{Object.entries(leaveCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="my-time-off-whole-day"><input type="checkbox" checked={wholeDay} onChange={event => setWholeDay(event.target.checked)} />Whole day</label>
      <div className="my-time-off-fields">
        <label>{wholeDay ? "First day off" : "Date"}<input type="date" value={startDate} onChange={event => {
          setStartDate(event.target.value);
          if (endDate < event.target.value) setEndDate(event.target.value);
        }} required /></label>
        {wholeDay ? <label>Last day off<input type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} required /></label>
          : <><label>Start time<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} required /></label>
            <label>End time<input type="time" value={endTime} onChange={event => setEndTime(event.target.value)} required /></label></>}
      </div>
      <p aria-live="polite">{minutes ? `${hoursLabel(minutes)} requested` : wholeDay ? "Choose dates." : "Enter the hours you need off."}{wholeDay ? " · 8 hours per day" : ""}</p>
      <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>
        <option value="vacation">Vacation / personal</option><option value="sick_emergency">Sick / emergency</option>
      </select></label>
      <label>Note for your manager (optional)<textarea rows={3} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>
      <button type="submit">{saving ? "Submitting…" : "Submit request"}</button>
    </fieldset>
    {error ? <p role="alert" className="my-profile-error">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
