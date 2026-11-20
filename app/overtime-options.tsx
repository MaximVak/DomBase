import type { FormEvent, ReactNode } from "react";
import { defaultOvertimePolicy, overtimeNumbers } from "./schedule-enforcement";
import type { OvertimeNumber, OvertimePolicy } from "./schedule-enforcement";

type Options = OvertimePolicy & { workWeekStart: number };

const unavailable = "Not available yet";

function OvertimeCheckbox({ children, checked = true }: { children: ReactNode; checked?: boolean }) {
  return <label className="enforcement-rule-line overtime-placeholder" title={unavailable}><input type="checkbox" checked={checked} disabled /><span>{children}</span></label>;
}

function InactiveNumber({ label, value, currency = false }: { label: string; value: number; currency?: boolean }) {
  return <input className={currency ? "overtime-money" : "overtime-number"} aria-label={label} type={currency ? "text" : "number"} value={currency ? `$${value.toFixed(2)}` : value} disabled title={unavailable} />;
}

export function OvertimeOptionsPanel({ settings, dirty, message, canManage, onChange, onSave }: {
  settings: Options;
  dirty: boolean;
  message: string;
  canManage: boolean;
  onChange: (changes: Partial<Options>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const threshold = (field: OvertimeNumber, label: string, enabled = true) => (
    <label className="enforcement-field-row">
      <span>{label}</span>
      <input className="overtime-number" type="number" {...overtimeNumbers[field]} required
        disabled={!canManage || !enabled} value={settings[field]} onChange={event => onChange({ [field]: Number(event.target.value) })} />
    </label>
  );
  const rule = (field: "overtimeDailyEnabled" | "overtimeWeeklyEnabled" | "overtimeSeventhDayEnabled" | "overtimeDoubleEnabled", label: string) => (
    <label className="enforcement-rule-line">
      <input type="checkbox" checked={settings[field]} disabled={!canManage} onChange={event => onChange({ [field]: event.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <form className="panel settings-enforcement-panel settings-overtime-panel" onSubmit={onSave}>
      <div className="settings-panel-heading"><h3>Overtime</h3><button type="submit" disabled={!canManage || !dirty}>Save</button></div>
      <p className="enforcement-intro">Set the rules used in Timesheets. The starting values follow California’s general overtime rules.</p>
      <div className="overtime-requirements">
        <a className="overtime-link" href="https://www.dir.ca.gov/dlse/faq_overtime.htm" target="_blank" rel="noreferrer">California overtime guidance</a>
        <button className="overtime-link" type="button" disabled={!canManage} onClick={() => onChange(defaultOvertimePolicy)}>Use California defaults</button>
      </div>

      <section className="overtime-group" aria-labelledby="daily-overtime-title">
        <h4 id="daily-overtime-title">Overtime thresholds</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule">
            {rule("overtimeDailyEnabled", "Enable daily overtime")}
            {threshold("overtimeDailyHours", "Daily overtime starts after (hours)", settings.overtimeDailyEnabled)}
          </div>
          <div className="enforcement-rule">
            {rule("overtimeWeeklyEnabled", "Enable weekly overtime")}
            {threshold("overtimeWeeklyHours", "Weekly overtime starts after (hours)", settings.overtimeWeeklyEnabled)}
          </div>
          <div className="enforcement-rule">
            {rule("overtimeSeventhDayEnabled", "Enable seventh-day overtime")}
            <p>Apply overtime on the seventh day when the employee worked all seven days of the same workweek.</p>
          </div>
          <div className="enforcement-rule">
            {rule("overtimeDoubleEnabled", "Enable double time")}
            {threshold("overtimeDoubleHours", "Daily double time starts after (hours)", settings.overtimeDoubleEnabled)}
            {threshold("overtimeSeventhDoubleHours", "Seventh-day double time starts after (hours)", settings.overtimeDoubleEnabled && settings.overtimeSeventhDayEnabled)}
          </div>
        </div>
      </section>

      <section className="overtime-group" aria-labelledby="overtime-rates-title">
        <h4 id="overtime-rates-title">Pay multipliers</h4>
        <div className="enforcement-basics">
          {threshold("overtimeMultiplier", "Overtime multiplier")}
          {threshold("overtimeDoubleMultiplier", "Double-time multiplier", settings.overtimeDoubleEnabled)}
        </div>
        <p>Timesheets uses the weighted regular rate for different hourly wages in the same workweek. Salaried employees earn overtime unless their recorded wage is marked exempt.</p>
      </section>

      <section className="overtime-group" aria-labelledby="overtime-workweek-title">
        <h4 id="overtime-workweek-title">Workweek settings</h4>
        <div className="enforcement-basics">
          <label className="enforcement-field-row">
            <span>Start of workweek</span>
            <select value={settings.workWeekStart} disabled={!canManage} onChange={event => onChange({ workWeekStart: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map(day => <option value={day} key={day}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}</option>)}
            </select>
          </label>
        </div>
        <p className="overtime-workweek-help">Workdays start at midnight in the location’s time zone. Schedule and Timesheets use the saved workweek start.</p>
      </section>

      <section className="overtime-group" aria-labelledby="overtime-tracking-title">
        <h4 id="overtime-tracking-title">Tracking &amp; calculating overtime</h4>
        <div className="enforcement-rules">
          <OvertimeCheckbox checked={false}>Track overtime across multiple locations</OvertimeCheckbox>
          <div className="enforcement-rule-line overtime-placeholder" title={unavailable}>
            <input type="checkbox" disabled aria-label="Enable split shift pay" />
            <span>Pay my employees for any split shift requirements at</span><InactiveNumber label="Split shift hourly pay" value={0} currency /><span>an hour</span>
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
              <span>Enable holiday pay rate</span><InactiveNumber label="Holiday pay multiplier" value={1.5} /><span>× regular hourly rate</span>
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
