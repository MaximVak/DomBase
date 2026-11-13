"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the existing vinext RSC Link prefetch error. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamData } from "../../team/types";
import { hourlyRate, rateFor } from "../../team/rules";
import { TeamP2Summary } from "./p2-summary";
import { BulkTeamForm } from "./bulk-form";
import { TeamPersonEditor } from "./person-editor";
import { saveId, teamRequest } from "./client";
type Message = { id: string; employeeId: number; channel: string; recipient: string; status: string; url: string; expiresAt: string };
export function TeamScreen() {
  const [data, setData] = useState<TeamData | null>(null); const [selected, setSelected] = useState(0); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const saving = useRef(false); const [blocked, setBlocked] = useState(false); const [inbox, setInbox] = useState<Message[]>([]); const mounted = useRef(false);
  const reload = useCallback(async () => { const value = await teamRequest<TeamData>("state"); if (mounted.current) { setData(value); setBlocked(false); setInbox([]); } }, []);
  useEffect(() => { mounted.current = true; void reload().catch(e => { if (mounted.current) setError(e.message); }); return () => { mounted.current = false; }; }, [reload]);
  async function save(operation: string, values: unknown) {
    if (!data || saving.current || blocked) return false; saving.current = true; setBusy(true); setError(""); setNotice(""); let committed = false;
    try { await teamRequest("commit", { id: saveId(), revision: data.revision, operation, data: values }); committed = true; setNotice("Changes saved."); await reload(); return true; }
    catch (e) { setBlocked(true); setError(committed ? "Saved, but the latest team could not load. Reload before making another change." : e instanceof Error ? e.message : "Could not confirm the save. Reload before continuing."); return committed; }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  const [showInactive, setShowInactive] = useState(false);
  const visiblePeople = data?.employees.filter(e => showInactive || (e.active && !e.terminated)) ?? [];
  const person = visiblePeople.find(e => e.id === selected);
  return <main className="team-screen"><header><div><a href="/">← Back to DomBase</a><h1>Team details</h1><p>People, jobs, wage history and invitations</p></div><nav className="team-actions" aria-label="Team tools"><a href="/access">Account access &amp; permissions</a><a href="/community">Achievements &amp; shout-outs</a></nav></header>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={busy} onClick={() => { setError(""); void reload().catch(e => setError(e.message)); }}>Reload team</button>
    {data ? <><TeamP2Summary key={data.revision} /><div className="team-toolbar"><label>Team member<select value={person?.id ?? 0} onChange={e => setSelected(Number(e.target.value))}><option value={0}>Choose a person</option>{visiblePeople.map(e => <option key={e.id} value={e.id}>{e.name}{e.terminated ? " — terminated" : ""}</option>)}</select></label><label className="retired-records-toggle"><input type="checkbox" checked={showInactive} disabled={busy} onChange={event => { setShowInactive(event.target.checked); setSelected(0); }} />Show inactive and terminated team members</label><p>Current pay period: {data.currentPeriod.start} – {data.currentPeriod.end}</p></div>
      <fieldset className="team-main-fieldset" disabled={busy || blocked}>{person ? <TeamPersonEditor key={`${person.id}:${data.revision}`} person={person} data={data} busy={busy} save={save} reload={reload} /> : null}
        {data.permissions["team.manage"] ? <BulkTeamForm data={data} busy={busy} save={save} /> : null}
        <TeamPeriodSettings key={data.settings.version} data={data} save={save} />
        {data.permissions["schedule.manage"] ? <DepartmentPublishing data={data} save={save} /> : null}
        {data.permissions["wages.read"] ? <section className="team-form"><h2>Scheduled labor by department</h2><p>Base labor estimates for the current pay period, using each shift’s job and effective rate. Annual salary is allocated at annual / 52 / 40 for estimates; salary payments and final overtime rules are handled separately.</p>{data.departments.map(department => {
          const shifts = data.shifts.filter(s => department.roles.includes(s.role) && s.date >= data.currentPeriod.start && s.date <= data.currentPeriod.end);
          const costs = shifts.map(shift => { const e = data.employees.find(e => e.id === shift.employeeId); const rate = hourlyRate(rateFor(e?.wageRates ?? [], shift.role, shift.date)); return rate === null ? null : rate * Math.max(0, (Number(shift.end.slice(0, 2)) * 60 + Number(shift.end.slice(3)) - Number(shift.start.slice(0, 2)) * 60 - Number(shift.start.slice(3))) / 60); });
          return <p key={department.id}><strong>{department.name}:</strong> {costs.some(c => c === null) ? "Rate missing for one or more shifts" : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0).toLocaleString("en-US", { style: "currency", currency: "USD" })} ({shifts.length} shifts)</p>;
        })}</section> : null}
      </fieldset>
      {data.permissions["team.invite"] ? <section className="team-form"><h2>Local delivery inbox</h2><p>These messages have not been emailed or texted. Links expire after one hour and should be handled privately.</p><button type="button" disabled={busy} onClick={() => { void teamRequest<{ messages: Message[] }>("inbox").then(result => setInbox(result.messages)).catch(e => setError(e.message)); }}>Load local invitations</button>{inbox.map(message => <div key={message.id}><p>{message.channel} · {message.recipient} · {message.status}</p><a href={message.url}>Open private invitation for employee {message.employeeId}</a></div>)}</section> : null}
    </> : !error ? <p role="status">Loading team…</p> : null}</main>;
}
function TeamPeriodSettings({ data, save }: { data: TeamData; save: (op: string, value: unknown) => Promise<boolean> }) {
  const [period, setPeriod] = useState(data.settings.payPeriod); const [anchor, setAnchor] = useState(data.settings.anchorDate);
  if (!data.allDepartments || !data.permissions["settings.manage"]) return null;
  return <form className="team-form" onSubmit={e => { e.preventDefault(); void save("settings", { payPeriod: period, anchorDate: anchor }); }}><h2>Pay-period calendar</h2><p>Used for effective-date shortcuts and termination visibility. This does not run payroll.</p><div className="team-fields"><label>Period<select value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="semimonthly">Twice a month (1–15, 16–end)</option><option value="monthly">Monthly</option></select></label><label>Weekly / biweekly anchor<input type="date" required value={anchor} onChange={e => setAnchor(e.target.value)} /></label></div><button type="submit">Save pay-period calendar</button></form>;
}
function DepartmentPublishing({ data, save }: { data: TeamData; save: (op: string, value: unknown) => Promise<boolean> }) {
  const [id, setId] = useState(data.departments[0]?.id ?? 0);
  return <form className="team-form" onSubmit={e => { e.preventDefault(); void save("publish", { departmentId: id }); }}><h2>Publish one department</h2><p>Save shifts as a draft in Scheduling first. Only this department’s draft changes will be published; other draft changes remain.</p><label>Department<select value={id} required onChange={e => setId(Number(e.target.value))}>{data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><button type="submit" disabled={!id}>Publish department draft</button></form>;
}
