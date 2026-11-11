"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const setup = mode === "setup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recipient, setRecipient] = useState<{ email: string; displayName: string } | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "invalid" | "done">(setup ? "loading" : "ready");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const tokenRef = useRef("");
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!setup) return;
    const controller = new AbortController();
    async function inspect() {
      const token = tokenRef.current || new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      tokenRef.current = token;
      window.history.replaceState(null, "", window.location.pathname);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("This setup link is incomplete. Ask for a new link.");
      const response = await fetch("/api/auth/setup/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This setup link is unavailable.");
      setRecipient(result);
      setPhase("ready");
    }
    void inspect().catch(error => {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Could not open this setup link.");
      setPhase("invalid");
    });
    return () => controller.abort();
  }, [setup]);

  useEffect(() => { if (phase === "done") successRef.current?.focus(); }, [phase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (setup && password !== confirmation) { setMessage("The passwords do not match."); return; }
    setPending(true);
    setMessage("");
    try {
      const body = setup ? { token: tokenRef.current, password } : { email, password };
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not complete your request.");
      setPassword("");
      setConfirmation("");
      if (setup) { tokenRef.current = ""; setPhase("done"); }
      else window.location.replace(result.account?.accessLevel === "employee" ? "/me" : "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect. Please try again.");
    } finally { setPending(false); }
  }

  return (
    <main className="login-screen">
      <section className="login-card auth-card" aria-labelledby="auth-heading">
        <div className="login-brand"><span className="brand-mark" aria-hidden="true">D</span><span className="auth-brand-name">DomBase</span></div>
        <h1 id="auth-heading">{setup ? "Set your password" : "Sign in"}</h1>
        {phase === "done" ? <>
          <h2 ref={successRef} tabIndex={-1}>Your password is set</h2>
          <p>Sign in with your email and the password you chose.</p>
          <a className="auth-link" href="/login">Continue to sign in</a>
        </> : <>
          <p>{setup ? "Choose a password for your account." : "Sign in to your DomBase account."}</p>
          {recipient ? <p className="auth-recipient"><strong>{recipient.displayName}</strong><span>{recipient.email}</span></p> : null}
          {phase === "loading" ? <p role="status">Checking your setup link…</p> : null}
          {message ? <p className="auth-error" role="alert">{message}</p> : null}
          {phase === "ready" ? <form onSubmit={submit} aria-busy={pending}>
            {!setup ? <label htmlFor="auth-email">Email
              <input id="auth-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required />
            </label> : null}
            <label htmlFor="auth-password">{setup ? "New password" : "Password"}
              <input id="auth-password" name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={setup ? 15 : undefined} maxLength={128} aria-describedby={setup ? "password-hint" : undefined} required />
            </label>
            {setup ? <>
              <p id="password-hint" className="auth-hint">Use 15–128 characters. Spaces are welcome.</p>
              <label htmlFor="auth-confirmation">Confirm password
                <input id="auth-confirmation" name="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={15} maxLength={128} required />
              </label>
            </> : null}
            <button type="submit" disabled={pending}>{pending ? "Please wait…" : setup ? "Set password" : "Sign in"}</button>
          </form> : null}
          {!setup ? <p className="auth-hint">Need access? Ask an owner for a private setup link.</p> : null}
          {phase === "invalid" ? <a className="auth-link" href="/login">Back to sign in</a> : null}
        </>}
      </section>
    </main>
  );
}
