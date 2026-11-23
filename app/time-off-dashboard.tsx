"use client";

import { useMemo, useState } from "react";
import { approvedLeaveByEmployee, leaveCategories, leaveCategory, leaveRequestMinutes } from "../workforce/leave-duration";
import type { Employee, PtoRequest } from "../workforce/model";

type Dates = { start: string; end: string };

export function TimeOffDashboard({ requests, employees, today, payPeriod, formatDate, formatHours, onReview }: {
  requests: PtoRequest[];
  employees: Employee[];
  today: string;
  payPeriod: Dates;
  formatDate: (date: string) => string;
  formatHours: (hours: number) => string;
  onReview: (id: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [customRange, setCustomRange] = useState<Dates | null>(null);
  const range = customRange ?? payPeriod;
  const validRange = Boolean(range.start && range.end && range.start <= range.end);
  const employeesById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);
  const upcoming = useMemo(() => requests.filter(row => row.status === "approved" && row.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id - b.id), [requests, today]);
  const approvedHours = useMemo(() => validRange ? approvedLeaveByEmployee(requests, { start: range.start, end: range.end })
    .map(row => ({ ...row, name: employeesById.get(row.employeeId)?.name ?? "Employee" }))
    .sort((a, b) => a.name.localeCompare(b.name)) : [], [validRange, requests, range.start, range.end, employeesById]);
  const upcomingLimit = 6;

  return <div className="time-off-dashboard">
    <section aria-labelledby="upcoming-time-off-title">
      <div className="pto-request-section"><h3 id="upcoming-time-off-title">Upcoming time off</h3></div>
      {upcoming.length ? <ul className="time-off-upcoming-list" id="upcoming-time-off-list">
        {(showAll ? upcoming : upcoming.slice(0, upcomingLimit)).map(request => {
          const name = employeesById.get(request.employeeId)?.name ?? "Employee";
          return <li key={request.id}>
            <span><strong>{name}</strong><small>{leaveCategories[leaveCategory(request)]}</small></span>
            <span>{formatDate(request.startDate)}{request.endDate === request.startDate ? "" : ` – ${formatDate(request.endDate)}`}</span>
            <strong>{formatHours(leaveRequestMinutes(request) / 60)}</strong>
            <button type="button" className="pto-history-link" onClick={() => onReview(request.id)} aria-label={`View approved time off for ${name} on ${formatDate(request.startDate)}`}>Details</button>
          </li>;
        })}
      </ul> : <p className="time-off-dashboard-empty">No upcoming approved time off.</p>}
      {upcoming.length > upcomingLimit ? <button type="button" className="pto-history-link" aria-controls="upcoming-time-off-list" aria-expanded={showAll}
        onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer" : `Show all ${upcoming.length} upcoming requests`}</button> : null}
    </section>

    <section aria-labelledby="approved-time-off-title">
      <div className="pto-request-section"><h3 id="approved-time-off-title">Approved hours by employee</h3></div>
      <div className="time-off-approved-range">
        <label>Start date<input type="date" value={range.start} onChange={event => setCustomRange({ ...range, start: event.target.value })} /></label>
        <label>End date<input type="date" value={range.end} onChange={event => setCustomRange({ ...range, end: event.target.value })} /></label>
        {customRange ? <button type="button" className="pto-history-link" onClick={() => setCustomRange(null)}>Current pay period</button> : null}
      </div>
      {approvedHours.length ? <>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the table at narrow widths. */}
        <div className="time-off-approved-scroll" role="region" aria-label="Approved-hours table" tabIndex={0}>
          <table className="time-off-approved-table" aria-labelledby="approved-time-off-title">
            <thead><tr><th scope="col">Employee</th><th scope="col">PTO</th><th scope="col">Sick leave</th><th scope="col">Unpaid</th><th scope="col">Total approved</th></tr></thead>
            <tbody>{approvedHours.map(row => <tr key={row.employeeId}>
              <th scope="row">{row.name}</th><td>{formatHours(row.pto / 60)}</td><td>{formatHours(row.sick / 60)}</td>
              <td>{formatHours(row.unpaid / 60)}</td><td><strong>{formatHours(row.total / 60)}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
        {approvedHours.some(row => row.total < row.pto + row.sick + row.unpaid) ? <p className="time-off-dashboard-note">Overlapping hours count once in the total.</p> : null}
      </> : <p className="time-off-dashboard-empty">{validRange ? "No approved hours in this date range." : "Choose a start date on or before the end date."}</p>}
    </section>
  </div>;
}
