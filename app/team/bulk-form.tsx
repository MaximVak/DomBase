"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import type { TeamData } from "../../team/types";
type Row = { name: string; email: string; phone: string; roleId: number; startDate: string; channel: string };
export function BulkTeamForm({ data, busy, save }: { data: TeamData; busy: boolean; save: (operation: string, values: unknown) => Promise<boolean> }) {
  const empty = (): Row => ({ name: "", email: "", phone: "", roleId: data.roles[0]?.id ?? 0, startDate: data.today, channel: "" });
  const [rows, setRows] = useState<Row[]>([empty()]); const [paste, setPaste] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); if (await save("bulk", { rows: rows.map(row => ({ ...row, ...(row.channel ? {} : { channel: undefined }) })) })) setRows([empty()]); }
  return <form className="team-form" onSubmit={submit}><h2>Add team members</h2><p>Add one person or up to 50 together. Either email or phone is required. Invitations are captured locally and are not sent.</p>
    <fieldset disabled={busy || !data.permissions["team.manage"]}><legend className="sr-only">New team members</legend>
      {rows.map((row, index) => <div className="team-new-row" key={index}><h3>Person {index + 1}</h3><div className="team-fields">
        {(["name", "email", "phone", "startDate"] as const).map(key => <label key={key}>{({ name: "Name", email: "Email", phone: "Phone", startDate: "Hire date" })[key]}<input type={key === "startDate" ? "date" : key === "email" ? "email" : "text"} required={key === "name" || key === "startDate"} value={row[key]} onChange={e => setRows(rows => rows.map((r, i) => i === index ? { ...r, [key]: e.target.value } : r))} /></label>)}
        <label>Job<select required value={row.roleId} onChange={e => setRows(rows => rows.map((r, i) => i === index ? { ...r, roleId: Number(e.target.value) } : r))}><option value={0}>Choose job</option>{data.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label>Invitation<select value={row.channel} onChange={e => setRows(rows => rows.map((r, i) => i === index ? { ...r, channel: e.target.value } : r))}><option value="">Add without invitation</option>{data.permissions["team.invite"] ? <><option value="email">Email — local capture</option><option value="sms">SMS — local capture</option></> : null}</select></label>
      </div>{rows.length > 1 ? <button type="button" onClick={() => setRows(rows => rows.filter((_, i) => i !== index))}>Remove person {index + 1}</button> : null}</div>)}
      <div className="team-actions"><button type="button" disabled={rows.length >= 50} onClick={() => setRows(rows => [...rows, empty()])}>Add another row</button><button type="submit" className="team-primary">{busy ? "Saving…" : rows.length === 1 ? "Add team member" : `Add ${rows.length} team members`}</button></div>
      <details><summary>Paste several people</summary><p>Paste tab-separated name, email and phone, one person per line. The first available job and today’s hire date will be selected for review.</p><textarea aria-label="Paste team members" value={paste} onChange={e => setPaste(e.target.value)} /><button type="button" onClick={() => { setRows(paste.trim().split(/\r?\n/).slice(0, 50).filter(Boolean).map(line => { const [name = "", email = "", phone = ""] = line.split("\t"); return { ...empty(), name, email, phone }; })); setPaste(""); }}>Review pasted rows</button></details>
    </fieldset></form>;
}
