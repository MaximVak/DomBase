"use client";
import { useRef, useState, useEffect } from "react";
import { useSharedWorkspace } from "./shared-workspace";
import type { ClearWeekPreview, ScheduleSelection } from "./schedule-tools-model";
export function ScheduleClearWeek({ weekStart, selection, includeNotes, onReady }: { weekStart: string; selection: ScheduleSelection; includeNotes: boolean; onReady: () => void }) {
  const shared = useSharedWorkspace(), [saveTemplate, setSaveTemplate] = useState(true), [name, setName] = useState(`Week of ${weekStart}`), [confirmed, setConfirmed] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ key: string; value: ClearWeekPreview } | null>(null), request = useRef<AbortController | null>(null);
  const choice = { revision: shared.data.revision, weekStart, selection, templateName: saveTemplate ? name.trim() : null, includeNotes }, key = JSON.stringify(choice), preview = result?.key === key ? result.value : null;
  useEffect(() => () => request.current?.abort(), []);
  async function review() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setChecking(true); setError(""); setConfirmed(false); setResult(null);
    try { const response = await fetch("/api/workspace/schedule-tools", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ action: "clear-preview", ...choice }), signal: controller.signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not review this week."); if (!controller.signal.aborted) setResult({ key, value }); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the clearing review. No changes were saved."); } finally { if (!controller.signal.aborted) setChecking(false); }
  }
  async function clear() { if (!preview || !confirmed || preview.issues.length) return; const result = await shared.scheduleTool({ action: "clear", ...choice, reviewToken: preview.reviewToken }); if (result) onReady(); else setError("Clearing was not confirmed. Check the workspace message and reload before retrying."); }
  return <section aria-label="Clear selected workweek"><h3>Save a template before clearing</h3><p>Only the current workweek and selection above are cleared. Published shifts remain visible to employees until you publish the draft.</p>
    <label className="schedule-tool-check"><input type="checkbox" checked={saveTemplate} disabled={shared.pending || checking} onChange={event => { setSaveTemplate(event.target.checked); setConfirmed(false); }} />Save the selected entries as a template before clearing</label>
    {saveTemplate ? <label>Saved template name<input value={name} maxLength={100} disabled={shared.pending || checking} onChange={event => { setName(event.target.value); setConfirmed(false); }} /></label> : <p>You chose to skip saving a template.</p>}
    <button type="button" disabled={shared.pending || checking || (saveTemplate && !name.trim())} onClick={() => void review()}>{checking ? "Checking…" : "Review clearing this week"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {preview ? <div className="schedule-tool-review"><h3>Review clearing {preview.cleared} entries</h3><p>{preview.publishedRemovals} published entries will be removed when you publish. {preview.discardedDraftEntries} draft entries will be discarded. Other dates and selections are preserved.</p><p>{saveTemplate ? `${preview.templateEntries} entries will be saved as “${name}” in the same save.` : "No template will be saved."} Actual punches stay unchanged.</p>
      <details><summary>View entries to clear</summary><ul className="schedule-tool-entry-list">{preview.entries.map(entry => <li key={entry.id}><strong>{entry.employee}</strong><span>{entry.date} · {entry.label}</span></li>)}</ul></details>
      {preview.issues.length ? <ul role="alert">{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      <label className="schedule-tool-check"><input type="checkbox" checked={confirmed} disabled={shared.pending || !!preview.issues.length} onChange={event => setConfirmed(event.target.checked)} />Clear these selected entries in my draft.</label><button type="button" className="primary-action" disabled={shared.pending || !confirmed || !!preview.issues.length || !preview.cleared} onClick={() => void clear()}>Save clearing to my draft</button>
    </div> : result ? <p role="status">Choices changed. Review this week again before clearing.</p> : null}
  </section>;
}
