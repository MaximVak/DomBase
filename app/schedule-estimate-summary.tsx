import type { ScheduleEstimate } from "./schedule-estimates";

export function ScheduleEstimateSummary({ rows, canReadWages }: { rows: ScheduleEstimate[]; canReadWages: boolean }) {
  const total = (key: "paidMinutes" | "unpaidMinutes" | "overtimeMinutes" | "doubleTimeMinutes") => rows.reduce((sum, row) => sum + row[key], 0) / 60;
  const missing = rows.some(row => row.paidMinutes > 0 && row.wagesCents === null);
  const wages = rows.reduce((sum, row) => sum + (row.wagesCents ?? 0), 0) / 100;
  const issues = [...new Set(rows.flatMap(row => row.issues))];
  return <aside className="schedule-estimate-summary" aria-label="Schedule estimates">
    <div><strong>{total("paidMinutes").toFixed(2)} paid hours</strong><span>{total("unpaidMinutes").toFixed(2)} unpaid meal hours excluded</span></div>
    {canReadWages ? <><div><strong>{missing ? "Wages need review" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(wages)}</strong><span>Estimated base wages + overtime</span></div><div><strong>{total("overtimeMinutes").toFixed(2)} OT · {total("doubleTimeMinutes").toFixed(2)} double time</strong><span>Standard California overtime estimate</span></div></> : null}
    <p>Visible shifts, including drafts. Meals are estimated; actual punches stay unchanged.{canReadWages ? " Excludes tips, missed-break and split-shift premiums. Salary uses an annual ÷ 2,080 planning rate. Workday starts at midnight; workweek uses company settings." : ""}</p>
    {canReadWages && issues.length ? <p role="status">{issues.join(". ")}.</p> : null}
  </aside>;
}
