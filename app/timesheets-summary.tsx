"use client";

// Named scrolling regions need keyboard focus to navigate wide summary tables.
/* eslint jsx-a11y/no-noninteractive-tabindex: ["error", { "roles": ["region", "tabpanel"] }] */

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import { hourlyWage, timesheetCsv, totalMetrics } from "./timesheets-model";
import type { TimeCard, TimesheetEmployee } from "./timesheets-model";

export const summaryColumns = [
  { id: "first", label: "First name" }, { id: "last", label: "Last name" },
  { id: "legalFirst", label: "Legal first name" }, { id: "legalMiddle", label: "Legal middle name" },
  { id: "legalLast", label: "Legal last name" }, { id: "payroll", label: "Payroll ID" },
  { id: "role", label: "Role" }, { id: "wage", label: "Wage rate" },
  { id: "regular", label: "Regular hours" }, { id: "ot", label: "OT hours" },
  { id: "doubleOt", label: "Double OT" }, { id: "qualifiedOt", label: "Qualified OT" },
  { id: "spread", label: "Spread of hours" }, { id: "split", label: "Split shifts" },
  { id: "scheduled", label: "Scheduled hours" }, { id: "actual", label: "Actual hours" },
  { id: "variance", label: "Actual vs. scheduled" }, { id: "paid", label: "Total paid hours" },
  { id: "breaks", label: "Meal breaks" }, { id: "wages", label: "Estimated wages" },
  { id: "cashTips", label: "Cash tips" }, { id: "creditTips", label: "Credit tips" },
  { id: "pto", label: "PTO" }, { id: "sick", label: "FFCRA – paid sick" },
  { id: "others", label: "FFCRA – others" }, { id: "child", label: "FFCRA – child" },
  { id: "blueLaw", label: "Blue law hours" }, { id: "holiday", label: "Holiday pay" },
];
export const defaultSummaryColumns = ["first", "last", "payroll", "wage", "regular", "ot", "doubleOt", "qualifiedOt", "pto"];
const textColumns = ["first", "last", "legalFirst", "legalMiddle", "legalLast", "payroll", "role", "wage"];
function moveColumn(order: string[], from: string, to: string) {
  const next = [...order];
  const source = next.indexOf(from), target = next.indexOf(to);
  if (source < 0 || target < 0 || source === target) return order;
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
}
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export function summaryRows(employees: TimesheetEmployee[], cards: TimeCard[]) {
  return employees.map(employee => {
    const own = cards.filter(card => card.employeeId === employee.id);
    const parts = employee.name.trim().split(/\s+/);
    const rate = hourlyWage(employee.wage);
    const values: Record<string, string> = {
      first: parts[0] ?? "", last: parts.slice(1).join(" "), payroll: employee.payrollId ?? "",
      wage: rate !== null ? `${money(rate)}/hr` : employee.wage || "—", role: employee.role,
      legalFirst: employee.legalFirstName?.trim() || "—", legalMiddle: employee.legalMiddleName?.trim() || "—", legalLast: employee.legalLastName?.trim() || "—",
    };
    for (const [key, value] of Object.entries(totalMetrics(own))) values[key] = value === null ? "—" : key === "wages" ? money(value) : value.toFixed(2);
    return { employee, values };
  });
}

