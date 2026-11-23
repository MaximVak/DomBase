import assert from "node:assert/strict";
import test from "node:test";
import { loadServerModule } from "../scripts/server-runtime.mjs";
const { buildTimeCards, totalMetrics, timeCardReviews, timeCardEvents, validateTimeCard, timesheetCsv, hourlyWage, weekStartFor, timeCardPreview, timeCardBreakIntervals, roundClockPunch } = await loadServerModule("app/timesheets-model.ts");
const { defaultOvertimePolicy } = await loadServerModule("app/schedule-enforcement.ts");
const { leaveBalance } = await loadServerModule("workforce/leave-policy.ts");
const employees = [{ id: 1, name: "Test Employee", role: "Sales", wage: "$20/hr", active: true }];
const at = (date, time) => new Date(`${date}T${time}:00`).toISOString();
const base = { employees, shifts: [], adjustments: [], pto: [], events: [], start: "2026-08-03", end: "2026-08-09", now: new Date("2026-08-10T12:00:00").getTime(), rounding: "actual", weekStart: 1, mandatoryMealBreak: true, mealBreakAfterHours: 5 };
function eventsFor(date, start, end, breakMinutes = 0, id = 1, nextDay = false) { return timeCardEvents({ employeeId: 1, date, start, end, nextDay, breakMinutes, role: "Sales", note: "", eventIds: [] }, id); }

const hours = value => value * 3600;
const leaveTerms = { category: "pto", method: "fixed", fixedFrequency: "annual", fixedAllowanceSeconds: hours(40),
  earnedSeconds: hours(1), perWorkedSeconds: hours(20), maxBalanceSeconds: null, carryoverSeconds: null, waitingDays: 0, tenureBonuses: [] };
const leaveDay = (date, startTime = null, endTime = null) => ({ startDate: date, endDate: date, startTime, endTime });
function accountFor({ terms = {}, enrollment = {}, ...options } = {}) {
  return leaveBalance({ terms: { ...leaveTerms, ...terms }, enrollment: { startDate: "2026-01-01", openingBalanceSeconds: 0, legacyBalanceYear: null, ...enrollment },
    calendar: { payPeriod: "semimonthly", anchorDate: "2026-01-01" }, today: "2026-12-31", hireDate: null, worked: new Map(), approved: [], ...options });
}

test("annual leave carries vested PTO and applies an explicit carryover limit to front-loaded sick leave", () => {
  const options = { today: "2027-01-02", approved: [leaveDay("2026-06-01"), leaveDay("2027-01-15", "09:00", "11:00")],
    enrollment: { startDate: "2025-03-01", legacyBalanceYear: 2026, openingBalanceSeconds: hours(3) } };
  assert.deepEqual(accountFor(options), { availableSeconds: hours(73), yearEarnedSeconds: hours(40), yearUsedSeconds: hours(2),
    reservedSeconds: hours(2), usableFrom: "2025-03-01" });
  const sick = accountFor({ ...options, terms: { category: "sick", carryoverSeconds: hours(5) } });
  assert.equal(sick.availableSeconds, hours(43));
});

test("fixed credits post on pay-period end dates and sick pay follows first-year earning milestones", () => {
  const terms = { fixedFrequency: "pay_period", fixedAllowanceSeconds: hours(24) };
  assert.equal(accountFor({ terms, today: "2026-01-14" }).availableSeconds, 0);
  assert.equal(accountFor({ terms, today: "2026-01-15" }).availableSeconds, hours(1));
  assert.equal(accountFor({ terms }).availableSeconds, hours(24));
  const sick = { terms: { ...terms, category: "sick", fixedAllowanceSeconds: hours(40) }, enrollment: { startDate: "2026-10-01" } };
  assert.ok(accountFor({ ...sick, today: "2027-01-27" }).availableSeconds < hours(24));
  assert.equal(accountFor({ ...sick, today: "2027-01-28" }).availableSeconds, hours(24));
  assert.equal(accountFor({ ...sick, today: "2027-04-18" }).availableSeconds, hours(40));
  assert.equal(accountFor({ ...sick, today: "2027-12-31" }).yearEarnedSeconds, hours(40));
});

