"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import type { DashboardAccount } from "../auth/types";
import Home from "./workspace";
import type { Change, WorkspaceData, StaffState } from "../workforce/contract";
import { equal } from "../workforce/contract";
import { stateChanges, saveBody } from "../workforce/changes";
import type { UploadDetails } from "../documents/types";
import { maxFileBytes } from "../documents/types";

import type { ScheduleToolResult } from "./schedule-tools-model";

type Period = { start: string; end: string };
type Shared = { scheduleTool: (body: Record<string, unknown>) => Promise<ScheduleToolResult | null>; setPeriod: (period: Period) => void; uploadDocument: (details: Omit<UploadDetails, "id">, file: File) => Promise<boolean>; data: WorkspaceData; pending: boolean; setEditing: (editing: boolean) => void; setState: (update: SetStateAction<StaffState>) => Promise<boolean>; save: (changes: Change[]) => Promise<boolean>; setError: (message: string) => void };
const SharedContext = createContext<Shared | null>(null);
export function useSharedWorkspace() { const value = useContext(SharedContext); if (!value) throw new Error("Shared workspace provider missing."); return value; }
function requestId() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function SharedWorkspace({ account }: { account: DashboardAccount }) {
  const [data, setData] = useState<WorkspaceData | null>(null); const current = useRef<WorkspaceData | null>(null);
  const [pending, setPending] = useState(false); const saving = useRef(false); const editing = useRef(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const period = useRef<Period | null>(null);
  const requestedPeriod = useRef<Period | null>(null);
  const stateUrl = useCallback(() => `/api/workspace/state${period.current ? `?${new URLSearchParams(period.current)}` : ""}`, []);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const uploadRetries = useRef(new Map<string, string>());
  const generation = useRef(0); const mounted = useRef(false); const needsReload = useRef(false);
  const apply = useCallback((value: WorkspaceData) => { current.current = value; setData(value); }, []);
  const load = useCallback(async (force = false, signal?: AbortSignal) => {
    if (!force && (saving.current || editing.current || needsReload.current || document.visibilityState === "hidden")) return;
    const version = generation.current;
    const response = await fetch(stateUrl(), { cache: "no-store", signal });
    if (signal?.aborted || !mounted.current) return;
    if (response.status === 401) { current.current = null; setData(null); window.location.replace("/login"); return; }
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not load shared data.");
    if (version === generation.current && (force || !editing.current) && !saving.current) { apply(result); needsReload.current = false; }
  }, [apply, stateUrl]);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    async function initialize() { await load(true, controller.signal); }
    void initialize().catch(() => { if (!controller.signal.aborted) setError("Could not load shared data. Check your connection and try again."); });
    const refresh = () => { void load().catch(() => { if (mounted.current) setError("Could not refresh shared data. Reload before making another change."); }); };
    const interval = window.setInterval(refresh, 5000); window.addEventListener("focus", refresh);
    const maintenance = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && ["owner", "general_manager"].includes(account.accessLevel) && current.current?.permissions["timesheets.manage"]) {
        void fetch("/api/workspace/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" }).then(response => { if (response.ok) refresh(); }).catch(() => {});
      }
    }, 60000);
    return () => { mounted.current = false; controller.abort(); window.clearInterval(interval); window.clearInterval(maintenance); window.removeEventListener("focus", refresh); };
  }, [load, account.accessLevel]);
  const setPeriod = useCallback((next: Period) => {
    requestedPeriod.current = next;
    if (period.current?.start === next.start && period.current?.end === next.end) return;
    if (saving.current || editing.current) return;
    period.current = next;
    if (current.current?.period?.start === next.start && current.current?.period?.end === next.end) return;
    generation.current++; needsReload.current = true;
    setPeriodLoading(true);
    const selected = generation.current;
    void load(true).then(() => { if (mounted.current && selected === generation.current) setError(""); })
      .catch(error => { if (mounted.current && selected === generation.current) setError(error instanceof Error ? error.message : "Could not load this period."); })
      .finally(() => { if (mounted.current && selected === generation.current) setPeriodLoading(false); });
  }, [load]);
  async function save(changes: Change[], preview?: StaffState) {
    const base = current.current;
    if (needsReload.current) { setError("Reload the latest data before making another change."); return false; }
    if (!base || saving.current) { setError("Wait for the current save to finish."); return false; }
    if (!changes.length) return true;
    saving.current = true; generation.current++; setPending(true); setError(""); setNotice("");
    if (preview) apply({ ...base, state: preview });
    let committed = false;
    try {
      const response = await fetch("/api/workspace/commit", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(saveBody(base, changes, requestId())), cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not confirm this save.");
      if (result.saved !== true) throw new Error("Could not confirm this save. Reload the latest data.");
      committed = true;
      needsReload.current = true;
      if (!mounted.current) return true;
      // The write acknowledgement and fresh projection have separate CPU budgets.
      // Freeze background polling until both finish so it cannot replace draft inputs.
      const refreshed = await fetch(stateUrl(), { cache: "no-store" });
      const latest = await refreshed.json();
      if (!refreshed.ok) throw new Error("Saved to the shared database, but the latest view could not load. Reload before making another change.");
      if (mounted.current) { apply(latest); needsReload.current = false; setNotice("Saved to the shared database."); } return true;
    } catch (error) {
      if (mounted.current) { apply(base); setError(committed ? "Saved to the shared database, but the latest view could not load. Reload before making another change." : error instanceof Error ? error.message : "The save could not be confirmed. Reload to check the latest server data before trying again."); }
      // A confirmed write must not invite duplicate submission if only its reload failed.
      return committed;
    } finally { saving.current = false; if (mounted.current) setPending(false); }
  }
  async function scheduleTool(body: Record<string, unknown>): Promise<ScheduleToolResult | null> {
    const base = current.current;
    if (!base || saving.current || needsReload.current) { setError("Close this dialog and reload the latest data before continuing."); return null; }
    if (body.revision !== base.revision) { setError("Shared data changed. Close this dialog and reload before reviewing again."); return null; }
    saving.current = true; generation.current++; setPending(true); setError(""); setNotice("");
    let result: ScheduleToolResult | null = null;
    try {
      // An uncertain write must be checked through a reload before any retry.
      needsReload.current = true;
      const response = await fetch("/api/workspace/schedule-tools", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ ...body, id: requestId() }) });
      const saved = await response.json();
      if (!response.ok) {
        if ([400, 403, 404].includes(response.status)) needsReload.current = false;
        throw new Error(saved.error || "Could not confirm the schedule operation. Reload before trying again.");
      }
      if (saved.saved !== true) throw new Error("Could not confirm this save. Reload before trying again.");
      result = saved;
      const refreshed = await fetch(stateUrl(), { cache: "no-store" }); const latest = await refreshed.json();
      if (!refreshed.ok) throw new Error("Saved, but the latest schedule could not load. Reload before making another change.");
      if (mounted.current) { apply(latest); needsReload.current = false; setNotice(body.action === "apply" ? "Copied to your draft. Review warnings and publish when ready." : "Schedule template saved."); }
      return result;
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "The save could not be confirmed. Close this dialog and reload to check before trying again.");
      return result;
    } finally { saving.current = false; if (mounted.current) setPending(false); }
  }
  async function uploadDocument(details: Omit<UploadDetails, "id">, file: File) {
    if (needsReload.current) { setError("Reload the latest data before making another change."); return false; }
    if (!current.current || saving.current) { setError("Wait for the current save to finish."); return false; }
    if (!file.size || file.size > maxFileBytes) { setError("Choose a non-empty file up to 10 MB."); return false; }
    saving.current = true; generation.current++; setPending(true); setError(""); setNotice("");
    let retryKey = "";
    try {
      const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
      const contentType = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : /\.gif$/i.test(file.name) ? "image/gif" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "application/octet-stream");
      const payload = { ...details, fileName: file.name, contentType, sizeBytes: file.size, sha256 };
      retryKey = JSON.stringify(payload); let id = uploadRetries.current.get(retryKey);
      if (!id) { id = requestId(); if (uploadRetries.current.size >= 10) uploadRetries.current.delete(uploadRetries.current.keys().next().value!); uploadRetries.current.set(retryKey, id); }
      const prepared = await fetch("/api/documents/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, id }), cache: "no-store" });
      const preparation = await prepared.json(); if (!prepared.ok) throw new Error(preparation.error || "Could not prepare the upload.");
      const response = await fetch(`/api/documents/${preparation.fileId}/content`, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes, cache: "no-store" });
      const result = await response.json(); if (!response.ok) { if (result.freshUpload) uploadRetries.current.delete(retryKey); throw new Error(result.error || "Could not confirm the upload."); }
      saving.current = false; await load(true);
      uploadRetries.current.delete(retryKey); setNotice("File saved to private storage."); return true;
    } catch (error) { setError(error instanceof Error ? error.message : "The upload could not be confirmed. Reload before retrying."); return false; }
    finally { saving.current = false; if (mounted.current) setPending(false); }
  }
  async function updateState(update: SetStateAction<StaffState>) {
    const base = current.current; if (!base) return false;
    if (saving.current) { setError("Wait for the current save to finish."); return false; }
    const next = typeof update === "function" ? update(structuredClone(base.state)) : update;
    if (equal(base.state, next)) return true;
    try {
      const roundingChanged = base.state.hoursRoundingMinutes !== next.hoursRoundingMinutes;
      const normalized = roundingChanged ? { ...next, hoursRoundingMinutes: base.state.hoursRoundingMinutes } : next;
      const changes = stateChanges(base.state, normalized, account.employeeId ?? -account.id);
      if (roundingChanged) changes.push({ entity: "settings", id: 1, before: { ...base.settings, hoursRoundingMinutes: base.state.hoursRoundingMinutes }, after: { ...base.settings, hoursRoundingMinutes: next.hoursRoundingMinutes } });
      return await save(changes, next);
    } catch (error) { setError(error instanceof Error ? error.message : "This action is unavailable."); return false; }
  }
  async function reload() {
    try { await load(true); setEpoch(value => value + 1); setError(""); setNotice("Latest shared data loaded. Review and re-enter any unsaved change."); }
    catch { setError("Could not reload shared data. Check your connection and try again."); }
  }
  if (!data) return <main className="login-screen"><section className="login-card auth-card"><h1>DomBase</h1>{error ? <><p role="alert">{error}</p><button onClick={() => void reload()}>Try again</button></> : <p role="status">Loading shared workspace…</p>}</section></main>;
  return <SharedContext.Provider value={{ data, scheduleTool, pending: pending || periodLoading, setPeriod, uploadDocument, setState: updateState, save, setEditing: value => { editing.current = value; if (!value && requestedPeriod.current) setPeriod(requestedPeriod.current); }, setError }}>
    <div className={`workspace-sync-bar ${error ? "has-error" : ""}`}>
      <p role={error ? "alert" : "status"}>{error || (periodLoading ? "Loading selected period…" : pending ? "Saving to the shared database…" : notice || "Connected to the shared database")}</p>
      {error ? <button disabled={pending} onClick={() => void reload()}>Reload latest data</button> : null}
    </div>
    <Home key={epoch} account={account} />
    {pending || periodLoading ? <div className="workspace-commit-cover" aria-hidden="true" /> : null}
  </SharedContext.Provider>;
}
