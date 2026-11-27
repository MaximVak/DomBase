"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export function PinForm({ language = "en", manager = false, busy, locked = false, offline = false, describedBy, onActivity, onSubmit }: { language?: KioskLanguage; manager?: boolean; busy: boolean; locked?: boolean; offline?: boolean; describedBy?: string; onActivity?: () => void; onSubmit: (pin: string) => Promise<void> }) {
  const text = kioskCopy[language];
  const [entry, setEntry] = useState({ pin: "", visible: "" });
  const { pin, visible } = entry;
  const input = useRef<HTMLInputElement>(null);
  const inactive = locked || offline;
  useEffect(() => { if (!inactive) input.current?.focus(); }, [inactive]);
  useEffect(() => {
    if (!pin) return;
    const timer = window.setTimeout(() => setEntry({ pin: "", visible: "" }), inactive ? 0 : 30000);
    return () => window.clearTimeout(timer);
  }, [entry, pin, inactive]);
  function edit(next: string, digit = "") {
    onActivity?.();
    if (digit) navigator.vibrate?.(35);
    setEntry({ pin: next, visible: digit });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || inactive || pin.length < 4) return;
    const value = pin;
    setEntry({ pin: "", visible: "" });
    await onSubmit(value);
  }
  return <form className="kiosk-pin-form" onSubmit={submit} aria-busy={busy} noValidate>
    <label htmlFor="kiosk-pin">{manager ? text.managerPin : text.employeePin}</label>
    <div className="kiosk-pin-entry">
      <input ref={input} id="kiosk-pin" type="password" inputMode="none" pattern="[0-9]{4,8}" autoComplete="off" minLength={4} maxLength={8} required value={inactive ? "" : pin} disabled={busy || inactive}
        onChange={event => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 8);
          if (next !== pin) edit(next, next.length === pin.length + 1 && next.startsWith(pin) ? next.slice(-1) : "");
        }} aria-describedby={["kiosk-pin-hint", describedBy].filter(Boolean).join(" ")} />
      <span className="kiosk-pin-mask" aria-hidden="true">{inactive ? "" : "•".repeat(pin.length - visible.length) + visible}</span>
    </div>
    <p id="kiosk-pin-hint" className="kiosk-hint">{manager ? text.managerHint : text.employeeHint}</p>
    <div className="kiosk-keypad" role="group" aria-label={text.keypad}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map(key => <button key={key} type="button" disabled={busy || inactive}
        aria-label={key === "delete" ? text.deleteDigit : key === "clear" ? text.clearPin : key}
        onClick={() => {
          if (key === "clear") { if (pin) edit(""); }
          else if (key === "delete") { if (pin) edit(pin.slice(0, -1)); }
          else if (pin.length < 8) edit(pin + key, key);
        }}>{key === "clear" ? text.clear : key === "delete" ? text.delete : key}</button>)}
    </div>
    <button className="kiosk-primary" type="submit" disabled={busy || inactive || pin.length < 4}>{locked ? text.tempLocked : busy ? text.wait : manager ? text.approve : text.continue}</button>
  </form>;
}
