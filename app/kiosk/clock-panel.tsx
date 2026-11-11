"use client";
import { useState } from "react";
export type ClockPerson = { employee: { id: number; name: string }; roles: { id: number; name: string }[]; state: "in" | "out" | "break" | "break_end"; expiresAt: string };
export type ClockInput = { eventType: string; roleId?: number; explanation: string };
export function ClockPanel({ person, busy, onClock, onCancel }: { person: ClockPerson; busy: boolean; onClock: (input: ClockInput) => Promise<void>; onCancel: () => void }) {
  const [roleId, setRoleId] = useState(String(person.roles[0]?.id ?? ""));
  const [explanation, setExplanation] = useState("");
  const off = person.state === "out";
  const onBreak = person.state === "break";
  const input = (eventType: string) => ({ eventType, explanation, ...(eventType === "in" ? { roleId: Number(roleId) } : {}) });
  return <section aria-labelledby="clock-person-heading" className="kiosk-clock-panel">
    <h2 id="clock-person-heading">Hello, {person.employee.name}</h2>
    <p>{off ? "You are clocked out." : onBreak ? "You are on a break." : "You are clocked in."}</p>
    {off ? <label htmlFor="kiosk-role">Job role
      <select id="kiosk-role" value={roleId} disabled={busy || !person.roles.length} onChange={event => setRoleId(event.target.value)}>
        {!person.roles.length ? <option value="">No active job role</option> : person.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select>
    </label> : null}
    {off && !person.roles.length ? <p role="status">Ask a manager to assign you an active job role before clocking in.</p> : null}
    <label htmlFor="kiosk-explanation">Note (optional)
      <textarea id="kiosk-explanation" value={explanation} maxLength={1000} disabled={busy} onChange={event => setExplanation(event.target.value)} />
    </label>
    <div className="kiosk-actions">
      {off ? <button className="kiosk-primary" disabled={busy || !roleId} onClick={() => void onClock(input("in"))}>Clock in</button>
        : onBreak ? <button className="kiosk-primary" disabled={busy} onClick={() => void onClock(input("break_end"))}>End break</button>
          : <><button className="kiosk-primary" disabled={busy} onClick={() => void onClock(input("out"))}>Clock out</button><button disabled={busy} onClick={() => void onClock(input("break"))}>Start break</button></>}
      <button type="button" onClick={onCancel}>Cancel and lock</button>
    </div>
    <p className="kiosk-hint">This screen locks automatically. Sign in again for your next action.</p>
  </section>;
}
