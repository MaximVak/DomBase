"use client";

import { useId, useState } from "react";
import type { PayCalendar, PayPeriod } from "../team/rules";

function usesAnchor(period: PayPeriod) {
  return period === "weekly" || period === "biweekly";
}

export function payCalendarForSave(calendar: PayCalendar, savedAnchor: string): PayCalendar {
  return usesAnchor(calendar.payPeriod) ? calendar : { ...calendar, anchorDate: savedAnchor };
}

export function PayPeriodFields({ calendar, disabled, onChange }: {
  calendar: PayCalendar;
  disabled?: boolean;
  onChange: (calendar: PayCalendar) => void;
}) {
  const frequencyLabel = useId();
  return <>
    <label>
      <span id={frequencyLabel}>Pay frequency</span>
      <select aria-labelledby={frequencyLabel} value={calendar.payPeriod} disabled={disabled} onChange={event => onChange({ ...calendar, payPeriod: event.target.value as PayPeriod })}>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Every two weeks</option>
        <option value="semimonthly">Twice a month</option>
        <option value="monthly">Monthly</option>
      </select>
    </label>
    {usesAnchor(calendar.payPeriod) ? <label>
      <span>Pay-period start date</span>
      <input type="date" required value={calendar.anchorDate} disabled={disabled} onChange={event => onChange({ ...calendar, anchorDate: event.target.value })} />
    </label> : <p>{calendar.payPeriod === "semimonthly" ? "Periods run from the 1st to the 15th and the 16th to the end of each month." : "Periods run from the first to the last day of each month."}</p>}
  </>;
}

export function PayrollSettingsPanel({ saved, canManage, pending, onSave }: {
  saved: PayCalendar;
  canManage: boolean;
  pending: boolean;
  onSave: (calendar: PayCalendar) => Promise<boolean>;
}) {
  const [calendar, setCalendar] = useState<PayCalendar>(saved);
  const nextCalendar = payCalendarForSave(calendar, saved.anchorDate);
  const dirty = nextCalendar.payPeriod !== saved.payPeriod || nextCalendar.anchorDate !== saved.anchorDate;
  return <form className="panel settings-enforcement-panel settings-payroll-panel" onSubmit={event => {
    event.preventDefault();
    if (canManage && !pending && dirty) void onSave(nextCalendar);
  }}>
    <div className="settings-panel-heading">
      <h3>Payroll settings</h3>
      <button type="submit" disabled={!canManage || pending || !dirty}>Save</button>
    </div>
    <div className="payroll-schedule-settings">
      <h4>Pay schedule</h4>
      <p>Timesheets uses this company-wide calendar. Overtime follows the workweek set under Overtime.</p>
      <div className="payroll-schedule-fields">
        <PayPeriodFields calendar={calendar} disabled={!canManage || pending} onChange={setCalendar} />
      </div>
    </div>
    <div className="payroll-running-settings">
      <label className="enforcement-rule-line" title="Not available yet">
        <input type="checkbox" disabled />
        <span>Lock timesheets after approval</span>
      </label>
    </div>
  </form>;
}
