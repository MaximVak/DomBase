"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AvailabilityEditor } from "../../availability-editor";
import { AvailabilityHistory } from "../../availability-history";
import type { AvailabilityRequestSlot } from "../../../workforce/model";
import type { MyAvailability } from "../../../self/availability";

const requestId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function MyAvailabilityScreen() {
  const [data, setData] = useState<MyAvailability | null>(null), [error, setError] = useState("");
  const [pending, setPending] = useState(true), [saved, setSaved] = useState("");
  const active = useRef<AbortController | null>(null), busy = useRef(false), mounted = useRef(false);
  const attempt = useRef<{ values: string; id: string } | null>(null);
  const load = useCallback(async (before?: string) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setPending(true); setError("");
    if (!before) setData(null);
    try {
      const response = await fetch(`/api/self/availability${before ? `?before=${encodeURIComponent(before)}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { setData(null); window.location.assign("/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load availability.");
      if (!controller.signal.aborted) setData(current => before && current && current.contextToken === body.contextToken ? { ...body, requests: [...current.requests, ...body.requests.filter((row: { id: number }) => !current.requests.some(old => old.id === row.id))] } : body);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "Could not load availability. Check your connection and reload."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; const timer = window.setTimeout(() => void load(), 0);
    const hide = () => { if (document.visibilityState === "hidden") { active.current?.abort(); setData(null); } else void load(); };
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; clearTimeout(timer); active.current?.abort(); document.removeEventListener("visibilitychange", hide); };
  }, [load]);
  async function save(effectiveDate: string, slots: AvailabilityRequestSlot[], requestNote: string) {
    if (!data || busy.current) return false;
    busy.current = true; setPending(true); setError(""); setSaved("");
    const values = JSON.stringify({ contextToken: data.contextToken, revision: data.revision, effectiveDate, slots, requestNote });
    if (attempt.current?.values !== values) attempt.current = { values, id: requestId() };
    try {
      const response = await fetch("/api/self/availability", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ id: attempt.current.id, ...JSON.parse(values) }) });
      if (response.status === 401 || response.status === 403) { setData(null); window.location.assign("/login"); return false; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not confirm the save. Reload saved history before retrying.");
      if (mounted.current) { attempt.current = null; setSaved(data.approvalRequired ? "Availability submitted for approval." : "Availability saved."); await load(); }
      return true;
    } catch (reason) { if (mounted.current) setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "Could not confirm the save. Retry the same request or reload saved history."); return false; }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <main className="team-screen employee-availability-screen">
    <header><div><nav aria-label="My account"><a href="/me">← My profile</a> · <a href="/me/schedule">My schedule</a></nav><h1>My availability</h1><p>Weekly preferences, requests and retained history.</p></div><button type="button" disabled={pending} onClick={() => void load()}>Reload saved availability (clears unsaved edits)</button></header>
    {pending ? <p role="status">Loading or saving availability…</p> : null}{error ? <p role="alert">{error}</p> : null}{saved ? <p role="status">{saved}</p> : null}
    {data ? <><p>{data.name} · {data.current ? `Current approved version effective ${data.current.effectiveDate}` : "No approved availability currently in effect"}.</p>
      <AvailabilityEditor key={data.contextToken} today={data.today} initialSlots={data.current?.slots} approvalRequired={data.approvalRequired} disabled={pending} onSave={save} />
      <AvailabilityHistory requests={data.requests} paginate={false} />
      {data.nextCursor ? <button type="button" disabled={pending} onClick={() => void load(data.nextCursor!)}>Load older availability</button> : null}
    </> : null}
  </main>;
}
