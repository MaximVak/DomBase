"use client";
import { useState } from "react";
import type { FormEvent } from "react";

export function ClockIdleSettings({ seconds, onSaved }: { seconds: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(seconds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/kiosk-admin/clock-options", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idleSeconds: Number(value), expectedSeconds: seconds }),
      });
      if (response.status === 409) { setError("The setting changed. Reload before saving again."); return; }
      if (!response.ok) throw new Error();
      onSaved();
    } catch { setError("Could not save the PIN screen timeout. Try again."); }
    finally { setSaving(false); }
  }
  return <section className="kiosk-admin-section" aria-labelledby="kiosk-clock-options-heading">
    <h2 id="kiosk-clock-options-heading">Clock settings</h2>
    <form onSubmit={save}>
      <label>Return to PIN after (seconds)<input type="number" min={5} max={120} step={1} value={value} required onChange={event => setValue(event.target.value)} aria-describedby="kiosk-timeout-help" /></label>
      <p id="kiosk-timeout-help">The clock also returns to PIN entry as soon as an action is complete.</p>
      {error ? <p className="kiosk-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={saving || Number(value) === seconds}>{saving ? "Saving…" : "Save clock settings"}</button>
    </form>
  </section>;
}
