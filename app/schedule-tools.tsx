"use client";
import { useEffect, useRef, useState } from "react";
import { useSharedWorkspace } from "./shared-workspace";
import { ScheduleClearWeek } from "./schedule-clear-week";
import { ScheduleToolsSelection } from "./schedule-tools-selection";
import { ScheduleWarningPanel } from "./schedule-warning-panel";
import { offsetScheduleDate, repeatScheduleWeeks, weekFor } from "./schedule-tools-model";
import type { ScheduleSelection, ScheduleToolChoice, ScheduleToolList, ScheduleToolPreview, TemplateSummary } from "./schedule-tools-model";

async function readTool<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/workspace/schedule-tools", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load schedule tools."); return data;
}
export function ScheduleTools({ weekStart, enabled, onOpenChange, onDraftReady }: { weekStart: string; enabled: boolean; onOpenChange: (open: boolean) => void; onDraftReady: (date: string) => void }) {
  const shared = useSharedWorkspace();
  const [open, setOpen] = useState(false);
  const close = () => { if (shared.pending) return; setOpen(false); onOpenChange(false); };
  return <>
    <button type="button" className="shift-filter-button" disabled={!enabled || shared.pending} title={enabled ? "Save templates, copy a week or repeat upcoming weeks" : "Switch to Week view to use templates and copy"} onClick={() => { setOpen(true); onOpenChange(true); }}>Templates & copy</button>
    {open ? <ScheduleToolsDialog weekStart={weekStart} onClose={close} onDraftReady={onDraftReady} /> : null}
  </>;
}
function ScheduleToolsDialog({ weekStart, onClose, onDraftReady }: { weekStart: string; onClose: () => void; onDraftReady: (date: string) => void }) {
  const shared = useSharedWorkspace(), dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<"templates" | "copy" | "repeat" | "clear">("templates");
  const [archived, setArchived] = useState(false), [list, setList] = useState<ScheduleToolList | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState<TemplateSummary | null>(null), [name, setName] = useState("");
  const [from, setFrom] = useState(weekStart), [target, setTarget] = useState(weekStart), [count, setCount] = useState(1);
  const [selection, setSelection] = useState<ScheduleSelection>({ departmentId: null, roleId: null, employeeIds: null });
  const [mode, setMode] = useState<"add" | "replace">("add"), [notes, setNotes] = useState(false), [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [review, setReview] = useState<{ key: string; value: ScheduleToolPreview } | null>(null), [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null), mounted = useRef(true);
  const canNotes = shared.data.permissions["schedule.notes.read"] && shared.data.permissions["schedule.notes.manage"];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; dialog.current?.showModal(); closeButton.current?.focus(); mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readTool<ScheduleToolList>({ action: "list", archived }, controller.signal).then(value => { if (!controller.signal.aborted) { setList(value); setLoading(false); } }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Templates could not load."); setLoading(false); } });
    return () => controller.abort();
  }, [archived, attempt]);
  const sourceWeek = from ? weekFor(from, shared.data.settings.workWeekStart) : "";
  const targetWeek = target ? weekFor(target, shared.data.settings.workWeekStart) : "";
  const choice: ScheduleToolChoice = { revision: shared.data.revision, source: tab === "templates" ? { kind: "template", id: selected?.id ?? 0 } : { kind: "week", weekStart: sourceWeek }, targets: tab === "repeat" ? repeatScheduleWeeks(sourceWeek || weekStart, count) : [targetWeek], selection, mode, includeNotes: notes && canNotes };
  const key = JSON.stringify(choice), preview = review?.key === key ? review.value : null;
  const disabled = shared.pending || checking || loading;
  function changeTab(next: typeof tab) { request.current?.abort(); setChecking(false); setTab(next); setReview(null); setError(""); setNotice(""); setReplaceConfirmed(false); setTarget(next === "templates" ? weekStart : offsetScheduleDate(sourceWeek || weekStart, 7)); }
  async function loadMore() {
    if (!list?.nextCursor) return; setChecking(true); setError("");
    try { const next = await readTool<ScheduleToolList>({ action: "list", archived, cursor: list.nextCursor }); if (mounted.current) setList({ ...next, templates: [...list.templates, ...next.templates] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more templates."); } finally { if (mounted.current) setChecking(false); }
  }
  async function saveTemplate(action: "save-template" | "rename-template" | "archive-template", replace = false) {
    setError(""); setNotice("");
    const body = action === "save-template" ? { name, weekStart, selection, includeNotes: notes && canNotes, ...(replace && selected ? { templateId: selected.id } : {}) } : action === "rename-template" ? { name, templateId: selected?.id } : { templateId: selected?.id, archived: !archived };
    const result = await shared.scheduleTool({ action, revision: shared.data.revision, ...body });
    if (!mounted.current) return;
    if (!result) { setError("This operation was not confirmed. Check the message above the workspace; close and reload before retrying if requested."); return; }
    setReview(null); setSelected(null); setName(""); setLoading(true); setAttempt(value => value + 1); setNotice(action === "archive-template" ? archived ? "Template restored." : "Template archived. It remains available in archived templates." : "Template saved. Published schedules are unchanged.");
  }
  async function previewDraft() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setChecking(true); setError(""); setReview(null); setReplaceConfirmed(false);
    try { const value = await readTool<ScheduleToolPreview>({ action: "preview", ...choice }, controller.signal); if (!controller.signal.aborted) setReview({ key, value }); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The draft preview could not load. No changes were saved."); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  async function apply() {
    if (!preview || preview.issues.length || (mode === "replace" && !replaceConfirmed)) return;
    const result = await shared.scheduleTool({ action: "apply", ...choice, reviewToken: preview.reviewToken });
    if (!result) { setError("Could not confirm the draft. Check the workspace message and reload before trying again."); return; }
    onDraftReady(choice.targets[0]); onClose();
  }
  return <dialog ref={dialog} className="schedule-tools-dialog" aria-labelledby="schedule-tools-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose(); }}>
    <header><div><h2 id="schedule-tools-title">Templates & copy</h2><p>Current workweek: {weekStart} – {offsetScheduleDate(weekStart, 6)}</p></div><button ref={closeButton} type="button" className="icon-button" aria-label="Close schedule tools" disabled={shared.pending} onClick={onClose}>×</button></header>
    <nav className="schedule-tools-tabs" aria-label="Schedule tools">{([ ["templates", "Templates"], ["copy", "Copy week"], ["repeat", "Repeat weeks"], ["clear", "Clear week"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} disabled={shared.pending} onClick={() => changeTab(value)}>{label}</button>)}</nav>
    {error ? <p role="alert" className="schedule-tool-error">{error} <button type="button" disabled={disabled} onClick={() => { shared.setError("Reload the latest shared data before continuing with schedule tools."); onClose(); }}>Close and reload workspace</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="schedule-tools-content" aria-busy={disabled}>
      {tab === "templates" ? <section aria-label="Saved schedule templates"><h3>Saved templates</h3><label className="schedule-tool-check"><input type="checkbox" checked={archived} disabled={disabled} onChange={event => { setArchived(event.target.checked); setSelected(null); setName(""); setList(null); setLoading(true); setError(""); }} />Show archived templates</label>
        {loading ? <p role="status">Loading templates…</p> : list?.templates.length ? <ul className="schedule-template-list">{list.templates.map(template => <li key={template.id}><button type="button" aria-pressed={selected?.id === template.id} disabled={shared.pending} onClick={() => { setSelected(template); setName(template.name); setReview(null); }}><strong>{template.name}</strong><span>{template.entries} entries{template.archived ? " · archived" : ""}</span></button></li>)}</ul> : <p>No {archived ? "archived" : "saved"} templates. Save the current week below to reuse it.</p>}
        {list?.nextCursor ? <button type="button" disabled={disabled} onClick={() => void loadMore()}>Load more templates</button> : null}
        <label>Template name<input maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Standard workweek" disabled={disabled} /></label>
        <div className="schedule-template-actions"><button type="button" disabled={disabled || !name.trim()} onClick={() => void saveTemplate("save-template")}>Save current week as new template</button>{selected ? <><button type="button" disabled={disabled || !name.trim()} onClick={() => void saveTemplate("rename-template")}>Rename selected template</button><button type="button" disabled={disabled} onClick={() => void saveTemplate("archive-template")}>{archived ? "Restore selected template" : "Archive selected template"}</button></> : null}</div>
        <p>Templates are shared with schedulers who can manage every department and team member they contain. Saving captures the current week, including your draft changes. Dates, leave, punches and pay rates are not copied.</p>
        {selected && !archived ? <details><summary>Replace this saved template</summary><p>This replaces all entries in “{selected.name}” with the selected entries from the current week. Published shifts stay unchanged.</p><button type="button" disabled={disabled || !name.trim()} onClick={() => void saveTemplate("save-template", true)}>Replace selected template with current week</button></details> : null}
      </section> : tab === "copy" || tab === "repeat" ? <section><h3>{tab === "copy" ? "Copy a workweek" : "Repeat a workweek"}</h3><label>Source week<input type="date" value={from} onChange={event => setFrom(event.target.value)} disabled={disabled} /></label><p>{sourceWeek ? `Copies ${sourceWeek} – ${offsetScheduleDate(sourceWeek, 6)}, including your saved draft changes.` : "Choose a source week."}</p>{tab === "repeat" ? <label>Number of following weeks<select value={count} disabled={disabled} onChange={event => setCount(Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option value={value} key={value}>{value} {value === 1 ? "week" : "weeks"}</option>)}</select></label> : null}</section> : null}
      <ScheduleToolsSelection disabled={disabled} value={selection} onChange={value => { setSelection(value); setReplaceConfirmed(false); }} departments={shared.data.state.departments} roles={list?.roles ?? []} employees={shared.data.state.employees} />
      {canNotes ? <label className="schedule-tool-check"><input type="checkbox" checked={notes} disabled={disabled} onChange={event => setNotes(event.target.checked)} />{tab === "clear" ? "Include shift notes in the saved template" : "Include shift notes when saving or copying"}</label> : <p>Shift notes are excluded. Viewing and managing notes are both required to copy them.</p>}
      {tab === "clear" ? <ScheduleClearWeek weekStart={weekStart} selection={selection} includeNotes={notes && canNotes} onReady={() => { onDraftReady(weekStart); onClose(); }} /> : <><section aria-label="Draft destination"><h3>{tab === "templates" ? "Apply selected template" : "Destination"}</h3>{tab !== "repeat" ? <label>Destination week<input type="date" value={target} onChange={event => setTarget(event.target.value)} disabled={disabled} /></label> : null}<p>Target workweeks: {choice.targets.filter(Boolean).join(", ") || "Choose a destination week."}</p>
        <label>Existing entries<select value={mode} disabled={disabled} onChange={event => { setMode(event.target.value as "add" | "replace"); setReplaceConfirmed(false); }}><option value="add">Keep existing entries and add copied shifts</option><option value="replace">Replace entries within my selection in these weeks</option></select></label><p>Nothing is published automatically. Overlapping work and day-off conflicts must be resolved; availability and overtime warnings stay advisory.</p>
        <button type="button" className="primary-action" disabled={disabled || (tab === "templates" ? !selected || archived : !sourceWeek) || choice.targets.some(date => !date)} onClick={() => void previewDraft()}>{checking ? "Checking…" : "Review draft changes"}</button>
      </section>
      {preview ? <ScheduleToolReview preview={preview} mode={mode} confirmed={replaceConfirmed} onConfirm={setReplaceConfirmed} onApply={() => void apply()} disabled={disabled} /> : review ? <p role="status">Choices changed. Review the updated draft before applying.</p> : null}
      </>}
    </div>
  </dialog>;
}
function ScheduleToolReview({ preview, mode, confirmed, onConfirm, onApply, disabled }: { preview: ScheduleToolPreview; mode: "add" | "replace"; confirmed: boolean; onConfirm: (value: boolean) => void; onApply: () => void; disabled: boolean }) {
  const { data } = useSharedWorkspace();
  return <section className="schedule-tool-review" aria-label="Draft changes to review"><h3>Review before saving</h3><p><strong>{preview.added} entries to add · {preview.replaced} existing entries to replace</strong></p><p>Workweeks: {preview.targets.join(", ")}. Your other draft changes are preserved.</p>
    {preview.issues.length ? <div role="alert"><h4>Resolve before copying</h4><ul>{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : <ScheduleWarningPanel result={{ data: preview.warnings, error: "", pending: false, retry: () => {} }} shifts={preview.shifts} employees={data.state.employees} label="Copied schedule warnings" />}
    <details><summary>View resulting schedule entries ({preview.shifts.length})</summary><ul className="schedule-tool-entry-list">{preview.shifts.map(shift => <li key={shift.id}><strong>{data.state.employees.find(employee => employee.id === shift.employeeId)?.name ?? "Team member"}</strong><span>{shift.date} · {shift.shiftType === "day_off" ? "Day off" : `${shift.start}–${shift.end}`} · {shift.role}</span>{shift.notes ? <span>Note: {shift.notes}</span> : null}</li>)}</ul></details>
    {mode === "replace" ? <label className="schedule-tool-check"><input type="checkbox" checked={confirmed} onChange={event => onConfirm(event.target.checked)} disabled={disabled} />Replace the {preview.replaced} selected entries in these target weeks when I publish this draft.</label> : null}
    <button type="button" className="primary-action" disabled={disabled || preview.issues.length > 0 || (mode === "replace" && !confirmed)} onClick={onApply}>Save to my draft</button><p>Review or edit the draft on the calendar, then use Publish when ready.</p>
  </section>;
}
