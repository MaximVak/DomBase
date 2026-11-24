"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { managerEmailEvents, notificationSpec } from "../workforce/notification-preferences-model";
import type { NotificationChannel, NotificationChoices, NotificationEvent, NotificationPreferences as Preferences } from "../workforce/notification-preferences-model";

const channels = { inApp: "In-app", email: "Email", sms: "Text (SMS)" };
type Endpoint = "/api/self/notification-preferences" | "/api/workspace/notification-preferences";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : fallback;
}

export function NotificationPreferences({ endpoint, onSaved }: { endpoint: Endpoint; onSaved?: () => void }) {
  const [data, setData] = useState<Preferences>();
  const [draft, setDraft] = useState<NotificationChoices>({});
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load notification preferences.");
      if (!controller.signal.aborted) { setData(result); setDraft({}); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason, "Could not load preferences. Check your connection and retry."));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => { clearTimeout(initial); request.current?.abort(); };
  }, [load]);

  const dirty = draft.smsEnabled !== undefined || !!Object.keys(draft.events ?? {}).length;
  function change(event: NotificationEvent, channel: NotificationChannel, value: boolean, saved: boolean) {
    setDraft(current => {
      const events = { ...current.events };
      const row = { ...events[event] };
      if (value === saved) delete row[channel];
      else row[channel] = value;
      if (Object.keys(row).length) events[event] = row;
      else delete events[event];
      return { ...current, events };
    });
    setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data || pending || !dirty) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError(""); setNotice("");
    const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    try {
      const { contextToken, revision, version, scheduleVersion } = data;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ id, contextToken, revision, version, scheduleVersion, ...draft }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save notification preferences.");
      if (!controller.signal.aborted) {
        setData(result); setDraft({}); setNotice("Notification preferences saved.");
        onSaved?.();
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason, "The save could not be confirmed. Reload preferences before retrying."));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const sections = new Map<string, Preferences["rows"]>();
  for (const row of data?.rows ?? []) {
    const { group } = notificationSpec(row.id);
    if (!sections.has(group)) sections.set(group, []);
    sections.get(group)!.push(row);
  }
  const personal = !!sections.get("Schedule")?.some(row => row.id === "schedule");
  return <form className="notification-preferences" aria-label="My notification preferences" aria-busy={pending} onSubmit={save}>
    {data ? <>
      {personal && <fieldset className="notification-settings-group" disabled={pending}>
        <legend>Text messages</legend>
        <label className="notification-preference-control"><input type="checkbox" checked={draft.smsEnabled ?? data.smsEnabled} onChange={event => {
          const value = event.target.checked;
          setDraft(current => ({ ...current, smsEnabled: value === data.smsEnabled ? undefined : value }));
          setNotice("");
        }} /> Allow text messages</label>
        <p>Turning this off stops all notification texts.{!data.smsConfigured && " Text delivery is pending setup."}</p>
        {!data.hasPhone && <p>Ask a manager to add a valid mobile number to your profile before using text delivery.</p>}
      </fieldset>}
      {[...sections].map(([title, rows]) => <fieldset className="notification-settings-group" disabled={pending} key={title}>
        <legend>{title}</legend>
        {!data.managerEmailConfigured && rows.some(row => managerEmailEvents.some(event => event === row.id))
          && <p>Manager email delivery is pending setup. Your choices are saved.</p>}
        {rows.map(row => {
          const spec = notificationSpec(row.id);
          return <div className="notification-settings-row" key={row.id} role="group" aria-label={spec.label}>
            <span>{spec.label}</span>
            <div className="notification-settings-channels">
              {(Object.keys(channels) as NotificationChannel[]).map(channel => {
                const saved = row.channels[channel];
                if (saved === undefined) return null;
                const planned = spec.planned.includes(channel) && (channel !== "sms" || !data.smsConfigured);
                return <label className="notification-preference-control" key={channel}>
                  <input type="checkbox" aria-label={spec.label + " " + channels[channel] + (planned ? " (coming later)" : "")}
                    checked={draft.events?.[row.id]?.[channel] ?? saved} onChange={event => change(row.id, channel, event.target.checked, saved)} />
                  <span>{channels[channel]}{planned && <small>Coming later</small>}</span>
                </label>;
              })}
            </div>
          </div>;
        })}
      </fieldset>)}
      {personal && !data.hasScheduleEmail && <p>Ask a manager to add a valid profile email for schedule and clock-out emails.</p>}
      {personal && !data.locationAlerts && <p>Location alerts are disabled for your profile. Your choices are saved for when alerts are enabled.</p>}
      {personal && data.locationAlerts && !data.scheduleAlerts && <p>Company schedule alerts are currently disabled.</p>}
    </> : pending && <p role="status">Loading notification preferences…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="notification-settings-actions">
      {data && <button type="submit" className="primary-action" disabled={pending || !dirty}>Save preferences</button>}
      <button type="button" disabled={pending} onClick={() => void load()}>Reload preferences</button>
    </div>
  </form>;
}
