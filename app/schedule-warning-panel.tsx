"use client";
import { useEffect, useState } from "react";
import type { PlannedShift } from "./schedule-estimates";
import { conflictLabels } from "./schedule-conflicts";
import type { ConflictAssessment, ConflictCode } from "./schedule-conflicts";

export type WarningPayload = { period: { start: string; end: string }; revision: number; upserts: PlannedShift[]; deletedShiftIds: number[] };
export function useScheduleWarnings(payload: WarningPayload | null) {
  const key = payload ? JSON.stringify(payload) : "";
  const [result, setResult] = useState<{ key: string; data: ConflictAssessment | null; error: string }>({ key: "", data: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/workspace/schedule-conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal, body: key });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Could not load schedule warnings.");
          if (!controller.signal.aborted) setResult({ key, data: body, error: "" });
        } catch (error) { if (!controller.signal.aborted) setResult({ key, data: null, error: error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : "Warnings are unavailable. Reload to try again; do not assume the schedule has no conflicts." }); }
      })();
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, attempt]);
  return { data: key && result.key === key ? result.data : null, error: key && result.key === key ? result.error : "", pending: !!key && (result.key !== key || (!result.data && !result.error)), retry: () => { setResult({ key: "", data: null, error: "" }); setAttempt(value => value + 1); } };
}
export function ShiftWarningBadge({ codes }: { codes?: ConflictCode[] }) {
  return codes?.length ? <span className="schedule-warning-badge" title={codes.map(code => conflictLabels[code]).join("; ")}>⚠ {codes.length} {codes.length === 1 ? "warning" : "warnings"}</span> : null;
}
export function ScheduleWarningPanel({ result, shifts, employees, visibleIds, label = "Schedule warnings", placeholder }: { result: ReturnType<typeof useScheduleWarnings>; shifts: PlannedShift[]; employees: { id: number; name: string }[]; visibleIds?: Set<number>; label?: string; placeholder?: string }) {
  const [limit, setLimit] = useState(20);
  const warnings = result.data?.warnings.filter(warning => (!visibleIds || visibleIds.has(warning.shiftId)) && shifts.some(shift => shift.id === warning.shiftId)) ?? [];
  const kinds = [...new Set(warnings.flatMap(warning => warning.codes))];
  return <section className="schedule-warning-panel" aria-label={label}>
    <h3>{label}{result.data && warnings.length ? ` · ${warnings.length} ${warnings.length === 1 ? "shift" : "shifts"} need review` : ""}</h3>
    {result.error ? <><p role="alert">{result.error}</p><button type="button" onClick={result.retry}>Retry warning check</button></> : !result.data ? <p role="status">{placeholder || "Checking schedule warnings…"}</p> : <>
      {!result.data.availability ? <p>Availability was not assessed because viewing permission is required.</p> : null}
      {!result.data.timeOff ? <p>Time-off conflicts were not assessed because viewing permission is required.</p> : null}
      <p>Review these reminders before publishing. They do not hide shifts or automatically change pay.</p>
      {kinds.length ? <ul className="warning-kind-list">{kinds.map(code => <li key={code}>{conflictLabels[code]} ({warnings.filter(warning => warning.codes.includes(code)).length})</li>)}</ul> : null}
      {warnings.length ? <details><summary>View warnings</summary><ul>{warnings.slice(0, limit).map(warning => {
        const shift = shifts.find(shift => shift.id === warning.shiftId)!;
        return <li key={warning.shiftId}><strong>{employees.find(employee => employee.id === shift.employeeId)?.name ?? "Team member"} · {shift.date} · {shift.start}–{shift.end}</strong><ul>{warning.codes.map(code => <li key={code}>{conflictLabels[code]}</li>)}</ul></li>;
      })}</ul>{warnings.length > limit ? <button type="button" onClick={() => setLimit(value => value + 20)}>Show more warnings</button> : null}</details> : <p>No warnings found in the checks available to you.</p>}
    </>}
  </section>;
}
