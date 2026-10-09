import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
const source = await readFile(new URL("../app/timesheets-model.ts", import.meta.url), "utf8");
const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020 } });
const { buildTimeCards, totalMetrics, timeCardReviews, timeCardEvents, validateTimeCard, timesheetCsv, hourlyWage, weekStartFor, timeCardPreview, timeCardBreakIntervals } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const employees = [{ id: 1, name: "Test Employee", role: "Sales", wage: "$20/hr", active: true }];
const at = (date, time) => new Date(`${date}T${time}:00`).toISOString();
const base = { employees, shifts: [], adjustments: [], pto: [], events: [], start: "2026-08-03", end: "2026-08-09", now: new Date("2026-08-10T12:00:00").getTime(), rounding: "actual", weekStart: 1, mandatoryMealBreak: true, mealBreakAfterHours: 5 };
function eventsFor(date, start, end, breakMinutes = 0, id = 1, nextDay = false) { return timeCardEvents({ employeeId: 1, date, start, end, nextDay, breakMinutes, role: "Sales", note: "", eventIds: [] }, id); }

test("time cards deduct meal breaks, preserve raw hours, and round the preview", () => {
  const events = eventsFor("2026-08-03", "09:00", "17:07", 30);
  const actual = buildTimeCards({ ...base, events });
  const rounded = buildTimeCards({ ...base, events, rounding: 15 });
  assert.ok(Math.abs(actual[0].metrics.actual - (7 + 37 / 60)) < 1e-9);
  assert.equal(rounded[0].metrics.paid, 7.5);
  assert.equal(rounded[0].metrics.actual, actual[0].metrics.actual);
  assert.equal(actual[0].metrics.breaks, .5);
  assert.deepEqual(actual[0].issues, []);
  assert.equal(totalMetrics(rounded).wages, 150);
  assert.equal(events[0].at, at("2026-08-03", "09:00"));
});

test("overnight cards clip at local midnight without double-counting hours or breaks", () => {
  const events = eventsFor("2026-08-03", "22:00", "06:00", 30, 1, true);
  const whole = buildTimeCards({ ...base, events });
  const day = buildTimeCards({ ...base, events, start: "2026-08-04", end: "2026-08-04" });
  assert.equal(whole.length, 2);
  assert.equal(totalMetrics(whole).actual, 7.5);
  assert.equal(totalMetrics(whole).breaks, .5);
  assert.equal(day.length, 1);
  assert.equal(day[0].metrics.actual, 5.5);
});

test("daily and weekly overtime do not count the same hours twice, including a partial-week view", () => {
  const events = Array.from({ length: 6 }, (_, index) => eventsFor(`2026-08-0${index + 3}`, "09:00", "17:00", 0, index * 10 + 1)).flat();
  const all = totalMetrics(buildTimeCards({ ...base, events }));
  const saturday = buildTimeCards({ ...base, events, start: "2026-08-08", end: "2026-08-08" });
  assert.equal(all.regular, 40);
  assert.equal(all.ot, 8);
  assert.equal(saturday[0].metrics.regular, 0);
  assert.equal(saturday[0].metrics.ot, 8);
  assert.equal(all.wages, 40 * 20 + 8 * 30);
  const long = buildTimeCards({ ...base, events: eventsFor("2026-08-03", "06:00", "19:00") })[0];
  assert.equal(long.metrics.regular, 8);
  assert.equal(long.metrics.ot, 4);
  assert.equal(long.metrics.doubleOt, 1);
});