test("verified worked time, waiting, tenure and caps apply independently of approved coverage", () => {
  const worked = new Map([["2026-01-02", hours(20)], ["2026-01-12", hours(40)], ["2026-01-25", hours(20)]]);
  const approved = [leaveDay("2026-01-13", "10:00", "12:00"), leaveDay("2026-01-13", "11:00", "13:00"), leaveDay("2026-11-01", "10:00", "12:00")];
  const options = { hireDate: "2026-01-01", today: "2026-02-01", worked, approved, enrollment: { openingBalanceSeconds: hours(8) },
    terms: { method: "rate", maxBalanceSeconds: hours(7), waitingDays: 10, tenureBonuses: [{ years: 1, seconds: hours(4) }] } };
  const pto = accountFor(options);
  assert.equal(pto.usableFrom, "2026-01-11");
  assert.equal(pto.yearEarnedSeconds, hours(1));
  assert.equal(pto.availableSeconds, hours(4));
  assert.equal(accountFor({ ...options, today: "2027-01-01" }).availableSeconds, hours(7));
  assert.equal(accountFor({ ...options, today: "2028-01-01" }).yearEarnedSeconds, 0);
  const sick = accountFor({ ...options, terms: { ...options.terms, category: "sick", maxBalanceSeconds: hours(80) } });
  assert.equal(sick.usableFrom, pto.usableFrom);
  assert.equal(sick.yearEarnedSeconds, hours(4));
  assert.equal(sick.availableSeconds, hours(7));
});

test("accountant CSV and native Excel preserve fixed columns, text IDs and editable salaried references", async () => {
  const { accountantCells, accountantColumns } = await loadServerModule("workforce/accountant-report.ts");
  const { accountantCsv, accountantWorkbook } = await loadServerModule("app/timesheets/accountant-export/files.ts");
  const { read } = await import("xlsx");
  const report = { period: { start: "2026-11-01", end: "2026-11-15" }, location: "Synthetic office", periodsPerYear: 24,
    rows: [
      { employeeId: 1, name: "Zoë Example", payrollId: "00007", regular: 80, overtime: 1.25, doubleTime: 0.5, pto: 2, total: 83.75, salaryEligible: true },
      { employeeId: 2, name: "=Example", payrollId: "+123", regular: null, overtime: null, doubleTime: null, pto: 0, total: null, salaryEligible: false },
    ] };
  const recorded = accountantCells(report);
  assert.deepEqual(recorded[0], accountantColumns);
  assert.equal(accountantCells(report, new Map())[1][8], 86.67);
  const revised = accountantCells(report, new Map([[1, 35]]));
  assert.deepEqual(revised[1], [...recorded[1], 75.83]);
  assert.equal(revised[2][7], "Review required");
  assert.equal(revised[2][8], "");
  assert.deepEqual(accountantCells({ ...report, periodsPerYear: null }, new Map([[1, 35]])), recorded);
  const csv = accountantCsv(revised);
  assert.match(csv, /^\uFEFF"Employee name","Payroll ID","Pay period"/);
  assert.match(csv, /"Zoë Example","00007","2026-11-01 to 2026-11-15","80\.00","1\.25","0\.50","2\.00","83\.75","75\.83"/);
  assert.match(csv, /"'=Example","'\+123"/);
  const bytes = Buffer.from(await accountantWorkbook(revised));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1");
  const sheet = read(bytes, { cellNF: true }).Sheets["Accountant timesheets"];
  assert.equal(sheet.B2.t, "s");
  assert.equal(sheet.B2.v, "00007");
  assert.equal(sheet.A2.v, "Zoë Example");
  assert.equal(sheet.J1, undefined);
  assert.deepEqual([sheet.H2.t, sheet.H2.v, sheet.H2.z, sheet.I2.v], ["n", 83.75, "0.00", 75.83]);
  assert.equal(sheet.A3.v, "=Example");
  assert.equal(sheet.A3.f, undefined);
});

test("time cards deduct meal breaks, preserve raw hours, and round the preview", () => {
  const events = eventsFor("2026-08-03", "09:00", "17:07", 30);
  const actual = buildTimeCards({ ...base, events });
  const rounded = buildTimeCards({ ...base, events, rounding: 15 });
  assert.ok(Math.abs(actual[0].metrics.actual - (7 + 37 / 60)) < 1e-9);
  assert.equal(rounded[0].metrics.paid, actual[0].metrics.paid);
  assert.equal(rounded[0].metrics.roundedHours, 7.5);
  assert.equal(rounded[0].roundedStart, events[0].at);
  assert.equal(rounded[0].roundedEnd, at("2026-08-03", "17:00"));
  assert.equal(actual[0].roundedEnd, undefined);
  assert.equal(rounded[0].metrics.actual, actual[0].metrics.actual);
  assert.equal(actual[0].metrics.breaks, .5);
  assert.deepEqual(actual[0].issues, []);
  assert.equal(totalMetrics(rounded).wages, 152.33);
  assert.equal(events[0].at, at("2026-08-03", "09:00"));
});

test("rounding previews both timestamps independently and leaves worked hours and overtime exact", () => {
  const date = "2026-08-03";
  const events = eventsFor(date, "09:04", "17:06");
  const [card] = buildTimeCards({ ...base, events, rounding: 10 });
  assert.deepEqual([card.roundedStart, card.roundedEnd], [at(date, "09:00"), at(date, "17:10")]);
  assert.deepEqual([card.start, card.end], events.map(event => event.at));
  assert.equal(card.metrics.roundedHours, 8 + 10 / 60);
  assert.equal(card.metrics.paid, 8 + 2 / 60);
  assert.equal(card.metrics.ot, 2 / 60);
  assert.equal(card.metrics.wages, 161);
  for (const interval of [5, 10, 15]) {
    const boundary = Date.parse(at(date, "14:00"));
    assert.equal(roundClockPunch(boundary + interval * 30000 - 1, interval), boundary);
    assert.equal(roundClockPunch(boundary + interval * 30000, interval), boundary + interval * 60000);
  }
});

