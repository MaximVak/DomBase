import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/schedule-enforcement.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const rules = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const defaults = rules.defaultScheduleEnforcement;
const eventsSource = await readFile(new URL("../app/schedule-events.ts", import.meta.url), "utf8");
const eventsCode = ts.transpileModule(eventsSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const scheduleEvents = await import(`data:text/javascript;base64,${Buffer.from(eventsCode).toString("base64")}`);
const profileSource = await readFile(new URL("../app/account-profile.ts", import.meta.url), "utf8");
const profileCode = ts.transpileModule(profileSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace('"./schedule-events"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(eventsCode).toString("base64")}`));
const accountProfile = await import(`data:text/javascript;base64,${Buffer.from(profileCode).toString("base64")}`);
const page = await readFile(new URL("../app/workspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) helpers.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);

// Run the actual page helpers against in-memory records, without clocking anyone in or out.
function runtime(extra = {}) {
  const names = ["formatTimeDraftInput", "timeDraftHourLength", "nextId", "lastWorkClockEvent", "shiftForClockEvent", "shiftStartDateTime", "shiftEndDateTime",
    "applyAutomaticClockOuts", "isAutomaticClockOut", "hasClockInForShift", "noShowAlertsFor", "needsTimeException",
    "isWithinScheduledMinute", "workWeekCalendarDays", "hoursDateRange", "hoursDateLabel", "dateRangeForCalendarTab", "shiftsForCalendarRange",
    "parseLocalDate", "startOfDay", "toDateInputValue", "shiftDateForWeekday", "shiftDatesForWeekdays",
    "formatShortDate", "formatLongDate", "formatMonthYear", "formatClockTime", "saveScheduleEnforcement",
    "saveAlertsPermissions", "applyScheduleDraft", "submitAvailabilityRequest", "saveEventsTrades", "saveScheduleEvent", "deleteScheduleEvent", "saveOvertime",
    "saveBreaksCompliance", "operationalAlertsFor", "matchingBreakStartEvent", "breakEndTime", "breakDurationMs", "isWithinClockInGrace",
    "timeToMinutes", "adjustedWorkedHoursForRange", "workedHoursForRange", "clockIntervals", "breakIntervalsForEvents",
    "clippedDuration", "overlapDuration", "startOfNextDay", "saveMessagesSettings", "createTeamConversation", "sendTeamMessage",
    "messagePtoRequestEmployee", "messageRosterEmployee", "saveAccountProfile", "hasEmployeeWithName", "normalizeEmployeeName",
    "formatPhoneNumberInput", "formatWageInput", "isManagerEmployee"];
  const context = vm.createContext({ ...rules, ...scheduleEvents, ...accountProfile, Date, console, newRecordId: () => Math.floor(Math.random() * 1000000000) + 100000,
    automaticClockOutExplanation: "Automatically clocked out two hours after the scheduled shift ended.",
    scheduleEnforcementStorageKey: "test-enforcement",
    operationalAlertLookbackMs: 7 * 24 * 60 * 60 * 1000,
    shiftWeekdayOptions: [1, 2, 3, 4, 5, 6, 0].map(value => ({ value })),
    scheduleEnforcement: defaults,
    ...extra,
  });
  const compiled = ts.transpileModule(names.map(name => {
    assert.ok(helpers.has(name), `Missing helper ${name}`);
    return helpers.get(name);
  }).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  vm.runInContext(compiled, context);
  return context;
}

const shift = { id: 1, employeeId: 1, date: "2026-10-03", start: "09:00", end: "17:00" };
const scheduledStart = new Date(`${shift.date}T09:00:00`).getTime();
const scheduledEnd = new Date(`${shift.date}T17:00:00`).getTime();

test("clock-in thresholds respect both exact boundaries and customized grace periods", () => {
  assert.equal(rules.clockInTiming(scheduledStart - 5 * 60000, scheduledStart, defaults), "on-time");
  assert.equal(rules.clockInTiming(scheduledStart - 5 * 60000 - 1, scheduledStart, defaults), "early");
  assert.equal(rules.clockInTiming(scheduledStart + 60000 - 1, scheduledStart, defaults), "on-time");
  assert.equal(rules.clockInTiming(scheduledStart + 60000, scheduledStart, defaults), "late");
  const custom = { ...defaults, earlyClockInMinutes: 10, lateMinutes: 5 };
  assert.equal(rules.clockInTiming(scheduledStart - 8 * 60000, scheduledStart, custom), "on-time");
  assert.equal(rules.clockInTiming(scheduledStart + 4 * 60000, scheduledStart, custom), "on-time");
  assert.equal(rules.clockInTiming(scheduledStart + 5 * 60000, scheduledStart, custom), "late");
});

test("explanation switches independently affect early, late, unscheduled, and clock-out actions", () => {
  const app = runtime();
  assert.equal(app.needsTimeException("in", shift, undefined, scheduledStart - 10 * 60000, defaults), true);
  assert.equal(app.needsTimeException("in", shift, undefined, scheduledStart - 10 * 60000, { ...defaults, requireEarlyClockInExplanation: false }), false);
  assert.equal(app.needsTimeException("in", shift, undefined, scheduledStart + 10 * 60000, { ...defaults, requireLateClockInExplanation: false }), false);
  assert.equal(app.needsTimeException("out", shift, undefined, scheduledEnd + 60000, defaults), true);
  assert.equal(app.needsTimeException("out", shift, undefined, scheduledEnd + 60000, { ...defaults, requireClockOutExplanation: false }), false);
  assert.equal(app.needsTimeException("in", undefined, undefined, scheduledStart, { ...defaults, requireUnscheduledExplanation: false }), false);
  assert.equal(app.needsTimeException("out", undefined, undefined, scheduledStart, defaults), true);
});

test("automatic clock-outs use configured delay, can be disabled, and never duplicate events", () => {
  const app = runtime();
  const clockIn = { id: 1, employeeId: 1, type: "in", at: new Date(scheduledStart).toISOString() };
  const state = { employees: [{ id: 1 }], shifts: [shift], clockEvents: [clockIn] };
  const settings = { ...defaults, automaticClockOutMinutes: 30 };
  const due = scheduledEnd + 30 * 60000;
  assert.equal(app.applyAutomaticClockOuts(state, due - 1, settings), state);
  assert.equal(app.applyAutomaticClockOuts(state, due, { ...settings, automaticClockOut: false }), state);
  const updated = app.applyAutomaticClockOuts(state, due, settings);
  assert.equal(updated.clockEvents.length, 2);
  assert.equal(updated.clockEvents[0].at, new Date(due).toISOString());
  assert.equal(app.isAutomaticClockOut(updated.clockEvents[0]), true);
  assert.match(updated.clockEvents[0].explanation, /30 minutes/);
  assert.equal(app.applyAutomaticClockOuts(updated, due + 60000, settings), updated);
  assert.equal(app.isAutomaticClockOut({ type: "out", explanation: app.automaticClockOutExplanation }), true);
});

test("no-show alerts honor the configured delay, disable switch, and recorded attendance", () => {
  const app = runtime();
  const employees = [{ id: 1, name: "Test", active: true }];
  const settings = { ...defaults, noShowMinutes: 10 };
  assert.equal(app.noShowAlertsFor(employees, [shift], [], scheduledStart + 9 * 60000, -Infinity, settings).length, 0);
  assert.equal(app.noShowAlertsFor(employees, [shift], [], scheduledStart + 10 * 60000, -Infinity, settings).length, 1);
  assert.equal(app.noShowAlertsFor(employees, [shift], [], scheduledStart + 10 * 60000, -Infinity, { ...settings, noShowAlerts: false }).length, 0);
  const events = [{ type: "in", employeeId: 1, at: new Date(scheduledStart).toISOString() }];
  assert.equal(app.noShowAlertsFor(employees, [shift], events, scheduledStart + 10 * 60000, -Infinity, settings).length, 0);
});

test("work-week settings keep shift apply dates and timesheet week ranges aligned", () => {
  const app = runtime();
  for (const weekStart of [0, 1, 4]) {
    const days = app.workWeekCalendarDays("2026-10-03", weekStart);
    assert.equal(new Date(`${days[0].date}T12:00:00`).getDay(), weekStart);
    const range = app.hoursDateRange("2026-10-03", "week", weekStart);
    assert.equal(app.toDateInputValue(range.start), days[0].date);
    assert.equal(app.toDateInputValue(range.end), days[6].date);
    for (const day of days) {
      assert.equal(app.shiftDateForWeekday("2026-10-03", new Date(`${day.date}T12:00:00`).getDay(), weekStart), day.date);
    }
  }
});



test("invalid stored settings fall back safely without accepting strings or out-of-range values", () => {
  assert.deepEqual(rules.normalizeScheduleEnforcement({ lateMinutes: -1, automaticClockOutMinutes: Infinity, workWeekStart: 7, automaticClockOut: "false" }), defaults);
  assert.equal(rules.normalizeScheduleEnforcement({ automaticClockOut: false }).automaticClockOut, false);
  assert.equal(rules.normalizeScheduleEnforcement({ earlyClockInMinutes: 0 }).earlyClockInMinutes, 0);
});

test("each settings panel saves its own fields while sharing missed-clock-in rules", () => {
  const saved = { ...defaults, lateMinutes: 5 };
  const draft = { ...saved, workWeekStart: 0, noShowMinutes: 15, employeesOwnScheduleOnly: true };
  const alerts = rules.schedulingSettingsForSave(saved, draft, rules.alertsPermissionsFields);
  assert.equal(alerts.employeesOwnScheduleOnly, true);
  assert.equal(alerts.noShowMinutes, 15);
  assert.equal(alerts.workWeekStart, saved.workWeekStart);
  const enforcement = rules.schedulingSettingsForSave(saved, draft, rules.scheduleEnforcementFields);
  assert.equal(enforcement.workWeekStart, 0);
  assert.equal(enforcement.noShowMinutes, 15);
  assert.equal(enforcement.employeesOwnScheduleOnly, false);
});

test("schedule visibility protects other employees and public views without restricting managers", () => {
  assert.equal(rules.canViewTeamSchedule(1, 1, false, false, true), true);
  assert.equal(rules.canViewTeamSchedule(2, 1, false, false, true), false);
  assert.equal(rules.canViewTeamSchedule(2, 1, true, false, true), true);
  assert.equal(rules.canViewTeamSchedule(2, 0, false, true, true), false);
  assert.equal(rules.canViewTeamSchedule(2, 1, false, false, false), true);
});

test("department permissions cover creates, role changes, deletes, and admin exceptions", () => {
  const manager = { id: 2, accessLevel: "Manager" };
  const departments = [{ managerIds: [2], roles: ["Sales"] }, { managerIds: [3], roles: ["Warehouse"] }];
  const allowed = role => rules.canManageScheduleRole(role, manager, departments, true);
  assert.equal(allowed("Sales"), true);
  assert.equal(allowed("Warehouse"), false);
  assert.equal(rules.canManageScheduleRole("Warehouse", { id: 1, accessLevel: "Admin" }, departments, true), true);
  assert.equal(rules.canManageScheduleRole("Warehouse", manager, departments, false), true);
  assert.equal(rules.canManageScheduleRole("Sales", { id: 2, accessLevel: "Employee" }, departments, false), false);
  const shifts = [{ id: 1, role: "Sales" }, { id: 2, role: "Warehouse" }];
  assert.equal(rules.scheduleDraftIsAllowed({ upsertedShifts: [{ id: 3, role: "Sales" }], deletedShiftIds: [] }, shifts, allowed), true);
  assert.equal(rules.scheduleDraftIsAllowed({ upsertedShifts: [{ id: 2, role: "Sales" }], deletedShiftIds: [] }, shifts, allowed), false);
  assert.equal(rules.scheduleDraftIsAllowed({ upsertedShifts: [], deletedShiftIds: [2] }, shifts, allowed), false);
});

// Publication preferences and authorization are exercised through real D1 and HTTP
// in schedule-publication.test.mjs and schedule-publication-app.test.mjs.
test("availability submissions persist pending or approved status according to the setting", () => {
  for (const requireAvailabilityApproval of [true, false]) {
    let state = { availabilityRequests: [] };
    const app = runtime({ activeEmployeeId: 1, scheduleEnforcement: { ...defaults, requireAvailabilityApproval }, setState: updater => { state = updater(state); } });
    app.submitAvailabilityRequest("2026-10-03", [{ day: "Monday", startHour: 9, endHour: 17 }], "Test");
    const request = state.availabilityRequests[0];
    assert.equal(request.status, requireAvailabilityApproval ? "pending" : "approved");
    assert.equal(Boolean(request.decidedAt), !requireAvailabilityApproval);
  }
});





test("schedule events support manager create, edit, and delete with valid records", () => {
  let state = { scheduleEvents: [] };
  const app = runtime({ mode: "manager", setState: updater => { state = updater(state); }, setScheduleEventDraft() {} });
  app.saveScheduleEvent({ id: 0, date: "2026-10-03", title: " Team day ", notes: " Welcome " });
  assert.equal(state.scheduleEvents[0].title, "Team day");
  assert.equal(state.scheduleEvents[0].notes, "Welcome");
  app.saveScheduleEvent({ ...state.scheduleEvents[0], date: "2026-10-04", title: "Updated" });
  assert.equal(state.scheduleEvents.length, 1);
  assert.equal(state.scheduleEvents[0].date, "2026-10-04");
  app.saveScheduleEvent({ id: 0, date: "2026-02-30", title: "Invalid", notes: "" });
  app.saveScheduleEvent({ id: 0, date: "2026-10-03", title: " ", notes: "" });
  assert.equal(state.scheduleEvents.length, 1);
  app.mode = "employee";
  app.saveScheduleEvent({ id: 0, date: "2026-10-03", title: "Not allowed", notes: "" });
  app.deleteScheduleEvent(state.scheduleEvents[0].id);
  assert.equal(state.scheduleEvents.length, 1);
  app.mode = "manager";
  app.scheduleEnforcement = { ...defaults, enableScheduleEvents: false };
  app.deleteScheduleEvent(state.scheduleEvents[0].id);
  assert.equal(state.scheduleEvents.length, 1);
  app.scheduleEnforcement = defaults;
  assert.deepEqual(scheduleEvents.normalizeScheduleEvents(JSON.parse(JSON.stringify(state.scheduleEvents))), JSON.parse(JSON.stringify(state.scheduleEvents)));
  app.deleteScheduleEvent(state.scheduleEvents[0].id);
  assert.equal(state.scheduleEvents.length, 0);
});

test("older and malformed event records normalize safely", () => {
  assert.deepEqual(scheduleEvents.normalizeScheduleEvents(undefined), []);
  const event = { id: 1, date: "2026-10-03", title: " Sale ", notes: "Notes" };
  const normalized = scheduleEvents.normalizeScheduleEvents([null, {}, event, event, { ...event, id: 2, date: "2026-02-30" }]);
  assert.deepEqual(normalized, [{ ...event, title: "Sale" }]);
  assert.equal(scheduleEvents.validEventDate("2028-02-29"), true);
  assert.equal(scheduleEvents.validEventDate("2026-02-29"), false);
});





test("missed-break alerts use the saved threshold and mandatory switch for open and completed sessions", () => {
  const app = runtime();
  const employees = [{ id: 1, name: "Test", active: true }];
  const clockIn = { id: 1, employeeId: 1, type: "in", at: new Date(scheduledStart).toISOString() };
  const settings = { ...defaults, mealBreakAfterHours: 4 };
  const due = scheduledStart + 4 * 60 * 60 * 1000;
  const missed = (events, time, config = settings) => app.operationalAlertsFor(employees, [shift], events, time, config).filter(alert => alert.title === "Missed break");
  assert.equal(missed([clockIn], due - 1).length, 0);
  assert.equal(missed([clockIn], due).length, 1);
  assert.equal(missed([clockIn], due)[0].at, new Date(due).toISOString());
  assert.match(missed([clockIn], due)[0].detail, /4 continuous hours/);
  assert.equal(missed([clockIn], due, { ...settings, mandatoryMealBreak: false }).length, 0);
  const earlyClockOut = { id: 2, employeeId: 1, type: "out", at: new Date(due).toISOString() };
  assert.equal(missed([clockIn, earlyClockOut], due).length, 1);
  assert.equal(missed([clockIn, earlyClockOut], due, defaults).length, 0);
  const fullClockOut = { ...earlyClockOut, at: new Date(scheduledEnd).toISOString() };
  assert.equal(missed([clockIn, fullClockOut], scheduledEnd, { ...settings, mandatoryMealBreak: false }).length, 0);
  const recordedBreak = { id: 3, employeeId: 1, type: "break", durationMinutes: 30, at: new Date(scheduledStart + 2 * 60 * 60 * 1000).toISOString() };
  assert.equal(missed([clockIn, recordedBreak], due).length, 0);
  assert.equal(missed([clockIn, recordedBreak, fullClockOut], scheduledEnd).length, 0);
});



test("disabled messaging blocks new chats, replies, and profile or PTO shortcuts", () => {
  const state = { conversations: [{ id: 1, participantIds: [1, 2], messages: [{ id: 1, body: "Existing" }] }] };
  let mutations = 0, error;
  const app = runtime({ state, scheduleEnforcement: { ...defaults, enableTeamMessaging: false },
    setState() { mutations++; }, setMessageError(value) { error = value; },
  });
  app.createTeamConversation({ preventDefault() {} });
  assert.match(error, /disabled/);
  app.sendTeamMessage({ preventDefault() {} });
  assert.match(error, /disabled/);
  app.messagePtoRequestEmployee();
  app.messageRosterEmployee(2);
  assert.equal(mutations, 0);
  assert.equal(state.conversations[0].messages.length, 1);
});

test("enabled messaging still creates group conversations and replies", () => {
  let state = { conversations: [] };
  const app = runtime({ activeEmployeeId: 1, newConversationMemberIds: [2, 3], ptoMessageEmployeeId: null,
    newConversationMessage: " Hello team ", state, setState(updater) { state = updater(state); },
    setNewConversationMemberIds() {}, setPtoMessageEmployeeId() {}, setNewConversationMessage() {},
    setMessageError() {}, setIsCreatingConversation() {}, setSelectedConversationId() {},
    setMessageDraft() {}, messageComposerRef: { current: null }, window: { requestAnimationFrame(callback) { callback(); } },
  });
  app.createTeamConversation({ preventDefault() {} });
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].messages[0].body, "Hello team");
  assert.deepEqual(Array.from(state.conversations[0].participantIds), [1, 2, 3]);
  app.selectedConversation = state.conversations[0];
  app.messageDraft = " Follow up ";
  app.sendTeamMessage({ preventDefault() {} });
  assert.equal(state.conversations[0].messages.length, 2);
  assert.equal(state.conversations[0].messages[1].body, "Follow up");
});

const profileEmployee = { id: 2, name: "Example Person", accessLevel: "Employee", pin: "9999", role: "Sales", wage: "$20.00/hr", startDate: "2026-01-01",
  email: "", phone: "", dateOfBirth: "", socialSecurityNumber: "", homeAddress: "", homeCityStateZip: "", emergencyContact: "",
  legalMiddleName: "Keep", emergencyContactRelationship: "Sibling", certificates: [{ id: 1, name: "Certificate", fileName: "" }],
};

test("profile values preserve stored names and legacy addresses, and hide the SSN in display", () => {
  const values = accountProfile.profileValues({ ...profileEmployee, name: "Example Multi Part", homeCityStateZip: "Sample City, CA 90000", socialSecurityNumber: "000-00-1234" });
  assert.equal(values.firstName, "Example");
  assert.equal(values.lastName, "Multi Part");
  assert.equal(values.legalFirstName, "");
  assert.equal(values.homeCity, "Sample City");
  assert.equal(values.homeStateProvince, "CA");
  assert.equal(values.homePostalCode, "90000");
  assert.equal(accountProfile.maskProfileSsn(values.socialSecurityNumber), "•••-••-1234");
  assert.equal(accountProfile.maskProfileSsn(""), "");
  assert.equal(accountProfile.profileValues({ ...profileEmployee, homeCity: "Updated city", homeCityStateZip: "Old city, CA 90000" }).homeCity, "Updated city");
});

test("profile updates validate personal fields and cannot change access, PINs, or other employee fields", () => {
  const values = accountProfile.profileValues(profileEmployee);
  const result = accountProfile.profileUpdate({ ...values, firstName: " New ", lastName: " Name ", homeCity: "Sample City", homeStateProvince: "CA", homePostalCode: "90000", accessLevel: "Admin", pin: "1111", id: 1 }, "2026-10-03");
  assert.equal(result.update.name, "New Name");
  assert.equal(result.update.homeCityStateZip, "Sample City, CA 90000");
  assert.equal(Object.hasOwn(result.update, "accessLevel"), false);
  assert.equal(Object.hasOwn(result.update, "pin"), false);
  assert.equal(Object.hasOwn(result.update, "id"), false);
  for (const invalid of [{ firstName: " " }, { email: "invalid" }, { socialSecurityNumber: "123" }, { dateOfBirth: "2026-02-30" }, { dateOfBirth: "2027-01-01" }, { homePostalCode: "123" }]) {
    assert.ok(accountProfile.profileUpdate({ ...values, ...invalid }, "2026-10-03").error);
  }
  assert.ok(accountProfile.profileUpdate({ ...values, socialSecurityNumber: "•••-••-1234", homeCity: "Updated" }, "2026-10-03").update);
  assert.ok(accountProfile.profileUpdate({ ...values, dateOfBirth: "2000-02-29", homePostalCode: "90000-1234" }, "2026-10-03").update);
});

test("self-profile saves wait for confirmation and update only the linked employee", async () => {
  const other = { ...profileEmployee, id: 3, name: "Other Person" };
  let state = { employees: [profileEmployee, other], conversations: [] };
  let writes = 0;
  const app = runtime({ state, activeEmployee: profileEmployee, activeEmployeeId: 2, accountOwnerEmployeeId: 1, isPublicSchedule: false, today: "2026-10-03",
    setState(updater) { state = updater(state); writes++; return true; },
  });
  const values = accountProfile.profileValues(profileEmployee);
  assert.equal(await app.saveAccountProfile({ ...values, firstName: "Updated", phone: "2025550100", emergencyContactPhone: "2025550101", legalLastName: "Legal", homeCity: "Sample City", homeStateProvince: "CA", homePostalCode: "90000" }), null);
  assert.equal(state.employees[0].name, "Updated Person");
  assert.equal(state.employees[0].phone, "(202) 555-0100");
  assert.equal(state.employees[0].emergencyContactPhone, "(202) 555-0101");
  assert.equal(state.employees[0].legalMiddleName, "Keep");
  assert.equal(state.employees[0].accessLevel, "Employee");
  assert.equal(state.employees[0].pin, "9999");
  assert.equal(state.employees[0].certificates, profileEmployee.certificates);
  assert.equal(state.employees[1], other);
  assert.match(await app.saveAccountProfile({ ...values, firstName: "Other", lastName: "Person" }), /already in use/);
  assert.equal(writes, 1);
  app.activeEmployee = undefined;
  assert.match(await app.saveAccountProfile(values), /not linked/);
  assert.equal(writes, 1);
});



test("employee performance respects the same missed-break threshold and mandatory switch", async () => {
  const { loadServerModule } = await import("../scripts/server-runtime.mjs");
  const { reliabilityFor } = await loadServerModule("team/insights-rules.ts");
  const state = { employees: [{id:1,name:"Fictional"}], shifts: [{ ...shift, role: "Sales" }], ptoRequests: [], clockEvents: [
    { id: 1, employeeId: 1, type: "in", at: new Date(scheduledStart).toISOString() },
    { id: 2, employeeId: 1, type: "out", at: new Date(scheduledEnd).toISOString() },
  ] };
  const result = settings => reliabilityFor(state, shift.date, shift.date, scheduledEnd, settings, Intl.DateTimeFormat().resolvedOptions().timeZone)[0];
  assert.equal(result(defaults).missedBreak, true);
  assert.equal(result({...defaults,mealBreakAfterHours:9}).missedBreak, false);
  assert.equal(result({...defaults,mandatoryMealBreak:false}).missedBreak, false);
  state.clockEvents.push({ id:3, employeeId:1, type:"break", at:new Date(scheduledStart+2*3600000).toISOString() }, { id:4, employeeId:1, type:"break_end", at:new Date(scheduledStart+2.5*3600000).toISOString() });
  assert.equal(result(defaults).missedBreak, false);
});

// Browser-persistence tests were replaced by real D1 persistence/restart checks
// in workforce.test.mjs. These controller checks cover acknowledgement behavior.
test("settings controllers submit only their own fields and await server confirmation", async t => {
  const cases = [["saveScheduleEnforcement", "setScheduleEnforcementMessage", "lateMinutes", 8], ["saveAlertsPermissions", "setAlertsPermissionsMessage", "noShowMinutes", 12], ["saveEventsTrades", "setEventsTradesMessage", "enableScheduleEvents", false], ["saveOvertime", "setOvertimeMessage", "workWeekStart", 0], ["saveBreaksCompliance", "setBreaksComplianceMessage", "mealBreakAfterHours", 4], ["saveMessagesSettings", "setMessagesSettingsMessage", "enableTeamMessaging", false]];
  for (const [name, feedback, field, value] of cases) await t.test(name, async () => {
    let release; let body; let message;
    const app = runtime({ state: { hoursRoundingMinutes: 15 }, scheduleEnforcementDraft: { ...defaults, [field]: value },
      shared: { save: changes => { body = changes; return new Promise(resolve => { release = resolve; }); } }, [feedback]: value => { message = value; } });
    const pending = app[name]({ preventDefault() {} });
    assert.equal(body[0].entity, "settings"); assert.equal(body[0].after[field], value); assert.equal(message, undefined);
    release(true); await pending; assert.match(message, /saved/);
  });
});

test("employee profiles can display missing or invalid optional start dates", () => {
  const context = runtime();
  assert.equal(context.formatShortDate(""), "—");
  assert.equal(context.formatShortDate("invalid"), "—");
  assert.match(context.formatShortDate("2026-11-02"), /Nov/);
});


test("Home upcoming shifts include today and each range's last day, respecting employee scope", () => {
  const app = runtime();
  const shifts = [
    { id: 1, employeeId: 3, date: "2026-11-12" },
    { id: 2, employeeId: 3, date: "2026-11-15" },
    { id: 3, employeeId: 3, date: "2026-11-30" },
    { id: 4, employeeId: 3, date: "2026-12-01" },
    { id: 5, employeeId: 99, date: "2026-11-12" },
    { id: 6, employeeId: 3, date: "2026-11-09" },
    { id: 7, employeeId: 3, date: "2026-11-08" },
  ];
  const ids = tab => Array.from(app.shiftsForCalendarRange(shifts, new Set([3]), "2026-11-12", tab, 1), s => s.id);
  assert.deepEqual(ids("today"), [1], "the manager's own shift must match today's summary");
  assert.deepEqual(ids("week"), [1, 2, 6], "both Monday and Sunday belong to the visible week");
  assert.deepEqual(ids("month"), [1, 2, 3, 6, 7], "last-day shifts belong to the visible month");
  assert.equal(app.shiftsForCalendarRange(shifts, new Set(), "2026-11-12", "today").length, 0);
});


test("complete typed and pasted clock times retain their hours and minutes", () => {
  const app = runtime();
  for (const time of ["1:00pm", "5:00pm", "12:00pm", "13:00", "09:30"]) assert.equal(app.formatTimeDraftInput(time), time);
});
