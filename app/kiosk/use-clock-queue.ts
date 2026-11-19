"use client";
import { useCallback, useRef, useState } from "react";
import { holdClock, queuedClocks, removeClock } from "./clock-queue";
import type { KioskText } from "./copy";

export function kioskPost(action: string, body: unknown, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(8000);
  return fetch("/api/kiosk/" + action, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

export function useClockQueue() {
  const [available, setAvailable] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [needsHelp, setNeedsHelp] = useState(false);
  const [result, setResult] = useState<KioskText | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    try {
      const entries = await queuedClocks();
      setAvailable(true);
      setPendingCount(entries.filter(entry => !entry.needsHelp).length);
      setNeedsHelp(entries.some(entry => entry.needsHelp));
    } catch { setAvailable(false); }
  }, []);

  const sync = useCallback(() => {
    if (running.current) return running.current;
    if (!navigator.onLine) return refresh();
    running.current = (async () => {
      try {
        const entries = (await queuedClocks()).filter(entry => !entry.needsHelp).sort((a, b) => a.attemptedAt - b.attemptedAt);
        let synced = false;
        let review = false;
        for (const entry of entries) {
          const action = { ticket: entry.ticket, attemptedAt: entry.attemptedAt, eventType: entry.eventType, roleId: entry.roleId, explanation: entry.explanation };
          const response = await kioskPost("sync", action);
          if ([401, 403, 409, 422].includes(response.status)) {
            await holdClock(action);
            continue;
          }
          if (!response.ok) break;
          const receipt = await response.json();
          if (receipt.outcome !== "synced" && receipt.outcome !== "review") break;
          await removeClock(entry.ticket);
          if (receipt.outcome === "review") review = true;
          else synced = true;
        }
        if (review || synced) setResult(review ? "review" : "synced");
      } catch { /* Transport failure keeps entries available for the next retry. */ }
      finally { await refresh(); running.current = null; }
    })();
    return running.current;
  }, [refresh]);
  return { available, pendingCount, needsHelp, result, refresh, sync };
}