test("schedule display aligns nearby recorded punches with their published shift and leaves the exact ledger intact", async () => {
  const date = "2026-08-03";
  const shift = { id: 91, employeeId: 1, role: "Sales", date, start: "09:00", end: "17:00" };
  const events = eventsFor(date, "08:58", "17:04", 30);
  const exact = buildTimeCards({ ...base, events, shifts: [shift] })[0];
  const input = { ...base, events, shifts: [shift], schedulePreview: { shifts: [shift], minutes: 15 } };
  const [card] = buildTimeCards(input);
  assert.deepEqual([card.start, card.end], [at(date, "08:58"), at(date, "17:04")]);
  assert.deepEqual([card.scheduleStart, card.scheduleEnd, card.metrics.scheduleHours], [at(date, "09:00"), at(date, "17:00"), 7.5]);
  assert.deepEqual({ ...card.metrics, scheduleHours: 0 }, exact.metrics);
  assert.deepEqual(card.issues, exact.issues);
  const { dayClockLabel } = await loadServerModule("app/timesheets-day.tsx");
  assert.equal(dayClockLabel(card, date, base.now, undefined, "schedule"), "9:00 am – 5:00 pm");
  assert.equal(dayClockLabel(card, date, base.now), "8:58 am – 5:04 pm");
  const { formatHours, formatTimesheetMetric } = await loadServerModule("app/timesheets-display.ts");
  assert.equal(formatHours(card.metrics.scheduleHours, "decimal"), "7.50");
  assert.equal(formatHours(card.metrics.scheduleHours, "minutes"), "7 hr 30 min");
  assert.equal(formatHours(-1.5, "minutes"), "−1 hr 30 min");
  assert.equal(formatTimesheetMetric("wages", 123.45, "minutes"), "$123.45");
  assert.equal(formatTimesheetMetric("split", 2, "minutes"), "2.00");
});

test("schedule display preserves ambiguous, distant, unconfirmed, and overnight punches outside their rounding bounds", () => {
  const date = "2026-08-03";
  const shift = { id: 91, employeeId: 1, role: "Sales", date, start: "09:00", end: "17:00" };
  const duplicate = { ...shift, id: 92, start: "09:01" };
  const events = eventsFor(date, "08:58", "17:06");
  const read = (shifts, records = events, minutes = 15) => buildTimeCards({ ...base, events: records, schedulePreview: { shifts, minutes } })[0];
  assert.equal(read([shift, duplicate]).scheduleStart, events[0].at);
  assert.equal(read([shift, duplicate], [{ ...events[0], shiftId: 91 }, events[1]]).scheduleStart, at(date, "09:00"));
  assert.equal(read([shift], [{ ...events[0], shiftId: 92 }, events[1]]).scheduleStart, events[0].at);
  assert.equal(read([{ ...shift, role: "Warehouse" }]).scheduleStart, events[0].at);
  assert.equal(read([{ ...shift, employeeId: 2 }]).scheduleStart, events[0].at);
  assert.equal(read([shift], events, 5).scheduleEnd, events[1].at);
  assert.equal(read([shift], [events[0], { ...events[1], assistedStatus: "pending" }]).scheduleEnd, undefined);
  assert.equal(read([shift], [events[0], { ...events[1], automatic: true }]).scheduleEnd, undefined);
  assert.equal(read([shift], [events[0]]).scheduleEnd, undefined);
  const overnight = eventsFor(date, "21:58", "06:02", 30, 1, true);
  const cards = buildTimeCards({ ...base, events: overnight, schedulePreview: { shifts: [{ ...shift, start: "22:00", end: "06:00" }], minutes: 15 } });
  assert.deepEqual(cards.map(card => [card.scheduleStart, card.scheduleEnd]), Array(2).fill([at(date, "22:00"), at("2026-08-04", "06:00")]));
  assert.equal(totalMetrics(cards).scheduleHours, 7.5);
  const beforeMidnight = eventsFor(date, "23:58", "06:00", 0, 1, true);
  assert.equal(read([{ ...shift, date: "2026-08-04", start: "00:00", end: "06:00" }], beforeMidnight).scheduleStart, beforeMidnight[0].at);
  const adjacent = [...eventsFor(date, "08:00", "08:58"), ...eventsFor(date, "08:59", "17:00", 0, 11)];
  assert.equal(read([{ ...shift, start: "08:00", end: "09:00" }], adjacent).scheduleEnd, adjacent[1].at);
});

