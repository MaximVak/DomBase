import type { FormEvent, ReactNode } from "react";

const unavailable = "Not available yet";

function InactiveLink({ children }: { children: ReactNode }) {
  return <button className="breaks-link" type="button" disabled title={unavailable}>{children}</button>;
}

function BreakOption({ label, description, checked = false, children }: { label: string; description: ReactNode; checked?: boolean; children?: ReactNode }) {
  return (
    <div className="enforcement-rule breaks-placeholder">
      <label className="enforcement-rule-line" title={unavailable}><input type="checkbox" checked={checked} disabled /><span>{label}</span></label>
      <p>{description}</p>
      {children}
    </div>
  );
}

function DeleteBreakButton({ duration }: { duration: number }) {
  return <button className="breaks-delete" type="button" disabled title={unavailable} aria-label={`Delete ${duration}-minute meal break`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button>;
}

export function BreaksCompliancePanel({ afterHours, mandatory, dirty, message, onChange, onSave }: {
  afterHours: number;
  mandatory: boolean;
  dirty: boolean;
  message: string;
  onChange: (changes: { mealBreakAfterHours?: number; mandatoryMealBreak?: boolean }) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel settings-enforcement-panel settings-breaks-panel" onSubmit={onSave}>
      <div className="settings-panel-heading"><h3>Breaks &amp; compliance</h3><button type="submit" disabled={!dirty}>Save</button></div>
      <p className="enforcement-intro">Stay compliant with <InactiveLink>California break requirements</InactiveLink> by tracking breaks in DomBase. Owners and managers are only notified when team members miss mandatory breaks. <InactiveLink>Learn more <span aria-hidden="true">↗</span></InactiveLink></p>

      <section className="breaks-section" aria-labelledby="meal-breaks-title">
        <h4 id="meal-breaks-title">Meal breaks (Unpaid)</h4>
        <div className="breaks-meal-grid">
          <span className="breaks-column-label">Break frequency</span><span className="breaks-column-label">Duration</span><span aria-hidden="true" /><span aria-hidden="true" />
          <label className="breaks-frequency"><input type="number" aria-label="Mandatory meal break frequency in hours" min={1} max={24} step={1} required value={afterHours} onChange={event => onChange({ mealBreakAfterHours: Number(event.target.value) })} /><span aria-hidden="true">hours</span></label>
          <input aria-label="First meal break duration" value="30 minutes" disabled title={unavailable} />
          <label className="breaks-mandatory"><input type="checkbox" role="switch" checked={mandatory} onChange={event => onChange({ mandatoryMealBreak: event.target.checked })} /><span>Mandatory break</span></label>
          <DeleteBreakButton duration={30} />
          <input aria-label="Optional meal break frequency" value="4 hours" disabled title={unavailable} />
          <input aria-label="Optional meal break duration" value="45 minutes" disabled title={unavailable} />
          <label className="breaks-mandatory breaks-placeholder" title={unavailable}><input type="checkbox" role="switch" disabled /><span>Mandatory break</span></label>
          <DeleteBreakButton duration={45} />
        </div>
        <p className="breaks-alert-help">The mandatory break frequency controls missed-break alerts and the missed-break count in employee performance.</p>
        <button className="breaks-add" type="button" disabled title={unavailable}>＋ Add meal break</button>
        <div className="breaks-divider">
          <BreakOption label="Exclude meal breaks from scheduled hours" checked description="Improve labor estimates by removing meal breaks from schedules and forecasts." />
        </div>
      </section>

      <section className="breaks-section" aria-labelledby="rest-breaks-title">
        <h4 id="rest-breaks-title">Rest breaks (Paid)</h4>
        <button className="breaks-add" type="button" disabled title={unavailable}>＋ Add rest break</button>
        <div className="breaks-divider">
          <BreakOption label="Rest break overage adjustment" description="Convert excess time from a rest break to unpaid time. Awards will not be applied to salaried team members. Please consult your local and state rules for guidelines." />
        </div>
      </section>

      <section className="breaks-section" aria-labelledby="break-settings-title">
        <h4 id="break-settings-title">Break settings</h4>
        <div className="enforcement-rules">
          <BreakOption label="Missed break corrections" description="At clock-out, team members can add missed meal breaks and mandatory rest breaks.">
            <div className="breaks-nested-options">
              <BreakOption label="Skip optional meal breaks" description="At clock-out, team members are only prompted about missed mandatory breaks. Optional meal breaks are not flagged." />
              <BreakOption label="Break waivers" description="When break waivers are enabled, all team members can waive missed mandatory breaks. To disable this for specific individuals, update their break waiver access settings in their profile." />
            </div>
          </BreakOption>
          <BreakOption label="Full break completion required" description="Team members must complete their full break before clocking back in." />
          <BreakOption label="Premium wages for missed breaks" description={<>Per California law, award one additional hour of pay for each missed meal or rest break, up to a maximum of two hours per workday. <InactiveLink>View California premium pay requirements <span aria-hidden="true">↗</span></InactiveLink></>} />
        </div>
      </section>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}
