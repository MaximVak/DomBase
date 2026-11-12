"use client";
import { useEffect, useState } from "react";
export type PinCooldown = { until: number; scope: "device" | "pin" };
export function pinCooldown(retryAfter: string | null, scope: unknown, now: number): PinCooldown {
  const value = Number(retryAfter);
  const seconds = Number.isFinite(value) && value > 0 ? Math.min(900, Math.ceil(value)) : 900;
  return { until: now + seconds * 1000, scope: scope === "pin" ? "pin" : "device" };
}
export function PinLockout({ value, manager = false, onExpired }: { value: PinCooldown; manager?: boolean; onExpired: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const expiry = window.setTimeout(onExpired, Math.max(1, value.until - Date.now()));
    return () => { window.clearInterval(tick); window.clearTimeout(expiry); };
  }, [value.until, onExpired]);
  const remaining = Math.max(0, Math.ceil((value.until - now) / 1000));
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return <aside className="kiosk-error">
    <p id="kiosk-lockout" role="alert">{value.scope === "device" ? manager ? "Manager approval on this tablet is temporarily locked." : "PIN entry on this tablet is temporarily locked." : "Too many attempts with this PIN."}</p>
    <p>Try {value.scope === "pin" ? "this PIN " : ""}again in <span role="timer" aria-live="off">{time}</span>.</p>
    {value.scope === "pin" ? <p>{manager ? "Another manager can enter a different approval PIN." : "Other employees can still enter their own PINs."}</p> : <p>Ask a manager for help if you need to record your time.</p>}
    <p>No clock action has been recorded.</p>
  </aside>;
}
