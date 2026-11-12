"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PinLockout, pinCooldown } from "./pin-lockout";
import type { PinCooldown } from "./pin-lockout";
import { PinForm } from "./pin-form";
import { ClockPanel } from "./clock-panel";
import type { ClockInput, ClockPerson } from "./clock-panel";

type Phase = "loading" | "unregistered" | "pin" | "person" | "approval" | "error";
export function KioskScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [deviceName, setDeviceName] = useState("");
  const [person, setPerson] = useState<ClockPerson | null>(null);
  const [pending, setPending] = useState<{ requestId: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldowns, setCooldowns] = useState<{ pin: PinCooldown | null; approve: PinCooldown | null }>({ pin: null, approve: null });
  const clearPinCooldown = useCallback(() => setCooldowns(current => ({ ...current, pin: null })), []);
  const clearApprovalCooldown = useCallback(() => setCooldowns(current => ({ ...current, approve: null })), []);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const registered = useRef(false);
  const lockRemote = useCallback(async () => {
    try { await fetch("/api/kiosk/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", keepalive: true }); } catch { /* Server expiry is authoritative when offline. */ }
  }, []);
  const reset = useCallback((confirmation = "") => {
    generation.current += 1; controller.current?.abort(); active.current = false;
    setPerson(null); setPending(null); setBusy(false); setMessage(""); setNotice(confirmation); setPhase("pin"); setEpoch(value => value + 1);
    void lockRemote();
  }, [lockRemote]);
  const check = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/kiosk/status", { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (response.status === 401) { registered.current = false; setPhase("unregistered"); return; }
      if (!response.ok) throw new Error("Could not check this tablet. Check the connection and try again.");
      const result = await response.json();
      await lockRemote();
      if (signal?.aborted) return;
      setCooldowns({ pin: result.pinRetryAfterSeconds > 0 ? pinCooldown(String(result.pinRetryAfterSeconds), "device", Date.now()) : null, approve: result.approvalRetryAfterSeconds > 0 ? pinCooldown(String(result.approvalRetryAfterSeconds), "device", Date.now()) : null });
      registered.current = true; setDeviceName(result.deviceName); setPhase("pin");
    } catch (error) { if (!signal?.aborted) { setMessage(error instanceof Error ? error.message : "Could not connect."); setPhase("error"); } }
  }, [lockRemote]);
  useEffect(() => {
    const initial = new AbortController();
    async function initialize() { await check(initial.signal); }
    void initialize();
    const hide = () => {
      if (document.visibilityState === "hidden" && registered.current) reset();
    };
    const pageHide = () => {
      if (registered.current) reset();
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) { reset(); void check(); } };
    const offline = () => { if (active.current) reset("Connection lost. Reconnect before recording a clock action."); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("blur", pageHide); window.addEventListener("pagehide", pageHide); window.addEventListener("pageshow", pageShow); window.addEventListener("offline", offline);
    return () => { initial.abort(); generation.current += 1; controller.current?.abort(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("blur", pageHide); window.removeEventListener("pagehide", pageHide); window.removeEventListener("pageshow", pageShow); window.removeEventListener("offline", offline); };
  }, [check, reset]);
  useEffect(() => {
    if (!person) return;
    const timer = window.setTimeout(() => reset("Screen locked. Enter your PIN for another action."), Math.max(0, Date.parse(person.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [person, reset]);
  async function submit(action: string, body: unknown, receive: (result: ClockPerson & { recorded?: boolean; approvalRequired?: boolean; requestId: string; reason: string; eventType: string }) => void) {
    if (busy || document.visibilityState === "hidden") return;
    const cooldown = action === "pin" || action === "approve" ? cooldowns[action] : null;
    if (cooldown?.scope === "device" && cooldown.until > Date.now()) return;
    const version = generation.current; const abort = new AbortController(); controller.current = abort;
    active.current = true; setBusy(true); setMessage(""); setNotice("");
    try {
      const response = await fetch(`/api/kiosk/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: abort.signal });
      const result = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        if (response.status === 429 && (action === "pin" || action === "approve")) {
          setCooldowns(current => ({ ...current, [action]: pinCooldown(response.headers.get("retry-after"), result.limitScope, Date.now()) }));
          return;
        }
        if ([401, 409].includes(response.status) && action !== "pin") { reset(); setMessage(result.error); return; }
        throw new Error(result.error || "Could not record this action. Please try again.");
      }
      if (action === "pin" || action === "approve") setCooldowns(current => ({ ...current, [action]: null }));
      receive(result);
    } catch (error) { if (version === generation.current && !abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not connect. Please try again."); }
    finally {
      if (version === generation.current) setBusy(false);
      else await lockRemote(); // A late PIN response must not leave a hidden person signed in.
    }
  }
  const success = (result: { eventType: string }) => reset(({ in: "Clock-in recorded.", out: "Clock-out recorded.", break: "Break started.", break_end: "Break ended." } as Record<string, string>)[result.eventType] || "Clock action recorded.");
  async function clock(input: ClockInput) {
    await submit("clock", input, result => {
      if (result.approvalRequired) { setPending({ requestId: result.requestId, reason: result.reason }); setPhase("approval"); }
      else success(result);
    });
  }
  return <main className="kiosk-screen">
    <section className="kiosk-shell" aria-labelledby="kiosk-heading">
      <header><span className="brand-mark" aria-hidden="true">D</span><div><p className="kiosk-eyebrow">DomBase time clock</p><h1 id="kiosk-heading">{deviceName || "Breakroom tablet"}</h1></div></header>
      {notice ? <p className="kiosk-notice" role="status">{notice}</p> : null}
      {message ? <p className="kiosk-error" role="alert">{message}</p> : null}
      {phase === "loading" ? <p role="status">Checking this tablet…</p> : null}
      {phase === "error" ? <button onClick={() => void check()}>Try again</button> : null}
      {phase === "unregistered" ? <><h2>Register this tablet</h2><p>An Owner or authorized manager needs to register this browser once. Employee PINs are available after registration.</p><a className="kiosk-primary" href="/kiosk-admin">Manager device setup</a></> : null}
      {phase === "pin" && cooldowns.pin ? <PinLockout value={cooldowns.pin} onExpired={clearPinCooldown} /> : null}
      {phase === "pin" ? <PinForm key={epoch} busy={busy} locked={cooldowns.pin?.scope === "device"} describedBy={cooldowns.pin ? "kiosk-lockout" : undefined} onSubmit={pin => submit("pin", { pin }, result => { setPerson(result); setPhase("person"); })} /> : null}
      {phase === "person" && person ? <ClockPanel person={person} busy={busy} onClock={clock} onCancel={() => reset()} /> : null}
      {phase === "approval" && pending ? <><h2>Manager approval</h2><p>{pending.reason}</p>{cooldowns.approve ? <PinLockout value={cooldowns.approve} manager onExpired={clearApprovalCooldown} /> : null}<PinForm key={`manager-${epoch}`} manager busy={busy} locked={cooldowns.approve?.scope === "device"} describedBy={cooldowns.approve ? "kiosk-lockout" : undefined} onSubmit={pin => submit("approve", { requestId: pending.requestId, pin }, success)} /><button onClick={() => reset()}>Cancel and lock</button></> : null}
    </section>
  </main>;
}
