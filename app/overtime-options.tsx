import type { FormEvent, ReactNode } from "react";

const unavailable = "Not available yet";

function OvertimeCheckbox({ children, checked = true }: { children: ReactNode; checked?: boolean }) {
  return <label className="enforcement-rule-line overtime-placeholder" title={unavailable}><input type="checkbox" checked={checked} disabled /><span>{children}</span></label>;
}

function OvertimeNumber({ label, value, currency = false }: { label: string; value: number; currency?: boolean }) {
  return <input className={currency ? "overtime-money" : "overtime-number"} aria-label={label} type={currency ? "text" : "number"} value={currency ? `$${value.toFixed(2)}` : value} disabled title={unavailable} />;
}

function InactiveLink({ children }: { children: ReactNode }) {
  return <button className="overtime-link" type="button" disabled title={unavailable}>{children}</button>;
}

export function OvertimeOptionsPanel({ weekStart, dirty, message, onWeekStartChange, onSave }: {
  weekStart: number;
  dirty: boolean;
  message: string;
  onWeekStartChange: (day: number) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel settings-enforcement-panel settings-overtime-panel" onSubmit={onSave}>
      <div className="settings-panel-heading"><h3>Overtime</h3><button type="submit" disabled={!dirty}>Save</button></div>
      <p className="enforcement-intro">Save money and stay compliant by tracking overtime through DomBase. <InactiveLink>Learn more</InactiveLink></p>
      <div className="overtime-requirements">
        <InactiveLink>Review overtime requirements for California <span aria-hidden="true">⌄</span></InactiveLink>
      </div>

      <section className="overtime-group" aria-labelledby="daily-overtime-title">
        <h4 id="daily-overtime-title">Daily overtime</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
            <input type="checkbox" checked disabled aria-label="Enable daily overtime" />
            <span>After</span><OvertimeNumber label="Daily overtime threshold in hours" value={8} />
            <span>hours per day, the base pay is</span><OvertimeNumber label="Daily overtime pay multiplier" value={1.5} /><span>× hourly</span>
          </div>
          <div className="enforcement-rule">
            <OvertimeCheckbox>Double overtime requirements</OvertimeCheckbox>
            <p>Employers must pay double time after 12 hours in a day.</p>
          </div>
        </div>
      </section>

      <section className="overtime-group" aria-labelledby="weekly-overtime-title">
        <h4 id="weekly-overtime-title">Weekly overtime</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
            <input type="checkbox" checked disabled aria-label="Enable weekly overtime" />
            <span>After</span><OvertimeNumber label="Weekly overtime threshold in hours" value={40} />
            <span>hours per week, the base pay is</span><OvertimeNumber label="Weekly overtime pay multiplier" value={1.5} /><span>× hourly</span>
          </div>
          <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
            <input type="checkbox" checked disabled aria-label="Alert managers when an employee approaches weekly overtime" />
            <span>Alert managers when an employee approaches</span><OvertimeNumber label="Weekly overtime alert threshold in hours" value={40} /><span>hrs in a week</span>
          </div>
          <div className="enforcement-rule">
            <OvertimeCheckbox>7th day overtime requirements</OvertimeCheckbox>
            <p>Employers must pay time and a half for the first 8 hours and double time after 8 hours if it&apos;s the 7th consecutive day of work.</p>
          </div>
        </div>
      </section>

      <section className="overtime-group" aria-labelledby="overtime-workweek-title">
        <h4 id="overtime-workweek-title">Workweek settings</h4>
        <p className="overtime-workweek-description">A workweek is a period of 168 hours during 7 consecutive 24-hour periods. It may begin on any day of the week and at any hour of the day established by the employer. <InactiveLink>Learn more</InactiveLink></p>
        <div className="enforcement-basics">
          <label className="enforcement-field-row">
            <span>Start of workweek</span>
            <select value={weekStart} onChange={event => onWeekStartChange(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6, 0].map(day => <option value={day} key={day}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}</option>)}
            </select>
          </label>
          <label className="enforcement-field-row overtime-placeholder" title={unavailable}>
            <span>Start of workday</span>
            <select aria-label="Start of workday" value="00:00" disabled><option value="00:00">12:00 am Midnight</option></select>
          </label>
        </div>
        <p className="overtime-workweek-help">The workweek start is also used for week views in Schedule and Timesheets.</p>
      </section>

      <section className="overtime-group" aria-labelledby="overtime-tracking-title">
        <h4 id="overtime-tracking-title">Tracking &amp; calculating overtime</h4>
        <div className="enforcement-rules">
          <OvertimeCheckbox checked={false}>Track overtime across multiple locations</OvertimeCheckbox>
          <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
            <input type="checkbox" disabled aria-label="Enable split shift pay" />
            <span>Pay my employees for any split shift requirements at</span><OvertimeNumber label="Split shift hourly pay" value={0} currency /><span>an hour</span>
          </div>
          <OvertimeCheckbox>Notify managers when an employee hits overtime</OvertimeCheckbox>
        </div>
      </section>

      <section className="overtime-group" aria-labelledby="holiday-pay-title">
        <h4 id="holiday-pay-title">Holiday pay rates</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule">
            <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
              <input type="checkbox" disabled aria-label="Enable holiday pay rate" />
              <span>Enable holiday pay rate</span><OvertimeNumber label="Holiday pay multiplier" value={1.5} /><span>× regular hourly rate</span>
            </div>
            <p>Note: Any hours worked as holiday pay will not count towards overtime calculation.</p>
          </div>
        </div>
        <div className="overtime-holiday-entry">
          <label><span>Date</span><div className="overtime-holiday-date"><span aria-hidden="true">▦</span><input aria-label="Holiday date" placeholder="Choose a date" disabled title={unavailable} /></div></label>
          <label><span>Holiday name</span><input placeholder="Holiday name" disabled title={unavailable} /></label>
          <button type="button" disabled title={unavailable}>＋ Add</button>
        </div>
      </section>
      <button className="overtime-history" type="button" disabled title={unavailable}><span aria-hidden="true">◷</span> View overtime settings history</button>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}
