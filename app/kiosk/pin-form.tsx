"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export function PinForm({ language = "en", manager = false, busy, locked = false, offline = false, describedBy, onSubmit }: { language?: KioskLanguage; manager?: boolean; busy: boolean; locked?: boolean; offline?: boolean; describedBy?: string; onSubmit: (pin: string) => Promise<void> }) {
  const text = kioskCopy[language];
  const [pin, setPin] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const inactive = locked || offline;
  useEffect(() => { if (!inactive) input.current?.focus(); }, [inactive]);
  useEffect(() => {
    if (!pin) return;
    const timer = window.setTimeout(() => setPin(""), inactive ? 0 : 30000);
    return () => window.clearTimeout(timer);
  }, [pin, inactive]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || inactive || pin.length < 4) return;
    const value = pin;
    setPin("");
    await onSubmit(value);
  }
  return <form className="kiosk-pin-form" onSubmit={submit} aria-busy={busy} noValidate>
    <label htmlFor="kiosk-pin">{manager ? text.managerPin : text.employeePin}</label>
    <input ref={input} id="kiosk-pin" type="password" inputMode="none" pattern="[0-9]{4,8}" autoComplete="off" minLength={4} maxLength={8} required value={inactive ? "" : pin} disabled={busy || inactive}
      onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} aria-describedby={["kiosk-pin-hint", describedBy].filter(Boolean).join(" ")} />
    <p id="kiosk-pin-hint" className="kiosk-hint">{manager ? text.managerHint : text.employeeHint}</p>
    <div className="kiosk-keypad" role="group" aria-label={text.keypad}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map(key => <button key={key} type="button" disabled={busy || inactive}
        aria-label={key === "delete" ? text.deleteDigit : key === "clear" ? text.clearPin : key}
        onClick={() => setPin(value => key === "clear" ? "" : key === "delete" ? value.slice(0, -1) : (value + key).slice(0, 8))}>{key === "clear" ? text.clear : key === "delete" ? text.delete : key}</button>)}
    </div>
    <button className="kiosk-primary" type="submit" disabled={busy || inactive || pin.length < 4}>{locked ? text.tempLocked : busy ? text.wait : manager ? text.approve : text.continue}</button>
  </form>;
}
