"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function PinForm({ manager = false, busy, locked = false, describedBy, onSubmit }: { manager?: boolean; busy: boolean; locked?: boolean; describedBy?: string; onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!pin) return;
    const timer = window.setTimeout(() => setPin(""), 30000);
    return () => window.clearTimeout(timer);
  }, [pin]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || locked || pin.length < 4) return;
    const value = pin; setPin("");
    await onSubmit(value);
  }
  return <form className="kiosk-pin-form" onSubmit={submit} aria-busy={busy}>
    <label htmlFor="kiosk-pin">{manager ? "Manager approval PIN" : "Employee PIN"}</label>
    <input ref={input} id="kiosk-pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" autoComplete="off" minLength={4} maxLength={8} required value={pin} disabled={busy || locked}
      onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} aria-describedby={["kiosk-pin-hint", describedBy].filter(Boolean).join(" ")} />
    <p id="kiosk-pin-hint" className="kiosk-hint">{manager ? "Approves this request only. The screen returns to employee PIN entry." : "Enter your own 4–8 digit PIN."}</p>
    <div className="kiosk-keypad" aria-label="PIN keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Delete"].map(key => <button key={key} type="button" disabled={busy || locked}
        aria-label={key === "Delete" ? "Delete last digit" : key === "Clear" ? "Clear PIN" : key}
        onClick={() => setPin(value => key === "Clear" ? "" : key === "Delete" ? value.slice(0, -1) : (value + key).slice(0, 8))}>{key}</button>)}
    </div>
    <button className="kiosk-primary" type="submit" disabled={busy || locked || pin.length < 4}>{locked ? "Temporarily locked" : busy ? "Please wait…" : manager ? "Approve request" : "Continue"}</button>
  </form>;
}
