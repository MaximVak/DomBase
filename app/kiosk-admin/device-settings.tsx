"use client";
import { useState } from "react";
import type { FormEvent } from "react";
export type ClockDevice = { id: string; name: string; registeredAt: string; revokedAt: string | null };
export function DeviceSettings({ devices, onSaved }: { devices: ClockDevice[]; onSaved: (message: string) => void }) {
  const [name, setName] = useState("Breakroom tablet"); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [confirmId, setConfirmId] = useState<string | null>(null);
  async function register(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); const body = { name, password }; setPassword("");
    try {
      const response = await fetch("/api/kiosk-admin/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not register this tablet.");
      window.location.replace("/kiosk");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect. Please try again."); setBusy(false); }
  }
  async function revoke(deviceId: string) {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/kiosk-admin/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }), cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not revoke this tablet.");
      setConfirmId(null); onSaved("Tablet access revoked. Its employee and approval sessions are no longer valid.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="kiosk-admin-section" aria-labelledby="device-heading">
    <h2 id="device-heading">Clock tablets</h2>
    <p>Register from the tablet itself. This browser will sign out of the dashboard and open only the time clock. Use your laptop or another browser for management.</p>
    <form onSubmit={register} aria-busy={busy}>
      <label htmlFor="device-name">Tablet name<input id="device-name" required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label htmlFor="device-password">Your dashboard password<input id="device-password" type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      <button className="kiosk-primary" disabled={busy} type="submit">{busy ? "Please wait…" : "Register this browser as a tablet"}</button>
    </form>
    {error ? <p className="kiosk-error" role="alert">{error}</p> : null}
    <h3>Registered tablets</h3>
    {!devices.length ? <p>No tablets registered yet.</p> : <ul className="kiosk-device-list">{devices.map(device => <li key={device.id}>
      <div><strong>{device.name}</strong><span>{device.revokedAt ? "Revoked" : "Active"}</span></div>
      {!device.revokedAt ? confirmId === device.id ? <div className="kiosk-actions"><p>End access for {device.name}?</p><button disabled={busy} onClick={() => void revoke(device.id)}>Confirm revocation</button><button disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button></div> : <button disabled={busy} onClick={() => setConfirmId(device.id)}>Revoke access</button> : null}
    </li>)}</ul>}
    <p className="kiosk-hint">Registration lasts up to one year unless revoked. Clearing this browser’s cookies requires registration again. Tablet kiosk mode is configured on the device.</p>
  </section>;
}
