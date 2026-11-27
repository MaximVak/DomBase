import type { LaborAmounts } from "../../../workforce/reports-labor";
import type { ReportsLabor } from "../../../workforce/reports-overview";
import { currency, Metric } from "../screen";

const showAmount = (amount: number | null) => amount === null ? "Review required" : currency(amount);

function CostTable({ heading, firstColumn, rows, holidayPayEnabled }: {
  heading: string; firstColumn: string; holidayPayEnabled: boolean;
  rows: (LaborAmounts & { key: string | number; name: string; department?: string })[];
}) {
  return <section className="reports-section">
    <h3>{heading}</h3>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to reach and scroll the cost breakdown. */}
    <div className="reports-table-scroll" role="region" aria-label={heading} tabIndex={0}>
      <table className="reports-hours-table reports-labor-table" aria-label={heading}>
        <thead><tr><th scope="col">{firstColumn}</th><th scope="col">Estimated wages</th><th scope="col">Break premiums included</th>
          {holidayPayEnabled && <><th scope="col">Holiday premium</th><th scope="col">Total labor cost</th></>}
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <th scope="row">{row.name}{row.department && <small>{row.department}</small>}</th>
          <td>{showAmount(row.estimatedCents)}</td><td>{showAmount(row.breakPremiumCents)}</td>
          {holidayPayEnabled && <><td>{showAmount(row.holidayPremiumCents)}</td><td>{showAmount(row.totalCents)}</td></>}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function LaborDetail({ report }: { report: ReportsLabor }) {
  const { totals, location, city, roles, departments, holidayPayEnabled } = report;
  if (!report.companyWide) return <p className="reports-status">Labor cost requires company-wide Timesheets access to calculate complete workweeks.</p>;
  return <>
    <section className="reports-section" aria-labelledby="reports-labor-location">
      <h3 id="reports-labor-location">By location</h3>
      <p className="reports-note labor-location">{location}{city && city !== location ? ` · ${city}` : ""}</p>
      <dl className="reports-metrics">
        <Metric label="Estimated wages">{showAmount(totals.estimatedCents)}</Metric>
        <Metric label="Break premiums included">{showAmount(totals.breakPremiumCents)}</Metric>
        {holidayPayEnabled && <><Metric label="Holiday premium">{showAmount(totals.holidayPremiumCents)}</Metric>
          <Metric label="Total labor cost">{showAmount(totals.totalCents)}</Metric></>}
      </dl>
      <p className="reports-note">Estimated wages use recorded Timesheets pay, including overtime, paid leave and verified break premiums.{holidayPayEnabled && " Holiday premium follows its separate Timesheets column."}</p>
      {totals.totalCents === null && <p className="reports-note" role="status">Review incomplete time or wage records in Timesheets. Complete groups show their own estimates.</p>}
      {!roles.length && <p className="reports-note">No payable activity in this date range.</p>}
    </section>
    {roles.length > 0 && <CostTable heading="By role" firstColumn="Role" rows={roles.map(role => ({ ...role, key: role.role, name: role.role || "Unassigned role" }))} holidayPayEnabled={holidayPayEnabled} />}
    {departments.length > 0 && <CostTable heading="By department" firstColumn="Department" rows={departments.map(department => ({ ...department, key: department.id ?? "unassigned" }))} holidayPayEnabled={holidayPayEnabled} />}
  </>;
}
