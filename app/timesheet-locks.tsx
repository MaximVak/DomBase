"use client";

import { useEffect, useRef, useState } from "react";
import type { LockAction, LockEvent, TimesheetLocks } from "../workforce/timesheet-lock-types";
import { saveId } from "./team/client";

const endpoint = "/api/workspace/timesheet-locks";
type Range = { start: string; end: string };

async function readLocks(query: string, signal?: AbortSignal): Promise<TimesheetLocks> {
  const response = await fetch(endpoint + query, { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load time-card locks.");
  return result;
}

export function useTimesheetLocks(enabled: boolean, start: string, end: string, revision?: number, onSaved?: () => Promise<void>) {
  const query = "?" + new URLSearchParams({ start, end });
  const [loaded, setLoaded] = useState<{ query: string; data: TimesheetLocks }>();
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ query: string; text: string; error?: boolean }>();
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const data = loaded?.query === query ? loaded.data : undefined;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await readLocks(query, controller.signal);
        if (!controller.signal.aborted && !busy.current) { setLoaded({ query, data: result }); setLoadError(""); }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load time-card locks.");
      }
    }
    void load();
    return () => controller.abort();
  }, [enabled, query, revision, refresh]);

  async function save(action: LockAction, targets: string[], range: Range = { start, end }) {
    if (!data || loadError || busy.current) return;
    busy.current = true;
    setSaving(true);
    setFeedback(undefined);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: saveId(), revision: data.revision, range, action, targets }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not change the lock.");
      const subject = !targets.length ? "Pay period" : result.count === 1 ? "Time card" : `${result.count} time cards`;
      setFeedback({ query, text: `${subject} ${action === "lock" ? "locked" : "unlocked"}.` });
      const [latest, workspace] = await Promise.allSettled([readLocks(query), onSaved?.()]);
      if (latest.status === "fulfilled") setLoaded({ query, data: latest.value });
      else setLoadError("Lock saved. Refresh to see the current lock status.");
      if (workspace.status === "rejected") setFeedback({ query, text: "Lock saved. Refresh the workspace before editing time cards.", error: true });
    } catch (error) {
      setFeedback({ query, text: error instanceof Error ? error.message : "Could not confirm the change. Check the lock before retrying.", error: true });
    } finally {
      busy.current = false;
      setSaving(false);
      setRefresh(value => value + 1);
    }
  }

  return { data, loadError, saving, feedback: feedback?.query === query ? feedback : undefined, save, retry: () => setRefresh(value => value + 1) };
}

export function TimesheetLockIcon() {
  return <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6a3 3 0 0 1 6 0v3m-3 3v2"/></svg>;
}

export function LockHistoryEntry({ entry }: { entry: LockEvent }) {
  const subject = entry.employeeId === null ? "Pay period" : "Time card";
  return <><small>{new Date(entry.at).toLocaleString()} · {entry.actor}</small><p>{subject} {entry.action === "lock" ? "locked" : "unlocked"}{entry.employeeId === null ? ` (${entry.startDate} – ${entry.endDate})` : ""}</p></>;
}
