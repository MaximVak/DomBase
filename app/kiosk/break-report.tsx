"use client";
import { useEffect, useRef, useState } from "react";
import type { BreakIssue, BreakReport } from "../../kiosk/break-rules";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export function BreakReportForm({ issues, language, busy, onSave, onBack }: {
  issues: BreakIssue[]; language: KioskLanguage; busy: boolean; onSave: (reports: BreakReport[]) => void; onBack: () => void;
}) {
  const text = kioskCopy[language];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [reports, setReports] = useState<Record<string, BreakReport>>({});
  const complete = issues.every(({ kind, slot }) => {
    const report = reports[kind + slot];
    return report && (report.outcome === "missed" || report.reason?.trim());
  });
  return <form className="kiosk-report" onSubmit={event => { event.preventDefault(); if (complete && !busy) onSave(Object.values(reports)); }}>
    <div className="kiosk-panel-content">
      <h2 ref={heading} tabIndex={-1}>{text.reviewBreaks}</h2>
      {issues.map(issue => {
        const { kind, slot, canWaive } = issue;
        const key = kind + slot;
        const report = reports[key];
        return <fieldset key={key}>
          <legend>{kind === "meal" ? text.meal : text.rest} {slot}</legend>
          <label>{text.breakOutcome}<select value={report?.outcome ?? ""} disabled={busy} onChange={event => {
            const outcome = event.target.value as BreakReport["outcome"];
            setReports(current => ({ ...current, [key]: { kind, slot, outcome } }));
          }}>
            <option value="" disabled>{text.choose}</option><option value="missed">{text.missed}</option>
            <option value="unrecorded">{text.unrecorded}</option>{canWaive ? <option value="waived">{text.waive}</option> : null}
          </select></label>
          {report?.outcome === "waived" ? <p>{text.waiverConsent}</p> : null}
          {report && report.outcome !== "missed" ? <label>{report.outcome === "unrecorded" ? text.breakTimes : text.waiverReason}
            <textarea disabled={busy} maxLength={300} required value={report.reason ?? ""} onChange={event => setReports(current => ({
              ...current, [key]: { ...report, reason: event.target.value },
            }))} /></label> : null}
        </fieldset>;
      })}
    </div>
    <div className="kiosk-actions"><button className="kiosk-primary" type="submit" disabled={busy || !complete}>{text.confirmClockOut}</button><button type="button" onClick={onBack} disabled={busy}>{text.back}</button></div>
  </form>;
}
