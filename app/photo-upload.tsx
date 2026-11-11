"use client";
/* eslint-disable @next/next/no-img-element -- Private photos require session cookies; the image optimizer cannot forward them. */
import { useState } from "react";
import type { ChangeEvent } from "react";
export function PhotoUpload({ employeeId, fileId, self = false, canEdit, onSaved }: { employeeId: number; fileId?: string; self?: boolean; canEdit: boolean; onSaved: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const base = self ? "/api/self/photo" : "/api/documents";
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || pending) return; setPending(true); setError("");
    try { if (file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PNG or JPEG up to 10 MB.");
      const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes); const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const prepared = await fetch(`${base}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, employeeId, kind: "photo", title: "Profile photo", fileName: file.name, contentType: file.type, sizeBytes: bytes.byteLength, sha256 }) }); const intent = await prepared.json(); if (!prepared.ok) throw new Error(intent.error);
      const saved = await fetch(`${base}/${intent.fileId}/content`, { method: "PUT", headers: { "Content-Type": file.type }, body: bytes }); const result = await saved.json(); if (!saved.ok) throw new Error(result.error); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm the photo. Reload before trying again."); } finally { setPending(false); event.target.value = ""; }
  }
  return <div className="profile-photo-control">{fileId ? <img src={`${base}/${fileId}/download`} alt="Employee profile" width={80} height={80} /> : <span>No profile photo</span>}
    {canEdit ? <label>{pending ? "Saving photo…" : "Change profile photo"}<input type="file" accept="image/png,image/jpeg" disabled={pending} onChange={upload} /></label> : null}{error ? <p role="alert">{error}</p> : null}</div>;
}
