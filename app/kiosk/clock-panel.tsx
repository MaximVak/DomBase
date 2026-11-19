"use client";
import { useEffect, useRef, useState } from "react";
import type { ClockInput } from "./clock-queue";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export type ClockPerson = { employee: { id: number; name: string }; roles: { id: number; name: string }[]; state: "in" | "out" | "break" | "break_end"; expiresAt: string; replay?: { ticket: string; serverTime: number } };

export function ClockPanel({ person, language, busy, offlineBlocked, onClock, onCancel }: { person: ClockPerson; language: KioskLanguage; busy: boolean; offlineBlocked: boolean; onClock: (input: ClockInput) => Promise<void>; onCancel: () => void }) {
  const text = kioskCopy[language];
  const [roleId, setRoleId] = useState(String(person.roles[0]?.id ?? ""));
  const [explanation, setExplanation] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const off = person.state === "out";
  const onBreak = person.state === "break";
  const disabled = busy || offlineBlocked;
  const input = (eventType: ClockInput["eventType"]) => ({ eventType, explanation, ...(eventType === "in" ? { roleId: Number(roleId) } : {}) });
  return <section aria-labelledby="clock-person-heading" className="kiosk-clock-panel">
    <h2 ref={heading} id="clock-person-heading" tabIndex={-1}>{text.hello}, {person.employee.name}</h2>
    <p>{off ? text.clockedOut : onBreak ? text.onBreak : text.clockedIn}</p>
    {off ? <label htmlFor="kiosk-role">{text.role}
      <select id="kiosk-role" value={roleId} disabled={busy || !person.roles.length} onChange={event => setRoleId(event.target.value)}>
        {!person.roles.length ? <option value="">{text.noRole}</option> : person.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select>
    </label> : null}
    {off && !person.roles.length ? <p role="status">{text.assignRole}</p> : null}
    <label htmlFor="kiosk-explanation">{text.note}
      <textarea id="kiosk-explanation" value={explanation} maxLength={1000} disabled={busy} onChange={event => setExplanation(event.target.value)} />
    </label>
    <div className="kiosk-actions">
      {off ? <button type="button" className="kiosk-primary" disabled={disabled || !roleId} onClick={() => void onClock(input("in"))}>{text.clockIn}</button>
        : onBreak ? <button type="button" className="kiosk-primary" disabled={disabled} onClick={() => void onClock(input("break_end"))}>{text.endBreak}</button>
          : <><button type="button" className="kiosk-primary" disabled={disabled} onClick={() => void onClock(input("out"))}>{text.clockOut}</button><button type="button" disabled={disabled} onClick={() => void onClock(input("break"))}>{text.startBreak}</button></>}
      <button type="button" onClick={onCancel}>{text.cancel}</button>
    </div>
    <p className="kiosk-hint">{text.lockHint}</p>
  </section>;
}
