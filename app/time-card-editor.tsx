"use client";

import type { FormEvent } from "react";
import { timeCardBounds, timeCardPreview, validateTimeCard } from "./timesheets-model";
import type { TimeCardBreak, TimeCardDraft, TimeCardEdit, TimesheetEmployee } from "./timesheets-model";

type Props = {
  draft: TimeCardDraft;
  employees: TimesheetEmployee[];
  roles: string[];
  locationName: string;
  history: TimeCardEdit[];
  today: string;
  now: number;
  error: string;
  onChange: (draft: TimeCardDraft) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onBreakSettings: () => void;
  onAdjust?: () => void;
};

function SectionIcon({ name }: { name: "clock" | "break" | "pin" | "history" | "calendar" }) {
  return <svg className="ts-card-section-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 3" /></> : name === "break" ? <><path d="M3 9h13v7a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><path d="M16 10h2a3 3 0 0 1 0 6h-2M7 2c-3 3 3 3 0 6M12 2c-3 3 3 3 0 6" /></> : name === "pin" ? <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></> : name === "history" ? <><path d="M4 8a9 9 0 1 1 0 8M4 3v5h5M12 7v5l3 2" /></> : <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>}
  </svg>;
}
function duration(minutes: number) {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)} hr ${total % 60} min`;
}

export function TimeCardEditor(props: Props) {
  const { draft, onChange } = props;
  const preview = timeCardPreview(draft);
  const breaks = draft.breaks ?? [];
  const incomplete = !draft.employeeId || !draft.date || !draft.start || !draft.end || breaks.some(entry => !entry.start || !entry.end);
  const validation = incomplete ? "" : validateTimeCard(draft, [], props.now);
  const history = [...props.history].reverse();

  function updateBreak(id: number, change: Partial<TimeCardBreak>) {
    onChange({ ...draft, breaks: breaks.map(entry => entry.id === id ? { ...entry, ...change } : entry) });
  }
  function addBreak() {
    const bounds = timeCardBounds(draft);
    const valid = Number.isFinite(bounds.start) && Number.isFinite(bounds.end) && bounds.end - bounds.start > 30 * 60000;
    // Suggest an interval only for the first break; additional breaks need explicit times.
    const midpoint = valid && !breaks.length ? new Date(bounds.start + (bounds.end - bounds.start - 30 * 60000) / 2) : null;
    const end = midpoint ? new Date(midpoint.getTime() + 30 * 60000) : null;
    const time = (value: Date | null) => value ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` : "";
    onChange({ ...draft, breaks: [...breaks, {
      id: Math.max(0, ...breaks.map(entry => entry.id)) + 1,
      start: time(midpoint), end: time(end), nextDay: midpoint ? midpoint.getDate() !== new Date(`${draft.date}T12:00:00`).getDate() : false,
    }] });
  }

  return <form className="ts-card-form" onSubmit={props.onSubmit}>
    <h2 className="sr-only" id="ts-dialog-title">{draft.eventIds.length ? "Edit time card" : "Add time card"}</h2>
    <button className="ts-card-close" type="button" onClick={props.onClose} aria-label="Close time card editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M20 4 4 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
    <div className="ts-card-main">
      <div className="ts-card-identity">
        <label className="ts-card-date"><SectionIcon name="calendar" /><span>{draft.date ? new Date(`${draft.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "Select date"}</span><input type="date" aria-label="Time card date" required max={props.today} value={draft.date} onInput={event => onChange({ ...draft, date: event.currentTarget.value })} /></label>
        <select className={draft.employeeId ? "" : "is-placeholder"} aria-label="Employee Name" value={draft.employeeId} disabled={draft.eventIds.length > 0} onChange={event => {
          const employeeId = Number(event.target.value);
          onChange({ ...draft, employeeId, role: props.employees.find(employee => employee.id === employeeId)?.role ?? "" });
        }}><option value={0} disabled>Employee Name</option>{props.employees.filter(employee => employee.active || employee.id === draft.employeeId).map(employee => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select>
        <select className={draft.role ? "" : "is-placeholder"} aria-label="Time card role" value={draft.role} onChange={event => onChange({ ...draft, role: event.target.value })}><option value="">Role</option>{props.roles.map(role => <option key={role}>{role}</option>)}</select>
        <span className="ts-card-location">at {props.locationName}</span>
      </div>
      <div className="ts-card-sections">
        <section className="ts-card-section" aria-labelledby="ts-card-worked-title">
          <SectionIcon name="clock" />
          <div className="ts-card-section-content">
            <h3 id="ts-card-worked-title">Worked ({duration(preview.workedMinutes)})</h3>
            <div className="ts-card-clock-fields">
              <label>Clocked in<input type="time" required value={draft.start} onInput={event => onChange({ ...draft, start: event.currentTarget.value })} /></label>
              <span aria-hidden="true">–</span>
              <label>Clocked out<input type="time" required value={draft.end} onInput={event => onChange({ ...draft, end: event.currentTarget.value })} /></label>
            </div>
            <label className="ts-card-overnight"><input type="checkbox" checked={draft.nextDay} onChange={event => onChange({ ...draft, nextDay: event.target.checked })} />Clock out the next day</label>
          </div>
        </section>
        <section className="ts-card-section" aria-labelledby="ts-card-breaks-title">
          <SectionIcon name="break" />
          <div className="ts-card-section-content">
            <h3 id="ts-card-breaks-title">Breaks ({breaks.length})</h3>
            <h4>Rest breaks (0 min)</h4>
            <div className="ts-card-break-notice"><span className="ts-card-info" aria-hidden="true">i</span><span>Set up your paid breaks in Settings.</span><button type="button" onClick={props.onBreakSettings}>Go to Settings</button></div>
            <h4>Meal breaks ({Math.round(preview.breakMinutes)} min)</h4>
            <div className="ts-card-break-list">{breaks.map((entry, index) => <div className="ts-card-break-entry" key={entry.id}>
              <div className="ts-card-break-times"><label><span className="sr-only">Meal break {index + 1} start</span><input type="time" required value={entry.start} onInput={event => updateBreak(entry.id, { start: event.currentTarget.value })} /></label><span aria-hidden="true">–</span><label><span className="sr-only">Meal break {index + 1} end</span><input type="time" required value={entry.end} onInput={event => updateBreak(entry.id, { end: event.currentTarget.value })} /></label><button type="button" className="ts-card-remove-break" aria-label={`Remove meal break ${index + 1}`} onClick={() => onChange({ ...draft, breaks: breaks.filter(value => value.id !== entry.id) })}>×</button></div>
              {draft.nextDay ? <label className="ts-card-overnight"><input type="checkbox" checked={entry.nextDay} onChange={event => updateBreak(entry.id, { nextDay: event.target.checked })} />Break starts the next day</label> : null}
            </div>)}</div>
            <button className="ts-card-add-break" type="button" onClick={addBreak}><span aria-hidden="true">＋</span>Add a break</button>
          </div>
        </section>
        <section className="ts-card-section ts-card-validation" aria-labelledby="ts-card-validation-title">
          <SectionIcon name="pin" /><div className="ts-card-section-content"><h3 id="ts-card-validation-title">Photo &amp; GPS validation (0)</h3><span className="sr-only">No photo or GPS records are available for this card.</span></div>
        </section>
        <section className="ts-card-section ts-card-history-section" aria-label="Time card edit history">
          <SectionIcon name="history" /><details className="ts-card-history ts-card-section-content"><summary><h3>Edit history ({history.length})</h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></summary><div className="ts-card-history-entries">{history.length ? history.map(edit => <article key={edit.id}><strong>{edit.actor}</strong><time dateTime={edit.at}>{new Date(edit.at).toLocaleString()}</time><p>{edit.before || "New time card"} → {edit.after}</p></article>) : <p>No changes saved yet.</p>}</div></details>
        </section>
        <details className="ts-card-note"><summary>Add a note</summary><label><span className="sr-only">Time card note</span><textarea value={draft.note} placeholder="Reason for adding or editing this card" onChange={event => onChange({ ...draft, note: event.target.value })} /></label></details>
        {props.error || validation ? <p className="ts-form-error" role="alert">{props.error || validation}</p> : null}
      </div>
    </div>
    <div className="ts-card-footer"><button className="ts-card-cancel" type="button" onClick={props.onClose}>Cancel</button>{props.onAdjust ? <button className="ts-text-button" type="button" onClick={props.onAdjust}>Adjust daily hours</button> : null}<button type="submit" className="ts-primary" disabled={incomplete || Boolean(validation)}>Save changes</button></div>
  </form>;
}
