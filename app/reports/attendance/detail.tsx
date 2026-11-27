import type { ReportsAttendance } from "../../../workforce/reports-overview";
import { Metric } from "../screen";

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const wallClock = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
function wallTime(time: string) {
  const date = new Date(`2000-01-01T${time}:00Z`);
  return Number.isFinite(date.valueOf()) ? wallClock.format(date) : time;
}

function difference(seconds: number | null) {
  if (seconds === null) return "—";
  if (!seconds) return "On schedule";
  const amount = Math.abs(seconds);
  const minutes = Math.floor(amount / 60), remainder = amount % 60;
  const duration = [minutes ? `${minutes}m` : "", remainder ? `${remainder}s` : ""].filter(Boolean).join(" ");
  return `${duration} ${seconds < 0 ? "before" : "after"}`;
}

function Rate({ label, value, count, denominator, description }: {
  label: string; value: number | null; count: number; denominator: number; description: string;
}) {
  return <Metric label={label}>{value === null ? "—" : `${value}%`}<small>{count} of {denominator} {description}</small></Metric>;
}

export function AttendanceDetail({ report }: { report: ReportsAttendance }) {
  const { totals, shifts, zone, lateMinutes } = report;
  const localClock = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const date = (key: string) => dayLabel.format(new Date(`${key}T12:00:00Z`));
  const punch = (stamp: string | null, shiftDate: string) => {
    if (!stamp) return "—";
    const actual = new Date(stamp), actualDay = localDate.format(actual);
    return <>{localClock.format(actual)}{actualDay !== shiftDate && <small>{date(actualDay)}</small>}</>;
  };
  const counts = [["On time", totals.onTime], ["Late", totals.late], ["No shows", totals.noShows], ["Excused", totals.excused],
    ["In progress", totals.inProgress], ["Upcoming", totals.upcoming], ["Needs review", totals.needsReview]] as const;

  return <>
    <section className="reports-section" aria-labelledby="reports-attendance-totals">
      <h3 id="reports-attendance-totals">Shift attendance</h3>
      <dl className="reports-metrics reports-attendance-metrics">
        <Rate label="On-time arrival" value={totals.punctualityRate} count={totals.onTime} denominator={totals.worked} description="worked shifts on time" />
        <Rate label="Attendance" value={totals.attendanceRate} count={totals.worked} denominator={totals.eligible} description="eligible shifts worked" />
        <Rate label="Schedule adherence" value={totals.adherenceRate} count={totals.onTime} denominator={totals.eligible} description="eligible shifts on time" />
      </dl>
      <dl className="attendance-counts">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="reports-note">Eligible shifts include completed worked shifts and no-shows. Excused, open, upcoming and review cases are excluded from the rates.</p>
      <p className="reports-note">Late starts are clock-ins at least {lateMinutes} {lateMinutes === 1 ? "minute" : "minutes"} after the scheduled start.</p>
      {!shifts.length && <p className="reports-note">No published shifts in this date range.</p>}
    </section>
    {shifts.length > 0 && <section className="reports-section">
      <h3>Scheduled and recorded clocks</h3>
      <p className="reports-note attendance-zone">Times shown in {zone}.</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the comparison at narrow widths. */}
      <div className="reports-table-scroll" role="region" aria-label="Shift attendance details" tabIndex={0}>
        <table className="reports-hours-table reports-attendance-table" aria-label="Scheduled and recorded clocks">
          <thead><tr><th scope="col">Shift</th><th scope="col">Scheduled</th><th scope="col">Clock-in</th><th scope="col">Clock-out</th>
            <th scope="col">Arrival difference</th><th scope="col">Departure difference</th><th scope="col">Status</th></tr></thead>
          <tbody>{shifts.map(row => <tr key={row.shiftId}>
            <th scope="row">{row.name}<small>{date(row.date)} · {row.role || "Unassigned role"}</small></th>
            <td>{wallTime(row.scheduledStart)} – {wallTime(row.scheduledEnd)}{row.overnight && <small>Ends next day</small>}</td>
            <td>{punch(row.clockIn, row.date)}</td><td>{punch(row.clockOut, row.date)}</td>
            <td>{difference(row.arrivalSeconds)}</td><td>{difference(row.departureSeconds)}</td>
            <td>{row.status}{row.review && <small>{row.review}</small>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}
  </>;
}
