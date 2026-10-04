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
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) helpers.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);

// Run the actual page helpers against in-memory records, without clocking anyone in or out.
function runtime(extra = {}) {
  const names = ["nextId", "lastWorkClockEvent", "shiftForClockEvent", "shiftStartDateTime", "shiftEndDateTime",
    "applyAutomaticClockOuts", "isAutomaticClockOut", "hasClockInForShift", "noShowAlertsFor", "needsTimeException",
    "isWithinScheduledMinute", "workWeekCalendarDays", "hoursDateRange", "hoursDateLabel", "dateRangeForCalendarTab",
    "parseLocalDate", "startOfDay", "toDateInputValue", "shiftDateForWeekday", "shiftDatesForWeekdays",
    "formatShortDate", "formatLongDate", "formatMonthYear", "formatClockTime", "saveScheduleEnforcement", "readStoredScheduleEnforcement",
    "saveAlertsPermissions", "publishSchedule", "applyScheduleDraft", "submitAvailabilityRequest", "saveEventsTrades", "saveScheduleEvent", "deleteScheduleEvent", "saveOvertime",
    "saveBreaksCompliance", "operationalAlertsFor", "matchingBreakStartEvent", "breakEndTime", "breakDurationMs", "isWithinClockInGrace",
    "employeePerformanceFor", "timeToMinutes", "adjustedWorkedHoursForRange", "workedHoursForRange", "clockIntervals", "breakIntervalsForEvents",
    "clippedDuration", "overlapDuration", "startOfNextDay", "saveMessagesSettings", "createTeamConversation", "sendTeamMessage",
    "messagePtoRequestEmployee", "messageRosterEmployee", "saveAccountProfile", "hasEmployeeWithName", "normalizeEmployeeName",
    "formatPhoneNumberInput", "readStoredState", "clearRosterPlaceholder", "formatWageInput", "isStarterPlaceholderEmployee", "isManagerEmployee"];
  const context = vm.createContext({ ...rules, ...scheduleEvents, ...accountProfile, Date, console,
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

test("saving and reloading settings preserves choices; invalid drafts never apply", () => {
  const stored = new Map();
  let saved, message;
  const app = runtime({ window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, workWeekStart: 0, lateMinutes: 5, automaticClockOut: false },
    setScheduleEnforcement: value => { saved = value; }, setScheduleEnforcementMessage: value => { message = value; },
  });
  app.saveScheduleEnforcement({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(app.readStoredScheduleEnforcement())), saved);
  assert.match(message, /saved/);
  app.scheduleEnforcementDraft = { ...defaults, scheduleStartHour: 17, scheduleEndHour: 7 };
  app.saveScheduleEnforcement({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(app.readStoredScheduleEnforcement())), saved);
  assert.match(message, /end time after/);
  stored.set("test-enforcement", "invalid JSON");
  assert.deepEqual(JSON.parse(JSON.stringify(app.readStoredScheduleEnforcement())), defaults);
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

test("publishing honors notification preferences and rejects an unauthorized saved draft", () => {
  function publisher(settings, allowed = () => true) {
    const draft = { upsertedShifts: [{ ...shift, role: "Sales" }], deletedShiftIds: [], affectedEmployeeIds: [1] };
    const state = { shifts: [], scheduleDraftsByManager: { 1: draft }, employees: [
      { id: 1, name: "Active", active: true, locationSettings: { sendLocationAlerts: true } },
      { id: 2, name: "Muted", active: true, locationSettings: { sendLocationAlerts: false } },
      { id: 3, name: "Inactive", active: false, locationSettings: { sendLocationAlerts: true } },
    ], scheduleUpdates: [] };
    let updated = state, error;
    const app = runtime({ state, scheduleEnforcement: settings, mode: "manager", activeEmployeeId: 1, activeScheduleDraft: draft,
      canEditScheduleRole: allowed, setState: updater => { updated = updater(updated); },
      setSchedulePermissionError: value => { error = value; }, setCreatedShiftTimes() {}, setEditedShiftTimes() {}, setLastEditedShiftId() {},
    });
    app.publishSchedule();
    return { updated, state, error };
  }
  const enabled = publisher(defaults);
  assert.equal(enabled.updated.shifts.length, 1);
  assert.equal(enabled.updated.scheduleUpdates.length, 1);
  assert.equal(enabled.updated.scheduleUpdates[0].employeeId, 1);
  assert.equal(publisher({ ...defaults, notifyScheduleChanges: false }).updated.scheduleUpdates.length, 0);
  const blocked = publisher(defaults, () => false);
  assert.equal(blocked.updated, blocked.state);
  assert.match(blocked.error, /outside your assigned departments/);
});

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

test("alerts permissions save and reload without applying unsaved enforcement changes", () => {
  const stored = new Map();
  let saved, message;
  const app = runtime({ window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, workWeekStart: 0, noShowMinutes: 15, employeesOwnScheduleOnly: true },
    setScheduleEnforcement: value => { saved = value; }, setAlertsPermissionsMessage: value => { message = value; },
  });
  app.saveAlertsPermissions({ preventDefault() {} });
  assert.equal(saved.workWeekStart, defaults.workWeekStart);
  assert.equal(saved.noShowMinutes, 15);
  assert.equal(saved.employeesOwnScheduleOnly, true);
  assert.match(message, /saved/);
  assert.deepEqual(JSON.parse(JSON.stringify(app.readStoredScheduleEnforcement())), JSON.parse(JSON.stringify(saved)));
});

test("events setting saves independently, survives reload, and hides without deleting events", () => {
  const stored = new Map();
  let saved, message;
  const app = runtime({ window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, enableScheduleEvents: false, employeesOwnScheduleOnly: true, workWeekStart: 0 },
    setScheduleEnforcement: value => { saved = value; }, setEventsTradesMessage: value => { message = value; },
  });
  app.saveEventsTrades({ preventDefault() {} });
  assert.equal(saved.enableScheduleEvents, false);
  assert.equal(saved.employeesOwnScheduleOnly, defaults.employeesOwnScheduleOnly);
  assert.equal(saved.workWeekStart, defaults.workWeekStart);
  assert.match(message, /saved/);
  assert.equal(app.readStoredScheduleEnforcement().enableScheduleEvents, false);
  assert.equal(rules.normalizeScheduleEnforcement({}).enableScheduleEvents, true);
  const records = [{ id: 1, date: "2026-10-03", title: "Team day", notes: "Details" }];
  assert.equal(scheduleEvents.scheduleEventsForDate(records, "2026-10-03", saved.enableScheduleEvents).length, 0);
  assert.equal(scheduleEvents.scheduleEventsForDate(records, "2026-10-03", true).length, 1);
  assert.equal(scheduleEvents.scheduleEventsForDate(records, "2026-10-04", true).length, 0);
  const previous = saved;
  app.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  app.saveEventsTrades({ preventDefault() {} });
  assert.equal(saved, previous);
  assert.match(message, /could not be saved/);
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
  app.deleteScheduleEvent(1);
  assert.equal(state.scheduleEvents.length, 1);
  app.mode = "manager";
  app.scheduleEnforcement = { ...defaults, enableScheduleEvents: false };
  app.deleteScheduleEvent(1);
  assert.equal(state.scheduleEvents.length, 1);
  app.scheduleEnforcement = defaults;
  assert.deepEqual(scheduleEvents.normalizeScheduleEvents(JSON.parse(JSON.stringify(state.scheduleEvents))), JSON.parse(JSON.stringify(state.scheduleEvents)));
  app.deleteScheduleEvent(1);
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

test("Overtime saves the shared workweek without applying unrelated drafts", () => {
  const stored = new Map();
  let saved, message;
  const app = runtime({ window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, workWeekStart: 0, noShowMinutes: 30, enableScheduleEvents: false },
    setScheduleEnforcement: value => { saved = value; }, setOvertimeMessage: value => { message = value; },
  });
  app.saveOvertime({ preventDefault() {} });
  assert.equal(saved.workWeekStart, 0);
  assert.equal(saved.noShowMinutes, defaults.noShowMinutes);
  assert.equal(saved.enableScheduleEvents, defaults.enableScheduleEvents);
  assert.equal(app.readStoredScheduleEnforcement().workWeekStart, 0);
  assert.match(message, /saved/);
  const previous = saved;
  app.scheduleEnforcementDraft.workWeekStart = 7;
  app.saveOvertime({ preventDefault() {} });
  assert.equal(saved, previous);
  assert.match(message, /valid/);
  app.scheduleEnforcementDraft.workWeekStart = 2;
  app.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  app.saveOvertime({ preventDefault() {} });
  assert.equal(saved, previous);
  assert.match(message, /could not be saved/);
});

test("break settings save independently, reload, and reject invalid frequencies", () => {
  const stored = new Map();
  let saved, message;
  const app = runtime({ window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, mealBreakAfterHours: 4, mandatoryMealBreak: false, workWeekStart: 0 },
    setScheduleEnforcement: value => { saved = value; }, setBreaksComplianceMessage: value => { message = value; },
  });
  app.saveBreaksCompliance({ preventDefault() {} });
  assert.equal(saved.mealBreakAfterHours, 4);
  assert.equal(saved.mandatoryMealBreak, false);
  assert.equal(saved.workWeekStart, defaults.workWeekStart);
  assert.equal(app.readStoredScheduleEnforcement().mealBreakAfterHours, 4);
  assert.equal(app.readStoredScheduleEnforcement().mandatoryMealBreak, false);
  assert.match(message, /saved/);
  const previous = saved;
  for (const invalid of [0, 25, 4.5, NaN]) {
    app.scheduleEnforcementDraft.mealBreakAfterHours = invalid;
    app.saveBreaksCompliance({ preventDefault() {} });
    assert.equal(saved, previous);
    assert.match(message, /1 to 24/);
  }
  app.scheduleEnforcementDraft.mealBreakAfterHours = 6;
  app.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  app.saveBreaksCompliance({ preventDefault() {} });
  assert.equal(saved, previous);
  assert.match(message, /could not be saved/);
  assert.equal(rules.normalizeScheduleEnforcement({}).mealBreakAfterHours, 5);
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

test("messages setting saves independently and survives reload without deleting conversations", () => {
  const stored = new Map();
  let saved, message;
  const conversations = [{ id: 1, participantIds: [1, 2], messages: [{ id: 1, body: "Existing message" }] }];
  const app = runtime({ mode: "manager", state: { conversations },
    window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    scheduleEnforcementDraft: { ...defaults, enableTeamMessaging: false, mandatoryMealBreak: false, workWeekStart: 0 },
    setScheduleEnforcement: value => { saved = value; }, setMessagesSettingsMessage: value => { message = value; },
    setIsCreatingConversation() {}, setPtoMessageEmployeeId() {}, setIsPtoMessageContext() {},
  });
  app.saveMessagesSettings({ preventDefault() {} });
  assert.equal(saved.enableTeamMessaging, false);
  assert.equal(saved.mandatoryMealBreak, defaults.mandatoryMealBreak);
  assert.equal(saved.workWeekStart, defaults.workWeekStart);
  assert.equal(app.readStoredScheduleEnforcement().enableTeamMessaging, false);
  assert.equal(app.state.conversations, conversations);
  assert.match(message, /saved/);
  assert.equal(rules.normalizeScheduleEnforcement({}).enableTeamMessaging, true);
  assert.equal(rules.normalizeScheduleEnforcement({ enableTeamMessaging: "false" }).enableTeamMessaging, true);
  const previous = saved;
  app.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  app.saveMessagesSettings({ preventDefault() {} });
  assert.equal(saved, previous);
  assert.match(message, /could not be saved/);
  app.mode = "employee";
  message = "";
  app.saveMessagesSettings({ preventDefault() {} });
  assert.equal(message, "");
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
  assert.ok(accountProfile.profileUpdate({ ...values, dateOfBirth: "2000-02-29", homePostalCode: "90000-1234" }, "2026-10-03").update);
});

test("self-profile saves update only the signed-in employee and reject duplicate names or public access", () => {
  const other = { ...profileEmployee, id: 3, name: "Other Person" };
  let state = { employees: [profileEmployee, other], conversations: [] };
  let writes = 0;
  const app = runtime({ state, activeEmployee: profileEmployee, activeEmployeeId: 2, accountOwnerEmployeeId: 1, isPublicSchedule: false, today: "2026-10-03",
    setState(updater) { state = updater(state); writes++; },
  });
  const values = accountProfile.profileValues(profileEmployee);
  assert.equal(app.saveAccountProfile({ ...values, firstName: "Updated", phone: "2025550100", emergencyContactPhone: "2025550101", legalLastName: "Legal", homeCity: "Sample City", homeStateProvince: "CA", homePostalCode: "90000" }), null);
  assert.equal(state.employees[0].name, "Updated Person");
  assert.equal(state.employees[0].phone, "(202) 555-0100");
  assert.equal(state.employees[0].emergencyContactPhone, "(202) 555-0101");
  assert.equal(state.employees[0].legalMiddleName, "Keep");
  assert.equal(state.employees[0].accessLevel, "Employee");
  assert.equal(state.employees[0].pin, "9999");
  assert.equal(state.employees[0].certificates, profileEmployee.certificates);
  assert.equal(state.employees[1], other);
  assert.match(app.saveAccountProfile({ ...values, firstName: "Other", lastName: "Person" }), /already in use/);
  assert.equal(writes, 1);
  app.isPublicSchedule = true;
  assert.match(app.saveAccountProfile(values), /Sign in/);
  assert.equal(writes, 1);
});

test("account owner profile renames preserve ownership and survive staff-state reload", () => {
  const owner = { ...profileEmployee, id: 1, name: "Original Owner", accessLevel: "Admin", pin: "0000" };
  let state = { employees: [owner], shifts: [], clockEvents: [], scheduleDraftsByManager: {} };
  let draftInfo = { accountOwner: "Original Owner", locationName: "Unsaved location" };
  let snapshot = JSON.stringify({ accountOwner: "Original Owner", locationName: "Saved location" });
  const stored = new Map();
  const app = runtime({ state, activeEmployee: owner, activeEmployeeId: 1, accountOwnerEmployeeId: 1, isPublicSchedule: false, today: "2026-10-03",
    savedBasicInfoSnapshot: snapshot, basicInfoStorageKey: "basic", storageKey: "staff", stateBackupStorageKey: "backup", starterState: { employees: [] },
    defaultEmployeeLocationSettings: () => ({}),
    window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) } },
    setBasicInfo(updater) { draftInfo = updater(draftInfo); }, setSavedBasicInfoSnapshot(value) { snapshot = value; },
    setState(updater) { state = updater(state); },
  });
  assert.equal(app.saveAccountProfile({ ...accountProfile.profileValues(owner), firstName: "Updated" }), null);
  assert.equal(draftInfo.accountOwner, "Updated Owner");
  assert.equal(draftInfo.locationName, "Unsaved location");
  assert.equal(JSON.parse(snapshot).locationName, "Saved location");
  assert.equal(JSON.parse(stored.get("basic")).accountOwner, "Updated Owner");
  stored.set("staff", JSON.stringify(state));
  const reloaded = app.readStoredState();
  assert.equal(reloaded.employees[0].name, "Updated Owner");
  assert.equal(reloaded.employees[0].accessLevel, "Admin");
  assert.equal(accountProfile.profileValues(reloaded.employees[0]).firstName, "Updated");
  const previous = state;
  app.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  assert.match(app.saveAccountProfile({ ...accountProfile.profileValues(owner), firstName: "Another" }), /could not be saved/);
  assert.equal(state, previous);
});

test("employee performance respects the same missed-break threshold and mandatory switch", () => {
  const app = runtime();
  const state = { shifts: [{ ...shift, role: "Sales" }], hoursAdjustments: [], clockEvents: [
    { id: 1, employeeId: 1, type: "in", at: new Date(scheduledStart).toISOString() },
    { id: 2, employeeId: 1, type: "out", at: new Date(scheduledEnd).toISOString() },
  ] };
  assert.equal(app.employeePerformanceFor(state, 1, scheduledEnd, defaults).missedBreaks, 1);
  assert.equal(app.employeePerformanceFor(state, 1, scheduledEnd, { ...defaults, mealBreakAfterHours: 9 }).missedBreaks, 0);
  assert.equal(app.employeePerformanceFor(state, 1, scheduledEnd, { ...defaults, mandatoryMealBreak: false }).missedBreaks, 0);
  state.clockEvents.push({ id: 3, employeeId: 1, type: "break", durationMinutes: 30, at: new Date(scheduledStart + 2 * 60 * 60 * 1000).toISOString() });
  assert.equal(app.employeePerformanceFor(state, 1, scheduledEnd, defaults).missedBreaks, 0);
});
