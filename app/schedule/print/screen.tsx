"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SchedulePrintDocument } from "../../schedule-print-document";
import { schedulePrintDocument, type SchedulePrintDocument as Document } from "../../schedule-print-model";
import type { EmployeeSchedule } from "../../../self/schedule-model";

export function SchedulePrintScreen({ employee }: { employee: boolean }) {
  const [data, setData] = useState<Document | null>(null), [draft, setDraft] = useState(false), [pending, setPending] = useState(true), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (print = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setData(null); setPending(true); setError("");
    try {
      const params = new URLSearchParams(window.location.search);
      let path: string;
      if (employee) { const date = params.get("date"); path = "/api/self/schedule" + (date ? "?" + new URLSearchParams({ date }) : ""); }
      else { params.set("draft", String(draft)); path = "/api/workspace/schedule-print?" + params; }
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) { window.location.replace("/login"); return; }
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not prepare the schedule.");
      if (controller.signal.aborted) return;
      let document: Document = body;
      if (employee) {
        const own = body as EmployeeSchedule;
        document = schedulePrintDocument({ location: own.locationName, timeZone: own.timeZone, start: own.startDate, end: own.endDate,
          weekStart: new Date(own.startDate + "T12:00:00Z").getUTCDay(), capturedAt: new Date().toISOString(), draft: false, canPrintDraft: false, scope: "My published shifts only",
          employees: [{ id: own.employeeId, name: own.shifts.find(row => row.employeeId === own.employeeId)?.employeeName ?? "Me" }], shifts: own.shifts.filter(row => row.employeeId === own.employeeId) });
      }
      if (print) { flushSync(() => { setData(document); setPending(false); }); window.print(); }
      else setData(document);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "Could not load the printout. Check your connection and reload."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }, [employee, draft]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); request.current?.abort(); }; }, [load]);
  return <main className="schedule-print-page">
    <header className="schedule-print-controls"><a href={employee ? "/me/schedule" : "/"}>← Back to schedule</a><h1>Print schedule</h1><p>Review your printout, then print or choose Save as PDF in your browser. Landscape layout is recommended.</p>
      <div><button type="button" disabled={pending} onClick={() => void load()}>Reload printout</button><button type="button" disabled={pending || !data} onClick={() => void load(true)}>Print / Save as PDF</button></div>
      {!employee && data?.canPrintDraft ? <label className="schedule-tool-check"><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />Include my saved draft changes (not published)</label> : null}
      <p>Each print reloads the current schedule and access. Printing does not publish, notify teammates or save changes.{employee ? " Only your own published shifts print, even when team viewing is allowed." : " Employee filters apply to assigned work; open shifts and location events stay separate."}</p>
    </header>
    {pending ? <p role="status">Preparing schedule printout…</p> : null}{error ? <p role="alert">{error} Use Reload printout to try again.</p> : null}
    {data && !pending ? <SchedulePrintDocument data={data} /> : null}
  </main>;
}
