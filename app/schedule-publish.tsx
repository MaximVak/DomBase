"use client";
import { useEffect, useRef, useState } from "react";
import { useSharedWorkspace } from "./shared-workspace";
import { offsetScheduleDate } from "./schedule-tools-model";
import type { PublishOptions, PublishPreview, PublicationDelivery } from "./schedule-publish-model";
import { ScheduleWarningPanel } from "./schedule-warning-panel";
export function SchedulePublishControl({ count, weekStart, onOpenChange, onPublished }: { count: number; weekStart: string; onOpenChange: (open: boolean) => void; onPublished: () => void }) {
  const [open, setOpen] = useState(false), shared = useSharedWorkspace();
  const close = () => { if (shared.pending) return; setOpen(false); onOpenChange(false); };
  return <><button type="button" className={`shift-publish-button${count > 0 ? " pending" : ""}`} disabled={shared.pending} onClick={() => { setOpen(true); onOpenChange(true); }}>{count ? `↑ Publish (${count})` : "Publish & notices"}</button>{open ? <PublishDialog weekStart={weekStart} onClose={close} onPublished={onPublished} /> : null}</>;
}
function PublishDialog({ weekStart, onClose, onPublished }: { weekStart: string; onClose: () => void; onPublished: () => void }) {
  const shared = useSharedWorkspace(), dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null), [allDates, setAllDates] = useState(false), [notify, setNotify] = useState<PublishOptions["notify"]>("changed"), [inApp, setInApp] = useState(true), [email, setEmail] = useState(shared.data.scheduleDelivery?.emailConfigured === true);
  const [reviewLatest, setReviewLatest] = useState(false), [attempt, setAttempt] = useState(0), [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ key: string; data: PublishPreview | null; error: string }>({ key: "", data: null, error: "" });
  const options: PublishOptions = { departmentId, period: allDates ? null : { start: weekStart, end: offsetScheduleDate(weekStart, 6) }, notify, inApp, email }, key = JSON.stringify({ revision: shared.data.revision, options });
  const data = result.key === key ? result.data : null, error = result.key === key ? result.error : "", loading = !data && !error;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; dialog.current?.showModal(); closeButton.current?.focus(); return () => { document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(), timer = window.setTimeout(() => {
      void fetch("/api/workspace/publish-preview", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: key, signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not review publication."); if (!controller.signal.aborted) setResult({ key, data: value, error: "" }); }).catch(reason => { if (!controller.signal.aborted) setResult({ key, data: null, error: reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "Could not load the review. No changes were published." }); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, attempt]);
  function changed() { setReviewLatest(false); setNotice(""); }
  async function publish() {
    if (!data || !data.changes || data.issues.length || (data.needsReview && !reviewLatest)) return;
    const draft = shared.data.state.scheduleDraftsByManager[Object.keys(shared.data.state.scheduleDraftsByManager).map(Number)[0]];
    if (!draft) return;
    const success = await shared.save([{ entity: "schedule-publish", id: 1, before: draft, after: { publish: true, ...options, reviewLatest, reviewToken: data.reviewToken } }]);
    if (success) { setNotice(`Published ${data.changes} ${data.changes === 1 ? "change" : "changes"}. ${data.remaining} draft changes remain outside this selection.`); setReviewLatest(false); onPublished(); }
  }
  return <dialog ref={dialog} className="schedule-tools-dialog schedule-publish-dialog" aria-labelledby="publish-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="publish-title">Review publication</h2><p>Choose what to publish and who receives a notice.</p></div><button type="button" ref={closeButton} className="icon-button" aria-label="Close publication review" disabled={shared.pending} onClick={onClose}>×</button></header>
    {notice ? <p role="status" className="schedule-publish-success">{notice}</p> : null}
    <div className="schedule-tools-content"><section aria-label="Publication choices"><h3>Draft changes</h3>
      <label>Publish department<select disabled={shared.pending} value={departmentId ?? ""} onChange={event => { setDepartmentId(event.target.value ? Number(event.target.value) : null); changed(); }}><option value="">All departments I can manage</option>{shared.data.state.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      <label className="schedule-tool-check"><input type="checkbox" disabled={shared.pending} checked={allDates} onChange={event => { setAllDates(event.target.checked); changed(); }} />Publish all draft dates</label><p>{allDates ? "All dates in this department selection. Other departments remain in draft." : `Current workweek only: ${weekStart} – ${offsetScheduleDate(weekStart, 6)}. Other weeks remain in draft.`}</p>
      <label>Notify employees<select disabled={shared.pending} value={notify} onChange={event => { setNotify(event.target.value as PublishOptions["notify"]); changed(); }}><option value="changed">Changed people only</option><option value="all">All active people in this department selection</option><option value="none">Nobody — publish without notices</option></select></label>
      <label className="schedule-tool-check"><input type="checkbox" checked={inApp} disabled={shared.pending || notify === "none"} onChange={event => { setInApp(event.target.checked); changed(); }} />In-app schedule notices</label>
      <label className="schedule-tool-check"><input type="checkbox" checked={email} disabled={shared.pending || notify === "none" || !shared.data.scheduleDelivery?.emailConfigured} onChange={event => { setEmail(event.target.checked); changed(); }} />Email employees who have an email address</label>
      {!shared.data.scheduleDelivery?.emailConfigured ? <p>Email delivery is unavailable in this environment. In-app notices remain available.</p> : null}<p>Employee alert preferences are respected. A shared email address receives one email per publication. SMS is not included.</p>
    </section>
    {loading ? <p role="status">Checking publication, recipients and conflicts…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setResult({ key: "", data: null, error: "" }); setAttempt(value => value + 1); }}>Retry review</button><button type="button" onClick={() => { shared.setError("Reload the latest shared data before reviewing publication again."); onClose(); }}>Close and reload workspace</button></div> : data ? <>
      <section aria-label="Publication summary"><h3>{data.changes} draft changes selected</h3><p>{data.remaining} changes will remain in draft.</p>{!data.masterEnabled ? <p>Company schedule alerts are disabled. This publication will not send notices.</p> : null}
        <p><strong>{data.recipients.filter(person => person.inApp).length} in-app notices · {data.emailDestinations} emails</strong></p>{data.missingEmail ? <p>{data.missingEmail} people have no valid email address; email cannot reach them.</p> : null}{data.optedOut ? <p>{data.optedOut} people are excluded by alert preferences.</p> : null}
        <details><summary>Review selected people ({data.recipients.length})</summary><ul className="schedule-tool-entry-list">{data.recipients.map(person => <li key={person.employeeId}>{person.name} · {[person.inApp ? "In-app" : "", person.email ? "Email" : ""].filter(Boolean).join(" + ") || "No available delivery channel"}</li>)}</ul></details>
        <details><summary>Review draft entries ({data.entries.length})</summary><ul className="schedule-tool-entry-list">{data.entries.map(entry => <li key={entry.id}><strong>{entry.employee} · {entry.action}</strong><span>Published: {entry.before}</span><span>After publishing: {entry.after}</span></li>)}</ul></details>
        {data.warnings && data.shifts.length ? <ScheduleWarningPanel result={{ data: data.warnings, error: "", pending: false, retry: () => {} }} shifts={data.shifts} employees={shared.data.state.employees} label="Warnings for selected draft work" /> : null}
        {data.issues.length ? <ul role="alert">{data.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
        {data.needsReview ? <label className="schedule-tool-check"><input type="checkbox" checked={reviewLatest} disabled={shared.pending} onChange={event => setReviewLatest(event.target.checked)} />Another manager published since this draft started. I reviewed the current published entries above and want to publish this selection.</label> : null}
        <button type="button" className="primary-action" disabled={shared.pending || !data.changes || !!data.issues.length || (data.needsReview && !reviewLatest)} onClick={() => void publish()}>Publish selected changes</button><p>Conflict warnings are advisory. Overlapping work and access changes must be resolved before publishing.</p>
      </section>
      {data.latest ? <PublicationDeliveryStatus value={data.latest} onRefresh={() => setAttempt(value => value + 1)} /> : null}
    </> : null}</div>
  </dialog>;
}
function PublicationDeliveryStatus({ value, onRefresh }: { value: PublicationDelivery; onRefresh: () => void }) {
  return <section aria-label="Latest publication delivery"><h3>Your latest publication · version {value.version}</h3><p>{value.department}{value.period ? ` · ${value.period.start} – ${value.period.end}` : ""}</p><p>{value.inAppCount} in-app notices · {value.emails.accepted} emails accepted · {value.emails.pending + value.emails.sending} emails pending</p>
    {value.emails.uncertain ? <p role="alert">Delivery is uncertain for {value.emails.uncertain} emails. Check the recipient inbox before arranging another send; uncertain emails are not sent again automatically.</p> : null}{value.emails.cancelled ? <p>{value.emails.cancelled} emails were cancelled because recipient details or preferences changed.</p> : null}<p>Accepted means the email provider accepted the message; it does not confirm inbox delivery.</p>
    <details><summary>View individual notice status</summary><ul className="schedule-tool-entry-list">{value.recipients.map(person => <li key={person.employeeId}>{person.name} · In-app: {person.inApp ? "created" : "not requested"} · Email: {person.email.replaceAll("_", " ")}</li>)}</ul></details><button type="button" onClick={onRefresh}>Refresh notice status</button>
  </section>;
}
