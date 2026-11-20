import type { FormEvent, ReactNode } from "react";
import type { ScheduleEnforcement } from "./schedule-enforcement";

type Controls = Pick<ScheduleEnforcement, "paidRestMinutes" | "unpaidRestOverage" | "missedBreakReports" | "breakWaivers" | "blockEarlyBreakReturn">;

const unavailable = "Not available yet";

function InactiveLink({ children }: { children: ReactNode }) {
  return <button className="breaks-link" type="button" disabled title={unavailable}>{children}</button>;
}

function BreakOption({ label, description, checked = false, onToggle }: { label: string; description: ReactNode; checked?: boolean; onToggle?: (checked: boolean) => void }) {
  return (
    <div className={onToggle ? "enforcement-rule" : "enforcement-rule breaks-placeholder"}>
      <label className="enforcement-rule-line" title={onToggle ? undefined : unavailable}><input type="checkbox" checked={checked} disabled={!onToggle} onChange={event => onToggle?.(event.target.checked)} /><span>{label}</span></label>
      <p>{description}</p>
    </div>
  );
}

function DeleteBreakButton({ duration }: { duration: number }) {
  return <button className="breaks-delete" type="button" disabled title={unavailable} aria-label={`Delete ${duration}-minute meal break`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button>;
}

export function BreaksCompliancePanel({ afterHours, minutes, mandatory, controls, dirty, message, onChange, onSave }: {
  afterHours: number;
  minutes: number;
  mandatory: boolean;
  controls: Controls;
  dirty: boolean;
  message: string;
  onChange: (changes: Partial<Controls & Pick<ScheduleEnforcement, "mealBreakAfterHours" | "mealBreakMinutes" | "mandatoryMealBreak">>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel settings-enforcement-panel settings-breaks-panel" onSubmit={onSave}>
      <div className="settings-panel-heading"><h3>Breaks &amp; compliance</h3><button type="submit" disabled={!dirty}>Save</button></div>
      <p className="enforcement-intro">Stay compliant with <InactiveLink>California break requirements</InactiveLink> by tracking breaks in DomBase. Kiosk break checks use the California meal and rest minimums. <InactiveLink>Learn more <span aria-hidden="true">↗</span></InactiveLink></p>

      <section className="breaks-section" aria-labelledby="meal-breaks-title">
        <h4 id="meal-breaks-title">Meal breaks (Unpaid)</h4>
        <div className="breaks-meal-grid">
          <span className="breaks-column-label">Break frequency</span><span className="breaks-column-label">Duration</span><span aria-hidden="true" /><span aria-hidden="true" />
          <label className="breaks-frequency"><input type="number" aria-label="Mandatory meal break frequency in hours" min={1} max={24} step={1} required value={afterHours} onChange={event => onChange({ mealBreakAfterHours: Number(event.target.value) })} /><span aria-hidden="true">hours</span></label>
          <label className="breaks-frequency"><input type="number" aria-label="First meal break duration in minutes" min={30} max={120} step={1} required value={minutes} onChange={event => onChange({ mealBreakMinutes: Number(event.target.value) })} /><span>minutes</span></label>
          <label className="breaks-mandatory"><input type="checkbox" role="switch" checked={mandatory} onChange={event => onChange({ mandatoryMealBreak: event.target.checked })} /><span>Mandatory break</span></label>
          <DeleteBreakButton duration={minutes} />
          <input aria-label="Optional meal break frequency" value="4 hours" disabled title={unavailable} />
          <input aria-label="Optional meal break duration" value="45 minutes" disabled title={unavailable} />
          <label className="breaks-mandatory breaks-placeholder" title={unavailable}><input type="checkbox" role="switch" disabled /><span>Mandatory break</span></label>
          <DeleteBreakButton duration={45} />
        </div>
        <p className="breaks-alert-help">The first meal can be offered earlier. The California kiosk preset checks meals by the fifth and tenth hours, and still checks required meals when the schedule allowance is optional.</p>
        <button className="breaks-add" type="button" disabled title={unavailable}>＋ Add meal break</button>
        <div className="breaks-divider">
          <p>Scheduled paid hours exclude mandatory unpaid meals. Paid rest breaks stay paid.</p>
        </div>
      </section>

      <section className="breaks-section" aria-labelledby="rest-breaks-title">
        <h4 id="rest-breaks-title">Rest breaks (Paid)</h4>
        <label className="breaks-frequency">Paid rest break length <input type="number" min={10} max={120} required step={1} value={controls.paidRestMinutes} onChange={event => onChange({ paidRestMinutes: Number(event.target.value) })} /> minutes</label>
        <div className="breaks-divider">
          <BreakOption label="Rest break overage adjustment" checked={controls.unpaidRestOverage} onToggle={unpaidRestOverage => onChange({ unpaidRestOverage })}
            description="Use only under a communicated policy for unauthorized extensions. Deduct only extra time the employee confirms was spent off duty." />
        </div>
      </section>

      <section className="breaks-section" aria-labelledby="break-settings-title">
        <h4 id="break-settings-title">Break settings</h4>
        <div className="enforcement-rules">
          <BreakOption label="Missed break reports" checked={controls.missedBreakReports} onToggle={missedBreakReports => onChange({ missedBreakReports })}
            description="Ask employees at clock-out to report required breaks they missed or took without recording." />
          <BreakOption label="Meal break waivers" checked={controls.breakWaivers} onToggle={breakWaivers => onChange({ breakWaivers })}
            description="Offer voluntary waivers to eligible employees with waiver access enabled in their profiles. The clock checks the hours worked and any earlier meal." />
          <BreakOption label="Prevent early return from breaks" checked={controls.blockEarlyBreakReturn} onToggle={blockEarlyBreakReturn => onChange({ blockEarlyBreakReturn })}
            description="Wait until the break is complete. Employees who already resumed work can record the actual return." />

        </div>
      </section>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}