test("short, overnight and open sessions keep their original work date and exact paid time", () => {
  const [short] = buildTimeCards({ ...base, events: eventsFor("2026-08-03", "09:01", "09:02"), rounding: 5 });
  assert.equal(short.roundedEnd, short.roundedStart);
  assert.equal(short.metrics.roundedHours, 0);
  assert.equal(short.metrics.actual, 1 / 60);
  const overnight = buildTimeCards({ ...base, events: eventsFor("2026-08-03", "23:58", "00:13", 0, 1, true), rounding: 5 });
  assert.deepEqual(overnight.map(card => [card.date, card.metrics.roundedHours, card.metrics.paid]), [
    ["2026-08-03", 0, 2 / 60],
    ["2026-08-04", 15 / 60, 13 / 60],
  ]);
  assert.equal(overnight[0].roundedStart, at("2026-08-04", "00:00"));
  const [open] = buildTimeCards({ ...base, start: "2026-08-03", end: "2026-08-03", now: Date.parse(at("2026-08-03", "09:45")),
    events: eventsFor("2026-08-03", "09:01", "09:40").slice(0, 1), rounding: 10 });
  assert.equal(open.roundedStart, at("2026-08-03", "09:00"));
  assert.equal(open.roundedEnd, undefined);
  assert.equal(open.metrics.roundedHours, 0);
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

test("seventh-day overtime resets on the configured workweek and distinguishes paid leave from work", () => {
  const days = ["03", "04", "05", "06", "07", "08", "09"];
  const work = days.map((day, index) => eventsFor(`2026-08-${day}`, "09:00", index === 6 ? "19:00" : "13:00", 0, index * 10 + 1));
  const input = { ...base, start: "2026-08-09", end: "2026-08-09", events: work.flat() };
  const totals = options => {
    const [row] = buildTimeCards({ ...input, ...options });
    return [row.metrics.regular, row.metrics.ot, row.metrics.doubleOt];
  };
  assert.deepEqual(totals({}), [0, 8, 2]);
  assert.deepEqual(totals({ weekStart: 0 }), [8, 2, 0]);
  assert.deepEqual(totals({ overtimePolicy: { ...defaultOvertimePolicy, overtimeSeventhDayEnabled: false } }), [8, 2, 0]);
  assert.deepEqual(totals({ overtimePolicy: { ...defaultOvertimePolicy, overtimeDoubleEnabled: false } }), [0, 10, 0]);
  assert.deepEqual(totals({ events: work.slice(1).flat(), pto: [
    { employeeId: 1, startDate: "2026-08-03", endDate: "2026-08-03", compensation: "paid", status: "approved" },
  ] }), [8, 2, 0]);
});

test("approved partial days merge overlapping intervals and preserve the full-day default", () => {
  const date = "2026-08-03", next = "2026-08-04";
  const range = (startTime, endTime, extra = {}) => ({ employeeId: 1, startDate: date, endDate: date, compensation: "paid", status: "approved", startTime, endTime, ...extra });
  const pto = [
    range("09:00", "11:00"), range("10:30", "12:00"), range("14:00", "14:30"),
    range("17:00", "18:00", { compensation: "unpaid" }), range("18:00", "21:00", { status: "pending" }),
    range(undefined, undefined, { startDate: next, endDate: next }),
    range("09:00", "11:00", { startDate: next, endDate: next }),
  ];
  const cards = buildTimeCards({ ...base, events: eventsFor(date, "07:00", "08:30"), pto });
  assert.deepEqual(cards.map(card => [card.date, card.metrics.actual, card.metrics.pto, card.metrics.paid]), [
    [date, 1.5, 3.5, 5], [next, 0, 8, 8],
  ]);
});

test("editable thresholds and multipliers apply across split cards without stacking weekly and daily premiums", () => {
  const [first, second] = buildTimeCards({ ...base, events: [
    ...eventsFor("2026-08-03", "06:00", "19:00"),
    ...eventsFor("2026-08-04", "08:00", "18:00", 0, 10),
  ], overtimePolicy: { ...defaultOvertimePolicy, overtimeWeeklyHours: 10 } });
  assert.deepEqual([first.metrics.regular, first.metrics.ot, first.metrics.doubleOt], [8, 4, 1]);
  assert.deepEqual([second.metrics.regular, second.metrics.ot, second.metrics.doubleOt], [2, 8, 0]);
  const split = buildTimeCards({ ...base, events: [
    ...eventsFor("2026-08-03", "07:00", "09:00"),
    ...eventsFor("2026-08-03", "10:00", "17:00", 0, 10),
  ], overtimePolicy: { ...defaultOvertimePolicy, overtimeDailyHours: 8.5, overtimeDoubleEnabled: false, overtimeMultiplier: 1.75 } });
  assert.deepEqual([totalMetrics(split).regular, totalMetrics(split).ot, totalMetrics(split).doubleOt, totalMetrics(split).wages], [8.5, .5, 0, 187.5]);
});

test("overtime uses the weighted rate from the same workweek, even for a one-day view", () => {
  const wageRates = [
    { id: 1, roleId: 1, role: "Sales", basis: "hourly", amountCents: 2000, effectiveDate: "2026-01-01" },
    { id: 2, roleId: 2, role: "Stock", basis: "hourly", amountCents: 3000, effectiveDate: "2026-01-01" },
  ];
  const a = eventsFor("2026-08-03", "09:00", "19:00");
  const b = eventsFor("2026-08-04", "09:00", "19:00", 0, 10).map(event => ({ ...event, role: "Stock" }));
  const input = { ...base, employees: [{ ...employees[0], wageRates }], events: [...a, ...b], end: "2026-08-03" };
  const [single] = buildTimeCards(input);
  assert.equal(single.metrics.wages, 225);
  assert.ok(single.notes.includes("Weighted workweek rate: $25.00/hr"));
  const [limited] = buildTimeCards({ ...input, overtimeScope: { companyWide: false } });
  assert.equal(limited.metrics.ot, null);
  assert.equal(limited.metrics.wages, null);
  const [otherRoleMissing] = buildTimeCards({ ...input, employees: [{ ...employees[0], wageRates: wageRates.slice(0, 1) }] });
  assert.equal(otherRoleMissing.metrics.ot, 2);
  assert.equal(otherRoleMissing.metrics.wages, null);
  assert.ok(otherRoleMissing.issues.includes("Review the workweek overtime rate"));
});

test("salaried overtime depends on the recorded exemption and pays the full multiplier for nonexempt hours", () => {
  const wage = { id: 1, roleId: 1, role: "Sales", basis: "annual_salary", amountCents: 6240000, effectiveDate: "2026-01-01" };
  const run = overtimeExempt => buildTimeCards({ ...base, events: eventsFor("2026-08-03", "06:00", "19:00"),
    employees: [{ ...employees[0], wageRates: [{ ...wage, overtimeExempt }] }] })[0].metrics;
  const hourlyEquivalent = run(false);
  assert.deepEqual([hourlyEquivalent.regular, hourlyEquivalent.ot, hourlyEquivalent.doubleOt, hourlyEquivalent.wages], [8, 4, 1, 480]);
  const exempt = run(true);
  assert.deepEqual([exempt.regular, exempt.ot, exempt.doubleOt, exempt.wages], [13, 0, 0, 390]);
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
  assert.equal(scheduled.metrics.scheduled, 7.5);
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

const summaryModule = () => loadServerModule("app/timesheets-summary.tsx");
const calendarModule = () => loadServerModule("app/timesheets-calendar.tsx");
const dayModule = () => loadServerModule("app/timesheets-day.tsx");
const panelComponent = async () => (await loadServerModule("app/timesheets-panel.tsx")).TimesheetsPanel;

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
  assert.deepEqual(timeCardPreview(draft), { elapsedMinutes: 480, breakMinutes: 45, restMinutes: 0, workedMinutes: 435 });
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
  const { summaryRows, summaryColumns, defaultSummaryColumns } = await summaryModule();
  const staff = [{ ...employees[0], name: "Alex Van Peshkov", payrollId: "007", legalFirstName: "Alexander", legalMiddleName: "V", legalLastName: "Peshkov" }, { id: 2, name: "Other Member", wage: "", role: "Sales", active: true }];
  const cards = buildTimeCards({ ...base, employees: staff, events: [...eventsFor("2026-08-03", "09:00", "17:00", 30), ...eventsFor("2026-08-04", "09:00", "17:00", 30, 10), ...eventsFor("2026-08-04", "09:00", "17:00", 30, 20).map(event => ({ ...event, employeeId: 2 }))] });
  const rows = summaryRows(staff, cards);
  assert.equal(summaryColumns.length, 32);
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
  const { calendarMonthDays, shiftCalendarMonth, validCalendarRange, calendarPresetRange } = await calendarModule();
  const leap = calendarMonthDays("2028-02-01");
  assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(leap[2], "2028-02-01");
  assert.equal(calendarMonthDays("2026-08-01")[6], "2026-08-01");
  assert.equal(shiftCalendarMonth("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftCalendarMonth("2026-01-31", -1), "2025-12-01");
  const calendar = { payPeriod: "weekly", anchorDate: "2026-10-01" };
  assert.deepEqual(calendarPresetRange("yesterday", "2026-01-01", calendar), { start: "2025-12-31", end: "2025-12-31" });
  assert.ok(validCalendarRange("2026-03-01", "2026-03-31"));
  assert.ok(validCalendarRange("2026-10-31", "2026-11-01"));
  assert.equal(validCalendarRange("2026-03-01", "2026-04-01"), false);
  assert.equal(validCalendarRange("2026-03-02", "2026-03-01"), false);
  assert.equal(validCalendarRange("2026-03-02", ""), false);
});

test("pay-period shortcuts follow each saved cadence across calendar boundaries", async () => {
  const { calendarPresetRange } = await calendarModule();
  const cases = [
    ["weekly", "2027-01-01", "2027-01-02", ["2026-12-26", "2027-01-01"], ["2026-12-19", "2026-12-25"]],
    ["biweekly", "2027-01-08", "2026-12-30", ["2026-12-30", "2027-01-12"], ["2026-12-16", "2026-12-29"]],
    ["semimonthly", "2028-03-01", "2026-11-02", ["2028-03-01", "2028-03-15"], ["2028-02-16", "2028-02-29"]],
    ["semimonthly", "2028-02-16", "2026-11-02", ["2028-02-16", "2028-02-29"], ["2028-02-01", "2028-02-15"]],
    ["monthly", "2027-01-10", "2026-11-02", ["2027-01-01", "2027-01-31"], ["2026-12-01", "2026-12-31"]],
  ];
  for (const [payPeriod, today, anchorDate, current, previous] of cases) {
    assert.deepEqual(calendarPresetRange("current", today, { payPeriod, anchorDate }), { start: current[0], end: current[1] });
    assert.deepEqual(calendarPresetRange("previous", today, { payPeriod, anchorDate }), { start: previous[0], end: previous[1] });
  }
});


test("Day view combines split cards and compares actual paid time with scheduled paid time", async () => {
  const { buildDayRows, dayClockLabel } = await dayModule();
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
  const { buildDayRows } = await dayModule();
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
  const { buildDayRows, dayClockLabel, TimesheetsDay } = await dayModule();
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
  const { sortDayRows } = await dayModule();
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

test("monthly Timesheets shows only the pay period and includes its full overtime workweeks", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Panel = await panelComponent();
  const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-01"];
  const events = dates.flatMap((date, index) => eventsFor(date, "09:00", "17:00", 0, index * 10 + 1));
  const html = renderToStaticMarkup(createElement(Panel, {
    ...base, employees, events, weekStart: 1, today: "2026-11-02", now: Date.parse(at("2026-11-02", "12:00")),
    payCalendar: { payPeriod: "monthly", anchorDate: "2026-11-02" },
    overtimeScope: { companyWide: true, dataPeriod: { start: "2026-10-26", end: "2026-12-06" } },
    departments: [], history: [], manager: true, activeEmployeeId: 1, roundingControl: null,
    onSaveCard() {}, onAdjust() {}, onSettings() {},
  }));
  assert.match(html, /Nov 1, 2026 – Nov 30, 2026/);
  assert.doesNotMatch(html, /Oct 26, 2026/);
  const totals = html.match(/<table[^>]*aria-label="Combined timesheet totals"[\s\S]*?<\/table>/)[0];
  assert.match(totals, /1 Time Card/);
  assert.match(totals, /data-column="ot"[^>]*>8\.00</);
});

test("summary printing defaults to visible columns and prints saved values without edit controls", async () => {
  const { TimesheetsSummary, defaultSummaryColumns } = await summaryModule();
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
  const { TimesheetsSummary } = await summaryModule();
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

test("California timesheets keep paid rest paid and recheck waivers against the entire workday", () => {
  const date = "2026-08-03";
  const make = (id, type, time, clockDetails) => ({ id, employeeId: 1, type, at: at(date, time), clockDetails });
  const event = [
    make(1, "in", "08:00", { california: true }),
    make(2, "break", "10:00", { breakKind: "rest" }),
    make(3, "break_end", "10:15", { unpaidSeconds: 300 }),
    make(4, "out", "13:45", { california: true, reports: [{ kind: "meal", slot: 1, outcome: "waived", reason: "Voluntary" }] }),
  ];
  const [first] = buildTimeCards({ ...base, events: event });
  assert.equal(first.metrics.actual, 5 + 40 / 60);
  assert.equal(first.metrics.breaks, 0);
  assert.deepEqual(first.issues, []);
  assert.ok(first.notes.includes("Meal 1 waiver: Voluntary"));
  const extension = [...event, make(5, "in", "15:00", { california: true }), make(6, "out", "16:00")];
  const rows = buildTimeCards({ ...base, events: extension });
  assert.ok(rows.at(-1).issues.includes("Missing or noncompliant meal"));
  assert.ok(rows.at(-1).issues.includes("Missing or short paid rest break"));
  const laterAutomatic = [...extension.slice(0, -1), { ...extension.at(-1), automatic: true }];
  const autoClosedRows = buildTimeCards({ ...base, events: laterAutomatic });
  assert.ok(autoClosedRows[0].notes.includes("Meal 1 waiver: Voluntary"));
  assert.ok(autoClosedRows.at(-1).issues.includes("Missing or noncompliant meal"));
});

test("California meal checks use exact timing and only allow the second waiver after a compliant first meal", async () => {
  const { inspectBreaks, requiredBreaks } = await loadServerModule("kiosk/break-rules.ts");
  const hour = 3600000;
  const event = (type, at) => ({ type, at });
  const assess = (work, firstMeal) => {
    const events = firstMeal === undefined ? [event("in", 0)] : [event("in", 0), event("break", firstMeal), event("break_end", firstMeal + hour / 2)];
    return requiredBreaks(inspectBreaks(events, 0, work + (firstMeal === undefined ? 0 : hour / 2)), { mealBreakAfterHours: 5, mealBreakMinutes: 30 }, true)
      .filter(issue => issue.kind === "meal");
  };
  assert.deepEqual(assess(5 * hour), []);
  assert.deepEqual(assess(6 * hour), [{ kind: "meal", slot: 1, canWaive: true }]);
  assert.deepEqual(assess(6 * hour + 1), [{ kind: "meal", slot: 1, canWaive: false }]);
  assert.deepEqual(assess(12 * hour, 5 * hour), [{ kind: "meal", slot: 2, canWaive: true }]);
  assert.deepEqual(assess(12 * hour + 1, 5 * hour), [{ kind: "meal", slot: 2, canWaive: false }]);
  assert.deepEqual(assess(11 * hour, 5 * hour + 1).map(issue => issue.canWaive), [false, false]);
});

test("automatic clock-out leaves unfinished breaks for review without assuming unpaid time or a waiver", () => {
  const date = "2026-08-03";
  const make = (id, type, wall, extra = {}) => ({ id, employeeId: 1, type, at: at(date, wall), ...extra });
  const start = make(1, "in", "09:00", { clockDetails: { california: true } });
  const end = make(3, "out", "14:45", { automatic: true });
  const meal = make(2, "break", "13:45", { clockDetails: { breakKind: "meal" } });
  const rest = { ...meal, clockDetails: { breakKind: "rest" } };
  for (const pause of [meal, rest]) {
    const [card] = buildTimeCards({ ...base, events: [start, pause, end] });
    assert.equal(card.metrics.actual, 5.75);
    assert.equal(card.metrics.breaks, 0);
    assert.ok(card.issues.includes("Confirm unfinished break"));
    assert.ok(card.issues.includes("Missing or noncompliant meal"));
    assert.ok(card.issues.includes("Missing or short paid rest break"));
  }
  const confirmed = make(4, "break_end", "14:15");
  const [card] = buildTimeCards({ ...base, events: [start, meal, confirmed, end] });
  assert.equal(card.metrics.actual, 5.25);
  assert.equal(card.metrics.breaks, 0.5);
  assert.deepEqual(card.issues, ["Automatic clock-out", "Missing or short paid rest break"]);
  const shifted = { ...end, at: at(date, "14:00") };
  const [atLimit] = buildTimeCards({ ...base, events: [start, meal, shifted] });
  assert.ok(atLimit.issues.includes("Confirm unfinished break"));
  assert.ok(!atLimit.issues.includes("Missing or noncompliant meal"));
});

const statutoryPremiums = { mealLimit: 1, restLimit: 1, companyWide: true };
const confirmedEvents = draft => timeCardEvents({
  employeeId: 1, date: "2026-08-03", start: "09:00", end: "17:00", breakMinutes: 0, role: "Sales",
  note: "", nextDay: false, eventIds: [], timeZone: "America/Los_Angeles", confirmBreakRecord: true, ...draft,
}, draft?.id ?? 1);

test("missed meals and rest breaks add separate paid hours once per workday and respect the optional company limits", () => {
  const events = confirmedEvents({ end: "20:30" });
  const input = { ...base, events, timeZone: "America/Los_Angeles", breakPremiumPolicy: statutoryPremiums };
  const [card] = buildTimeCards(input);
  assert.deepEqual([card.metrics.mealPremium, card.metrics.restPremium, card.metrics.premiumPay], [1, 1, 40]);
  assert.deepEqual([card.metrics.actual, card.metrics.regular, card.metrics.ot, card.metrics.doubleOt, card.metrics.paid], [11.5, 8, 3.5, 0, 13.5]);
  assert.equal(card.metrics.wages, 305);
  const [company] = buildTimeCards({ ...input, breakPremiumPolicy: { ...statutoryPremiums, restLimit: 2 } });
  assert.deepEqual([company.metrics.mealPremium, company.metrics.restPremium, company.metrics.premiumPay, company.metrics.paid], [1, 2, 60, 14.5]);
  const [disabled] = buildTimeCards({ ...input, breakPremiumPolicy: undefined });
  assert.equal(disabled.metrics.paid, 11.5);
  assert.equal(disabled.metrics.premiumPay, 0);
});

test("break premiums recalculate from exact saved breaks and honor an eligible recorded waiver", () => {
  const input = { ...base, breakPremiumPolicy: statutoryPremiums, timeZone: "America/Los_Angeles" };
  const rests = [{ id: 1, start: "10:30", end: "10:40", kind: "rest", nextDay: false }];
  const events = confirmedEvents({ end: "14:45", breaks: rests });
  const [missing] = buildTimeCards({ ...input, events });
  assert.deepEqual([missing.metrics.mealPremium, missing.metrics.restPremium, missing.metrics.restBreaks], [1, 0, 1 / 6]);
  const waived = events.map(event => event.type === "out" ? { ...event, clockDetails: { reports: [{ kind: "meal", slot: 1, outcome: "waived" }] } } : event);
  assert.equal(buildTimeCards({ ...input, events: waived })[0].metrics.mealPremium, 0);
  const delayed = confirmedEvents({ end: "15:45", breaks: [...rests, { id: 2, start: "14:00:00.500", end: "14:30:00.500", nextDay: false, kind: "meal" }] });
  const corrected = confirmedEvents({ end: "15:45", breaks: [...rests, { id: 2, start: "14:00", end: "14:30", nextDay: false, kind: "meal" }] });
  assert.equal(delayed[3].at, "2026-08-03T21:00:00.500Z");
  assert.equal(buildTimeCards({ ...input, events: delayed, rounding: 15 })[0].metrics.mealPremium, 1);
  assert.equal(buildTimeCards({ ...input, events: corrected, rounding: 15 })[0].metrics.mealPremium, 0);
  assert.equal(buildTimeCards({ ...input, events: [...waived.slice(0, -1), { ...waived.at(-1), at: "2026-08-03T22:01:00.000Z" }] })[0].metrics.mealPremium, 1);
});

test("premium estimates use recorded whole-workweek wages across roles and protect incomplete and salaried records", () => {
  const wageRates = [
    { id: 1, roleId: 1, role: "Sales", basis: "hourly", amountCents: 2000, effectiveDate: "2026-01-01" },
    { id: 2, roleId: 2, role: "Stock", basis: "hourly", amountCents: 3000, effectiveDate: "2026-01-01" },
  ];
  const events = [...confirmedEvents({ end: "13:00" }), ...confirmedEvents({ id: 10, start: "14:00", end: "18:00", role: "Stock" }),
    ...confirmedEvents({ id: 20, date: "2026-08-04", role: "Stock", end: "13:00" })];
  const input = { ...base, events, employees: [{ ...employees[0], wageRates }], end: "2026-08-03",
    breakPremiumPolicy: statutoryPremiums, timeZone: "America/Los_Angeles" };
  const rows = buildTimeCards(input);
  assert.deepEqual(rows.map(card => [card.metrics.mealPremium, card.metrics.restPremium, card.metrics.premiumPay]), [[0, 0, 0], [1, 1, 53.33]]);
  assert.equal(totalMetrics(rows).actual, 8);
  assert.equal(totalMetrics(rows).ot, 0);
  const truncated = buildTimeCards({ ...input, breakPremiumPolicy: { ...statutoryPremiums, dataPeriod: { start: "2026-08-03", end: "2026-08-03" } } });
  assert.equal(truncated[1].metrics.premiumPay, null);
  const scoped = buildTimeCards({ ...input, breakPremiumPolicy: { ...statutoryPremiums, companyWide: false } });
  assert.equal(totalMetrics(scoped).mealPremium, 0);
  assert.ok(scoped[1].issues.includes("Review premiums in company-wide Timesheets"));
  const salary = wageRates.map(rate => ({ ...rate, basis: "annual_salary", amountCents: 8800000, overtimeExempt: true }));
  const exempt = buildTimeCards({ ...input, employees: [{ ...employees[0], wageRates: salary }] });
  assert.equal(totalMetrics(exempt).mealPremium, 0);
  assert.equal(totalMetrics(exempt).restPremium, 0);
  const nonexempt = buildTimeCards({ ...input, employees: [{ ...employees[0], wageRates: salary.map(rate => ({ ...rate, overtimeExempt: false })) }] });
  assert.ok(nonexempt[1].issues.includes("Review salaried break premium"));
});

test("unrecorded break claims and unresolved clock-outs are flagged before a premium estimate is added", () => {
  const events = confirmedEvents({ end: "17:00" });
  const input = { ...base, timeZone: "America/Los_Angeles", breakPremiumPolicy: statutoryPremiums };
  for (const alternative of [
    { automatic: true }, { assistedStatus: "pending" },
    { clockDetails: { reports: [{ kind: "meal", slot: 1, outcome: "unrecorded", reason: "Took lunch without using the tablet." }] } },
  ]) {
    const [card] = buildTimeCards({ ...input, events: [events[0], { ...events[1], ...alternative }] });
    assert.ok(card.issues.includes("Confirm time and breaks before calculating premiums"));
    assert.equal(card.metrics.premiumPay, 0);
  }
});
