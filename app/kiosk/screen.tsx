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
import { clearOfflineDevice, offlineDeviceName, prepareEmployeePin, prepareOfflineDevice, recordOfflineClock, signInOffline, storePreparedPin } from "./offline-pin";
import type { OfflineSession, PreparedPin } from "./offline-pin";
import { prepareOfflineShell } from "./offline-shell";

type Phase = "loading" | "unregistered" | "pin" | "person" | "approval" | "error";
type Cooldowns = { pin: PinCooldown | null; approve: PinCooldown | null };
type PendingApproval = { id: string; early: boolean; idleMs: number; deadline: number; hardDeadline: number };

export function KioskScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [deviceName, setDeviceName] = useState("");
  const [person, setPerson] = useState<ClockPerson | null>(null);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const offlinePerson = useRef<OfflineSession | null>(null);
  const preparedPin = useRef<PreparedPin | undefined>(undefined);
  const [message, setMessage] = useState<KioskText | null>(null);
  const [notice, setNotice] = useState<KioskText | null>(null);
  const [language, setLanguage] = useState<KioskLanguage>("en");
  const [cooldowns, setCooldowns] = useState<Cooldowns>({ pin: null, approve: null });
  const clearPinCooldown = useCallback(() => setCooldowns(current => ({ ...current, pin: null })), []);
  const clearApprovalCooldown = useCallback(() => setCooldowns(current => ({ ...current, approve: null })), []);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const pendingPhoto = useRef<Blob | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const approvalActivity = useRef<Promise<unknown> | null>(null);
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
    approvalActivity.current = null;
    pendingPhoto.current = undefined;
    active.current = false;
    working.current = false;
    offlinePerson.current = null;
    preparedPin.current = undefined;
    setPerson(null); setPending(null); setBusy(false); setMessage(null); setNotice(confirmation); setPhase("pin");
    setEpoch(value => value + 1);
    lockRemote();
  }, [lockRemote]);
  const check = useCallback(async (signal?: AbortSignal) => {
    if (checking.current) return;
    checking.current = true;
    try {
      if (!navigator.onLine) throw new Error("Offline.");
      const timeout = AbortSignal.timeout(8000);
      const response = await fetch("/api/kiosk/status?offline=1", { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (signal?.aborted) return;
      if (response.status === 401) {
        registered.current = false; healthy.current = true; setOnline(true); setOfflineReady(false); setDeviceName(""); setPhase("unregistered");
        await clearOfflineDevice().catch(() => undefined);
        await sync();
        return;
      }
      if (!response.ok) throw new Error("Tablet status unavailable.");
      const next = await response.json();
      if (next.offlineDevice) await prepareOfflineDevice(next.offlineDevice, next.deviceName).catch(() => undefined);
      void prepareOfflineShell();
      lockRemote();
      await lockRequest.current;
      if (signal?.aborted) return;
      setCooldowns({ pin: next.pinRetryAfterSeconds > 0 ? pinCooldown(String(next.pinRetryAfterSeconds), "device", Date.now()) : null, approve: next.approvalRetryAfterSeconds > 0 ? pinCooldown(String(next.approvalRetryAfterSeconds), "device", Date.now()) : null });
      registered.current = true; healthy.current = true;
      setOnline(true); setDeviceName(next.deviceName); setMessage(null); setPhase("pin");
      setOfflineReady(Boolean(await offlineDeviceName().catch(() => undefined)));
      await sync();
    } catch {
      if (signal?.aborted) return;
      const local = await offlineDeviceName().catch(() => undefined);
      if (signal?.aborted) return;
      healthy.current = false; setOnline(false); setOfflineReady(Boolean(local));
      registered.current = Boolean(local);
      if (local) { setDeviceName(local); setMessage(null); setPhase("pin"); }
      else { setMessage("checkingFailed"); setPhase("error"); }
    } finally { checking.current = false; }
  }, [lockRemote, sync]);

  useEffect(() => {
    const initial = new AbortController();
    const recover = () => {
      if (!navigator.onLine) { setOnline(false); return; }
      if (document.hidden || active.current) return;
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
    const offline = () => { healthy.current = false; setOnline(false); };
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
    if (phase !== "person" || !person) return;
    const remaining = person.replay ? Date.parse(person.expiresAt) - person.replay.serverTime - (performance.now() - receivedAt.current)
      : Date.parse(person.expiresAt) - Date.now();
    const timer = window.setTimeout(() => reset("locked"), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [phase, person, reset]);

  useEffect(() => {
    if (phase !== "approval" || !pending) return;
    const timer = window.setTimeout(() => reset("locked"), Math.max(0, pending.deadline - performance.now()));
    return () => window.clearTimeout(timer);
  }, [pending, phase, reset]);

  function keepApprovalActive() {
    if (!pending || !online || document.hidden) return;
    const deadline = Math.min(performance.now() + pending.idleMs, pending.hardDeadline);
    setPending({ ...pending, deadline });
    approvalActivity.current = kioskPost("approval-activity", { requestId: pending.id }).catch(() => undefined);
  }

  function selectLanguage(next: KioskLanguage) {
    setLanguage(next);
    try { localStorage.setItem(languageKey, next); } catch { /* Language remains available for this visit. */ }
  }

  async function enterOfflinePin(pin: string, version: number) {
    const { session, retry } = await signInOffline(pin);
    if (version !== generation.current) return false;
    if (retry) setCooldowns(current => ({ ...current, pin: pinCooldown(String(retry), "device", Date.now()) }));
    if (!session) { if (!retry) setMessage("offlineBadPin"); return false; }
    offlinePerson.current = session;
    const expiresAt = Math.min(Date.now() + session.authorization.idleSeconds * 1000, session.authorization.expiresAt - session.clockOffset);
    setPerson({ ...session.person, local: true, state: session.progress?.state ?? session.person.state, expiresAt: new Date(expiresAt).toISOString() });
    setPhase("person");
    return true;
  }

  async function submit(action: "pin" | "approve" | "clock", body: { pin: string; queue?: boolean; breaks?: boolean; requestId?: string } | ClockInput, clockInput?: ClockInput, photo?: Blob) {
    if (working.current || document.hidden) return;
    const cooldown = action === "clock" ? null : cooldowns[action];
    if (cooldown?.scope === "device" && cooldown.until > Date.now()) return;
    const version = generation.current;
    if (action === "clock") pendingPhoto.current = photo;
    const abort = new AbortController();
    controller.current = abort;
    active.current = true; working.current = true;
    setBusy(true); setMessage(null); setNotice(null);
    const replay = clockInput && person?.replay;
    const cached = preparedPin.current;
    const attemptedAt = replay ? Math.floor(replay.serverTime + performance.now() - receivedAt.current) : 0;
    const queued = clockInput && replay ? { ...clockInput, ticket: replay.ticket, attemptedAt,
      ...(cached && !clockInput.details?.assisted ? { followUp: { grant: cached.authorization.id,
        progress: { anchor: "online." + replay.ticket.split(".")[0], state: clockInput.eventType, attemptedAt } } } : {}),
    } : null;
    const pin = "pin" in body ? body.pin : undefined;
    let savedLocally = false;
    let signedIn = false;
    try {
      if (action === "pin" && pin && (!online || !navigator.onLine)) {
        signedIn = await enterOfflinePin(pin, version);
        return;
      }
      if (clockInput && offlinePerson.current) {
        await recordOfflineClock(offlinePerson.current, clockInput);
        if (version === generation.current) reset("queued");
        void sync();
        return;
      }
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
      if (action === "approve") await approvalActivity.current;
      if (version !== generation.current) return;
      if (!navigator.onLine) {
        if (savedLocally) reset("queued");
        else if (clockInput && offlinePerson.current) setMessage("storage");
        else if (action === "pin" && pin && offlineReady) {
          setOnline(false); healthy.current = false;
          signedIn = await enterOfflinePin(pin, version).catch(() => false);
          if (!signedIn && version === generation.current && !registered.current) setMessage("connection");
        } else setMessage("connection");
        return;
      }
      const payload = { ...body, ...(queued ? { ticket: queued.ticket } : {}),
        ...(pendingPhoto.current && action !== "pin" ? { photo: true } : {}),
        ...((action === "pin" && available) || cached ? { offline: true } : {}) };
      const response = await kioskPost(action, payload, abort.signal);
      const data = await response.json();
      if (version !== generation.current) return;
      if (savedLocally && queued) {
        if (response.status >= 500 || [401, 408, 409, 429].includes(response.status)) { reset("queued"); return; }
        try { await removeClock(queued, response.ok && !data.approvalRequired); }
        catch { reset("queued"); return; }
      }
      if (version !== generation.current) return;
      if (!response.ok) {
        if (response.status === 429 && action !== "clock") {
          setCooldowns(current => ({ ...current, [action]: pinCooldown(response.headers.get("retry-after"), data.limitScope, Date.now()) }));
          return;
        }
        if (action === "clock" && ([401, 409].includes(response.status) || data.error === kioskCopy.en.breaksChanged)) reset();
        if (action === "approve" && (response.status === 409 || data.error === "Enter your employee PIN again.")) reset("locked");
        setMessage(localizedError(data.error, response.status, action));
        return;
      }
      if (action === "pin") {
        if (pin && data.offline) {
          const prepared = await prepareEmployeePin(pin, data).catch(() => undefined);
          if (version !== generation.current) return;
          preparedPin.current = prepared;
          if (prepared) setOfflineReady(true);
        }
        signedIn = true;
        receivedAt.current = performance.now();
        setCooldowns(current => ({ ...current, pin: null }));
        setPerson({ employee: data.employee, roles: data.roles, state: data.state, expiresAt: data.expiresAt,
          replay: data.replay, breakView: data.breakView, serverTime: data.serverTime, assist: data.assist,
          clockInPhotos: data.clockInPhotos === true, clockInSchedule: data.clockInSchedule });
        setPhase("person");
      } else if (data.approvalRequired) {
        const at = performance.now();
        setPending({ id: data.requestId, early: data.reason === kioskCopy.en.earlyApproval, idleMs: data.idleMs,
          deadline: at + data.expiresInMs, hardDeadline: at + data.hardExpiresInMs });
        setPhase("approval");
      } else {
        if (cached && data.offline && data.offlineState) {
          await storePreparedPin({ ...cached, authorization: data.offline, clockOffset: data.offline.issuedAt - Date.now(), person: { ...cached.person, state: data.offlineState } }).catch(() => undefined);
          if (version !== generation.current) return;
        }
        if (action === "approve") setCooldowns(current => ({ ...current, approve: null }));
        let confirmation: KioskText = data.assistance === "approved" ? "assistanceApproved" : data.assistance === "pending" ? "assistancePending" : data.eventType;
        if (pendingPhoto.current && data.eventType === "in") {
          const attached = typeof data.photoGrant === "string" && await fetch("/api/kiosk/clock-photo", {
            method: "POST", cache: "no-store", headers: { "Content-Type": "image/jpeg", "X-Clock-Photo-Grant": data.photoGrant },
            body: pendingPhoto.current, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
          }).then(response => response.ok, () => false);
          if (version !== generation.current) return;
          confirmation = attached ? "clockInPhoto" : "clockInPhotoFailed";
        }
        reset(confirmation);
      }
    } catch {
      if (version === generation.current) {
        if (savedLocally) reset("queued");
        else if (clockInput && offlinePerson.current) setMessage("storage");
        else if (action === "pin" && pin && offlineReady) {
          setOnline(false); healthy.current = false;
          signedIn = await enterOfflinePin(pin, version).catch(() => false);
          if (!signedIn && version === generation.current && !registered.current) setMessage("connection");
        } else setMessage("connection");
      }
    } finally {
      if (version === generation.current) {
        working.current = false; setBusy(false);
        if (action === "pin" && !signedIn) active.current = false;
      }
    }
  }

  const offlineText = phase === "person" && available && (person?.replay || person?.local) ? "offlineAction" : phase === "approval" ? "offlineApproval" : offlineReady ? "offlineReady" : "offlinePin";
  return <main className="kiosk-screen" lang={language}>
    <section className="kiosk-shell" data-phase={phase} aria-labelledby="kiosk-heading">
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
      {phase === "pin" ? <PinForm key={epoch} language={language} busy={busy} offline={!online && !offlineReady} locked={cooldowns.pin?.scope === "device"} describedBy={cooldowns.pin ? "kiosk-lockout" : undefined} onSubmit={pin => submit("pin", { pin, queue: available, breaks: true })} /> : null}
      {phase === "person" && person ? <ClockPanel person={person} language={language} busy={busy} online={online} earlyClockBlocked={message === "earlyClock"} offlineBlocked={!online && !((person.replay || person.local) && available)} onClock={(input, photo) => submit("clock", input, input, photo)} onCancel={() => reset()} /> : null}
      {phase === "approval" && pending ? <><h2>{text.approval}</h2><p>{pending.early ? text.earlyApproval : text.approvalReason}</p>{cooldowns.approve ? <PinLockout value={cooldowns.approve} language={language} manager onExpired={clearApprovalCooldown} /> : null}
        <PinForm key={"manager-" + epoch} language={language} manager busy={busy} offline={!online} locked={cooldowns.approve?.scope === "device"} describedBy={cooldowns.approve ? "kiosk-lockout" : undefined} onActivity={keepApprovalActive} onSubmit={pin => submit("approve", { requestId: pending.id, pin })} /><button type="button" onClick={() => reset()}>{text.cancel}</button>
      </> : null}
    </section>
  </main>;
}
