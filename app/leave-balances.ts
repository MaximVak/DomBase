"use client";

import { useEffect, useState } from "react";
import type { EmployeeLeaveBalances } from "../workforce/leave-policy";

export function useLeaveBalances(enabled: boolean, revision: number) {
  const [rows, setRows] = useState<EmployeeLeaveBalances[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const response = await fetch("/api/workspace/leave-balances", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Leave balances are temporarily unavailable.");
        const balances: EmployeeLeaveBalances[] = await response.json();
        if (!controller.signal.aborted) { setRows(balances); setError(""); }
      } catch {
        if (!controller.signal.aborted) { setRows([]); setError("Leave balances are temporarily unavailable."); }
      } finally { loading = false; }
    }
    void load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener("focus", load);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled, revision]);
  return { rows, error };
}
