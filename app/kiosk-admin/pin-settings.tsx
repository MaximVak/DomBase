"use client";
import { useState } from "react";
import type { FormEvent } from "react";
export type PinEmployee = { id: number; name: string; enrolled: boolean };
export function PinSettings({ employees, onSaved }: { employees?: PinEmployee[]; onSaved: (message: string) => void }) {
  const manager = employees === undefined;
  const [employeeId, setEmployeeId] = useState(String(employees?.[0]?.id ?? ""));
  const [pin, setPin] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [generatedPin, setGeneratedPin] = useState("");
  const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const prefix = manager ? "approval" : "employee";
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!manager && pin !== confirmation) { setError("The PINs do not match."); return; }
    setBusy(true); setError(""); setGeneratedPin("");
    const body = manager ? { password } : { pin, password, employeeId: Number(employeeId) };
    setPin(""); setConfirmation(""); setPassword("");
    try {
      const response = await fetch(`/api/kiosk-admin/${prefix}-pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save this PIN.");
      if (manager) setGeneratedPin(result.pin);
      onSaved(manager ? "Your manager approval PIN is set. It cannot sign in to the dashboard." : "Employee PIN saved. Any previous PIN session has ended.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="kiosk-admin-section" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`}>{manager ? "Your manager approval PIN" : "Employee PINs"}</h2>
    <p>{manager ? "Generate a separate PIN for approving a single clock request on a registered tablet. Your new PIN is shown only once; save it privately." : "Set or reset an employee’s PIN. Existing PINs cannot be viewed. Tell the employee their new PIN privately."}</p>
    {!manager && !employees.length ? <p>No active employees in your scope. Add the shared demo team in the next step.</p> : <form onSubmit={submit} aria-busy={busy}>
      {!manager ? <label htmlFor="pin-employee">Employee<select id="pin-employee" value={employeeId} disabled={busy} onChange={event => setEmployeeId(event.target.value)}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.enrolled ? " · PIN set" : " · no PIN"}</option>)}</select></label> : null}
      {!manager ? <><label htmlFor={`${prefix}-new-pin`}>New PIN<input id={`${prefix}-new-pin`} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required value={pin} disabled={busy} onChange={event => setPin(event.target.value.replace(/\D/g, ""))} aria-describedby={`${prefix}-pin-hint`} /></label>
      <p id={`${prefix}-pin-hint`} className="kiosk-hint">Use 4–8 digits. All-zero PINs and PINs already used by another employee or manager are unavailable.</p>
      <label htmlFor={`${prefix}-confirm-pin`}>Confirm PIN<input id={`${prefix}-confirm-pin`} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value.replace(/\D/g, ""))} /></label></> : null}
      <label htmlFor={`${prefix}-password`}>Your dashboard password<input id={`${prefix}-password`} type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      {error ? <p className="kiosk-error" role="alert">{error}</p> : null}
      <button className="kiosk-primary" disabled={busy} type="submit">{busy ? "Saving…" : manager ? "Generate approval PIN" : "Save PIN"}</button>
    </form>}
    {generatedPin ? <div role="status"><p>Your new approval PIN: <strong>{generatedPin}</strong></p><p>Save it privately. It cannot be displayed again.</p><button type="button" onClick={() => setGeneratedPin("")}>Hide PIN</button></div> : null}
  </section>;
}
