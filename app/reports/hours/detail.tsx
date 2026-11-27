import type { ReportHours, ReportsHours } from "../../../workforce/reports-overview";
import { duration, Metric, signedDuration } from "../screen";

const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

function HoursTable({ heading, firstColumn, rows }: {
  heading: string; firstColumn: string; rows: (ReportHours & { key: number | string; label: string })[];
}) {
  return <section className="reports-section">
    <h3>{heading}</h3>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the comparisons on narrow screens. */}
    <div className="reports-table-scroll" role="region" aria-label={heading} tabIndex={0}>
      <table className="reports-hours-table" aria-label={heading}>
        <thead><tr><th scope="col">{firstColumn}</th><th scope="col">Scheduled</th><th scope="col">Actual work</th><th scope="col">Variance</th>
          <th scope="col">Paid leave</th><th scope="col">Break premiums</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <th scope="row">{row.label}{row.needsReview && <small>Time card needs review</small>}</th>
          <td>{duration(row.scheduledSeconds)}</td><td>{duration(row.workedSeconds)}</td><td>{signedDuration(row.varianceSeconds)}</td>
          <td>{duration(row.paidLeaveSeconds)}</td><td>{row.breakPremiumSeconds === null ? "Unavailable" : duration(row.breakPremiumSeconds)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function HoursDetail({ report }: { report: ReportsHours }) {
  const { totals, days, team } = report;
  return <>
    <section className="reports-section" aria-labelledby="reports-hours-total">
      <h3 id="reports-hours-total">Hours for selected dates</h3>
      <dl className="reports-metrics reports-hours-metrics">
        <Metric label="Published scheduled hours">{duration(totals.scheduledSeconds)}</Metric>
        <Metric label="Recorded work hours">{duration(totals.workedSeconds)}</Metric>
        <Metric label="Actual minus scheduled">{signedDuration(totals.varianceSeconds)}</Metric>
        <Metric label="Paid leave">{duration(totals.paidLeaveSeconds)}</Metric>
        <Metric label="Break premium hours">{totals.breakPremiumSeconds === null ? "Unavailable" : duration(totals.breakPremiumSeconds)}</Metric>
      </dl>
      <p className="reports-note">Scheduled hours reflect published shifts and the meal allowance. Variance compares recorded work with scheduled hours. Paid leave and break premiums are shown separately.</p>
      {totals.needsReview && <p className="reports-note" role="status">Time cards that need review are excluded from recorded work. The variance may change after review.</p>}
      {totals.breakPremiumSeconds === null && <p className="reports-note">Break premium totals require the same company-wide time and rate information as Timesheets.</p>}
      {!days.length && <p className="reports-note">No published shifts, time cards or paid leave in this date range.</p>}
    </section>
    {days.length > 0 && <HoursTable heading="By day" firstColumn="Date" rows={days.map(day => ({ ...day, key: day.date,
      label: dateLabel.format(new Date(`${day.date}T12:00:00Z`)) }))} />}
    {team.length > 0 && <HoursTable heading="By team member" firstColumn="Team member" rows={team.map(person => ({ ...person, key: person.id, label: person.name }))} />}
  </>;
}
