"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PinLockout, pinCooldown } from "./pin-lockout";
import type { PinCooldown } from "./pin-lockout";
import { PinForm } from "./pin-form";
import { ClockPanel } from "./clock-panel";
import type { ClockPerson } from "./clock-panel";
import { queueClock, removeClock } from "./clock-queue";
import type { ClockInput } from "./clock-queue";
import { kioskCopy, languageKey, localizedError } from "./copy";
import type { KioskLanguage, KioskText } from "./copy";
import { kioskPost, useClockQueue } from "./use-clock-queue";

type Phase = "loading" | "unregistered" | "pin" | "person" | "approval" | "error";
type Cooldowns = { pin: PinCooldown | null; approve: PinCooldown | null };

export function KioskScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [deviceName, setDeviceName] = useState("");
  const [person, setPerson] = useState<ClockPerson | null>(null);
  const [pending, setPending] = useState<{ id: string; early: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<KioskText | null>(null);
  const [notice, setNotice] = useState<KioskText | null>(null);
  const [language, setLanguage] = useState<KioskLanguage>("en");
  const [cooldowns, setCooldowns] = useState<Cooldowns>({ pin: null, approve: null });
  const clearPinCooldown = useCallback(() => setCooldowns(current => ({ ...current, pin: null })), []);
  const clearApprovalCooldown = useCallback(() => setCooldowns(current => ({ ...current, approve: null })), []);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const working = useRef(false);
  const registered = useRef(false);
  const receivedAt = useRef(0);
  const healthy = useRef(false);
  const checking = useRef(false);
  const lockRequest = useRef<Promise<unknown>>(Promise.resolve());
  const { available, pendingCount, needsHelp, result, refresh, sync } = useClockQueue();
  const text = kioskCopy[language];

  const lockRemote = useCallback(() => {
    if (!navigator.onLine) return;
    lockRequest.current = lockRequest.current.then(() => kioskPost("lock", {}).catch(() => undefined));
  }, []);
  const reset = useCallback((confirmation: KioskText | null = null) => {
    generation.current += 1;
    controller.current?.abort();
    active.current = false;
    working.current = false;
    setPerson(null); setPending(null); setBusy(false); setMessage(null); setNotice(confirmation); setPhase("pin");
    setEpoch(value => value + 1);
    lockRemote();
  }, [lockRemote]);
  const check = useCallback(async (signal?: AbortSignal) => {
    if (checking.current) return;
    checking.current = true;
    try {
      const timeout = AbortSignal.timeout(8000);
      const response = await fetch("/api/kiosk/status", { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (signal?.aborted) return;
      if (response.status === 401) {
        registered.current = false; healthy.current = true; setDeviceName(""); setPhase("unregistered");
        await sync();
        return;
      }
      if (!response.ok) throw new Error("Tablet status unavailable.");
      const next = await response.json();
      lockRemote();
      await lockRequest.current;
      if (signal?.aborted) return;
      setCooldowns({ pin: next.pinRetryAfterSeconds > 0 ? pinCooldown(String(next.pinRetryAfterSeconds), "device", Date.now()) : null, approve: next.approvalRetryAfterSeconds > 0 ? pinCooldown(String(next.approvalRetryAfterSeconds), "device", Date.now()) : null });
      registered.current = true; healthy.current = true;
      setDeviceName(next.deviceName); setMessage(null); setPhase("pin");
      await sync();
    } catch {
      if (!signal?.aborted) { healthy.current = false; setMessage("checkingFailed"); setPhase("error"); }
    } finally { checking.current = false; }
  }, [lockRemote, sync]);

  useEffect(() => {
    const initial = new AbortController();
    const recover = () => {
      setOnline(navigator.onLine);
      if (document.hidden || active.current || !navigator.onLine) return;
      if (healthy.current) void sync();
      else void check(initial.signal);
    };
    const start = window.setTimeout(() => {
      try { if (localStorage.getItem(languageKey) === "es") setLanguage("es"); } catch { /* Language can be selected for this visit. */ }
      setOnline(navigator.onLine);
      void refresh();
      void check(initial.signal);
    }, 0);
    const timer = window.setInterval(recover, 8000);
    const hide = () => { if (document.hidden && registered.current) reset(); };
    const pageHide = () => { if (registered.current) reset(); };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) { healthy.current = false; recover(); } };
    const offline = () => setOnline(false);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", pageHide);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", offline);
    window.addEventListener("online", recover);
    return () => {
      initial.abort(); generation.current += 1; controller.current?.abort();
      window.clearInterval(timer); window.clearTimeout(start);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", pageHide);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", recover);
    };
  }, [check, refresh, reset, sync]);

  useEffect(() => {
    if (!person) return;
    const remaining = person.replay ? Date.parse(person.expiresAt) - person.replay.serverTime - (performance.now() - receivedAt.current)
      : Date.parse(person.expiresAt) - Date.now();
    const timer = window.setTimeout(() => reset("locked"), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [person, reset]);

  function selectLanguage(next: KioskLanguage) {
    setLanguage(next);
    try { localStorage.setItem(languageKey, next); } catch { /* Language remains available for this visit. */ }
  }

  async function submit(action: "pin" | "approve" | "clock", body: object, clockInput?: ClockInput) {
    if (working.current || document.hidden) return;
    const cooldown = action === "clock" ? null : cooldowns[action];
    if (cooldown?.scope === "device" && cooldown.until > Date.now()) return;
    const version = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    active.current = true; working.current = true;
    setBusy(true); setMessage(null); setNotice(null);
    const replay = clockInput && person?.replay;
    const queued = clockInput && replay ? { ...clockInput, ticket: replay.ticket, attemptedAt: Math.floor(replay.serverTime + performance.now() - receivedAt.current) } : null;
    let savedLocally = false;
    let signedIn = false;
    try {
      if (queued) {
        try {
          await queueClock(queued);
          savedLocally = true;
        } catch {
          if (!navigator.onLine) { setMessage("storage"); return; }
        }
      }
      if (version !== generation.current) return;
      if (action === "pin") { await lockRequest.current; await sync(); }
      if (version !== generation.current) return;
      if (!navigator.onLine) {
        if (savedLocally) reset("queued");
        else setMessage("connection");
        return;
      }
      const response = await kioskPost(action, queued ? { ...body, ticket: queued.ticket } : body, abort.signal);
      const data = await response.json();
      if (version !== generation.current) return;
      if (savedLocally && queued) {
        if (response.status >= 500 || [401, 408, 409, 429].includes(response.status)) { reset("queued"); return; }
        try { await removeClock(queued.ticket); }
        catch { reset("queued"); return; }
      }
      if (version !== generation.current) return;
      if (!response.ok) {
        if (response.status === 429 && action !== "clock") {
          setCooldowns(current => ({ ...current, [action]: pinCooldown(response.headers.get("retry-after"), data.limitScope, Date.now()) }));
          return;
        }
        if (action === "clock" && ([401, 409].includes(response.status) || data.error === kioskCopy.en.breaksChanged)) reset();
        setMessage(localizedError(data.error, response.status, action));
        return;
      }
      if (action === "pin") {
        signedIn = true;
        receivedAt.current = performance.now();
        setCooldowns(current => ({ ...current, pin: null }));
        setPerson(data); setPhase("person");
      } else if (data.approvalRequired) {
        setPending({ id: data.requestId, early: data.reason === kioskCopy.en.earlyApproval }); setPhase("approval");
      } else {
        if (action === "approve") setCooldowns(current => ({ ...current, approve: null }));
        reset(data.eventType);
      }
    } catch {
      if (version === generation.current) {
        if (savedLocally) reset("queued");
        else setMessage("connection");
      }
    } finally {
      if (version === generation.current) {
        working.current = false; setBusy(false);
        if (action === "pin" && !signedIn) active.current = false;
      }
    }
  }

  const offlineText = phase === "person" && available && person?.replay ? "offlineAction" : phase === "approval" ? "offlineApproval" : "offlinePin";
  return <main className="kiosk-screen" lang={language}>
    <section className="kiosk-shell" aria-labelledby="kiosk-heading">
      <header><span className="brand-mark" aria-hidden="true">D</span><div className="kiosk-title"><p className="kiosk-eyebrow">{text.clock}</p><h1 id="kiosk-heading">{deviceName || text.tablet}</h1></div>
        <button type="button" className="kiosk-language" lang={language === "en" ? "es" : "en"} onClick={() => selectLanguage(language === "en" ? "es" : "en")}>{language === "en" ? "Español" : "English"}</button>
      </header>
      {!online ? <p className="kiosk-status" role="status">{text[offlineText]}</p> : null}
      {notice ? <p className="kiosk-notice" role="status">{text[notice]}</p> : null}
      {pendingCount > 0 && notice !== "queued" ? <p className="kiosk-status" role="status">{text.pending}</p> : null}
      {result && phase === "pin" ? <p className="kiosk-notice" role="status">{text[result]}</p> : null}
      {needsHelp ? <p className="kiosk-error" role="alert">{text.queueHelp}</p> : null}
      {!available && (phase === "pin" || phase === "person") ? <p className="kiosk-status" role="status">{text.storage}</p> : null}
      {message ? <p className="kiosk-error" role="alert">{text[message]}</p> : null}
      {phase === "loading" ? <p role="status">{text.checking}</p> : null}
      {phase === "error" ? <button type="button" onClick={() => void check()}>{text.retry}</button> : null}
      {phase === "unregistered" ? <><h2>{text.register}</h2><p>{text.registrationHint}</p></> : null}
      {phase === "pin" && cooldowns.pin ? <PinLockout value={cooldowns.pin} language={language} onExpired={clearPinCooldown} /> : null}
      {phase === "pin" ? <PinForm key={epoch} language={language} busy={busy} offline={!online} locked={cooldowns.pin?.scope === "device"} describedBy={cooldowns.pin ? "kiosk-lockout" : undefined} onSubmit={pin => submit("pin", { pin, queue: available, breaks: true })} /> : null}
      {phase === "person" && person ? <ClockPanel person={person} language={language} busy={busy} earlyClockBlocked={message === "earlyClock"} offlineBlocked={!online && !(person.replay && available)} onClock={input => submit("clock", input, input)} onCancel={() => reset()} /> : null}
      {phase === "approval" && pending ? <><h2>{text.approval}</h2><p>{pending.early ? text.earlyApproval : text.approvalReason}</p>{cooldowns.approve ? <PinLockout value={cooldowns.approve} language={language} manager onExpired={clearApprovalCooldown} /> : null}
        <PinForm key={"manager-" + epoch} language={language} manager busy={busy} offline={!online} locked={cooldowns.approve?.scope === "device"} describedBy={cooldowns.approve ? "kiosk-lockout" : undefined} onSubmit={pin => submit("approve", { requestId: pending.id, pin })} /><button type="button" onClick={() => reset()}>{text.cancel}</button>
      </> : null}
    </section>
  </main>;
}
