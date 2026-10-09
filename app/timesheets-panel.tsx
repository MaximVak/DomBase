"use client";

// Named scrolling regions need focus so keyboard users can scroll the ledger and totals.
/* eslint jsx-a11y/no-noninteractive-tabindex: ["error", { "roles": ["region", "tabpanel"] }] */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { buildDayRows, sortDayRows, TimesheetsDay } from "./timesheets-day";
import type { DaySort } from "./timesheets-day";
import { TimesheetsCalendar } from "./timesheets-calendar";
import { TimesheetsSummary } from "./timesheets-summary";
import { TimeCardEditor } from "./time-card-editor";
import { addDays, buildTimeCards, defaultTimesheetColumns, localDate, timesheetColumns, timesheetCsv, timeCardReviews, totalMetrics, validateTimeCard, weekStartFor } from "./timesheets-model";
import type { ColumnId, Rounding, TimeCard, TimeCardDraft, TimeCardEdit, TimesheetAdjustment, TimesheetEmployee, TimesheetEvent, TimesheetPto, TimesheetShift } from "./timesheets-model";

type Props = {
  employees: TimesheetEmployee[]; events: TimesheetEvent[]; shifts: TimesheetShift[]; adjustments: TimesheetAdjustment[]; pto: TimesheetPto[];
  departments: { id: number; name: string; roles: string[] }[]; history: TimeCardEdit[]; today: string; now: number;
  manager: boolean; activeEmployeeId: number; weekStart: number; rounding: Rounding; roundingControl: ReactNode;
  mandatoryMealBreak: boolean; mealBreakAfterHours: number;
  onSaveCard: (draft: TimeCardDraft) => void; onAdjust: (employeeId: number, date: string, hours: number) => void;
  summary?: boolean; onSummaryChange?: (summary: boolean) => void; onPayrollId?: (employeeId: number, payrollId: string) => void;
  onAddTeamMember?: () => void; onSettings: () => void; onBreakSettings?: () => void; locationName?: string;
};
const dayDateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "2-digit", year: "numeric" });
const dateLabel = (date: string, long = false) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", long ? { month: "short", day: "numeric", year: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
const clockLabel = (value?: string) => value ? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase() : "Open";
const timeValue = (value: string) => { const date = new Date(value); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
const cardCount = (cards: TimeCard[]) => new Set(cards.filter(card => card.start).map(card => card.eventIds[0])).size;
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).slice(0, 2).join("");
const metricLabel = (column: ColumnId, value: number | null | undefined) => value == null ? "—" : column === "wages" ? value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : value.toFixed(2);
function download(name: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([timesheetCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Chevron({ up = false }: { up?: boolean }) { return <svg className={up ? "ts-chevron up" : "ts-chevron"} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CalendarIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" /></svg>; }

export function TimesheetsPanel(props: Props) {
  const [localSummary, setSummary] = useState(false);
  const summary = props.summary ?? localSummary;
  const [period, setPeriod] = useState<"day" | "period">("period");
  const [day, setDay] = useState(props.today);
  const [range, setRange] = useState(() => { const start = weekStartFor(props.today, props.weekStart); return { start, end: addDays(start, 6) }; });
  const [menu, setMenu] = useState<"date" | "filters" | "view" | "tools" | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("first");
  const [daySort, setDaySort] = useState<DaySort>("first");
  const [groupBy, setGroupBy] = useState("member");
  const [columns, setColumns] = useState<ColumnId[]>(defaultTimesheetColumns);
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(timesheetColumns.map(column => column.id));
  const [dragColumn, setDragColumn] = useState<ColumnId | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const reviewId = useId();
  const [dialog, setDialog] = useState<"help" | "history" | "card" | null>(null);
  const [inspectingCard, setInspectingCard] = useState<TimeCard | null>(null);
  const [draft, setDraft] = useState<TimeCardDraft | null>(null);
  const hasDraft = draft !== null;
  const [formError, setFormError] = useState("");
  const [headerSort, setHeaderSort] = useState<{ column: string; direction: number } | null>(null);
  const [printMode, setPrintMode] = useState("detail");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const totalsScrollRef = useRef<HTMLDivElement>(null);
  const start = period === "day" ? day : range.start, end = period === "day" ? day : range.end;
  const members = props.employees.filter(employee => props.manager || employee.id === props.activeEmployeeId);
  const memberById = new Map(members.map(member => [member.id, member]));
  const cards = useMemo(() => buildTimeCards({ ...props, employees: props.employees.filter(employee => props.manager || employee.id === props.activeEmployeeId), start, end }), [props, start, end]);
  const visibleCards = cards.filter(card => (!roles.length || roles.includes(card.role)) && (memberById.get(card.employeeId)?.name.toLowerCase().includes(search.toLowerCase())));
  const reviews = timeCardReviews(visibleCards);
  const needsReview = reviews.length;
  const activeColumns = columnOrder.filter(id => columns.includes(id));
  const ledgerWidths = [215, ...activeColumns.map(id => id === "role" ? 120 : id === "card" ? 170 : id === "issues" ? 130 : 95), 45];
  const ledgerMinWidth = ledgerWidths.reduce((sum, width) => sum + width, 0);
  const ledgerColumns = <colgroup>{ledgerWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
  const roleAssignments = new Set(visibleCards.filter(card => card.start || card.adjustment).map(card => `${card.employeeId}:${card.eventIds[0] ?? card.id}:${card.role}`)).size;
  function syncLedgerScroll(source: HTMLDivElement, target: HTMLDivElement | null) { if (target && target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft; }
  const allRoles = [...new Set([...props.departments.flatMap(department => department.roles), ...members.map(member => member.role), ...cards.map(card => card.role)])].filter(Boolean);
  const groups = new Map<string, { name: string; employee?: TimesheetEmployee; cards: TimeCard[] }>();
  for (const card of visibleCards) {
    const employee = memberById.get(card.employeeId);
    const key = groupBy === "role" ? card.role : groupBy === "date" ? card.date : String(card.employeeId);
    if (!groups.has(key)) groups.set(key, { name: groupBy === "role" ? card.role : groupBy === "date" ? dateLabel(card.date) : employee?.name ?? "Team member", employee: groupBy === "member" ? employee : undefined, cards: [] });
    groups.get(key)?.cards.push(card);
  }
  if (showEmpty && groupBy === "member") {
    for (const employee of members) if (!groups.has(String(employee.id)) && employee.name.toLowerCase().includes(search.toLowerCase()) && (!roles.length || roles.includes(employee.role))) groups.set(String(employee.id), { name: employee.name, employee, cards: [] });
  }
  const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => {
    if (headerSort && !["date", "role", "card", "issues", "wage"].includes(headerSort.column)) { const order = (totalMetrics(a.cards)[headerSort.column] ?? 0) - (totalMetrics(b.cards)[headerSort.column] ?? 0); if (order) return order * headerSort.direction; }
    if (sort === "hours") return (totalMetrics(b.cards).paid ?? 0) - (totalMetrics(a.cards).paid ?? 0) || a.name.localeCompare(b.name);
    const name = (value: string) => sort === "last" ? value.split(" ").slice(-1)[0] : value;
    return name(a.name).localeCompare(name(b.name), undefined, { sensitivity: "base" });
  });
  const allCollapsed = orderedGroups.length > 0 && orderedGroups.every(([key]) => collapsed.includes(key));
  const history = props.history.filter(edit => edit.date >= start && edit.date <= end && memberById.has(edit.employeeId));
  const totals = totalMetrics(visibleCards);
  const dayRows = sortDayRows(buildDayRows({ ...props, shifts: props.shifts.filter(shift => !roles.length || roles.includes(shift.role || memberById.get(shift.employeeId)?.role || "")), employees: members.filter(member => member.name.toLowerCase().includes(search.toLowerCase()) && (!roles.length || roles.includes(member.role) || visibleCards.some(card => card.employeeId === member.id))), cards: visibleCards, date: day, showEmpty }), daySort, day);
  const dayIssues = dayRows.reduce((count, row) => count + row.issues.length, 0);
  function openDayCard(card: TimeCard, button: HTMLButtonElement) {
    if (props.manager) editCard(card, button);
    else { setInspectingCard(card); openDialog("card", button); }
  }
  function resolveDayIssue(button: HTMLButtonElement) {
    const row = dayRows.find(row => row.issues.length);
    if (!row) return;
    const card = row.cards.find(card => card.issues.length) ?? row.cards[0];
    if (card) editCard(card, button); else newCard(row.employee.id, button);
  }

  useEffect(() => {
    if (!menu) return;
    const pointer = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest(".ts-menu-anchor")) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [menu]);
  useEffect(() => {
    if (!dialog && !hasDraft) return;
    const element = modalRef.current;
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary, [href]') ?? []).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDialog(null); setDraft(null); triggerRef.current?.focus(); }
      if (event.key === "Tab") { const items = focusable(), first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [dialog, hasDraft]);

  function toggleMenu(value: typeof menu, button: HTMLButtonElement) { triggerRef.current = button; setMenu(menu === value ? null : value); }
  function openDialog(value: typeof dialog, button: HTMLButtonElement) { triggerRef.current = button; setMenu(null); setDialog(value); }
  function closeDialog() { setDraft(null); setDialog(null); triggerRef.current?.focus(); }
  function newCard(employeeId?: number, button?: HTMLButtonElement) {
    if (!props.manager) return;
    if (button) triggerRef.current = button;
    setDraft({ employeeId: employeeId ?? 0, date: start > props.today ? props.today : start, start: "", end: "", nextDay: false, breakMinutes: 0, breaks: [], role: members.find(member => member.id === employeeId)?.role ?? "", note: "", eventIds: [] }); setFormError("");
  }
  function editCard(card: TimeCard, button: HTMLButtonElement) {
    if (!props.manager) return;
    triggerRef.current = button;
    const original = props.events.filter(event => card.eventIds.includes(event.id));
    const startEvent = original.find(event => event.type === "in"), endEvent = original.find(event => event.type === "out");
    if (!startEvent) { newCard(card.employeeId, button); setDraft(current => current ? { ...current, date: card.date, role: card.role } : current); return; }
    const endAt = endEvent?.at ?? new Date(props.now).toISOString();
    const breaks = original.filter(event => event.type === "break").map(event => {
      const breakEnd = original.find(other => other.type === "break_end" && other.at >= event.at)?.at ?? endAt;
      return { id: event.id, start: timeValue(event.at), end: timeValue(breakEnd), nextDay: localDate(new Date(event.at)) !== localDate(new Date(startEvent.at)) };
    });
    setDraft({ employeeId: card.employeeId, date: localDate(new Date(startEvent.at)), start: timeValue(startEvent.at), end: timeValue(endAt), nextDay: localDate(new Date(startEvent.at)) !== localDate(new Date(endAt)), breakMinutes: 0, breaks, role: card.role, note: "", eventIds: card.eventIds, cardId: startEvent.cardId ?? startEvent.id }); setFormError("");
  }
  function saveCard(event: FormEvent) {
    event.preventDefault(); if (!draft || !props.manager) return;
    const error = validateTimeCard(draft, props.events, props.now);
    if (error) { setFormError(error); return; }
    props.onSaveCard(draft); closeDialog();
  }
  function moveColumn(from: ColumnId, to: ColumnId) { if (from === to) return; setColumnOrder(order => { const next = order.filter(id => id !== from); next.splice(next.indexOf(to), 0, from); return next; }); }
  function exportCards() {
    download(`timesheets-${start}-${end}.csv`, [["Team member", "Date", ...activeColumns.map(id => timesheetColumns.find(column => column.id === id)?.label ?? id)], ...visibleCards.map(card => [memberById.get(card.employeeId)?.name ?? "", card.date, ...activeColumns.map(column => plainCell(card, column))])]); setMenu(null);
  }
  function plainCell(card: TimeCard, column: ColumnId) {
    if (column === "role") return card.role;
    if (column === "wage") return memberById.get(card.employeeId)?.wage || "—";
    if (column === "card") return card.start ? `${clockLabel(new Date(Math.max(Date.parse(card.start), Date.parse(`${card.date}T00:00:00`))).toISOString())} – ${card.end ? clockLabel(new Date(Math.min(Date.parse(card.end), Date.parse(`${addDays(card.date, 1)}T00:00:00`))).toISOString()) : card.date < props.today ? "12:00am (+1)" : "Open"}${card.end && localDate(new Date(card.end)) > card.date ? " (+1)" : ""}` : card.adjustment ? "Manual adjustment" : (card.metrics.pto ?? 0) ? "Paid time off" : "No time card";
    if (column === "issues") return card.issues.join("; ") || "—";
    return metricLabel(column, card.metrics[column]);
  }
  function print(value: string) { setPrintMode(value); setCollapsed([]); setMenu(null); setTimeout(() => window.print(), 50); }
  function sortCards(rows: TimeCard[]) {
    if (!headerSort) return rows;
    return [...rows].sort((a, b) => { const column = headerSort.column; const order = column === "date" ? a.date.localeCompare(b.date) : ["role", "card", "issues", "wage"].includes(column) ? plainCell(a, column as ColumnId).localeCompare(plainCell(b, column as ColumnId)) : (a.metrics[column] ?? 0) - (b.metrics[column] ?? 0); return order * headerSort.direction; });
  }
  const columnHeader = (id: string, label: string) => <button type="button" onClick={() => setHeaderSort(current => ({ column: id, direction: current?.column === id ? -current.direction : 1 }))}>{label}<span aria-hidden="true">{headerSort?.column === id ? headerSort.direction === 1 ? "↑" : "↓" : "↑↓"}</span></button>;
  const renderCell = (card: TimeCard, column: ColumnId) => {
    if (column === "card") return <button className="ts-card-link" type="button" onClick={event => props.manager ? editCard(card, event.currentTarget) : (setInspectingCard(card), openDialog("card", event.currentTarget))} title={card.notes.join("\n") || undefined}>{plainCell(card, column)}{card.notes.length ? <span className="ts-note-count" aria-label={`${card.notes.length} notes`}>{card.notes.length}</span> : null}</button>;
    if (column === "issues") return card.issues.length ? <div className="ts-issues">{card.issues.map(issue => <span key={issue}>{issue}</span>)}</div> : "—";
    return <span className={["ot", "doubleOt"].includes(column) && (card.metrics[column] ?? 0) > 0 ? "ts-overtime" : undefined}>{plainCell(card, column)}</span>;
  };

  const dateControl = <div className="ts-menu-anchor ts-date-anchor"><button type="button" className="ts-date-button" aria-expanded={menu === "date"} onClick={event => toggleMenu("date", event.currentTarget)}><CalendarIcon />{period === "day" ? dayDateLabel(start) : dateLabel(start, true)}{start !== end ? ` – ${dateLabel(end, true)}` : ""}<Chevron /></button>
          {menu === "date" ? <TimesheetsCalendar start={start} end={end} today={props.today} weekStart={props.weekStart} singleDay={period === "day"}
            onCancel={() => { setMenu(null); triggerRef.current?.focus(); }}
            onApply={value => { if (value.start !== value.end) setRange(value); setDay(value.start); setPeriod(value.start === value.end ? "day" : "period"); setReviewExpanded(false); setMenu(null); triggerRef.current?.focus(); }} /> : null}
        </div>;
  if (summary) return <TimesheetsSummary
    employees={members.filter(member => visibleCards.some(card => card.employeeId === member.id) || (showEmpty && (!roles.length || roles.includes(member.role)) && member.name.toLowerCase().includes(search.toLowerCase())))}
    cards={visibleCards} dateControl={dateControl} start={start} end={end}
    rounding={props.rounding} filtered={Boolean(roles.length || search)}
    onBack={() => { setSummary(false); setMenu(null); props.onSummaryChange?.(false); setTimeout(() => triggerRef.current?.focus(), 0); }}
    onPayrollId={props.manager ? props.onPayrollId : undefined}
  />;

  return <section className={period === "day" ? "timesheets-panel ts-day-panel" : "timesheets-panel ts-pay-period-panel"} aria-label="Timesheets" data-print-mode={printMode}>
    <div className="ts-topline"><span className="ts-period-caption">{period === "period" ? "Pay period" : "Daily time cards"}<small>{cardCount(visibleCards)} {cardCount(visibleCards) === 1 ? "time card" : "time cards"} · {orderedGroups.length} {groupBy === "member" ? orderedGroups.length === 1 ? "team member" : "team members" : "groups"}</small></span><div className="ts-period-tabs" role="group" aria-label="Timesheet period"><button type="button" className={period === "day" ? "active" : ""} aria-pressed={period === "day"} onClick={() => { setPeriod("day"); setReviewExpanded(false); setMenu(null); }}>Day</button><button type="button" className={period === "period" ? "active" : ""} aria-pressed={period === "period"} onClick={() => { setPeriod("period"); setMenu(null); }}>Pay period</button></div><span className="ts-total-caption">{metricLabel("paid", totals.paid)}<small>Total paid hours</small></span></div>
    <div className="ts-toolbar">
      <div className="ts-toolbar-main">
        {period === "day" ? <div className="ts-day-date-navigation"><button type="button" aria-label="Previous day" onClick={() => { setDay(addDays(day, -1)); setMenu(null); }}>‹</button>{dateControl}<button type="button" aria-label="Next day" onClick={() => { setDay(addDays(day, 1)); setMenu(null); }}>›</button></div> : dateControl}
        {period === "period" ? <>
        <div className="ts-menu-anchor"><button className="ts-menu-trigger" type="button" aria-expanded={menu === "filters"} onClick={event => toggleMenu("filters", event.currentTarget)}>Filters{roles.length ? <span className="ts-filter-count">{roles.length}</span> : null}<Chevron /></button>
          {menu === "filters" ? <div className="ts-popover ts-filter-popover"><span>Filter by roles</span><details className="ts-nested-select"><summary>{roles.length ? `${roles.length} roles selected` : "Select roles"}<Chevron /></summary><div className="ts-option-list">{props.departments.map(department => <div key={department.id}><strong>{department.name || "Department not set"}</strong>{department.roles.filter(role => allRoles.includes(role)).map(role => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => setRoles(current => current.includes(role) ? current.filter(value => value !== role) : [...current, role])} />{role}</label>)}</div>)}{allRoles.filter(role => !props.departments.some(department => department.roles.includes(role))).map(role => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => setRoles(current => current.includes(role) ? current.filter(value => value !== role) : [...current, role])} />{role}</label>)}{!allRoles.length ? <p>No roles available</p> : null}</div></details>{roles.length ? <button className="ts-text-button" type="button" onClick={() => setRoles([])}>Clear filters</button> : null}</div> : null}
        </div>
        </> : null}
        <div className="ts-menu-anchor"><button className="ts-menu-trigger" type="button" aria-expanded={menu === "view"} onClick={event => toggleMenu("view", event.currentTarget)}>View<Chevron /></button>
          {menu === "view" ? <div className={period === "day" ? "ts-popover ts-view-popover ts-day-view-popover" : "ts-popover ts-view-popover"}><label className="ts-search"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="m15 15 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg><input aria-label="Search team members" placeholder="Search team members…" value={search} onChange={event => setSearch(event.target.value)} /></label>{period === "day" ? <div className="ts-view-setting"><span>Sort by</span><details className="ts-nested-select ts-day-sort"><summary aria-label="Sort by">{daySort === "first" ? "First Name" : daySort === "last" ? "Last Name" : "Start time"}<Chevron /></summary><div className="ts-day-sort-options" role="menu" aria-label="Sort team members">{([{ id: "first", label: "First Name" }, { id: "last", label: "Last Name" }, { id: "start", label: "Start time" }] as const).map(option => <button type="button" role="menuitemradio" aria-checked={daySort === option.id} key={option.id} onClick={event => { setDaySort(option.id); const details = event.currentTarget.closest("details"); details?.removeAttribute("open"); details?.querySelector("summary")?.focus(); }} onKeyDown={event => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault(); const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? []); const index = buttons.indexOf(event.currentTarget); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>{option.label}{daySort === option.id ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</button>)}</div></details></div> : <><label className="ts-view-setting"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="first">First Name</option><option value="last">Last Name</option><option value="hours">Most hours</option></select></label><label className="ts-view-setting"><span>Group by</span><select value={groupBy} onChange={event => { setGroupBy(event.target.value); setCollapsed([]); }}><option value="member">Team member</option><option value="role">Role</option><option value="date">Date</option></select></label><div className="ts-view-setting"><span>Visible columns</span><details className="ts-nested-select ts-columns-select"><summary>{columns.length}/24 Columns<Chevron /></summary><div className="ts-option-list ts-column-list">{columnOrder.map((id, index) => <div className={columns.includes(id) ? "ts-column-option selected" : "ts-column-option"} key={id} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragColumn) moveColumn(dragColumn, id); setDragColumn(null); }}><label><input type="checkbox" checked={columns.includes(id)} onChange={() => setColumns(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />{timesheetColumns.find(column => column.id === id)?.label}</label><span className="ts-column-move"><button type="button" disabled={index === 0} aria-label={`Move ${id} column left`} onClick={() => moveColumn(id, columnOrder[index - 1])}>↑</button><button type="button" disabled={index === columnOrder.length - 1} aria-label={`Move ${id} column right`} onClick={() => { const next = [...columnOrder]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; setColumnOrder(next); }}>↓</button><button className="ts-drag-handle" type="button" draggable onDragStart={() => setDragColumn(id)} onDragEnd={() => setDragColumn(null)} aria-label={`Drag to reorder ${id} column`}>⠿</button></span></div>)}</div></details></div><div className="ts-view-footer"><button type="button" aria-pressed={showEmpty} onClick={() => setShowEmpty(value => !value)}>Show team members without hours<span aria-hidden="true">{showEmpty ? "◉" : "◎"}</span></button><button type="button" onClick={() => setCollapsed(allCollapsed ? [] : orderedGroups.map(([key]) => key))}>{allCollapsed ? "Expand" : "Collapse"} all rows<span aria-hidden="true">↕</span></button><button type="button" className="ts-text-button" onClick={() => { setColumns(defaultTimesheetColumns); setColumnOrder(timesheetColumns.map(column => column.id)); setHeaderSort(null); }}>Reset columns</button></div></>}</div> : null}
        </div>
      </div>
      {period === "day" ? props.manager ? <button type="button" className="ts-day-resolve" disabled={!dayIssues} onClick={event => resolveDayIssue(event.currentTarget)}><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3 1 21h22Z" fill="currentColor" /><path d="M12 9v5m0 3v1" stroke="#fff" strokeWidth="2" /></svg>{dayIssues ? `Resolve ${dayIssues} ${dayIssues === 1 ? "issue" : "issues"}` : "No issues"}</button> : null : <>
      <div className="ts-toolbar-actions"><div className="ts-rounding">{props.roundingControl}</div><div className="ts-menu-anchor ts-tools-anchor"><button className="ts-menu-trigger" type="button" aria-expanded={menu === "tools"} onClick={event => toggleMenu("tools", event.currentTarget)}>Tools<Chevron /></button>
        {menu === "tools" ? <div className="ts-popover ts-tools-popover"><details className="ts-print-select"><summary>Print timesheets<Chevron /></summary><button type="button" onClick={() => print("detail")}>Detailed time cards</button><button type="button" onClick={() => print("summary")}>Summary by team member</button></details><button type="button" onClick={exportCards}>Download time cards</button>{props.manager ? <button type="button" onClick={event => openDialog("history", event.currentTarget)}>Time card edit history</button> : null}{props.manager ? <button type="button" disabled title="Email delivery is not connected">Email time card edit history<small>Not available yet</small></button> : null}<div className="ts-menu-divider" /><button type="button" disabled title="Tip Manager is not available in this prototype">Enable Tip Manager<small>Not available yet</small></button><div className="ts-menu-divider" /><button type="button" onClick={event => openDialog("help", event.currentTarget)}>Get to know Timesheets</button>{props.manager ? <button type="button" onClick={() => { setMenu(null); props.onSettings(); }}>Settings</button> : null}</div> : null}
      </div>{props.manager ? <button className="ts-add-button" type="button" onClick={event => newCard(undefined, event.currentTarget)}>Add time card</button> : null}<button type="button" className="ts-primary" onClick={event => { triggerRef.current = event.currentTarget; setMenu(null); setSummary(true); props.onSummaryChange?.(true); }}>View summary</button></div></>}

    </div>
    {period === "day" ? <TimesheetsDay rows={dayRows} date={day} now={props.now} manager={props.manager} rounding={props.rounding} onOpenCard={openDayCard} onAdd={newCard} /> : <>
    <div className="ts-review-bar"><button type="button" aria-expanded={reviewExpanded} aria-controls={reviewId} onClick={() => setReviewExpanded(value => !value)}><Chevron up={reviewExpanded} />Needs review<span className={needsReview ? "ts-review-count" : "ts-review-count is-clear"}>{needsReview}</span></button>{roles.length || search ? <span className="ts-filter-caption">Filtered results</span> : null}{props.rounding !== "actual" ? <span className="ts-rounding-caption">Rounded to {props.rounding} min</span> : null}</div>
    <div className="ts-review-cards" id={reviewId} hidden={!reviewExpanded} role="region" aria-label="Time cards needing review">{reviews.map(review => {
      const member = memberById.get(review.employeeId);
      const dates = dateLabel(review.startDate).replace(",", "") + (review.endDate !== review.startDate ? ` – ${dateLabel(review.endDate).replace(",", "")}` : "");
      return <button type="button" className="ts-review-card" key={review.key} aria-label={`Review ${member?.name ?? "Team member"} time card on ${dates}: ${review.issues.join(", ")}`} onClick={event => openDayCard(review.card, event.currentTarget)}><span className="ts-review-person"><span className="ts-review-avatar" aria-hidden="true">{initials(member?.name ?? "?")}</span><strong>{member?.name ?? "Team member"}</strong></span><span className="ts-review-date">{dates}, {Math.floor(review.workedMinutes / 60)} hr {review.workedMinutes % 60} min</span><span className="ts-review-issues">{review.issues.map(issue => <span key={issue}><svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 2 10 0 5 5v10l-5 5H7l-5-5V7Z" fill="currentColor" /><path d="M12 7v6m0 3v1" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>{issue === "Missing breaks" ? "1 Missed Break" : issue}</span>)}</span></button>;
    })}{!reviews.length ? <p className="ts-review-clear">No time cards need review{roles.length || search ? " for these filters" : ""}.</p> : null}</div>
    <div className="ts-table-scroll" tabIndex={0} role="region" aria-label="Time card ledger" ref={ledgerScrollRef} onScroll={event => syncLedgerScroll(event.currentTarget, totalsScrollRef.current)}><table className="ts-table ts-period-ledger" style={{ minWidth: ledgerMinWidth }}>{ledgerColumns}<thead><tr><th scope="col" aria-sort={headerSort?.column === "date" ? headerSort.direction === 1 ? "ascending" : "descending" : "none"}>{columnHeader("date", groupBy === "member" ? "Date" : "Team member / Date")}</th>{activeColumns.map(id => <th key={id} scope="col" aria-sort={headerSort?.column === id ? headerSort.direction === 1 ? "ascending" : "descending" : "none"}>{columnHeader(id, timesheetColumns.find(column => column.id === id)?.label ?? id)}</th>)}<th scope="col" className="ts-actions-column"><span className="sr-only">Actions</span></th></tr></thead>{orderedGroups.map(([key, group]) => {
      const groupTotals = totalMetrics(group.cards), isCollapsed = collapsed.includes(key);
      return <tbody className="ts-member-group" key={key}><tr className="ts-group-row"><th scope="row"><button className="ts-group-toggle" type="button" aria-expanded={!isCollapsed} onClick={() => setCollapsed(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])}><Chevron up={!isCollapsed} />{group.employee ? <span className="ts-avatar">{initials(group.name)}</span> : null}<strong>{group.name}</strong></button></th>{activeColumns.map((id, index) => <td key={id} data-column={id}>{id === "card" ? <strong>{cardCount(group.cards)} {cardCount(group.cards) === 1 ? "Time Card" : "Time Cards"}</strong> : id === "issues" ? null : id === "role" || id === "wage" ? index === 0 && !columns.includes("card") ? `${group.cards.length} rows` : null : <strong className={["ot", "doubleOt"].includes(id) && (groupTotals[id] ?? 0) > 0 ? "ts-overtime" : undefined}>{metricLabel(id, groupTotals[id])}</strong>}</td>)}<td>{props.manager && group.employee ? <button type="button" className="ts-more-button" aria-label={`Add time card for ${group.name}`} title="Add time card" onClick={event => newCard(group.employee?.id, event.currentTarget)}>⋮</button> : null}</td></tr>{!isCollapsed ? <>{sortCards(group.cards).map(card => <tr className="ts-card-row" key={card.id}><td>{groupBy === "member" ? dateLabel(card.date) : <><strong className="ts-cell-member">{memberById.get(card.employeeId)?.name}</strong><span>{dateLabel(card.date)}</span></>}</td>{activeColumns.map(id => <td className={["role", "card", "issues"].includes(id) ? "ts-text-cell" : "ts-numeric-cell"} key={id}>{renderCell(card, id)}</td>)}<td>{props.manager ? <button className="ts-row-edit" type="button" onClick={event => editCard(card, event.currentTarget)} aria-label={`Edit ${memberById.get(card.employeeId)?.name} time card on ${dateLabel(card.date)}`}>Edit</button> : null}</td></tr>)}{!group.cards.length ? <tr className="ts-empty-member"><td colSpan={activeColumns.length + 2}>No hours recorded in this period.</td></tr> : null}{props.manager && group.employee ? <tr className="ts-add-row"><td colSpan={activeColumns.length + 2}><button type="button" onClick={event => newCard(group.employee?.id, event.currentTarget)}><span aria-hidden="true">＋</span>Add time card</button></td></tr> : null}</> : null}</tbody>;
    })}{props.manager && props.onAddTeamMember ? <tbody className="ts-add-member-row"><tr><td colSpan={activeColumns.length + 2}><button type="button" onClick={props.onAddTeamMember}><span aria-hidden="true">＋</span>Add team member</button></td></tr></tbody> : null}</table>{!orderedGroups.length ? <div className="ts-empty-state"><CalendarIcon /><h3>No time cards in this period</h3><p>{roles.length || search ? "Try clearing the filters or choosing another date range." : "Choose another period, show team members without hours, or add a time card."}</p><button type="button" className="ts-text-button" onClick={() => { setShowEmpty(true); setReviewExpanded(false); setRoles([]); setSearch(""); }}>Show all team members</button></div> : null}</div></>}

    <table className="ts-print-summary"><caption>Timesheet summary · {dateLabel(start, true)} – {dateLabel(end, true)}</caption><thead><tr><th>Team member</th><th>Regular hours</th><th>OT hours</th><th>Double OT</th><th>PTO</th><th>Paid hours</th><th>Est. wages</th></tr></thead><tbody>{members.filter(member => visibleCards.some(card => card.employeeId === member.id)).map(member => { const total = totalMetrics(visibleCards.filter(card => card.employeeId === member.id)); return <tr key={member.id}><th>{member.name}</th>{(["regular", "ot", "doubleOt", "pto", "paid", "wages"] as ColumnId[]).map(id => <td key={id}>{metricLabel(id, total[id])}</td>)}</tr>; })}</tbody></table>
    <div className="ts-table-footnote">{period === "day" ? "Total spans clock-in to clock-out; meal breaks are shown separately. Rounding applies to paid hours." : "Hours shown in decimals · Wage and overtime estimates"} <button type="button" onClick={event => openDialog("help", event.currentTarget)} aria-label="About timesheet estimates">ⓘ</button></div>
    {period === "period" ? <div className="ts-totals-ribbon" tabIndex={0} role="region" aria-label="Timesheet totals ribbon" ref={totalsScrollRef} onScroll={event => syncLedgerScroll(event.currentTarget, ledgerScrollRef.current)}><table className="ts-table ts-period-ledger ts-totals-table" style={{ minWidth: ledgerMinWidth }} aria-label="Combined timesheet totals">{ledgerColumns}<tbody><tr><th scope="row">{roles.length || search ? "Filtered totals" : "Totals"}</th>{activeColumns.map(id => <td key={id} data-column={id} aria-label={`${timesheetColumns.find(column => column.id === id)?.label}: ${id === "role" ? `${roleAssignments} roles` : id === "card" ? `${cardCount(visibleCards)} time cards` : id === "issues" || id === "wage" ? "" : metricLabel(id, totals[id])}`}>{id === "role" ? <span title="Role assignments on worked time cards">{roleAssignments} {roleAssignments === 1 ? "Role" : "Roles"}</span> : id === "card" ? `${cardCount(visibleCards)} ${cardCount(visibleCards) === 1 ? "Time Card" : "Time Cards"}` : id === "issues" || id === "wage" ? null : metricLabel(id, totals[id])}</td>)}<td /></tr></tbody></table></div> : null}
    {(dialog || draft) ? <div className="ts-modal-backdrop"><div className={draft ? "ts-modal ts-card-modal" : "ts-modal"} role="dialog" aria-modal="true" aria-labelledby="ts-dialog-title" ref={modalRef}>{!draft ? <div className="ts-modal-heading"><div><p>{dateLabel(start, true)}{end !== start ? ` – ${dateLabel(end, true)}` : ""}</p><h2 id="ts-dialog-title">{dialog === "history" ? "Time card edit history" : dialog === "card" ? "Time card details" : "About Timesheets"}</h2></div><button type="button" onClick={closeDialog} aria-label="Close timesheet dialog">×</button></div> : null}
      {draft ? <TimeCardEditor
        draft={draft}
        employees={members}
        roles={allRoles}
        locationName={props.locationName ?? "DomBase"}
        today={props.today}
        now={props.now}
        error={formError}
        history={draft.eventIds.length ? props.history.filter(edit => edit.employeeId === draft.employeeId && (edit.cardId !== undefined ? edit.cardId === draft.cardId : edit.date === draft.date)) : []}
        onChange={value => { setDraft(value); setFormError(""); }}
        onSubmit={saveCard}
        onClose={closeDialog}
        onBreakSettings={() => { closeDialog(); (props.onBreakSettings ?? props.onSettings)(); }}
        onAdjust={draft.eventIds.length ? () => {
          const hours = cards.filter(card => card.employeeId === draft.employeeId && card.date === draft.date).reduce((total, card) => total + (card.metrics.actual ?? 0), 0);
          props.onAdjust(draft.employeeId, draft.date, hours);
          closeDialog();
        } : undefined}
      /> : dialog === "card" && inspectingCard ? <div className="ts-help"><h3>{dateLabel(inspectingCard.date)} · {inspectingCard.role}</h3><p>{plainCell(inspectingCard, "card")}</p><div className="ts-summary-metrics"><div><span>Actual hours</span><strong>{metricLabel("actual", inspectingCard.metrics.actual)}</strong></div><div><span>Meal breaks</span><strong>{metricLabel("breaks", inspectingCard.metrics.breaks)}</strong></div><div><span>Paid hours</span><strong>{metricLabel("paid", inspectingCard.metrics.paid)}</strong></div></div>{inspectingCard.issues.map(issue => <p key={issue}>{issue}</p>)}{inspectingCard.notes.map((note, index) => <p key={index}>{note}</p>)}<div className="ts-modal-actions"><button type="button" className="ts-primary" onClick={closeDialog}>Done</button></div></div> : dialog === "history" ? <><p className="ts-form-note">Saved additions and edits in this period. Email delivery is not connected; download the history to share it.</p><div className="ts-edit-history">{[...history].reverse().map(edit => <article key={edit.id}><strong>{memberById.get(edit.employeeId)?.name} · {dateLabel(edit.date)}</strong><small>{new Date(edit.at).toLocaleString()} · {edit.actor}</small><p>{edit.before || "New time card"} → {edit.after}</p></article>)}{!history.length ? <p>No time card edits recorded in this period.</p> : null}</div><div className="ts-modal-actions"><button type="button" disabled={!history.length} onClick={() => download(`time-card-history-${start}-${end}.csv`, [["Team member", "Date", "Edited at", "Edited by", "Before", "After"], ...history.map(edit => [memberById.get(edit.employeeId)?.name ?? "", edit.date, edit.at, edit.actor, edit.before, edit.after])])}>Download edit history</button><button type="button" className="ts-primary" onClick={closeDialog}>Done</button></div></> : <div className="ts-help"><p>Review hours by day or select your pay-period dates. Expand a team member to see clock times, breaks, issues, and paid time off. Filters select roles; View changes the team search, grouping, and columns.</p><p>Rounding previews each card&apos;s net worked time at the nearest 5, 10, or 15 minutes. Administrators can save the rounding interval with Set. Actual clock records remain available.</p><p>Estimated overtime uses 8 regular hours per day, double time after 12 hours, and a 40-hour work week. Weekly calculations include earlier days in the saved work week. Estimated wages use the hourly rate, 1.5× overtime, 2× double overtime, and paid time off. Scheduled hours show the full scheduled interval.</p><p>Qualified OT, tips, special pay, and FFCRA columns display a dash because these amounts are not recorded. Estimates do not include payroll deductions or special pay rules.</p><p>To fix a missing clock-out or break, open the card and update its times. Employee accounts can view only their own cards. Tools provides printing, CSV downloads, edit history, and time-clock settings.</p><div className="ts-modal-actions"><button type="button" className="ts-primary" onClick={closeDialog}>Got it</button></div></div>}
    </div></div> : null}
  </section>;
}
