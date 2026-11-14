"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Preferences = { revision: number; version: number; contextToken: string; inApp: boolean; email: boolean; masterEnabled: boolean; hasEmail: boolean };
export function ScheduleAlertPreferences({ endpoint, onSaved }: { onSaved?: () => void; endpoint: "/api/self/schedule-preferences" | "/api/workspace/schedule-preferences" }) {
  const [data, setData] = useState<Preferences | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [pending, setPending] = useState(false), request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setData(null); setError(""); setPending(true);
    try { const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not load alert preferences."); if (!controller.signal.aborted) setData(value); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "Could not load alert preferences. Check your connection and try again."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }, [endpoint]);
  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => { clearTimeout(initial); request.current?.abort(); }; }, [load]);
  async function save() {
    if (!data || pending) return; setPending(true); setError(""); setNotice("");
    const controller = new AbortController(); request.current = controller;
    const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, contextToken: data.contextToken, revision: data.revision, version: data.version, inApp: data.inApp, email: data.email }), signal: controller.signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not save alert preferences."); if (!controller.signal.aborted) { setNotice("Schedule alert preferences saved."); await load(); onSaved?.(); } }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "The save could not be confirmed. Reload preferences before retrying."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <section className="schedule-alert-preferences" aria-label="My schedule alert preferences" aria-busy={pending}><h3>My schedule alerts</h3><p>Choose how you receive future schedule publication and change notices.</p>
    {data ? <><label className="schedule-tool-check"><input type="checkbox" checked={data.inApp} disabled={pending} onChange={event => { setData({ ...data, inApp: event.target.checked }); setNotice(""); }} />In-app notices</label><label className="schedule-tool-check"><input type="checkbox" checked={data.email} disabled={pending} onChange={event => { setData({ ...data, email: event.target.checked }); setNotice(""); }} />Email</label>{!data.hasEmail ? <p>Your profile needs a valid email address to receive email notices. Ask a manager to update it.</p> : null}{!data.masterEnabled ? <p>Company or location alerts are currently disabled for you. Your preferences will apply when those alerts are enabled.</p> : null}<button type="button" disabled={pending} onClick={() => void save()}>Save my schedule alerts</button></> : pending ? <p role="status">Loading alert preferences…</p> : null}
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}<button type="button" disabled={pending} onClick={() => void load()}>Reload preferences</button>
  </section>;
}
