"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoUpload } from "../photo-upload";
import { PersonalProfileForm } from "./profile-form";
import type { MyProfile, PersonalProfile } from "../../self/profile";
function requestId() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function MyProfileScreen() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [pending, setPending] = useState(false); const busy = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [epoch, setEpoch] = useState(0); const mounted = useRef(false);
  const accountEmail = useRef<string | null>(null);
  const unauthorized = useCallback(() => { setProfile(null); window.location.replace("/login"); }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/self/profile", { cache: "no-store", signal });
    if (response.status === 401 || response.status === 403) { if (mounted.current && !signal?.aborted) unauthorized(); return; }
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load your profile.");
    if (mounted.current && !signal?.aborted) { accountEmail.current = data.accountEmail; setProfile(data); setBlocked(false); setEpoch(value => value + 1); }
  }, [unauthorized]);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void load(controller.signal).catch(() => { if (!controller.signal.aborted) setError("Could not load your profile. Try reloading it."); });
    async function checkSession() {
      if (busy.current || document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!mounted.current || controller.signal.aborted) return;
        if (response.status === 401) { unauthorized(); return; }
        if (response.ok) {
          const current = (await response.json()).account;
          if (current?.accessLevel !== "employee") { setProfile(null); window.location.replace("/"); }
          else if (accountEmail.current && current.email !== accountEmail.current) { setProfile(null); window.location.replace("/me"); }
        }
      } catch { /* Preserve drafts while offline; the save still requires a live session. */ }
    }
    const interval = window.setInterval(checkSession, 60000);
    window.addEventListener("focus", checkSession); document.addEventListener("visibilitychange", checkSession);
    return () => { mounted.current = false; controller.abort(); clearInterval(interval); window.removeEventListener("focus", checkSession); document.removeEventListener("visibilitychange", checkSession); };
  }, [load, unauthorized]);
  async function reload() {
    if (busy.current) return; busy.current = true; setPending(true); setError(""); setMessage("");
    try { await load(); } catch { setError("Could not reload your profile. Your unsaved edits are still here."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(values: PersonalProfile) {
    if (!profile || busy.current || blocked) return false;
    busy.current = true; setPending(true); setBlocked(true); setError(""); setMessage(""); let committed = false;
    try {
      const response = await fetch("/api/self/profile", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ id: requestId(), contextToken: profile.contextToken, employeeVersion: profile.employeeVersion, profileVersion: profile.profileVersion, values }) });
      if (response.status === 401 || response.status === 403) { unauthorized(); return false; }
      const result = await response.json();
      if (!response.ok) { if (response.status < 500 && response.status !== 409) setBlocked(false); throw new Error(result.error || "Could not confirm the save. Reload the saved profile before trying again."); }
      committed = true;
      if (mounted.current) { setBlocked(true); setMessage("Profile saved."); }
      await load(); return true;
    } catch (error) {
      if (mounted.current) {
        if (committed || !(error instanceof Error) || error instanceof TypeError) setBlocked(true);
        setError(committed ? "Your profile was saved, but the latest view could not load. Reload the saved profile before making another change."
          : error instanceof Error ? error.message : "Could not confirm the save. Reload the saved profile before trying again.");
      }
      return committed;
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function logout() {
    if (busy.current) return; busy.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(); unauthorized();
    } catch { setError("Could not sign out. Check your connection and try again."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <main className="my-profile-screen">
    <header><div><p className="my-profile-brand">DomBase</p><h1>My profile</h1></div><button type="button" disabled={pending} onClick={logout}>Sign out</button></header>
    {message ? <p role="status">{message}</p> : null}
    {error ? <div className="my-profile-error"><p role="alert">{error}</p><button type="button" disabled={pending} onClick={reload}>Reload saved profile</button></div> : null}
    {profile ? <><p><a href="/community">My achievements, reminders &amp; shout-outs</a></p><PhotoUpload employeeId={profile.employeeId} fileId={profile.photoFileId} self canEdit={!pending && !blocked} onSaved={reload} /><PersonalProfileForm key={epoch} profile={profile} busy={pending} blocked={blocked} onSave={save} onReload={reload} /></>
      : !error ? <p role="status">Loading your profile…</p> : null}
  </main>;
}