test("multiple sessions, negative adjustments, and paid PTO reconcile with daily totals", () => {
  const events = [...eventsFor("2026-08-03", "08:00", "12:00"), ...eventsFor("2026-08-03", "13:00", "17:00", 0, 10)];
  const cards = buildTimeCards({ ...base, events, adjustments: [{ id: 1, employeeId: 1, date: "2026-08-03", hours: -6 }], pto: [{ employeeId: 1, startDate: "2026-08-04", endDate: "2026-08-04", status: "approved", compensation: "paid" }, { employeeId: 1, startDate: "2026-08-05", endDate: "2026-08-05", status: "pending", compensation: "paid" }] });
  assert.equal(totalMetrics(cards).actual, 2);
  assert.equal(totalMetrics(cards).pto, 8);
  assert.equal(totalMetrics(cards).paid, 10);
  assert.equal(cards.some(card => card.date === "2026-08-05"), false);
  assert.ok(cards.every(card => card.metrics.actual >= 0));
});

test("scheduled-only rows do not invent clock times, and issue flags follow the saved break setting", () => {
  const scheduled = buildTimeCards({ ...base, shifts: [{ employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", role: "Sales" }] })[0];
  assert.equal(scheduled.start, undefined);
  assert.equal(scheduled.metrics.actual, 0);
  assert.equal(scheduled.metrics.scheduled, 8);
  const events = [{ id: 1, employeeId: 1, type: "in", at: at("2026-08-03", "09:00") }];
  const now = new Date("2026-08-03T15:00:00").getTime();
  assert.deepEqual(buildTimeCards({ ...base, end: "2026-08-03", events, now })[0].issues, ["Missing clock-out", "Missing breaks"]);
  assert.deepEqual(buildTimeCards({ ...base, end: "2026-08-03", events, now, mandatoryMealBreak: false })[0].issues, ["Missing clock-out"]);
});

test("time-card validation rejects overlaps, reversed or future times, and excessive breaks while allowing edits", () => {
  const events = eventsFor("2026-08-03", "09:00", "17:00");
  const draft = { employeeId: 1, date: "2026-08-03", start: "10:00", end: "16:00", nextDay: false, breakMinutes: 30, role: "Sales", note: "", eventIds: [] };
  assert.match(validateTimeCard(draft, events, base.now), /overlaps/);
  assert.equal(validateTimeCard({ ...draft, eventIds: events.map(event => event.id) }, events, base.now), "");
  assert.match(validateTimeCard({ ...draft, start: "17:00", end: "09:00" }, [], base.now), /after clock-in/);
  assert.match(validateTimeCard({ ...draft, date: "2026-08-11" }, [], base.now), /future/);
  assert.match(validateTimeCard({ ...draft, breakMinutes: 360 }, [], base.now), /shorter/);
  assert.equal(validateTimeCard({ ...draft, start: "22:00", end: "06:00", nextDay: true }, [], base.now), "");
});

test("CSV exports escape user fields, and unsupported wages or payroll columns remain unknown", () => {
  assert.equal(hourlyWage("$80,000/year"), null);
  assert.equal(hourlyWage(""), null);
  assert.equal(hourlyWage("$24.50/hr"), 24.5);
  const cards = buildTimeCards({ ...base, employees: [{ ...employees[0], wage: "" }], events: eventsFor("2026-08-03", "09:00", "17:00") });
  assert.equal(totalMetrics(cards).wages, null);
  assert.equal(totalMetrics(cards).qualifiedOt, null);
  assert.equal(totalMetrics([]).qualifiedOt, null);
  assert.match(timesheetCsv([["Name", "Date"], ["=CMD()", 'Zoë, "Z"\nnext']]), /"'=CMD\(\)"/);
  assert.match(timesheetCsv([["Name"], ['Zoë, "Z"']]), /"Zoë, ""Z"""/);
  assert.equal(weekStartFor("2026-08-09", 1), "2026-08-03");
  assert.equal(weekStartFor("2026-08-09", 0), "2026-08-09");
});

async function summaryModule() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { JsxEmit } = await import("typescript");
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL("../app/timesheets-summary.tsx", import.meta.url), "utf8");
  const { outputText: js } = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } });
  const linked = js.replaceAll('"react-dom"', JSON.stringify(pathToFileURL(require.resolve("react-dom")).href)).replaceAll('"./timesheets-model"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)).replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)).replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href));
  return `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`;
}

