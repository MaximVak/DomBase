"use client";
import { useEffect, useState } from "react";
import type { TeamInsightsData } from "../../team/insights-types";
export function TeamP2Summary() {
  const [data, setData] = useState<TeamInsightsData | null>(null);
  useEffect(() => { const c = new AbortController(); void fetch("/api/team/insights", { cache: "no-store", signal: c.signal }).then(async r => { if (r.ok && !c.signal.aborted) setData(await r.json()); }).catch(() => {}); return () => c.abort(); }, []);
  return <section className="team-form p2-controls"><h2>Team reminders</h2>{data ? <><p>{data.canCertificates ? `${data.certificateWarnings.length} certificates expired or due within 10 days. ` : ""}{data.milestones.length} shared birthdays/work anniversaries in the next 30 days.</p>{data.certificateWarnings.slice(0, 3).map(c => <p key={c.certificateId}>{c.name} · {c.title} · {c.status} ({c.expirationDate})</p>)}{data.milestones.slice(0, 3).map(m => <p key={m.id}>{m.date} · {m.name} · {m.label}</p>)}</> : <p>Open reports to check current reminders.</p>}<a href="/team/reports">Open team reports &amp; reminders</a></section>;
}
