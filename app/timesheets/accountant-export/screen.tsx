"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { accountantCells, defaultReferenceHours, payPeriodLabel } from "../../../workforce/accountant-report";
import type { AccountantReport, AccountantRow } from "../../../workforce/accountant-report";
import { accountantCsv, accountantWorkbook } from "./files";

type Format = "csv" | "xls" | "print";
class ReportAccessError extends Error {}

async function loadReport(signal?: AbortSignal): Promise<AccountantReport> {
  const response = await fetch("/api/workspace/accountant-export" + window.location.search, { cache: "no-store", signal });
  if (response.status === 401) window.location.replace("/login");
  const payload = await response.json();
  if (response.status === 401 || response.status === 403) throw new ReportAccessError(payload.error || "You do not have accountant export access.");
  if (!response.ok) throw new Error(payload.error || "Could not prepare the accountant report.");
  return payload;
}

function saveFile(content: BlobPart, mime: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WeeklyHoursField({ employee, value, disabled, onChange }: { employee: AccountantRow; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="accountant-hours-field"><label htmlFor={id}>{employee.name}</label>
    <input id={id} type="number" min="0" max="168" step="any" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
  </div>;
}

export function AccountantExportScreen() {
  const [report, setReport] = useState<AccountantReport>();
  const [showReference, setShowReference] = useState(false);
  const [weeklyInput, setWeeklyInput] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(true);
  const [reload, setReload] = useState(0);
  const saving = useRef(false);
  const eligible = report?.rows.filter(employee => employee.salaryEligible) ?? [];
  const withReference = showReference && eligible.length > 0;
  const weeklyHours = new Map(eligible.map(employee => [employee.employeeId, Number(weeklyInput[employee.employeeId] ?? defaultReferenceHours)]));
  const invalid = withReference && eligible.some(employee => {
    const hours = weeklyHours.get(employee.employeeId)!;
    return weeklyInput[employee.employeeId]?.trim() === "" || !Number.isFinite(hours) || hours < 0 || hours > 168;
  });
  const cells = report ? accountantCells(report, withReference ? weeklyHours : undefined) : [];
  const missingId = report?.rows.filter(row => !row.payrollId.trim()).length ?? 0;
  const reviewCount = report?.rows.filter(row => row.total === null).length ?? 0;

  useEffect(() => {
    const controller = new AbortController();
    void loadReport(controller.signal).then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the report."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [reload]);

  async function exportReport(format: Format) {
    if (!report || !report.rows.length || invalid || saving.current) return;
    saving.current = true;
    setPending(true); setError(""); setStatus("");
    try {
      const latest = await loadReport();
      if (JSON.stringify(latest) !== JSON.stringify(report)) {
        setReport(latest);
        setStatus("Timesheets changed. Review the updated report and choose a format again.");
        return;
      }
      const name = `accountant-timesheets-${report.period.start}-${report.period.end}`;
      if (format === "print") window.print();
      else if (format === "csv") saveFile(accountantCsv(cells), "text/csv;charset=utf-8", `${name}.csv`);
      else saveFile(await accountantWorkbook(cells), "application/vnd.ms-excel", `${name}.xls`);
    } catch (reason) {
      if (reason instanceof ReportAccessError) setReport(undefined);
      setError(reason instanceof Error ? reason.message : "Could not export the report.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <main className="accountant-export-page">
    <header className="accountant-export-header">
      <Link className="accountant-return" href="/">DomBase</Link>
      <h1>Accountant export</h1>
      {report ? <p>{report.location} · {payPeriodLabel(report.period)}</p> : null}
      <div className="accountant-actions">
        <button type="button" disabled={!report?.rows.length || pending || invalid} onClick={() => void exportReport("csv")}>Download CSV</button>
        <button type="button" disabled={!report?.rows.length || pending || invalid} onClick={() => void exportReport("xls")}>Download Excel (.xls)</button>
        <button type="button" disabled={!report?.rows.length || pending || invalid} onClick={() => void exportReport("print")}>Print / Save as PDF</button>
        {error && !report ? <button type="button" disabled={pending} onClick={() => { setError(""); setPending(true); setReload(value => value + 1); }}>Try again</button> : null}
      </div>
    </header>
    {pending ? <p className="accountant-screen-only" role="status">{report ? "Checking the latest timesheets…" : "Preparing the accountant report…"}</p> : null}
    {status ? <p className="accountant-screen-only" role="status">{status}</p> : null}
    {error ? <p className="accountant-screen-only accountant-alert" role="alert">{error}</p> : null}
    {report && <>
      {eligible.length ? <section className="accountant-reference accountant-screen-only" aria-label="Salaried reference options">
        <label className="accountant-reference-toggle"><input type="checkbox" checked={withReference} disabled={pending} onChange={event => setShowReference(event.target.checked)} /> Include salaried reference hours</label>
        {withReference ? <><p>Set weekly hours for each salaried employee. The reference is weekly hours × 52 ÷ {report.periodsPerYear}.</p>
          <div className="accountant-hours-grid">{eligible.map(employee => <WeeklyHoursField key={employee.employeeId} employee={employee}
            value={weeklyInput[employee.employeeId] ?? String(defaultReferenceHours)} disabled={pending} onChange={value => setWeeklyInput(current => ({ ...current, [employee.employeeId]: value }))} />)}</div>
          {invalid ? <p className="accountant-alert" role="alert">Enter weekly hours from 0 to 168 for each salaried employee.</p> : null}</> : null}
      </section> : null}
      <p className="accountant-description">Company-wide hours for the selected dates. Total hours add regular, overtime, double time, and approved paid PTO.</p>
      {report.periodsPerYear === null ? <p className="accountant-description accountant-screen-only">Salaried reference hours are available for a full company pay period.</p> : null}
      {withReference ? <p className="accountant-description">Salaried reference hours are separate from the recorded totals.</p> : null}
      {missingId || reviewCount ? <ul className="accountant-warnings">
        {missingId ? <li>{missingId} {missingId === 1 ? "employee is" : "employees are"} missing a Payroll ID.</li> : null}
        {reviewCount ? <li>{reviewCount} {reviewCount === 1 ? "row has" : "rows have"} hours that need review. Check the affected time cards or pay classifications before processing those rows.</li> : null}
      </ul> : null}
      {report.rows.length ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to reach and scroll the table.
        <div className="accountant-table-scroll" role="region" aria-label="Accountant timesheets" tabIndex={0}>
          <table className="accountant-table">
            <thead><tr>{cells[0].map((column, index) => <th key={column} scope="col" className={index >= 3 ? "accountant-number" : undefined}>{column}</th>)}</tr></thead>
            <tbody>{cells.slice(1).map((row, index) => <tr key={report.rows[index].employeeId}>{row.map((cell, column) => column === 0 ?
              <th scope="row" key={column}>{cell}</th> : <td key={column} className={column >= 3 ? "accountant-number" : undefined}>{typeof cell === "number" ? cell.toFixed(2) : cell || "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <p>No recorded hours or paid PTO for this date range.</p>}
    </>}
  </main>;
}
