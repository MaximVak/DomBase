"use client";
import { useState } from "react";
import { accessRequest } from "./account-access-client";
import type { Access, Account } from "./account-access-client";
export function AccountSetupLink({ account, busy, onBusy, onSaved }: { account: Account; busy: boolean; onBusy: (value: boolean) => void; onSaved: (access: Access) => void }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string; version: number } | null>(null);
  const [error, setError] = useState("");
  const visible = link?.version === account.version ? link : null;
  async function issue() {
    if (busy) return; onBusy(true); setError(""); setLink(null);
    try {
      const result = await accessRequest<{ access: Access; token: string; expiresAt: string }>(`accounts/${account.id}/setup`, undefined, { version: account.version });
      onSaved(result.access);
      setLink({ url: `${window.location.origin}/setup#token=${result.token}`, expiresAt: result.expiresAt, version: result.access.account.version });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create a setup link. Reload and try again."); }
    finally { onBusy(false); }
  }
  if (account.accessLevel === "owner" || (account.accessLevel === "employee" && account.employeeId === null) || account.loginEnabled || account.disabledAt) return null;
  return <section className="account-setup" aria-label="Initial password setup">
    <h4>Password setup</h4>
    <p>Create a private one-use link, valid for one hour. Creating another link invalidates the previous one. No email or SMS is sent.</p>
    <button type="button" disabled={busy} onClick={issue}>Create private setup link</button>
    {visible ? <div role="status"><label htmlFor={`setup-link-${account.id}`}>Private setup link<input id={`setup-link-${account.id}`} type="text" readOnly value={visible.url} onFocus={e => e.target.select()} /></label>
      <p>Expires {new Date(visible.expiresAt).toLocaleTimeString()}. Share privately with the named person. This link disappears when you leave or reload this page.</p>
      <button type="button" onClick={() => setLink(null)}>Hide link</button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
