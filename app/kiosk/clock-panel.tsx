"use client";
import { useEffect, useRef, useState } from "react";
import type { BreakIssue, BreakKind } from "../../kiosk/break-rules";
import type { ClockInput } from "./clock-queue";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";
import { BreakReportForm } from "./break-report";

export type ClockPerson = {
  employee: { id: number; name: string }; roles: { id: number; name: string }[];
  state: "in" | "out" | "break" | "break_end"; expiresAt: string; serverTime?: number;
  replay?: { ticket: string; serverTime: number };
  breakView?: { issues: BreakIssue[]; active?: { kind: BreakKind; availableAt: number; extensionAt: number } };
};

export function ClockPanel({ person, language, busy, offlineBlocked, earlyClockBlocked, onClock, onCancel }: {
  person: ClockPerson; language: KioskLanguage; busy: boolean; offlineBlocked: boolean; earlyClockBlocked: boolean;
  onClock: (input: ClockInput) => Promise<void>; onCancel: () => void;
}) {
  const text = kioskCopy[language];
  const [roleId, setRoleId] = useState(String(person.roles[0]?.id ?? ""));
  const [explanation, setExplanation] = useState("");
  const [reporting, setReporting] = useState(false);
  const [extension, setExtension] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [reporting]);
  const activeBreak = person.breakView?.active;
  useEffect(() => {
    if (!activeBreak?.availableAt && !activeBreak?.extensionAt) return;
    const entered = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - entered), 1000);
    return () => window.clearInterval(timer);
  }, [activeBreak]);
  const off = person.state === "out";
  const onBreak = person.state === "break";
  const disabled = busy || offlineBlocked;
  const serverTime = (person.serverTime ?? person.replay?.serverTime ?? 0) + elapsed;
  const remaining = activeBreak ? Math.max(0, Math.ceil((activeBreak.availableAt - serverTime) / 1000)) : 0;
  const askExtension = !!activeBreak?.extensionAt && serverTime > activeBreak.extensionAt;
  const issues = person.breakView?.issues ?? [];
  const input = (eventType: ClockInput["eventType"], details?: ClockInput["details"]) =>
    ({ eventType, explanation, ...(eventType === "in" ? { roleId: Number(roleId) } : {}), ...(details ? { details } : {}) });
  if (reporting) return <BreakReportForm issues={issues} language={language} busy={disabled}
    onSave={reports => void onClock(input("out", { reports }))} onBack={() => setReporting(false)} />;
  return <section aria-labelledby="clock-person-heading" className="kiosk-clock-panel">
    <h2 ref={heading} id="clock-person-heading" tabIndex={-1}>{text.hello}, {person.employee.name}</h2>
    <p>{off ? text.clockedOut : onBreak ? activeBreak?.kind === "rest" ? text.onRest : text.onMeal : text.clockedIn}</p>
    {off ? <label htmlFor="kiosk-role">{text.role}
      <select id="kiosk-role" value={roleId} disabled={busy || !person.roles.length} onChange={event => setRoleId(event.target.value)}>
        {!person.roles.length ? <option value="">{text.noRole}</option> : person.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select>
    </label> : null}
    {off && !person.roles.length ? <p role="status">{text.assignRole}</p> : null}
    <label htmlFor="kiosk-explanation">{text.note}
      <textarea id="kiosk-explanation" value={explanation} maxLength={1000} disabled={busy} onChange={event => setExplanation(event.target.value)} />
    </label>
    {onBreak && remaining > 0 ? <p>{text.remaining} <span role="timer" aria-live="off">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span></p> : null}
    {onBreak && askExtension ? <label className="kiosk-check"><input type="checkbox" checked={extension} disabled={disabled} onChange={event => setExtension(event.target.checked)} />{text.offDutyExtension}</label> : null}
    <div className="kiosk-actions">
      {off ? <><button type="button" className="kiosk-primary" disabled={disabled || !roleId} onClick={() => void onClock(input("in"))}>{text.clockIn}</button>
        {earlyClockBlocked ? <button type="button" disabled={disabled || !roleId} onClick={() => void onClock(input("in", { worked: true }))}>{text.startedWork}</button> : null}</>
        : onBreak ? <><button type="button" className="kiosk-primary" disabled={disabled || remaining > 0} onClick={() => void onClock(input("break_end", extension ? { offDutyExtension: true } : undefined))}>{text.endBreak}</button>
          {remaining > 0 ? <button type="button" disabled={disabled} onClick={() => void onClock(input("break_end", { worked: true }))}>{text.resumedWork}</button> : null}</>
        : <><button type="button" className="kiosk-primary" disabled={disabled} onClick={() => issues.length ? setReporting(true) : void onClock(input("out", { reports: [] }))}>{text.clockOut}</button>
          <button type="button" disabled={disabled} onClick={() => void onClock(input("break", { breakKind: "rest" }))}>{text.startRest}</button>
          <button type="button" disabled={disabled} onClick={() => void onClock(input("break", { breakKind: "meal" }))}>{text.startMeal}</button></>}
      <button type="button" onClick={onCancel}>{text.cancel}</button>
    </div>
    <p className="kiosk-hint">{text.lockHint}</p>
  </section>;
}
