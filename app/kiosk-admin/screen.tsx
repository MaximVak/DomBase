"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DeviceSettings } from "./device-settings";
import type { ClockDevice } from "./device-settings";
import { PinSettings } from "./pin-settings";
import type { PinEmployee } from "./pin-settings";
export function KioskAdminScreen() {
  const [data, setData] = useState<{ devices: ClockDevice[]; employees: PinEmployee[] } | null>(null);
  const [canApprove, setCanApprove] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [devices, approval] = await Promise.all([fetch("/api/kiosk-admin/devices", { cache: "no-store", signal }), fetch("/api/kiosk-admin/approval-pin", { cache: "no-store", signal })]);
      if (signal?.aborted) return;
      if ([devices.status, approval.status].includes(401)) { window.location.replace("/login"); return; }
      if ((!devices.ok && devices.status !== 403) || (!approval.ok && approval.status !== 403)) throw new Error("Could not load tablet settings. Try again.");
      const next = devices.ok ? await devices.json() : null;
      if (signal?.aborted) return;
      setData(next); setCanApprove(approval.ok); setError("");
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not connect."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function initialize() { await load(controller.signal); }
    void initialize();
    return () => controller.abort();
  }, [load]);
  function saved(message: string) { setNotice(message); void load(); }
  return <main className="kiosk-admin-screen">
    <header><Link href="/">← Dashboard</Link><h1>Tablet &amp; PIN access</h1><p>Manage the shared clock separately from personal dashboard sign-in.</p></header>
    {loading ? <p role="status">Loading tablet settings…</p> : null}
    {notice ? <p className="kiosk-notice" role="status">{notice}</p> : null}
    {error ? <div><p className="kiosk-error" role="alert">{error}</p><button onClick={() => void load()}>Try again</button></div> : null}
    {!loading && !error && !data && !canApprove ? <p>You do not have tablet management or approval access. Ask an Owner.</p> : null}
    {data ? <><DeviceSettings devices={data.devices} onSaved={saved} /><PinSettings employees={data.employees} onSaved={saved} /></> : null}
    {canApprove ? <PinSettings onSaved={saved} /> : null}
  </main>;
}