async function calendarModule() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { JsxEmit } = await import("typescript");
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL("../app/timesheets-calendar.tsx", import.meta.url), "utf8");
  const { outputText: js } = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } });
  const linked = js.replaceAll('"./timesheets-model"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)).replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)).replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href));
  return `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`;
}

async function dayModule() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { JsxEmit } = await import("typescript");
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL("../app/timesheets-day.tsx", import.meta.url), "utf8");
  const { outputText: js } = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } });
  const linked = js.replaceAll('"./timesheets-model"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)).replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)).replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href));
  return `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`;
}

async function panelComponent() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const { JsxEmit } = await import("typescript");
  const panelSource = await readFile(new URL("../app/timesheets-panel.tsx", import.meta.url), "utf8");
  const modelUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  const { outputText: panelJs } = transpileModule(panelSource, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } });
  const editorSource = await readFile(new URL("../app/time-card-editor.tsx", import.meta.url), "utf8");
  const { outputText: editorJs } = transpileModule(editorSource, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } });
  const editorLinked = editorJs.replaceAll('"./timesheets-model"', JSON.stringify(modelUrl)).replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)).replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href));
  const editorUrl = `data:text/javascript;base64,${Buffer.from(editorLinked).toString("base64")}`;
  const linked = panelJs.replaceAll('"./timesheets-day"', JSON.stringify(await dayModule())).replaceAll('"./timesheets-calendar"', JSON.stringify(await calendarModule())).replaceAll('"./timesheets-summary"', JSON.stringify(await summaryModule())).replaceAll('"./time-card-editor"', JSON.stringify(editorUrl)).replaceAll('"./timesheets-model"', JSON.stringify(modelUrl)).replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)).replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`)).TimesheetsPanel;
}

test("employee Timesheets renders only their own records and has no editing or history controls", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Panel = await panelComponent();
  const html = renderToStaticMarkup(createElement(Panel, { ...base, employees: [...employees, { id: 2, name: "Other Private Employee", role: "Sales", wage: "$50/hr", active: true }], events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-03", "08:00", "18:00", 30, 20).map(event => ({ ...event, employeeId: 2 }))], today: "2026-08-03", departments: [], history: [], manager: false, activeEmployeeId: 1, roundingControl: null, onSaveCard() {}, onAdjust() {}, onSettings() {} }));
  assert.match(html, /Test Employee/);
  assert.match(html, /7\.50/);
  assert.doesNotMatch(html, /Other Private Employee|\$50\/hr|Add time card<|Edit Test Employee|time card edit history/i);
});

test("a second clock-in bounds a missing clock-out so broken records do not create overlapping paid hours", () => {
  const events = [{ id: 1, employeeId: 1, type: "in", at: at("2026-08-03", "08:00") }, ...eventsFor("2026-08-03", "12:00", "16:00", 0, 10)];
  const cards = buildTimeCards({ ...base, events });
  assert.equal(totalMetrics(cards).actual, 8);
  assert.equal(cards.length, 2);
  assert.ok(cards[0].issues.includes("Missing clock-out"));
});

test("explicit meal breaks save their exact intervals and produce the same live and ledger totals", () => {
  const draft = { employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", nextDay: false, breakMinutes: 0, role: "Sales", note: "", eventIds: [], breaks: [{ id: 1, start: "12:00", end: "12:30", nextDay: false }, { id: 2, start: "15:00", end: "15:15", nextDay: false }] };
  assert.equal(validateTimeCard(draft, [], base.now), "");
  assert.deepEqual(timeCardPreview(draft), { elapsedMinutes: 480, breakMinutes: 45, workedMinutes: 435 });
  const events = timeCardEvents(draft, 100);
  assert.deepEqual(events.filter(event => event.type === "break").map(event => event.at), [at(draft.date, "12:00"), at(draft.date, "15:00")]);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.equal(totalMetrics(buildTimeCards({ ...base, events })).actual, 7.25);
  assert.equal(totalMetrics(buildTimeCards({ ...base, events })).breaks, .75);
  const edited = timeCardEvents({ ...draft, date: "2026-08-04", cardId: events[0].cardId, eventIds: events.map(event => event.id) }, 200);
  assert.ok(edited.every(event => event.cardId === 100));
});

test("meal-break validation rejects incomplete, overlapping, and out-of-card intervals", () => {
  const draft = { employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", nextDay: false, breakMinutes: 0, role: "Sales", note: "", eventIds: [], breaks: [] };
  const entry = { id: 1, start: "12:00", end: "12:30", nextDay: false };
  assert.match(validateTimeCard({ ...draft, employeeId: 0 }, [], base.now), /Select an employee/);
  assert.match(validateTimeCard({ ...draft, breaks: [{ ...entry, end: "" }] }, [], base.now), /start and end/);
  assert.match(validateTimeCard({ ...draft, breaks: [{ ...entry, start: "08:00" }] }, [], base.now), /within/);
  assert.match(validateTimeCard({ ...draft, breaks: [entry, { ...entry, id: 2, start: "12:15", end: "13:00" }] }, [], base.now), /overlap/);
  assert.equal(validateTimeCard(draft, [], base.now), "");
});

test("overnight meal breaks work both across midnight and on the next day", () => {
  const draft = { employeeId: 1, date: "2026-08-03", start: "22:00", end: "06:00", nextDay: true, breakMinutes: 0, role: "Sales", note: "", eventIds: [], breaks: [{ id: 1, start: "23:45", end: "00:15", nextDay: false }, { id: 2, start: "03:00", end: "03:15", nextDay: true }] };
  assert.equal(validateTimeCard(draft, [], base.now), "");
  assert.equal(timeCardPreview(draft).workedMinutes, 435);
  assert.equal(timeCardBreakIntervals(draft)[0].end, Date.parse(at("2026-08-04", "00:15")));
  assert.equal(totalMetrics(buildTimeCards({ ...base, events: timeCardEvents(draft, 1) })).actual, 7.25);
});


test("summary aggregates employee totals, preserves payroll IDs, and distinguishes unknown wages", async () => {
  const { summaryRows, summaryColumns, defaultSummaryColumns } = await import(await summaryModule());
  const staff = [{ ...employees[0], name: "Alex Van Peshkov", payrollId: "007", legalFirstName: "Alexander", legalMiddleName: "V", legalLastName: "Peshkov" }, { id: 2, name: "Other Member", wage: "", role: "Sales", active: true }];
  const cards = buildTimeCards({ ...base, employees: staff, events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-04", "09:00", "17:00", 30, 10), ...eventsFor("2026-08-04", "09:00", "17:00", 30, 20).map(event => ({ ...event, employeeId: 2 }))] });
  const rows = summaryRows(staff, cards);
  assert.equal(summaryColumns.length, 28);
  assert.equal(defaultSummaryColumns.length, 9);
  assert.equal(rows[0].values.first, "Alex");
  assert.equal(rows[0].values.last, "Van Peshkov");
  assert.equal(rows[0].values.payroll, "007");
  assert.equal(rows[0].values.regular, "15.00");
  assert.equal(rows[0].values.wages, "$300.00");
  assert.equal(rows[0].values.legalFirst, "Alexander");
  assert.equal(rows[0].values.legalMiddle, "V");
  assert.equal(rows[0].values.legalLast, "Peshkov");
  assert.equal(rows[1].values.legalFirst, "—");
  assert.equal(rows[1].values.wages, "—");
});

test("employee summary is a page with only own records and no payroll editing", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Panel = await panelComponent();
  const html = renderToStaticMarkup(createElement(Panel, { ...base, employees: [...employees, { id: 2, name: "Private Other", role: "Sales", wage: "$50/hr", active: true }], events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-03", "08:00", "18:00", 30, 20).map(event => ({ ...event, employeeId: 2 }))], today: "2026-08-03", departments: [], history: [], manager: false, activeEmployeeId: 1, roundingControl: null, summary: true, onPayrollId() {}, onSaveCard() {}, onAdjust() {}, onSettings() {} }));
  assert.match(html, /aria-label="Timesheet summary"/);
  assert.match(html, /9\/28 Columns/);
  assert.match(html, /Legal first name/);
  assert.match(html, /Reorder Holiday pay column/);
  assert.doesNotMatch(html, /Private Other|Edit payroll ID|role="dialog"|View summary/);
});


test("calendar month grids handle leap years, year boundaries, and the one-month selection limit", async () => {
  const { calendarMonthDays, shiftCalendarMonth, validCalendarRange, calendarPresetRange } = await import(await calendarModule());
  const leap = calendarMonthDays("2028-02-01");
  assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(leap[2], "2028-02-01");
  assert.equal(calendarMonthDays("2026-08-01")[6], "2026-08-01");
  assert.equal(shiftCalendarMonth("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftCalendarMonth("2026-01-31", -1), "2025-12-01");
  assert.deepEqual(calendarPresetRange("current", "2026-10-09", 1), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(calendarPresetRange("previous", "2026-10-09", 0), { start: "2026-09-27", end: "2026-10-03" });
  assert.deepEqual(calendarPresetRange("yesterday", "2026-01-01", 1), { start: "2025-12-31", end: "2025-12-31" });
  assert.ok(validCalendarRange("2026-03-01", "2026-03-31"));
  assert.ok(validCalendarRange("2026-10-31", "2026-11-01"));
  assert.equal(validCalendarRange("2026-03-01", "2026-04-01"), false);
  assert.equal(validCalendarRange("2026-03-02", "2026-03-01"), false);
  assert.equal(validCalendarRange("2026-03-02", ""), false);
});


test("Day view combines split cards and compares elapsed clock time with scheduled time", async () => {
  const { buildDayRows, dayClockLabel } = await import(await dayModule());
  const shifts = [{ employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", role: "Sales" }];
  const events = [...eventsFor("2026-08-03", "09:00", "12:00", 0), ...eventsFor("2026-08-03", "13:00", "18:15", 30, 10)];
  const cards = buildTimeCards({ ...base, shifts, events });
  const rows = buildDayRows({ ...base, shifts, cards, date: "2026-08-03", showEmpty: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cards.length, 2);
  assert.equal(rows[0].elapsedMinutes, 495);
  assert.equal(rows[0].mealMinutes, 30);
  assert.equal(rows[0].varianceMinutes, 15);
  assert.equal(totalMetrics(cards).actual, 7.75);
  assert.equal(dayClockLabel(cards[0], "2026-08-03", base.now), "9:00 am – 12:00 pm");
});

test("Day no-shows require a completed scheduled shift and exclude approved leave and manual hours", async () => {
  const { buildDayRows } = await import(await dayModule());
  const shifts = [{ employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", role: "Sales" }];
  const cards = buildTimeCards({ ...base, shifts });
  const input = { ...base, shifts, cards, date: "2026-08-03", showEmpty: false };
  assert.deepEqual(buildDayRows(input)[0].issues, ["No-Show"]);
  assert.deepEqual(buildDayRows({ ...input, now: Date.parse(at("2026-08-03", "16:00")) })[0].issues, []);
  assert.deepEqual(buildDayRows({ ...input, pto: [{ employeeId: 1, status: "approved", compensation: "unpaid", startDate: "2026-08-03", endDate: "2026-08-03" }] })[0].issues, []);
  assert.deepEqual(buildDayRows({ ...input, cards: buildTimeCards({ ...base, shifts, adjustments: [{ id: 1, employeeId: 1, date: "2026-08-03", hours: 8 }] }) })[0].issues, []);
  assert.equal(buildDayRows({ ...input, cards: [], shifts: [], showEmpty: false }).length, 0);
});

test("Day view clips overnight work to the selected day and employee rows expose no editing controls", async () => {
  const { buildDayRows, dayClockLabel, TimesheetsDay } = await import(await dayModule());
  const cards = buildTimeCards({ ...base, events: eventsFor("2026-08-03", "22:00", "06:00", 0, 1, true) });
  const rows = buildDayRows({ ...base, cards, date: "2026-08-04", showEmpty: false });
  assert.equal(rows[0].elapsedMinutes, 360);
  assert.equal(dayClockLabel(rows[0].cards[0], "2026-08-04", base.now), "12:00 am – 6:00 am");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(createElement(TimesheetsDay, { rows, date: "2026-08-04", now: base.now, manager: false, onOpenCard() {}, onAdd() {} }));
  assert.match(html, /Total: 6 hrs 0 min/);
  assert.doesNotMatch(html, /Add time card|Resolve|ts-day-add/);
});

test("day sorting uses names, actual starts, scheduled fallback, and midnight for overnight cards", async () => {
  const { sortDayRows } = await import(await dayModule());
  const row = (id, name, start, scheduledStart) => ({ employee: { ...employees[0], id, name }, cards: start ? [{ start }] : [], scheduled: scheduledStart ? [{ date: "2026-08-04", start: scheduledStart }] : [], elapsedMinutes: 0 });
  const rows = [row(1, "Alex Zebra", at("2026-08-04", "09:00"), "06:00"), row(2, "Carlos Adams", undefined, "08:00"), row(3, "Zoe Baker", at("2026-08-03", "22:00")), row(4, "Bea Miles"), row(5, "Aaron Young")];
  assert.deepEqual(sortDayRows(rows, "first", "2026-08-04").map(row => row.employee.id), [5, 1, 4, 2, 3]);
  assert.deepEqual(sortDayRows(rows, "last", "2026-08-04").map(row => row.employee.id), [2, 3, 4, 5, 1]);
  assert.deepEqual(sortDayRows(rows, "start", "2026-08-04").map(row => row.employee.id), [3, 2, 1, 5, 4]);
  assert.deepEqual(rows.map(row => row.employee.id), [1, 2, 3, 4, 5]);
});

test("pay-period totals combine visible employee cards and respect employee access", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Panel = await panelComponent();
  const props = { ...base, employees: [...employees, { id: 2, name: "Other Employee", role: "Warehouse", wage: "$30/hr", active: true }], events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-03", "08:00", "17:00", 60, 20).map(event => ({ ...event, employeeId: 2 }))], today: "2026-08-03", departments: [], history: [], manager: true, activeEmployeeId: 1, roundingControl: null, onSaveCard() {}, onAdjust() {}, onSettings() {}, onAddTeamMember() {} };
  const totals = html => html.match(/<table[^>]*aria-label="Combined timesheet totals"[\s\S]*?<\/table>/)[0];
  const combined = totals(renderToStaticMarkup(createElement(Panel, props)));
  assert.match(combined, /2 Roles/);
  assert.match(combined, /2 Time Cards/);
  assert.match(combined, /data-column="regular"[^>]*>15\.50</);
  assert.match(combined, /data-column="breaks"[^>]*>1\.50</);
  assert.match(combined, /data-column="wages"[^>]*>\$390\.00</);
  const own = totals(renderToStaticMarkup(createElement(Panel, { ...props, manager: false })));
  assert.match(own, /1 Role/);
  assert.match(own, /1 Time Card/);
  assert.match(own, /data-column="regular"[^>]*>7\.50</);
  assert.match(own, /data-column="wages"[^>]*>\$150\.00</);
});

test("summary printing defaults to visible columns and prints saved values without edit controls", async () => {
  const { TimesheetsSummary, defaultSummaryColumns } = await import(await summaryModule());
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const staff = [{ ...employees[0], payrollId: "EMP-100" }];
  const html = renderToStaticMarkup(createElement(TimesheetsSummary, { employees: staff, cards: buildTimeCards({ ...base, employees: staff, events: eventsFor("2026-08-03", "09:00", "17:00", 30) }), dateControl: null, start: base.start, end: base.end, rounding: "actual", filtered: false, onBack() {}, onPayrollId() {} }));
  assert.match(html, /Print current columns shown/);
  assert.match(html, /Print all columns/);
  const printable = html.match(/<table class="ts-summary-print-ledger"[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...printable.matchAll(/data-column="([^"]+)"/g)].map(match => match[1]), defaultSummaryColumns);
  assert.match(printable, /EMP-100/);
  assert.match(printable, /7\.50/);
  assert.doesNotMatch(printable, /<button|<input|<form/);
});

test("review cards identify missed breaks and disappear after the clock card is corrected", () => {
  const cards = buildTimeCards({ ...base, events: eventsFor("2026-08-08", "09:00", "14:00") });
  const [review] = timeCardReviews(cards);
  assert.equal(review.employeeId, 1);
  assert.equal(review.startDate, "2026-08-08");
  assert.equal(review.workedMinutes, 300);
  assert.deepEqual(review.issues, ["Missing breaks"]);
  assert.equal(review.card, cards[0]);
  assert.deepEqual(timeCardReviews(buildTimeCards({ ...base, events: eventsFor("2026-08-08", "09:00", "14:00", 30) })), []);
});

test("review counts clock sessions once across midnight while keeping separate shifts separate", () => {
  const events = [...eventsFor("2026-08-03", "22:00", "06:00", 0, 1, true), ...eventsFor("2026-08-05", "09:00", "14:00", 0, 10)];
  const reviews = timeCardReviews(buildTimeCards({ ...base, events }));
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].startDate, "2026-08-03");
  assert.equal(reviews[0].endDate, "2026-08-04");
  assert.equal(reviews[0].workedMinutes, 480);
  assert.deepEqual(reviews[0].issues, ["Missing breaks"]);
  assert.equal(reviews[1].workedMinutes, 300);
});

test("summary ribbon sums displayed employees, leaves identity and rates blank, and prints the same totals", async () => {
  const { TimesheetsSummary } = await import(await summaryModule());
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const staff = [...employees, { ...employees[0], id: 2, name: "Second Worker", wage: "$30/hr" }];
  const cards = buildTimeCards({ ...base, employees: staff, events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-03", "08:00", "17:00", 60, 10).map(event => ({ ...event, employeeId: 2 }))] });
  const props = { employees: staff, cards, dateControl: null, start: base.start, end: base.end, rounding: "actual", filtered: false, onBack() {} };
  const html = renderToStaticMarkup(createElement(TimesheetsSummary, props));
  const ribbon = html.match(/<table[^>]*aria-label="Combined summary totals"[\s\S]*?<\/table>/)[0];
  assert.match(ribbon, /Totals/);
  assert.match(ribbon, /data-total-column="regular"><strong>15\.50<\/strong>/);
  assert.match(ribbon, /data-total-column="ot"><strong>0\.00<\/strong>/);
  assert.match(ribbon, /data-total-column="qualifiedOt"><strong>—<\/strong>/);
  assert.match(ribbon, /data-total-column="wage"><\/td>/);
  assert.match(html, /<tfoot>[\s\S]*data-total-column="regular"><strong>15\.50<\/strong>/);
  const ownHtml = renderToStaticMarkup(createElement(TimesheetsSummary, { ...props, employees, filtered: true }));
  const ownRibbon = ownHtml.match(/<table[^>]*aria-label="Combined summary totals"[\s\S]*?<\/table>/)[0];
  assert.match(ownRibbon, /Filtered totals/);
  assert.match(ownRibbon, /data-total-column="regular"><strong>7\.50<\/strong>/);
});