type Props = {
  employees: TimesheetEmployee[]; cards: TimeCard[];
  dateControl: ReactNode; start: string; end: string; rounding: string | number; filtered: boolean;
  onBack: () => void; onPayrollId?: (employeeId: number, payrollId: string) => void;
};
export function TimesheetsSummary(props: Props) {
  const viewportRef = useRef<HTMLElement>(null);
  const columnsRef = useRef<HTMLDetailsElement>(null);
  const printRef = useRef<HTMLDetailsElement>(null);
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const totalsScrollRef = useRef<HTMLDivElement>(null);
  const dragColumn = useRef<string | null>(null);
  const [columnOrder, setColumnOrder] = useState(summaryColumns.map(column => column.id));
  const [announcement, setAnnouncement] = useState("");
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  useEffect(() => {
    const section = viewportRef.current;
    if (!section) return;
    const mobileNav = document.querySelector<HTMLElement>(".bottom-nav");
    const update = () => {
      const bounds = section.getBoundingClientRect();
      section.style.setProperty("--ts-summary-top", `${Math.round(Math.max(0, bounds.top + window.scrollY))}px`);
      section.style.setProperty("--ts-summary-left", `${bounds.left}px`);
      section.style.setProperty("--ts-summary-width", `${bounds.width}px`);
      const navBounds = mobileNav?.getBoundingClientRect();
      section.style.setProperty("--ts-summary-bottom", `${navBounds && navBounds.height > 0 ? Math.max(0, window.innerHeight - navBounds.top + 8) : 0}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    if (section.parentElement) observer.observe(section.parentElement);
    if (mobileNav) observer.observe(mobileNav);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  const [columns, setColumns] = useState(defaultSummaryColumns);
  const [sort, setSort] = useState({ id: "first", direction: 1 });
  const [printMode, setPrintMode] = useState<"current" | "all">("current");
  const [editing, setEditing] = useState<number | null>(null);
  const [payrollId, setPayrollId] = useState("");
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node)) return; for (const ref of [columnsRef, printRef]) if (ref.current && !ref.current.contains(event.target)) ref.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key !== "Escape") return; for (const ref of [columnsRef, printRef]) if (ref.current?.open) { ref.current.open = false; ref.current.querySelector<HTMLElement>("summary")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => {
    const resetPrint = () => setPrintMode("current");
    window.addEventListener("afterprint", resetPrint);
    return () => window.removeEventListener("afterprint", resetPrint);
  }, []);
  const orderedColumns = columnOrder.map(id => summaryColumns.find(column => column.id === id)!);
  const activeColumns = orderedColumns.filter(column => columns.includes(column.id));
  const ledgerWidths = activeColumns.map(column => column.id === "payroll" ? 200 : column.id === "role" ? 190 : textColumns.includes(column.id) ? 140 : 130);
  const ledgerMinWidth = ledgerWidths.reduce((sum, width) => sum + width, 0);
  const ledgerColumns = <colgroup>{ledgerWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
  function syncLedgerScroll(source: HTMLDivElement, target: HTMLDivElement | null) { if (target && target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft; }
  function reorder(from: string, to: string) {
    setColumnOrder(current => moveColumn(current, from, to));
    setAnnouncement(`${summaryColumns.find(column => column.id === from)?.label} moved to position ${columnOrder.indexOf(to) + 1}`);
  }
  const rows = summaryRows(props.employees, props.cards).sort((a, b) => {
    const numeric = !textColumns.includes(sort.id);
    const av = a.values[sort.id], bv = b.values[sort.id];
    const order = numeric && av !== "—" && bv !== "—" ? Number(av.replace(/[$,]/g, "")) - Number(bv.replace(/[$,]/g, "")) : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    return order * sort.direction || a.employee.name.localeCompare(b.employee.name);
  });
  const totals = totalMetrics(props.cards.filter(card => props.employees.some(employee => employee.id === card.employeeId)));
  function totalsRow(selected: typeof summaryColumns) {
    return <tr>{selected.map((column, index) => {
      const value = textColumns.includes(column.id) ? "" : totals[column.id] == null ? "—" : column.id === "wages" ? money(totals[column.id]!) : totals[column.id]!.toFixed(2);
      const Cell = index === 0 ? "th" : "td";
      return <Cell key={column.id} scope={index === 0 ? "row" : undefined} className={index === 0 && !value ? "ts-summary-text" : "ts-summary-number"} data-total-column={column.id}>{index === 0 ? <span className={value ? "ts-summary-totals-label" : undefined}>{props.filtered ? "Filtered totals" : "Totals"}</span> : null}{value ? <strong>{value}</strong> : null}</Cell>;
    })}</tr>;
  }
  function download() {
    const csv = timesheetCsv([activeColumns.map(column => column.label), ...rows.map(row => activeColumns.map(column => row.values[column.id]))]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `timesheet-summary-${props.start}-${props.end}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function print(mode: "current" | "all") {
    if (printRef.current) printRef.current.open = false;
    flushSync(() => setPrintMode(mode));
    window.print();
  }
  const printColumns = printMode === "all" ? orderedColumns : activeColumns;
  return <section ref={viewportRef} className="timesheets-panel ts-summary-page" aria-label="Timesheet summary" data-summary-print={printMode}>
    <div className="ts-summary-page-top">
      <button type="button" className="ts-summary-back" ref={backRef} onClick={props.onBack}><span aria-hidden="true">←</span>Timesheets</button>
      <div className="ts-summary-toolbar">{props.dateControl}<div className="ts-summary-actions"><details className="ts-summary-print ts-menu-anchor" ref={printRef}><summary><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6Z" /><circle cx="17" cy="11" r=".7" /></svg>Print<span aria-hidden="true">▾</span></summary><div className="ts-popover"><button type="button" onClick={() => print("current")}>Print current columns shown</button><button type="button" onClick={() => print("all")}>Print all columns</button></div></details><button type="button" className="ts-primary" onClick={download}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" /></svg>Download</button></div></div>
      <div className="ts-summary-overview"><div className="ts-summary-cards"><div><span>Sales</span><strong>—</strong><small>Sales data not connected</small></div><div><span>Labor percentage</span><strong>—</strong><small>Requires sales data</small></div><div><span>Estimated wages</span><strong>{totals.wages === null ? "—" : money(totals.wages)}</strong>{totals.wages === null ? <small>Add hourly wage rates to estimate wages</small> : null}</div></div><div className="ts-summary-column-control"><span>Show/hide columns</span><details className="ts-nested-select ts-summary-columns" ref={columnsRef}>
          <summary>{columns.length}/{summaryColumns.length} Columns<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7Z" fill="currentColor" /></svg></summary>
          <div className="ts-option-list ts-summary-column-list">{orderedColumns.map((column, index) => <div className="ts-summary-column-option" key={column.id} onDragOver={event => { if (dragColumn.current) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragColumn.current) reorder(dragColumn.current, column.id); dragColumn.current = null; }}>
            <label><input type="checkbox" checked={columns.includes(column.id)} disabled={columns.length === 1 && columns.includes(column.id)} onChange={() => setColumns(current => current.includes(column.id) ? current.filter(id => id !== column.id) : [...current, column.id])} /><span>{column.label}</span></label>
            <button type="button" className="ts-summary-column-handle" draggable aria-label={`Reorder ${column.label} column`} title="Drag to reorder, or use the arrow keys" onDragStart={event => { dragColumn.current = column.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column.id); }} onDragEnd={() => { dragColumn.current = null; }} onKeyDown={event => {
              const target = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? columnOrder.length - 1 : -1;
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); if (columnOrder[target]) reorder(column.id, columnOrder[target]); }
            }}><svg width="18" height="28" viewBox="0 0 18 28" aria-hidden="true" fill="currentColor">{[5, 14, 23].map(y => <g key={y}><circle cx="4" cy={y} r="3" /><circle cx="14" cy={y} r="3" /></g>)}</svg></button>
          </div>)}<button type="button" className="ts-text-button ts-summary-reset-columns" onClick={() => { setColumns(defaultSummaryColumns); setColumnOrder(summaryColumns.map(column => column.id)); setAnnouncement("Column visibility and order reset"); }}>Reset columns</button></div>
        </details><span className="sr-only" role="status">{announcement}</span></div></div>
    </div>
    <div className="ts-summary-ledger-scroll" ref={ledgerScrollRef} tabIndex={0} role="region" aria-label="Employee summary ledger" onScroll={event => syncLedgerScroll(event.currentTarget, totalsScrollRef.current)}><table className="ts-summary-ledger" style={{ minWidth: ledgerMinWidth }}><caption className="sr-only">Employee totals from {props.start} to {props.end}</caption>{ledgerColumns}<thead><tr>{activeColumns.map(column => <th key={column.id} scope="col" aria-sort={sort.id === column.id ? sort.direction === 1 ? "ascending" : "descending" : "none"}><button type="button" onClick={() => setSort(current => ({ id: column.id, direction: current.id === column.id ? -current.direction : 1 }))}>{column.label}{sort.id === column.id ? <span aria-hidden="true">{sort.direction === 1 ? "▾" : "▴"}</span> : null}</button></th>)}</tr></thead><tbody>{rows.map(({ employee, values }) => <tr key={employee.id}>{activeColumns.map(column => <td className={textColumns.filter(id => id !== "wage").includes(column.id) ? "ts-summary-text" : "ts-summary-number"} key={column.id}>{column.id === "payroll" && props.onPayrollId ? editing === employee.id ? <form className="ts-payroll-editor" onSubmit={event => { event.preventDefault(); props.onPayrollId?.(employee.id, payrollId.trim()); setEditing(null); }}><input aria-label={`Payroll ID for ${employee.name}`} value={payrollId} maxLength={100} onChange={event => setPayrollId(event.target.value)} /><button type="submit">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></form> : <button type="button" className={values.payroll ? "ts-payroll-id" : "ts-payroll-missing"} aria-label={`Edit payroll ID for ${employee.name}`} onClick={() => { setEditing(employee.id); setPayrollId(values.payroll); }}>{values.payroll || "＋ Payroll ID"}</button> : values[column.id] || "—"}</td>)}</tr>)}</tbody></table>{!rows.length ? <div className="ts-empty-state"><h3>No hours recorded in this period</h3><p>Choose another date range or return to Timesheets to add a time card.</p></div> : null}</div>
    <table className="ts-summary-print-ledger" aria-label="Printable timesheet summary"><caption>Timesheet summary · {props.start} – {props.end}</caption><thead><tr>{printColumns.map(column => <th key={column.id} scope="col" data-column={column.id}>{column.label}</th>)}</tr></thead><tbody>{rows.map(({ employee, values }) => <tr key={employee.id}>{printColumns.map(column => <td key={column.id} className={textColumns.filter(id => id !== "wage").includes(column.id) ? "ts-summary-text" : "ts-summary-number"}>{values[column.id] || "—"}</td>)}</tr>)}</tbody><tfoot>{totalsRow(printColumns)}</tfoot></table>
    <p className="ts-summary-page-note">Summary follows the selected dates{props.filtered ? ", filters" : ""} and {props.rounding === "actual" ? "actual hours" : `${props.rounding}-minute rounding`}. Wage and overtime amounts are estimates. Unrecorded amounts show a dash.</p>
    <div className="ts-summary-totals-ribbon" ref={totalsScrollRef} tabIndex={0} role="region" aria-label="Summary totals ribbon" onScroll={event => syncLedgerScroll(event.currentTarget, ledgerScrollRef.current)}><table className="ts-summary-ledger ts-summary-totals-table" style={{ minWidth: ledgerMinWidth }} aria-label="Combined summary totals">{ledgerColumns}<tbody>{totalsRow(activeColumns)}</tbody></table></div>
  </section>;
}
