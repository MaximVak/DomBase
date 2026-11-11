"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { profileError, profileFields } from "../../self/profile";
import type { MyProfile, PersonalProfile } from "../../self/profile";
export function PersonalProfileForm({ profile, busy, blocked, onSave, onReload }: { profile: MyProfile; busy: boolean; blocked: boolean;
  onSave: (values: PersonalProfile) => Promise<boolean>; onReload: () => void }) {
  const [values, setValues] = useState(profile.values);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(profile.values);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || blocked) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const error = profileError(values, today); setError(error ?? ""); if (error) return;
    await onSave(values);
  }
  return <form className="personal-profile-form" onSubmit={submit} aria-label="Edit my profile" aria-busy={busy}>
    <p>Sign-in email: <strong>{profile.accountEmail}</strong>. Your personal email below updates your contact details. Ask an Owner to change your sign-in email.</p>
    <fieldset disabled={busy}>
      <legend className="sr-only">Personal and contact information</legend>
      {(["Contact", "Personal", "Address", "Emergency contact"] as const).map(group => <section key={group} aria-labelledby={`my-profile-${group.replaceAll(" ", "-")}`}>
        <h2 id={`my-profile-${group.replaceAll(" ", "-")}`}>{group}</h2>
        <div className="personal-profile-fields">{profileFields.filter(field => field.group === group).map(field => <label key={field.key} htmlFor={`my-profile-${field.key}`}>{field.label}
          <input id={`my-profile-${field.key}`} type={"type" in field ? field.type : "text"} autoComplete={"autoComplete" in field ? field.autoComplete : "off"}
            maxLength={field.max} required={field.key === "name"} value={values[field.key]}
            onChange={e => { setValues(current => ({ ...current, [field.key]: e.target.value })); setError(""); }} />
        </label>)}</div>
      </section>)}
      <div className="personal-profile-actions"><button type="submit" disabled={!dirty || blocked}>{busy ? "Saving…" : "Save profile"}</button>
        <button type="button" disabled={!dirty} onClick={() => { setValues(profile.values); setError(""); }}>Cancel edits</button>
        <button type="button" onClick={onReload}>Reload saved profile</button></div>
      <p className="personal-profile-help">Reloading discards unsaved edits. Job details, wages and access are managed by your employer.</p>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
