"use client";
import { useCallback, useEffect, useState } from "react";
/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the vinext RSC prefetch error. */
import { DeviceSettings } from "./device-settings";
import type { ClockDevice } from "./device-settings";
import { PinSettings } from "./pin-settings";
import type { PinEmployee } from "./pin-settings";
import { OfflineClockReview } from "./offline-review";
import { ClockIdleSettings } from "./idle-settings";
import type { ComponentProps } from "react";
export function KioskAdminScreen() {
  const [data, setData] = useState<{ devices: ClockDevice[]; employees: PinEmployee[] } | null>(null);
  const [canApprove, setCanApprove] = useState(false); const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ComponentProps<typeof OfflineClockReview>["entries"] | null>(null);
  const [idleSeconds, setIdleSeconds] = useState<number | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [devices, approval, review, options] = await Promise.all([fetch("/api/kiosk-admin/devices", { cache: "no-store", signal }), fetch("/api/kiosk-admin/approval-pin", { cache: "no-store", signal }), fetch("/api/kiosk-admin/offline-review", { cache: "no-store", signal }), fetch("/api/kiosk-admin/clock-options", { cache: "no-store", signal })]);
      if (signal?.aborted) return;
      const responses = [devices, approval, review, options];
      if (responses.some(response => response.status === 401)) { window.location.replace("/login"); return; }
      if (responses.some(response => !response.ok && response.status !== 403)) throw new Error("Could not load tablet settings. Try again.");
      const [next, pending, clock] = await Promise.all([devices, review, options].map(response => response.ok ? response.json() : null));
      if (signal?.aborted) return;
      setData(next); setCanApprove(approval.ok); setReviews(pending?.entries ?? null); setIdleSeconds(clock?.idleSeconds ?? null); setError("");
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
    <header><a href="/">← Dashboard</a><h1>Tablet &amp; PIN access</h1><p>Manage the shared clock separately from personal dashboard sign-in.</p></header>
    {loading ? <p role="status">Loading tablet settings…</p> : null}
    {notice ? <p className="kiosk-notice" role="status">{notice}</p> : null}
    {error ? <div><p className="kiosk-error" role="alert">{error}</p><button onClick={() => void load()}>Try again</button></div> : null}
    {!loading && !error && !data && !canApprove && !reviews && idleSeconds === null ? <p>You do not have tablet management or approval access. Ask an Owner.</p> : null}
    {idleSeconds !== null ? <ClockIdleSettings key={idleSeconds} seconds={idleSeconds} onSaved={() => saved("Clock settings saved.")} /> : null}
    {reviews ? <OfflineClockReview entries={reviews} onReviewed={() => saved("Clock entry reviewed.")} /> : null}
    {data ? <><DeviceSettings devices={data.devices} onSaved={saved} /><PinSettings employees={data.employees} onSaved={saved} /></> : null}
    {canApprove ? <PinSettings onSaved={saved} /> : null}
  </main>;
}
