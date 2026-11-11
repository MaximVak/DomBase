"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
export function InvitationForm() {
  const token = useRef(""); const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [phase, setPhase] = useState("loading"); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  useEffect(() => { const controller = new AbortController();
    token.current ||= new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""; window.history.replaceState(null, "", window.location.pathname);
    void fetch("/api/invitations/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.current }), signal: controller.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!controller.signal.aborted) { setName(body.name); setEmail(body.email); setPhase("ready"); } }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setPhase("invalid"); } });
    return () => controller.abort();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (pending) return; if (password !== confirm) { setError("Passwords do not match."); return; } setPending(true); setError("");
    try { const r = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.current, email, password }) }); const body = await r.json(); if (!r.ok) throw new Error(body.error); setPhase("done"); setPassword(""); setConfirm(""); token.current = ""; } catch (e) { setError(e instanceof Error ? e.message : "Could not accept invitation."); } finally { setPending(false); }
  }
  return <main className="login-screen"><section className="login-card auth-card"><h1>Join DomBase</h1>
    {phase === "loading" ? <p role="status">Checking invitation…</p> : phase === "done" ? <><p role="status">Your profile access is ready.</p><a href="/login">Sign in</a></> : phase === "ready" ? <><p>{name}, choose your own password to access your profile.</p><form onSubmit={submit}><fieldset disabled={pending}><legend className="sr-only">Account setup</legend><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label><label>New password<input type="password" required minLength={15} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label><label>Confirm password<input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></label><p>Use 15–128 characters. Phone invitations also need a sign-in email.</p><button type="submit">{pending ? "Joining…" : "Set up profile access"}</button></fieldset></form></> : null}
    {error ? <p role="alert">{error}</p> : null}</section></main>;
}
