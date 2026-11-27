/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the vinext RSC prefetch error. */
import type { ReactNode } from "react";
import type { ReportsOverview, ReportScope } from "../../workforce/reports-overview";
import { SidebarNavIcon } from "../sidebar-nav-icon";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const reportSections = {
  overview: { path: "/reports", title: "Overview" },
  hours: { path: "/reports/hours", title: "Scheduled vs. Actual Hours" },
  attendance: { path: "/reports/attendance", title: "Attendance" },
};

export function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function signedDuration(seconds: number) {
  const sign = Math.round(Math.abs(seconds) / 60) === 0 ? "" : seconds < 0 ? "−" : "+";
  return sign + duration(Math.abs(seconds));
}

export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="report-metric"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ReportFrame({ active, scope, canCompare, error, start, end, children }: {
  active: keyof typeof reportSections; scope?: ReportScope; canCompare: boolean; error?: string; start: string; end: string; children: ReactNode;
}) {
  const { path, title } = reportSections[active];
  const query = scope ? `?${new URLSearchParams(scope.period)}` : "";
  return <main className="reports-screen">
    <header className="reports-header">
      <a href="/" className="reports-back">← Dashboard</a>
      <div className="reports-title"><SidebarNavIcon icon="reports" /><h1>Reports</h1></div>
    </header>
    {canCompare && <nav className="reports-nav" aria-label="Reports sections">
      {Object.entries(reportSections).map(([key, section]) =>
        <a key={key} href={section.path + query} aria-current={key === active ? "page" : undefined}>{section.title}</a>)}
    </nav>}
    <section className="reports-overview" aria-labelledby="reports-overview-title">
      <div className="reports-overview-heading">
        <div><h2 id="reports-overview-title">{title}</h2>{scope && <p>{scope.location} · {scope.companyWide ? "All departments" : "Your departments"}</p>}</div>
        <form action={path} method="get" className="reports-filters" aria-label="Report dates">
          <label>Start date<input type="date" name="start" defaultValue={start} required /></label>
          <label>End date<input type="date" name="end" defaultValue={end} required /></label>
          <button type="submit">Apply</button>
        </form>
      </div>
      {error && <div className="reports-status" role="alert"><p>{error}</p><a href={path}>Open current workweek</a></div>}
      {children}
    </section>
  </main>;
}

export function ReportsScreen({ report, error, start, end }: { report?: ReportsOverview; error?: string; start: string; end: string }) {
  const { schedule, time, attendance, labor } = report ?? {};
  const difference = schedule && time ? time.workedSeconds - schedule.paidSeconds : undefined;
  return <ReportFrame active="overview" scope={report} canCompare={Boolean(schedule && time)} error={error} start={start} end={end}>
      {report && <>
        {!schedule && !time && <p className="reports-status">Your current access doesn’t include schedule or timesheet reports.</p>}
        {(schedule || time) && <section className="reports-section" aria-labelledby="reports-hours-title">
          <h3 id="reports-hours-title">Hours</h3>
          <dl className="reports-metrics">
            {schedule && <Metric label="Published scheduled hours">{duration(schedule.paidSeconds)}</Metric>}
            {time && <Metric label="Recorded work hours">{duration(time.workedSeconds)}</Metric>}
            {difference !== undefined && <Metric label="Actual minus scheduled">{signedDuration(difference)}</Metric>}
            {time && <Metric label="Paid leave">{duration(time.paidLeaveSeconds)}</Metric>}
          </dl>
          {time?.needsReview && <p className="reports-note">Some time cards need review before their hours are included.</p>}
          {!schedule?.shifts && !schedule?.paidSeconds && !time?.workedSeconds && !time?.paidLeaveSeconds && !time?.needsReview && <p className="reports-note">No shifts or hours in this date range.</p>}
        </section>}
        {attendance && <section className="reports-section" aria-labelledby="reports-attendance-title">
          <h3 id="reports-attendance-title">Attendance</h3>
          <dl className="reports-metrics">
            <Metric label="On-time arrival rate">{attendance.punctualityRate === null ? "—" : `${attendance.punctualityRate}%`}</Metric>
            <Metric label="On-time shifts">{attendance.onTime}</Metric>
            <Metric label="Late arrivals">{attendance.late}</Metric>
            <Metric label="No-shows">{attendance.noShows}</Metric>
          </dl>
        </section>}
        {labor && <section className="reports-section" aria-labelledby="reports-labor-title">
          <h3 id="reports-labor-title">Labor cost</h3>
          <dl className="reports-metrics"><Metric label="Estimated wages">{labor.estimatedCents === null ? "Review required" : usd.format(labor.estimatedCents / 100)}</Metric></dl>
          {labor.estimatedCents === null && <p className="reports-note">{report.companyWide ? "Review time cards and wage setup in Timesheets for this workweek." : "Estimated wages require a company-wide workweek."}</p>}
        </section>}
      </>}
  </ReportFrame>;
}
