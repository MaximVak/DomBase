"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { noShowReasons, reviewBatchLimit } from "../workforce/timesheet-review-types";
import type { ReviewAction, ReviewItem, TimesheetReview } from "../workforce/timesheet-review-types";
import { saveId } from "./team/client";

type View = "needs-review" | "looking-good" | "resolved-no-show";
type Grouping = "role" | "department" | "member" | "date";
type Props = {
  start: string;
  end: string;
  timeZone?: string;
  daily: boolean;
  revision: number;
  canManage: boolean;
  roles: string[];
  search: string;
  grouping: Grouping;
  onOpenCard: (item: ReviewItem, button: HTMLButtonElement) => boolean;
};
const endpoint = "/api/workspace/timesheet-review";
const views: { id: View; label: string }[] = [
  { id: "needs-review", label: "Needs review" },
  { id: "looking-good", label: "Looking good" },
  { id: "resolved-no-show", label: "Resolved no-shows" },
];

async function reviewRequest<T>(suffix: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint + suffix, { cache: "no-store", ...init });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Timesheets could not complete the review.");
  return result;
}

export function TimesheetReviewPanel({ start, end, timeZone, daily, revision, canManage, roles, search, grouping, onOpenCard }: Props) {
  const [data, setData] = useState<TimesheetReview>();
  const [view, setView] = useState<View>("needs-review");
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [reasonTarget, setReasonTarget] = useState("");
  const reasonLabel = useId();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const mutation = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    const query = "?" + new URLSearchParams({ start, end });
    async function load() {
      if (reading || mutation.current) return;
      reading = true;
      try {
        const value = await reviewRequest<TimesheetReview>(query, { signal: controller.signal });
        if (!controller.signal.aborted && !mutation.current) { setData(value); setLoadError(""); }
      } catch (error) {
        if (!controller.signal.aborted && !mutation.current) setLoadError(error instanceof Error ? error.message : "Review could not load.");
      } finally { reading = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    const focus = () => { void load(); };
    window.addEventListener("focus", focus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [start, end, revision, refresh]);

  const items = (data?.items ?? []).filter(item => (!roles.length || roles.includes(item.role))
    && item.employee.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = {
    "needs-review": items.filter(item => item.status === "needs-review"),
    "looking-good": items.filter(item => item.status === "ready" || item.status === "approved"),
    "resolved-no-show": items.filter(item => item.status === "resolved-no-show"),
  };
  const available = groups[view];
  const awaiting = items.filter(item => item.kind === "card" && item.status !== "approved");
  const ready = items.filter(item => item.status === "ready" && item.allowedAction === "approve");
  const eligible = available.filter(item => item.allowedAction === "resolve" || item.allowedAction === "approve");
  const selected = eligible.filter(item => selection[item.key] === item.version);
  const selectedAction = selected[0]?.allowedAction;
  const grouped = new Map<string, ReviewItem[]>();
  for (const item of available) {
    const value = grouping === "department" ? item.department : grouping === "role" ? item.role : "";
    const group = grouped.get(value) ?? [];
    group.push(item);
    grouped.set(value, group);
  }
  const dateLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"));
  const timeLabel = (value: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));

  function choose(next: View) { setExpanded(!expanded || view !== next); setView(next); setSelection({}); setReasonTarget(""); }
  function toggle(item: ReviewItem) {
    setSelection(current => {
      const next = { ...current };
      if (next[item.key] === item.version) delete next[item.key];
      else next[item.key] = item.version;
      return next;
    });
  }

  async function submit(action: ReviewAction, targets: ReviewItem[], absence?: { reason: string; note: string }) {
    if (!targets.length || targets.length > reviewBatchLimit || mutation.current || loadError) return;
    mutation.current = true;
    setPending(true); setSaveError(""); setStatus("");
    try {
      const result = await reviewRequest<{ saved: boolean; count: number }>("", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: saveId(), period: { start, end }, action, targets: targets.map(({ key, version }) => ({ key, version })), ...absence }),
      });
      const noun = result.count === 1 ? "card" : "cards";
      setStatus(action === "no_show" ? "No-show reason saved." : `${result.count} time ${noun} ${action === "approve" ? "approved" : "marked reviewed"}.`);
      setSelection({}); setReasonTarget("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Review could not be saved.");
    } finally {
      mutation.current = false;
      setData(undefined);
      setPending(false);
      setRefresh(value => value + 1);
    }
  }

  function saveAbsence(event: FormEvent, item: ReviewItem) {
    event.preventDefault();
    if (reason) void submit("no_show", [item], { reason, note });
  }

  return <section className="ts-assistant" aria-label="Timesheet review assistant">
    <div className="ts-assistant-bar">
      <div className="ts-assistant-views" role="group" aria-label="Review groups">
        {views.map(group => group.id === "resolved-no-show" && !groups[group.id].length ? null :
          <button type="button" key={group.id} aria-expanded={expanded && view === group.id} onClick={() => choose(group.id)}>
            {group.label}{data ? ` (${groups[group.id].length})` : ""}
          </button>)}
      </div>
      {canManage ? <button type="button" className="ts-primary" title="Approve the ready cards in this view" disabled={pending || !data || Boolean(loadError) || !ready.length || ready.length > reviewBatchLimit}
        onClick={() => void submit("approve", ready)}>
        {daily ? "Approve day" : "Approve pay period"}{ready.length ? ` (${ready.length})` : ""}
      </button> : null}
    </div>
    {data && awaiting.length > 0 && <p className="ts-assistant-alert" role="status">
      {awaiting.length} {awaiting.length === 1 ? "time card has" : "time cards have"} unapproved hours.
      {groups["needs-review"].length ? ` ${groups["needs-review"].length} ${groups["needs-review"].length === 1 ? "item needs" : "items need"} attention.` : ""}
    </p>}
    {status && <p role="status">{status}</p>}
    {saveError && <p role="alert">{saveError}</p>}
    {loadError ? <p role="alert">{loadError} <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh review</button></p> :
      !data ? <p role="status">{pending ? "Saving review…" : "Loading time-card review…"}</p> : null}
    {ready.length > reviewBatchLimit ? <p>Approve up to {reviewBatchLimit} cards at a time using a shorter date range or a role filter.</p> : null}
    {expanded && data ? <div className="ts-assistant-results" aria-label={views.find(group => group.id === view)?.label}>
      {eligible.length > 1 && eligible.length <= reviewBatchLimit ? <button type="button" className="ts-text-button" disabled={pending || Boolean(loadError)}
        onClick={() => setSelection(selected.length === eligible.length ? {} : Object.fromEntries(eligible.map(item => [item.key, item.version])))}>
        {selected.length === eligible.length ? "Clear selection" : "Select all eligible"}
      </button> : null}
      {selectedAction && selectedAction !== "no_show" ? <button type="button" className="secondary-action"
        disabled={pending || Boolean(loadError) || selected.length > reviewBatchLimit} onClick={() => void submit(selectedAction, selected)}>
        {selectedAction === "approve" ? "Approve selected" : "Resolve selected"} ({selected.length})
      </button> : null}
      {!available.length && <p>{view === "needs-review" ? "No items need review in this view." : "No cards in this group."}</p>}
      {[...grouped.entries()].map(([name, group]) => <div className="ts-assistant-group" key={name}>
        {name && <h3>{name}</h3>}
        {group.map(item => <article className="ts-assistant-item" key={item.key}>
          <div>
            <strong>{item.employee}</strong>
            <p>{dateLabel(item.date)} · {item.role || "Unassigned"} · {timeLabel(item.start)}{item.end ? ` – ${timeLabel(item.end)}` : " · Open"}</p>
            {item.status === "approved" || item.status === "resolved-no-show" ? <p>{item.status === "approved" ? "Approved" : item.decision?.reason} · {item.decision?.actor}</p> : null}
            {item.status === "needs-review" && item.issues.length ? <p>{item.issues.join(" · ")}</p> : null}
            {item.status === "ready" && item.decision ? <p>Issues reviewed by {item.decision.actor}</p> : null}
            {item.status === "resolved-no-show" && item.decision?.note ? <p className="ts-assistant-note">{item.decision.note}</p> : null}
          </div>
          <div className="ts-assistant-item-actions">
            {(item.allowedAction === "resolve" || item.allowedAction === "approve") && <label>
              <input type="checkbox" checked={selection[item.key] === item.version} disabled={pending || Boolean(loadError)} onChange={() => toggle(item)} />
              {item.allowedAction === "approve" ? "Select for approval" : "Select to resolve"}<span className="sr-only"> for {item.employee} on {dateLabel(item.date)}</span>
            </label>}
            {item.kind === "card" || item.allowedAction === "no_show" ? <button type="button" className="ts-text-button" disabled={pending}
              onClick={event => { if (!onOpenCard(item, event.currentTarget)) setSaveError("This card is updating. Refresh the review and try again."); }}>{item.kind === "card" ? "Open time card" : "Add missing time"}</button> : null}
            {item.allowedAction === "no_show" && <button type="button" className="secondary-action" disabled={pending || Boolean(loadError)}
              onClick={() => { setReasonTarget(item.key); setReason(""); setNote(""); }}>Add no-show reason</button>}
          </div>
          {reasonTarget === item.key && item.allowedAction === "no_show" && <form className="ts-assistant-reason" onSubmit={event => saveAbsence(event, item)}>
            <label><span id={reasonLabel}>Reason</span><select aria-labelledby={reasonLabel} value={reason} onChange={event => setReason(event.target.value)} required>
              <option value="">Choose a reason</option>{noShowReasons.map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label>Manager note (optional)<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
            <div><button type="button" disabled={pending} onClick={() => setReasonTarget("")}>Cancel</button>
              <button type="submit" className="ts-primary" disabled={pending || Boolean(loadError) || !reason}>Save reason</button></div>
          </form>}
        </article>)}
      </div>)}
    </div> : null}
  </section>;
}
