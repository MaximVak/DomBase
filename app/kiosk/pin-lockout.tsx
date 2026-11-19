"use client";
import { useEffect, useState } from "react";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";
export type PinCooldown = { until: number; scope: "device" | "pin" };
export function pinCooldown(retryAfter: string | null, scope: unknown, now: number): PinCooldown {
  const value = Number(retryAfter);
  const seconds = Number.isFinite(value) && value > 0 ? Math.min(900, Math.ceil(value)) : 900;
  return { until: now + seconds * 1000, scope: scope === "pin" ? "pin" : "device" };
}
export function PinLockout({ value, language = "en", manager = false, onExpired }: { value: PinCooldown; language?: KioskLanguage; manager?: boolean; onExpired: () => void }) {
  const text = kioskCopy[language];
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const expiry = window.setTimeout(onExpired, Math.max(1, value.until - Date.now()));
    return () => { window.clearInterval(tick); window.clearTimeout(expiry); };
  }, [value.until, onExpired]);
  const remaining = Math.max(0, Math.ceil((value.until - now) / 1000));
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return <aside className="kiosk-error">
    <p id="kiosk-lockout" role="alert">{value.scope === "device" ? manager ? text.managerLocked : text.pinLocked : text.pinAttempts}</p>
    <p>{value.scope === "pin" ? text.retryPin : text.retryDevice} <span role="timer" aria-live="off">{time}</span>.</p>
    <p>{value.scope === "pin" ? manager ? text.managerOther : text.employeeOther : text.askManager}</p>
    <p>{text.noAction}</p>
  </aside>;
}
