"use client";
import { useEffect, useState } from "react";
import type { TeamInsightsData } from "../../team/insights-types";
export function EmployeeReliabilityPanel({ employeeId }: { employeeId: number }) {
  const [data, setData] = useState<TeamInsightsData | null>(null), [error, setError] = useState("");
  useEffect(() => { const c = new AbortController(); void fetch("/api/team/insights", {cache:"no-store",signal:c.signal}).then(async r => {const body=await r.json();if(!r.ok)throw new Error(body.error);if(!c.signal.aborted)setData(body);}).catch(e=>{if(!c.signal.aborted)setError(e.message || "Could not load performance.");});return()=>c.abort();}, [employeeId]);
  const person = data?.people.find(p => p.id === employeeId), shifts = data?.shifts.filter(s => s.employeeId === employeeId) ?? [];
  const roles = [...new Set(shifts.map(s => s.role))].map(role => ({role,hours:shifts.filter(s=>s.role===role).reduce((sum,s)=>sum+s.workedHours,0)}));
  const percentage=(n:number|null|undefined)=>n==null?"—":`${n}%`;
  return <><section className="team-member-profile-card performance-attendance-card"><h3>Attendance • this month</h3>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading recorded shift results…</p> : !data.canReliability ? <p>Reports, timesheet and schedule read permissions are required to view performance.</p> : person ? <>
      <div className="performance-metric-grid"><div><span>Attendance rate</span><strong>{percentage(person.attendanceRate)}</strong></div><div><span>On time rate</span><strong>{percentage(person.punctualityRate)}</strong></div><div><span>On-time shift score</span><strong>{percentage(person.onTimeShiftScore)}</strong></div><div><span>Missed clock outs</span><strong>{person.missingClockOuts}</strong></div><div><span>No shows</span><strong>{person.noShows}</strong></div><div><span>Shifts worked</span><strong>{person.worked}</strong></div><div><span>Missed breaks</span><strong>{person.missedBreaks}</strong></div></div><p>{data.start} – {data.end}. Scores use completed scheduled shifts and actual corrected records. Approved leave is excused; unfinished shifts have no score.</p><a href="/team/reports">Open printable punctuality report</a>
    </> : <p>No visible shift results for this person.</p>}</section>
    {data?.canReliability ? <section className="team-member-profile-card performance-role-card"><h3>Role breakdown</h3><div className="performance-role-list">{roles.length ? roles.map(r=><div key={r.role}><strong>{r.role}</strong><span>{r.hours.toFixed(2)} recorded hours</span></div>) : <p>No recorded work in this period.</p>}</div></section> : null}</>;
}
