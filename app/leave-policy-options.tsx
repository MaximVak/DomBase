"use client";

import type { PtoPolicyForm } from "../workforce/model";

export function LeavePolicyOptions({ form, change }: {
  form: PtoPolicyForm; change: (next: Partial<PtoPolicyForm>) => void;
}) {
  const sick = form.category === "sick";
  const frontLoaded = sick && form.method === "fixed" && form.fixedFrequency === "annual";
  return <div className="leave-policy-options">
    {form.method === "fixed" ? <div className="my-time-off-fields">
      <label>Credit schedule<select value={form.fixedFrequency}
        onChange={event => change({ fixedFrequency: event.target.value === "pay_period" ? "pay_period" : "annual", carryoverHours: "" })}>
        <option value="annual">Once per year</option><option value="pay_period">Each completed pay period</option>
      </select></label>
    </div> : null}
    <div className="my-time-off-fields">
      <label>Maximum balance (hours)<input type="number" min={sick ? 80 : 0.01} max="10000" step="0.01" placeholder="No cap"
        value={form.maxBalanceHours} onChange={event => change({ maxBalanceHours: event.target.value })} /></label>
      <label>{sick ? "New-hire waiting days to use sick leave" : "New-hire waiting days before accruing"}<input type="number" min="0" max={sick ? 90 : 365}
        value={form.waitingDays} onChange={event => change({ waitingDays: event.target.value })} /></label>
      {frontLoaded ? <label>Year-end carryover (hours)<input type="number" min="0" max="10000" step="0.01" placeholder="Carry full balance"
        value={form.carryoverHours} onChange={event => change({ carryoverHours: event.target.value })} /></label> : null}
    </div>
    <p>{frontLoaded ? "The full annual grant is available in the new year. A blank carryover limit keeps the full unused balance."
      : "Unused earned hours carry forward. The maximum balance limits new accrual."}</p>
    {sick ? <p>Set allowances and caps for the applicable number of workdays. Five workdays can exceed 40 hours.</p> : null}
    <fieldset>
      <legend>Tenure bonuses</legend>
      {form.tenureBonuses.map((bonus, index) => (
        <div className="leave-tenure-bonus" key={index}>
          <label>Anniversary years<input type="number" min="1" max="100" value={bonus.years}
            onChange={event => change({ tenureBonuses: form.tenureBonuses.map((row, i) => i === index ? { ...row, years: event.target.value } : row) })} /></label>
          <label>Bonus hours<input type="number" min="0.01" max="10000" step="0.01" value={bonus.hours}
            onChange={event => change({ tenureBonuses: form.tenureBonuses.map((row, i) => i === index ? { ...row, hours: event.target.value } : row) })} /></label>
          <button type="button" onClick={() => change({ tenureBonuses: form.tenureBonuses.filter((_, i) => i !== index) })}>Remove bonus</button>
        </div>
      ))}
      <button type="button" disabled={form.tenureBonuses.length >= 20} onClick={() => change({ tenureBonuses: [...form.tenureBonuses, { years: "", hours: "" }] })}>Add anniversary bonus</button>
    </fieldset>
  </div>;
}
