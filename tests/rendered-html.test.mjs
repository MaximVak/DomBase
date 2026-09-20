import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the DomBase staff shell", async () => {
  const response = await render();
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>DomBase<\/title>/i);
  assert.match(html, /DomBase/);
  assert.match(html, /PIN/);
  assert.match(page, /setPin\(event\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 4\)\)/);
  assert.match(page, /aria-label="Access PIN"[^]*?maxLength=\{4\}[^]*?pattern="\[0-9\]\{4\}"/);
  assert.match(html, /Enter/);
  assert.doesNotMatch(html, /Workforce/);
  assert.doesNotMatch(html, /Unlock/);
  assert.doesNotMatch(html, /Manager mode/);
  assert.doesNotMatch(html, /Mobile DomBase staff sections/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("dashboard navigation is labeled Home and shows the signed-in mode", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /id: "dashboard", label: "Home", icon: "home"/);
  assert.match(page, /mode === "manager" \? "Manager mode" : "Employee mode"/);
  assert.match(page, /activeViewLabel\(activeView, mode\)/);
});

test("Team is a sidebar dropdown beneath Home with roster and role routes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /label: "Home", icon: "home"[^]*label: "Team", icon: "person"[^]*label: "Schedule", icon: "calendar"/);
  assert.match(page, /className="sidebar-nav-group"/);
  assert.match(page, /aria-controls="team-sidebar-menu"/);
  assert.match(page, />\s*Roster\s*<\/button>/);
  assert.match(page, />\s*Department \/ Roles\s*<\/button>/);
  assert.match(page, /activeView === "departments_roles"/);
  assert.match(page, /navigateToView\("employees"\)/);
});

test("Schedule is a sidebar dropdown with scheduling routes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /aria-controls="schedule-sidebar-menu"/);
  assert.match(page, />Shifts<\/button>/);
  assert.match(page, />Time off<\/button>/);
  assert.match(page, />My availability<\/button>/);
  assert.match(page, />Team availability<\/button>/);
  assert.match(page, /navigateToView\("team_availability"\)/);
});

test("shift editor uses clear time labels and available role options", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /placeholder="Start time"/);
  assert.match(page, /placeholder="End time"/);
  assert.match(page, /aria-label="Shift role"[^]*availableRoles\.map\(\(role\)/);
  assert.doesNotMatch(page, /placeholder="Start shift"|placeholder="End shift"/);
  assert.doesNotMatch(page, /aria-label="Edit shift employee"/);
  assert.match(page, /<span>Date<\/span>/);
  assert.match(page, /<span>Clock-in time<\/span>/);
  assert.match(page, /<span>Clock-out time<\/span>/);
  assert.match(page, /<span>Role<\/span>/);
  assert.match(page, /className="shift-edit-field"/);
  assert.match(page, /editingShiftHasStarted/);
  assert.match(page, /editingShiftHasEnded/);
  assert.match(page, /disabled=\{editingShiftHasStarted\}/);
  assert.match(page, /disabled=\{editingShiftHasEnded\}/);
  assert.match(page, /Once a shift starts, only its clock-out time can be changed\./);
  assert.match(page, /Clock-out time must remain in the future while the shift is active\./);
  assert.match(page, /This shift has ended and can no longer be changed\./);
  assert.match(page, /shiftForClockEvent\(event, workingScheduleShifts\)\?\.id === savedEditingShift\.id/);
  assert.match(page, /editingShiftIsNoShow \? "No-show" : `Clocked in: \$\{editingShiftClockIn \? formatClockTime\(editingShiftClockIn\.at\) : "Not recorded"\}`/);
  assert.match(page, /<span>Clock-in time<\/span>\s*\{editingShiftClockIn \|\| editingShiftHasStarted \? \(/);
  assert.match(page, /Clocked out: \{editingShiftClockOut \? formatClockTime\(editingShiftClockOut\.at\) : "Not recorded"\}/);
  assert.match(page, /\(editingShiftClockOut \|\| editingShiftHasEnded\) && !editingShiftIsNoShow/);
  assert.match(page, /<form className="shift-edit-modal"[^]*?<span className="shift-edit-label-row">\s*<span>Clock-in time<\/span>[^]*?value=\{editingShift\.start\}/);
  assert.match(page, /<form className="shift-edit-modal"[^]*?<span className="shift-edit-label-row">\s*<span>Clock-out time<\/span>[^]*?value=\{editingShift\.end\}/);
  assert.doesNotMatch(page, /<form className="shift-create-modal"(?:(?!<\/form>)[\s\S])*Clocked in:/);
  assert.match(page, /function suggestedTimeForDraft/);
  assert.match(page, /function formatTimeDraftInput/);
  assert.match(page, /minuteDigits\.length > 0 && Number\(minuteDigits\[0\]\) > 5/);
  assert.match(page, /minuteDigits\.length === 2 && Number\(minuteDigits\) > 59/);
  assert.match(page, /return minuteDigits \? `\$\{hour\}:\$\{minuteDigits\}` : hour/);
  assert.match(page, /label: `\$\{displayHour\}:\$\{minute\.toString\(\)\.padStart\(2, "0"\)\}\$\{period\}`/);
  assert.match(page, /suggestAfter=\{shiftForm\.start\}/);
  assert.match(page, /suggestAfter=\{editingShift\.start\}/);
  assert.match(page, /suggestBefore=\{shiftForm\.end\}/);
  assert.match(page, /suggestBefore=\{editingShift\.end\}/);
  assert.match(page, /function isTimeDraftBefore\(value: string, before\?: string\)/);
  assert.match(page, /candidateMinutes < beforeMinutes/);
  assert.match(page, /suggestion\?\.time \?\? parseTypedTime\(draft\)/);
  assert.match(page, /const formattedDraft = formatTimeDraftInput\(nextValue, currentDraft\)/);
  assert.match(page, /return isTimeDraftBefore\(formattedDraft, suggestBefore\) \? formattedDraft : currentDraft/);
  assert.match(page, /!parsed \|\| !isTimeDraftBefore\(draft, suggestBefore\)/);
  assert.match(page, /className="time-input-hint"/);
  assert.doesNotMatch(page, /copy-calendar|Copy shift range|repeatDates/);
  assert.match(page, /const shiftDates = shiftDatesForWeekdays\(shiftForm\.date, createShiftWeekdays\)/);
  assert.match(page, /const shiftWeekdayOptions = \[/);
  assert.match(page, /function shiftDatesForWeekdays/);
  assert.match(page, /function toggleCreateShiftWeekday/);
  assert.match(page, /function toggleEditingShiftWeekday/);
  assert.match(page, /<legend>Apply to:<\/legend>/);
  assert.match(page, /<span>Shift notes:<\/span>/);
  assert.match(page, /className="shift-notes-field"/);
  assert.match(page, /placeholder="Leave a note for your employee, and they’ll see it when they clock in\."/);
  assert.doesNotMatch(page, /like the address of a job site/);
  assert.match(page, /notes: shiftForm\.notes\.trim\(\)/);
  assert.match(page, /function deleteEditingShift\(\) \{\s*if \(!editingShift \|\| !activeUserIsAdmin\) return;/);
  assert.match(page, /\{activeUserIsAdmin \? \(\s*<button type="button" className="delete-action"/);
  assert.doesNotMatch(page, /className="delete-action" onClick=\{deleteEditingShift\} disabled=\{editingShiftHasStarted\}/);
  assert.doesNotMatch(page, /A shift cannot be deleted after it starts\./);
  assert.match(page, /className=\{`secondary-action\$\{editingShiftHasEnded \? " align-right" : ""\}`\}/);
  assert.match(page, /\{!editingShiftHasEnded \? \(\s*<button type="submit" className="primary-action">Save changes<\/button>/);
  assert.match(styles, /\.modal-actions \.secondary-action \{[^}]*grid-column: 3;/s);
  assert.match(styles, /\.modal-actions \.secondary-action\.align-right \{[^}]*grid-column: 4;[^}]*justify-self: end;[^}]*inline-size: 94px;/s);
  assert.match(styles, /\.modal-actions \.delete-action \{[^}]*inline-size: 94px;/s);
  assert.match(styles, /\.modal-actions \.primary-action \{[^}]*grid-column: 4;/s);
  assert.match(page, /additionalShifts/);
  assert.match(page, /activeIsClockedIn && myShift\?\.notes/);
  assert.match(page, /<strong>Shift note:<\/strong>/);
  assert.match(styles, /\.shift-apply-days button \{[^}]*border-radius: 50%;/s);
  assert.match(styles, /\.shift-apply-days > div \{[^}]*justify-content: flex-start;[^}]*gap: 12px;[^}]*margin-top: 5px;/s);
  assert.match(styles, /\.shift-notes-field textarea \{/);
  assert.doesNotMatch(page, /shift-editor-drawer|Select Employee/);
  assert.match(page, /function openShiftCreator\(employee: Employee, date: string\)/);
  assert.match(page, /function openMonthShiftCreator\(date: string\)/);
  assert.match(page, /className="shift-cell-add"/);
  assert.match(page, /function employeeHasApprovedTimeOffOnDate\(requests: PtoRequest\[\], employeeId: number, date: string\)/);
  assert.match(page, /request\.employeeId === employeeId\s*&& request\.status === "approved"\s*&& request\.startDate <= date\s*&& request\.endDate >= date/);
  assert.equal((page.match(/!employeeHasApprovedTimeOffOnDate\(state\.ptoRequests \?\? \[\], shift\.employeeId, shift\.date\)/g) ?? []).length, 3);
  assert.match(page, /mode === "manager" && dayShifts\.length === 0 && !timeOff/);
  assert.match(page, /\{timeOff \? \(\s*<div className="shift-time-off">/);
  assert.doesNotMatch(page, /\{dayShifts\.length === 0 && timeOff \? \(/);
  assert.match(page, /onClick=\{\(\) => openShiftCreator\(employee, day\.date\)\}/);
  assert.match(page, /className="shift-cell-add schedule-track-add"/);
  assert.match(page, /mode === "manager" && employeeShifts\.length === 0 && !timeOff/);
  assert.match(page, /onClick=\{\(\) => openShiftCreator\(employee, scheduleDate\)\}/);
  assert.match(page, /className="shift-cell-add shift-month-add"/);
  assert.match(page, /onClick=\{\(\) => openMonthShiftCreator\(day\.date\)\}/);
  assert.match(page, /event\.target === event\.currentTarget/);
  assert.match(page, /className="shift-create-modal"/);
  assert.match(page, /Date, clock-in time, clock-out time, and role are required\./);
  assert.match(page, /<span>Date<\/span>/);
  assert.match(page, /<span>Clock-in time<\/span>/);
  assert.match(page, /<span>Clock-out time<\/span>/);
  assert.match(page, /<span>Role<\/span>/);
  assert.match(page, /employeeScheduleTab === "month" \? \(\s*<label className="shift-edit-field">\s*<span>Employee<\/span>/);
  assert.match(page, /aria-label="Shift employee"/);
  assert.doesNotMatch(page, /<span>(?:Date|Clock-in time|Clock-out time|Role) \*<\/span>/);
  assert.match(page, /aria-label=\{`Previous \$\{employeeScheduleTab\}`\}>\s*<span aria-hidden="true">‹<\/span>\s*<\/button>\s*<label className="shift-date-control">[^]*?<\/label>\s*<button[^]*?aria-label=\{`Next \$\{employeeScheduleTab\}`\}>\s*<span aria-hidden="true">›<\/span>/);
  assert.match(page, /className="shift-date-navigation"/);
  assert.match(page, /className="shift-view-control">\s*<select className="shift-view-select"[^]*?<span aria-hidden="true">▾<\/span>/);
  assert.match(page, /className=\{`shift-publish-button\$\{unpublishedShiftCount > 0 \? " pending" : ""\}`\}/);
  assert.match(page, /disabled=\{unpublishedShiftCount === 0\}/);
  assert.match(page, /type ScheduleDraft = \{/);
  assert.match(page, /scheduleDraftsByManager: Record<number, ScheduleDraft>/);
  assert.match(page, /const stateBackupStorageKey = "dombase-staff-state-backup-v1"/);
  assert.match(page, /isRecoverableStaffRecord\(previousState\)/);
  assert.match(page, /return normalizeStoredState\(backupState\)/);
  assert.doesNotMatch(page, /localStorage\.removeItem\(storageKey\)/);
  assert.match(page, /const activeScheduleDraft = mode === "manager"/);
  assert.match(page, /const draftShiftIds = new Set\(activeScheduleDraft\?\.upsertedShifts\.map\(\(shift\) => shift\.id\) \?\? \[\]\)/);
  assert.match(page, /applyScheduleDraft\(state\.shifts, activeScheduleDraft\)/);
  assert.match(page, /\[activeEmployeeId\]: scheduleDraft/);
  assert.match(page, /const publishedShifts = applyScheduleDraft\(current\.shifts, scheduleDraft\)/);
  assert.match(page, /delete remainingScheduleDrafts\[activeEmployeeId\]/);
  assert.match(page, /shifts: publishedShifts/);
  assert.match(page, /function nextScheduleShiftId\(state: StaffState\)/);
  assert.equal((page.match(/draftShiftIds\.has\(shift\.id\) \? " draft" : ""/g) ?? []).length, 3);
  assert.match(styles, /\.schedule-bar\.draft \{[^}]*border: 2px dotted var\(--blue-accent\);[^}]*background: #dceeff;/s);
  assert.match(styles, /\.shift-week-card\.draft \{[^}]*border: 2px dotted var\(--blue-accent\);[^}]*background: #dceeff;/s);
  assert.match(styles, /\.shift-month-card\.draft \{[^}]*border: 2px dotted var\(--blue-accent\) !important;[^}]*background: #dceeff !important;/s);
  assert.match(styles, /\.shift-publish-button:disabled \{[^}]*opacity: 1;/s);
  assert.match(styles, /\.shift-time-lock-note \{/);
  assert.match(styles, /\.shift-edit-field \{/);
  assert.match(styles, /\.shift-edit-label-row \{[^}]*justify-content: space-between;/s);
  assert.match(styles, /\.shift-edit-actual-time \{[^}]*font-size: inherit;/s);
  assert.match(styles, /\.time-input-shell \{/);
  assert.match(styles, /\.time-input-hint \{[^}]*color: #9aa9ba;/s);
  assert.match(styles, /html \{[^}]*scrollbar-gutter: stable;/s);
  assert.match(styles, /\.shift-date-navigation \{[^}]*grid-template-columns: 42px minmax\(250px, auto\) 42px;/s);
  assert.match(styles, /\.shift-view-select \{[^}]*appearance: none;[^}]*background: #edf4fb !important;/s);
  assert.match(styles, /\.shift-view-control > span \{/);
  assert.match(styles, /\.shift-arrow-button > span \{[^}]*transform: translateY\(-2px\);/s);
  assert.doesNotMatch(page, /shift-week-row\$\{employeeWeekShifts\.length > 0 \? " has-scheduled-shifts" : ""\}/);
  assert.doesNotMatch(styles, /\.shift-week-row\.has-scheduled-shifts:hover/);
  assert.match(styles, /\.shift-week-cell\.has-content \{[^}]*align-content: start;/s);
  assert.match(styles, /\.shift-cell-add \{[^}]*opacity: 0;/s);
  assert.match(styles, /\.shift-cell-add > span::before,[^]*transform: translate\(-50%, -50%\);/);
  assert.match(styles, /\.schedule-track:hover \.schedule-track-add,[^}]*opacity: 1;/s);
  assert.doesNotMatch(styles, /\.schedule-chart-row\.has-scheduled-shifts:hover/);
  assert.match(styles, /\.shift-month-day:hover \.shift-month-add,[^}]*opacity: 1;/s);
  assert.match(styles, /\.shift-month-day \{[^}]*display: flex;[^}]*flex-direction: column;/s);
  assert.match(styles, /\.shift-month-add \{[^}]*flex: 1 1 42px;[^}]*width: 100%;/s);
  assert.match(styles, /\.shift-month-add > span \{[^}]*width: 32px;[^}]*height: 32px;[^}]*place-items: center;/s);
});

test("sidebar dropdowns collapse when another section is selected", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /setIsTeamNavOpen\(view === "employees" \|\| view === "departments_roles"\)/);
  assert.match(page, /setIsScheduleNavOpen\(\["schedule", "time_off", "my_availability", "team_availability"\]\.includes\(view\)\)/);
  assert.match(page, /const shouldOpen = !isTeamNavOpen;\s*navigateToView\("employees"\);\s*setIsTeamNavOpen\(shouldOpen\)/);
  assert.match(page, /const shouldOpen = !isScheduleNavOpen;\s*navigateToView\("schedule"\);\s*setIsScheduleNavOpen\(shouldOpen\)/);
});

test("Roster includes complete team fields without placeholders for contact, location, or role", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  [
    "Team member",
    "Contact information",
    "Access level",
    "Location",
    "Role",
    "Wage",
    "Status",
  ].forEach((heading) => assert.match(page, new RegExp(`>${heading}<`)));
  assert.doesNotMatch(page, /email: "To be added"/);
  assert.doesNotMatch(page, /phone: "To be added"/);
  assert.doesNotMatch(page, /location: "To be added"/);
  assert.doesNotMatch(page, /wage: "To be added"/);
  assert.match(page, /function updateEmployeeDetail/);
  assert.match(page, /function rosterInputValue/);
  assert.match(page, /className="roster-table"/);
  assert.match(page, /clearRosterPlaceholder\(normalizedEmployee\.email\)/);
  assert.match(page, /role: clearRosterPlaceholder\(normalizedEmployee\.role\)/);
  assert.match(page, /wage: formatWageInput\(clearRosterPlaceholder\(normalizedEmployee\.wage\)\)/);
  assert.doesNotMatch(page, /<small>Email<\/small>/);
  assert.doesNotMatch(page, /<small>Phone number<\/small>/);
  assert.match(page, /placeholder="Email"/);
  assert.match(page, /placeholder="Phone number"/);
  assert.match(page, /availableLocations\.map\(\(location\)/);
  assert.match(page, /locationNamesFromBasicInfo\(savedBasicInfo\)/);
  assert.match(page, /employee\.location === previousLocationName/);
  assert.doesNotMatch(page, /!availableLocations\.includes\(employee\.location\)/);
  assert.match(page, /availableRoles\.map\(\(role\)/);
  assert.match(page, /<select[^]*aria-label=\{`Location for \$\{employee\.name\}`\}/);
  assert.match(page, /<select[^]*aria-label=\{`Role for \$\{employee\.name\}`\}/);
  assert.match(page, /<option value="">Select<\/option>/);
  assert.match(page, /employee\.id === 1 \? \(/);
  assert.match(page, /<span>Admin<\/span>/);
  assert.match(page, /normalizedEmployee\.id === 1[^]*\? "Admin"/);
  assert.match(page, /aria-label=\{`Access level for \$\{employee\.name\}`\}/);
  assert.match(page, /<option value="Employee">Employee<\/option>/);
  assert.match(page, />\s*Add team member\s*<\/button>/);
  assert.match(page, /className="roster-heading"/);
  assert.match(page, /isAddingEmployee \? \(/);
  assert.match(page, /id="add-team-member-form"/);
  assert.match(page, /className="team-member-modal"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, />Contact information</);
  assert.match(page, />Job details</);
  assert.match(page, /employeeForm\.firstName/);
  assert.match(page, /employeeForm\.lastName/);
  assert.match(page, /employeeForm\.email/);
  assert.match(page, /employeeForm\.phone/);
  assert.match(page, /<span>First name <b[^>]*>\*<\/b><\/span>[^]*?<input[^]*?required/s);
  assert.match(page, /<span>Last name <b[^>]*>\*<\/b><\/span>[^]*?<input[^]*?required/s);
  assert.match(page, /<span>Email <b[^>]*>\*<\/b><\/span>[^]*?<input[^]*?required/s);
  assert.match(page, /<span>Mobile phone number <b[^>]*>\*<\/b><\/span>[^]*?<input[^]*?required/s);
  assert.match(page, /employeeForm\.location/);
  assert.match(page, /employeeForm\.wage/);
  assert.match(page, /function formatWageInput/);
  assert.match(page, /return `\$\$\{amount\.toFixed\(2\)\}\/hr`/);
  assert.match(page, /updateEmployeeDetail\(employee\.id, "wage", formatWageInput\(event\.target\.value\)\)/);
  assert.match(page, /onFocus=\{\(\) => updateEmployeeDetail\(employee\.id, "wage", ""\)\}/);
  assert.match(page, /event\.target\.value\.replace\(\/\\D\/g, ""\)/);
  assert.match(page, /pattern="\[0-9\]\*"/);
  assert.match(page, /function cancelAddingEmployee/);
  assert.match(page, /className="employee-edit-button"/);
  assert.match(page, /className="roster-row-remove"/);
  assert.match(page, /const activeUserIsAdmin = activeEmployee\?\.accessLevel === "Admin"/);
  assert.match(page, /activeUserIsAdmin && employee\.id !== activeEmployeeId/);
  assert.match(page, /if \(!activeUserIsAdmin \|\| employeeId === activeEmployeeId\)/);
  assert.match(page, /mode === "manager" && activeUserIsAdmin && employeePendingDeletion/);
  assert.match(page, /setEmployeePendingDeletion\(employee\)/);
  assert.match(page, /className="employee-delete-modal"/);
  assert.match(page, />Delete employee<\/button>/);
  assert.doesNotMatch(page, /window\.confirm\("Are you sure you want to remove this employee\?"\)/);
  assert.match(page, /data-editing-employee-row=\{isEditing \? employee\.id : undefined\}/);
  assert.match(page, /function finishRosterEditing/);
  assert.match(page, /document\.addEventListener\("pointerdown", finishRosterEditing\)/);
  assert.match(page, /const numericPin = pin\.replace\(\/\\D\/g, ""\)\.slice\(0, 4\)/);
  assert.match(page, /pin: event\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 4\)/);
  assert.match(page, /pattern="\[0-9\]\{4\}"/);
  assert.match(page, /maxLength=\{4\}/);
  assert.match(page, /placeholder="\*\*\*\*"/);
  assert.match(page, /className="team-member-add-role-button"/);
  assert.match(page, /function addRoleFromEmployeeForm/);
  assert.match(page, /aria-label="New role name"/);
  assert.match(page, /placeholder="Enter role name"/);
  assert.match(page, /window\.requestAnimationFrame\(\(\) => employeeRoleInputRef\.current\?\.focus\(\)\)/);
  assert.match(page, /event\.key === "Enter"[^]*addRoleFromEmployeeForm\(\)/);
  assert.match(page, /onBlur=\{\(\) => \{[^]*setIsAddingEmployeeRole\(false\)/);
  assert.doesNotMatch(page, /team-member-role-creator/);
  assert.match(page, /accessLevel: employeeForm\.accessLevel/);
  assert.match(page, /className="team-member-pill-options team-member-access-options"/);
  assert.match(page, /type="radio"/);
  assert.match(page, /name="new-team-member-access-level"/);
  assert.match(page, /checked=\{employeeForm\.accessLevel === accessLevel\}/);
  assert.match(page, /className="team-member-setting-fields"/);
  assert.match(page, /className="team-member-pill-options team-member-status-options"/);
  assert.match(page, /name="new-team-member-status"/);
  assert.match(page, /checked=\{employeeForm\.active === isActive\}/);
  assert.match(page, /active: employeeForm\.active/);
  assert.match(page, /employee\.active \? "Active" : "Inactive"/);
  assert.match(page, /\{state\.employees\.map\(\(employee\) => \{/);
  assert.match(page, /function updateEmployeeStatus/);
  assert.match(page, /aria-label=\{`Status for \$\{employee\.name\}`\}/);
  assert.match(page, /updateEmployeeStatus\(employee\.id, event\.target\.value === "active"\)/);
  assert.match(page, /<option value="Admin">Admin<\/option>/);
  assert.match(page, /<option value="Manager">Manager<\/option>/);
  assert.match(page, /<option value="Employee">Employee<\/option>/);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.roster-actions \{[^}]*justify-content: center;[^}]*padding-right: 28px;/s);
  assert.match(styles, /\.roster-header > span:nth-child\(n \+ 2\) \{\s*text-align: center;/);
  assert.match(styles, /\.roster-row > div\[role="cell"\]:nth-child\(n \+ 2\) \{\s*text-align: center;/);
  assert.match(styles, /\.roster-row > div\[role="cell"\]:nth-child\(n \+ 2\) input,[^}]*text-align-last: center;/s);
  assert.match(styles, /\.roster-status \{\s*justify-self: center;/);
  assert.doesNotMatch(styles, /\.roster-actions \.employee-edit-button[^}]*transform:/s);
  assert.match(styles, /\[role="columnheader"\] \{[^}]*font-size: calc\(1em \+ 2px\);[^}]*font-weight: 600;/s);
});

test("Departments and Roles keeps an unassigned row and supports editable roles and managers", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /<h3>Departments and Roles<\/h3>/);
  assert.match(page, />Add new department<\/button>/);
  assert.match(page, /placeholder="Add department name"/);
  assert.match(page, />Department<\/span>/);
  assert.match(page, /Type to create a new role or search existing roles/);
  assert.match(page, /Add Managers to Departments/);
  assert.match(page, /Department not set/);
  assert.match(page, /className="department-role-tags"/);
  assert.match(page, /className="department-manager-list"/);
  assert.match(page, /placeholder="Add role"/);
  assert.match(page, /onBlur=\{\(\) => addDepartmentRole\(department\.id\)\}/);
  assert.match(page, />Select manager<\/option>/);
  assert.match(page, /addDepartmentManager\(department\.id, Number\(event\.target\.value\)\)/);
  assert.match(page, /function removeDepartmentRole/);
  assert.match(page, /function removeDepartmentManager/);
  assert.match(page, /departments: Department\[\]/);
  assert.match(page, /unassignedDepartment \?\? fallbackDepartment/);
  assert.match(page, /function rolesForDepartment/);
  assert.match(page, /rolesForDepartment\(department, state\.departments, rosterRoles\)/);
  assert.match(page, /state\.departments\.flatMap\(\(department\) => department\.roles\), \.\.\.rosterRoles/);
  assert.match(page, /employee\.role === role \? \{ \.\.\.employee, role: "" \}/);
  assert.match(page, /className="department-edit-button"/);
  assert.match(page, /placeholder="Department not set"/);
  assert.match(page, /function saveDepartmentName/);
  assert.match(page, /departmentNameDraft\.trim\(\) \|\| "Department not set"/);
  assert.match(page, /departmentIndex > 0 \? \(/);
  assert.match(page, /className="department-row-remove"/);
  assert.match(page, /function removeDepartment\(/);
  assert.match(page, /assignedManagers\.length === 0 \? \(/);
  assert.match(page, /assignedManagers\.map\(\(manager\)/);
});

test("starter preview code is no longer wired into DomBase", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("manager PTO view supports configurable fixed and rate policies", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /id: "pto", label: "PTO"/);
  assert.match(page, /HoursSectionTab/);
  assert.match(page, /View hours/);
  assert.match(page, /View PTO/);
  assert.match(page, /ptoHours: ptoHoursEarnedForPolicy\(accrualHoursWorked, ptoPolicy, employee\.id\)/);
  assert.match(page, /const ptoPolicyByEmployeeId = new Map<number, PtoPolicy>\(\)/);
  assert.match(page, /ptoPolicyByEmployeeId\.set\(employeeId, policy\)/);
  assert.match(page, /function ptoHoursEarnedForPolicy/);
  assert.match(page, /Math\.max\(0, hoursWorked\) \/ policy\.workedHours/);
  assert.match(page, /function formatPtoChartHours/);
  assert.match(page, /Math\.trunc\(hours\)/);
  assert.match(page, /role="cell">\{formatPtoChartHours\(hoursWorked\)\}/);
  assert.match(page, /className="pto-earned">\{formatPtoChartHours\(ptoHours\)\}/);
  assert.match(page, /setPtoPolicyStep\("balances"\)/);
  assert.match(page, /"Starting balances"/);
  assert.match(page, />PTO start balance</);
  assert.match(page, /startingBalances:/);
  assert.match(page, /earnedHours: 1,[^]*workedHours: 30/);
  assert.match(page, />Fixed <small>/);
  assert.match(page, />Rate <small>/);
  assert.match(page, /className="pto-policy-primary-fields"/);
  assert.match(page, /htmlFor="pto-policy-name">Name</);
  assert.doesNotMatch(page, />Name this policy</);
  assert.match(page, /function savePtoPolicy/);
  assert.match(page, />\s*Policies\s*</);
  assert.match(page, /isViewingPtoPolicies/);
  assert.match(page, /id="saved-pto-policies-title">Policies</);
  assert.match(page, /className="pto-policies-heading-content"/);
  assert.match(page, /length > 2 \? "pto-saved-policy-list is-scrollable"/);
  assert.match(page, />\s*\+ Add Policy\s*</);
  assert.match(page, /function editPtoPolicy/);
  assert.match(page, /function cancelPtoPolicyEditor/);
  assert.match(page, /function deletePtoPolicy/);
  assert.match(page, /className="pto-policy-edit-button"/);
  assert.match(page, /className="pto-policy-delete-button"/);
  assert.match(page, /"Edit PTO policy"/);
  assert.doesNotMatch(page, /className="pto-policy-delete-link"/);
  assert.match(page, />No saved policies\.</);
  assert.doesNotMatch(page, /formatDecimalHours/);
  assert.match(page, /Hours worked YTD/);
  assert.match(page, /PTO earned/);
  assert.match(page, /PTO used/);
  assert.match(page, /PTO left/);
  assert.match(page, /function ptoHoursUsedThisYear/);
});

test("manager can persist manual worked-hour adjustments", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /type HoursAdjustment/);
  assert.match(page, /function editWorkedHours/);
  assert.match(page, /function saveWorkedHours/);
  assert.match(page, /hoursAdjustments:/);
  assert.match(page, />Edit<\/button>/);
  assert.match(page, /adjustedWorkedHoursForRange/);
  assert.match(page, /startOfDay\(parseLocalDate\(adjustment\.date\)\)/);
  assert.match(page, /aria-label="Worked hours"/);
  assert.match(page, /aria-label="Worked minutes"/);
  assert.match(page, /Are you sure you want to change/);
});

test("employee Hours view is read-only and filtered to the signed-in employee", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /id: "hours", label: "Hours", icon: "clock"/);
  assert.match(page, /employee\.id === activeEmployeeId/);
  assert.match(page, /mode === "manager" \? \(/);
  assert.match(page, /mode === "manager" \? hoursRounding : "actual"/);
  assert.match(page, /if \(view === "hours"\) \{[\s\S]*?setActiveHoursSectionTab\("hours"\)/);
});

test("employees can submit persistent PTO requests with required details", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /type PtoRequest/);
  assert.match(page, /function submitPtoRequest/);
  assert.doesNotMatch(page, /!ptoRequestForm \|\| !activeEmployee \|\| mode !== "employee"/);
  assert.match(page, /const autoApproved = activeEmployee\.accessLevel === "Admin"/);
  assert.match(page, /const initialStatus: PtoRequest\["status"\] = autoApproved \? "approved" : "pending"/);
  assert.match(page, /decidedAt: autoApproved \? requestedAt : undefined/);
  assert.match(page, /decidedByEmployeeId: autoApproved \? activeEmployee\.id : undefined/);
  assert.match(page, /Sick \/ Emergency/);
  assert.match(page, /Vacation/);
  assert.match(page, /Explain your time off request/);
  assert.match(page, /<span>Explanation \(optional\)<\/span>/);
  assert.doesNotMatch(page, /An explanation is required\./);
  assert.match(page, /reviewingPtoRequest\.explanation \|\| "No explanation provided\."/);
  assert.match(page, />Paid time off</);
  assert.match(page, />Unpaid time off</);
  assert.match(page, /compensation: ptoRequestForm\.compensation/);
  assert.match(page, /Submit request/);
  assert.match(page, /Admin time off is approved automatically\./);
  assert.match(page, /activeEmployee\?\.accessLevel === "Admin" \? "Add time off" : "Submit request"/);
  assert.match(page, /\{ptoRequestForm \? \(/);
  assert.match(page, /<button type="button" className="pto-new-request-button" onClick=\{openPtoRequest\}>Request time off<\/button>/);
  assert.match(page, /Requested \{formatRequestTimestamp\(request\.requestedAt\)\}/);
  assert.match(page, /You do not have enough PTO hours\. You cannot submit this request\./);
  assert.match(page, /This employee does not have enough PTO hours/);
  assert.match(page, /function ptoHoursForDateRange/);
  assert.doesNotMatch(page, /useCustomTime/);
  assert.doesNotMatch(page, /Specify hours instead of requesting full days/);
  assert.match(page, /Each selected day, including weekends, counts as one full 8-hour day/);
  assert.match(page, /calendarDays \+= 1/);
  assert.match(page, /return calendarDays \* 8/);
  assert.doesNotMatch(page, /current\.getDay\(\) !== 0 && current\.getDay\(\) !== 6/);
  assert.match(page, /PTO available:/);
  assert.match(styles, /\.pto-request-preview \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*justify-self: center;/s);
  assert.match(styles, /\.pto-request-preview > div \{[^}]*display: flex;[^}]*justify-content: center;[^}]*white-space: nowrap;/s);
  assert.match(page, /PTO used:/);
  assert.match(page, /PTO left:/);
  assert.match(page, /function cancelPtoRequest/);
  assert.match(page, /const cancelledAt = new Date\(\)\.toISOString\(\)/);
  assert.match(page, /status: "cancelled",\s*decidedAt: cancelledAt,\s*decidedByEmployeeId: activeEmployeeId/);
  assert.match(page, />Cancel<\/button>/);
  assert.match(page, /pendingPtoRequests/);
  assert.match(page, /filteredHistoricalPtoRequests/);
  assert.match(page, /View history/);
  assert.match(page, /Back to requests/);
  assert.match(page, /pto-current-request-table/);
  assert.match(styles, /\.pto-current-requests-heading \{\s*padding-bottom: 24px;\s*\}/);
  assert.match(page, /<span role="columnheader">Dates<\/span>\s*<span role="columnheader">Status<\/span>\s*<span role="columnheader">Total hours<\/span>\s*<span role="columnheader" aria-label="Request actions" \/>/);
  assert.match(page, /<strong className="pto-current-request-status" role="cell">Pending<\/strong>/);
  assert.match(page, /className="pto-current-request-hours" role="cell">\s*<span>\{formatPtoHours\(totalHours\)\}<\/span>\s*<\/div>\s*<div className="pto-current-request-actions" role="cell">/);
  assert.match(styles, /\.pto-current-request-head,[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\) 80px;/s);
  assert.match(styles, /\.pto-current-request-actions \{[^}]*justify-content: center;/s);
  assert.match(styles, /\.pto-current-request-head > span:nth-child\(n \+ 2\),[^}]*text-align: center;/s);
  assert.match(styles, /\.pto-current-request-row > :nth-child\(n \+ 2\):nth-child\(-n \+ 5\)[^}]*text-align: center;/s);
  assert.match(page, />Total hours</);
});

test("request history supports month, status, and employee filters", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /ptoHistoryMonth/);
  assert.match(page, /ptoHistoryStatusFilter/);
  assert.match(page, /ptoHistoryEmployeeId/);
  assert.match(page, /aria-label="Previous request-history month"/);
  assert.match(page, /aria-label="Filter request history by status"/);
  assert.match(page, /request\.status !== "pending"/);
  assert.doesNotMatch(page, /<option value="pending">To Review<\/option>/);
  assert.match(page, /aria-label="Filter request history by employee"/);
  assert.match(page, /className="pto-history-employee-divider"/);
  assert.match(page, /className="pto-history-employee-menu"/);
  assert.match(page, /className="pto-request-card-open"/);
  assert.match(page, /function formatPtoHistoryMonth/);
  assert.match(page, /function ptoHistoryStatusLabel/);
  assert.match(page, /\(second\.decidedAt \?\? second\.requestedAt\)\.localeCompare\(first\.decidedAt \?\? first\.requestedAt\)/);
  assert.match(page, /formatNumericDate\(request\.decidedAt\)\} at \{formatClockTime\(request\.decidedAt\)/);
});

test("section navigation resets nested views to their main page", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function navigateToView\(view: ViewId\)/);
  assert.match(page, /setIsViewingPtoHistory\(false\)/);
  assert.match(page, /setIsViewingPtoPolicies\(false\)/);
  assert.match(page, /setEmployeeScheduleTab\("week"\)/);
  assert.match(page, /setActiveHoursSectionTab\("hours"\)/);
  assert.match(page, /setActiveSettingsTab\("Basic info"\)/);
});

test("managers can approve or deny pending PTO requests", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /function decidePtoRequest/);
  assert.match(page, /request\.employeeId === activeEmployeeId/);
  assert.match(page, /You cannot approve or deny your own time off request\./);
  assert.match(page, /reviewingOwnPtoRequest/);
  assert.match(page, /Your request is pending approval\./);
  assert.match(page, /request\.employeeId === activeEmployeeId \? \(/);
  assert.match(page, /Approve or deny this time off request/);
  assert.match(page, /request\.compensation !== "unpaid"/);
  assert.match(page, /decidePtoRequest\("approved"\)/);
  assert.match(page, /decidePtoRequest\("denied"\)/);
  assert.match(page, /pto-request-list-header/);
  assert.match(page, /pto-request-icon-action/);
  assert.match(page, /function deletePtoRequest/);
  assert.match(page, /function messagePtoRequestEmployee/);
  assert.doesNotMatch(page, /function messagePtoRequestEmployee\(\)[^]*?setReviewingPtoRequestId\(null\)[^]*?function toggleConversationMember/);
  assert.match(page, /reviewingPtoRequest && isMessagesOpen \? "message-menu pto-review-message-overlay" : "message-menu"/);
  assert.match(styles, /\.message-menu\.pto-review-message-overlay \{\s*z-index: 60;/);
  assert.match(styles, /\.pto-review-message-overlay \.message-dropdown \{[^}]*position: fixed;[^}]*z-index: 61;/s);
  assert.match(page, /ref=\{ptoReviewModalRef\}/);
  assert.match(page, /reviewModal\.getBoundingClientRect\(\)/);
  assert.match(page, /const rightSideLeft = reviewBounds\.right \+ gap/);
  assert.match(page, /Math\.min\(reviewBounds\.top, window\.innerHeight - reviewBounds\.height - edgePadding\)/);
  assert.doesNotMatch(page, /window\.innerHeight - dropdownHeight - edgePadding/);
  assert.match(page, /setPtoMessageOverlayPosition\(\{ top, left, height: reviewBounds\.height \}\)/);
  assert.match(page, /left: ptoMessageOverlayPosition\.left/);
  assert.match(page, /height: ptoMessageOverlayPosition\.height/);
  assert.match(page, /visibility: "visible"/);
  assert.match(styles, /\.pto-review-message-overlay \.message-dropdown \{[^}]*right: auto;[^}]*visibility: hidden;/s);
  assert.match(page, /className="pto-message-employee-action"/);
  assert.match(page, /setNewConversationMemberIds\(\[employeeId\]\)/);
  assert.match(page, /setPtoMessageEmployeeId\(employeeId\)/);
  assert.match(page, /const directConversation = \(state\.conversations \?\? \[\]\)\.find/);
  assert.match(page, /const pretypedMessage = `Hi \$\{employee\?\.name\.split\(" "\)\[0\] \?\? "there"\}, I have a question about your time off request\.`/);
  assert.match(page, /if \(directConversation\) \{\s*setMessageDraft\(pretypedMessage\);\s*openConversation\(directConversation\.id, true\)/);
  assert.match(page, /setNewConversationMessage\(pretypedMessage\)/);
  assert.match(page, /openConversation\(directConversation\.id, true\)/);
  assert.match(page, /setIsPtoMessageContext\(true\)/);
  assert.match(page, /\{!isPtoMessageContext \? \(\s*<button\s*type="button"\s*className="message-back-button"/);
  assert.match(styles, /\.pto-review-message-overlay \.conversation-view \{[^}]*height: 100%;[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /\.pto-review-message-overlay \.conversation-messages \{[^}]*min-height: 0;[^}]*max-height: none;/s);
  assert.match(page, /<textarea[^]*?value=\{messageDraft\}[^]*?rows=\{2\}/);
  assert.match(styles, /\.message-reply-form textarea \{[^}]*min-height: 64px;[^}]*max-height: 64px;[^}]*resize: none;/s);
  assert.match(page, /isCreatingConversation && ptoMessageEmployeeId !== null \? \(/);
  assert.match(page, /className="conversation-view pto-draft-conversation"/);
  assert.match(page, /employeeById\(state\.employees, ptoMessageEmployeeId\)\?\.name \?\? "Employee"/);
  assert.match(page, /<div className="conversation-messages" ref=\{conversationMessagesRef\} \/>/);
  assert.match(page, /<form className="message-reply-form" onSubmit=\{createTeamConversation\}>/);
  assert.match(page, /const recipientIds = ptoMessageEmployeeId === null/);
  assert.match(page, /const existingDirectConversation = ptoMessageEmployeeId === null/);
  assert.match(styles, /\.message-reply-form \.message-error \{[^}]*grid-column: 1 \/ -1;/s);
  assert.match(page, /decidedByEmployeeId: activeEmployeeId/);
  assert.match(page, /Review \$\{employee\?\.name/);
  assert.match(page, /request\.status !== "cancelled"/);
});

test("signed-in users have a header account menu instead of a sidebar logout panel", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(page, /className="pin-panel"/);
  assert.match(page, /className="account-avatar"/);
  assert.match(page, />Profile<\/button>/);
  assert.match(page, />Team members<\/button>/);
  assert.match(page, /className="account-sign-out"/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeAccountMenu\)/);
  assert.match(page, /aria-label="Notifications"/);
  assert.match(page, /unreadConversationCount > 0\s*\? `\$\{unreadConversationCount\} unread conversations`\s*: "Messages"/);
  assert.match(page, /aria-label="Stopwatch"/);
  assert.doesNotMatch(page, /aria-label="Notification categories"/);
  assert.doesNotMatch(page, /activeNotificationTab/);
  assert.match(page, /activeUserCanManage = Boolean\(activeEmployee && isManagerEmployee\(activeEmployee\)\)/);
  assert.match(page, /notificationRequests = activeUserCanManage/);
  assert.match(page, /operationalAlerts = activeUserCanManage/);
  assert.match(page, /function operationalAlertsFor/);
  assert.match(page, /title: `\$\{timing\} \$\{action\}`/);
  assert.match(page, /detail: `\$\{employeeName\} \$\{actionPastTense\} \$\{timing\.toLocaleLowerCase\(\)\} at \$\{formatClockTime\(event\.at\)\}; scheduled for/);
  assert.match(page, /title: "Late return from break"/);
  assert.match(page, /title: "Missed break"/);
  assert.match(page, /function noShowAlertsFor/);
  assert.match(page, /title: "No-show"/);
  assert.match(page, /const alertEligibleShifts = state\.shifts;/);
  assert.match(page, /noShowAlertsFor\(state\.employees, alertEligibleShifts/);
  assert.match(page, /activeUserCanManage\s*\? noShowAlertsFor/);
  assert.match(page, /kind: "no-show" as const/);
  assert.match(page, /const displayedEventHistoryItems = areEventsExpanded\s*\? eventHistoryItems\s*: eventHistoryItems\.slice\(0, 10\)/);
  assert.match(page, /eventHistoryItems\.length > 10/);
  assert.match(page, /setAreEventsExpanded\(\(current\) => !current\)/);
  assert.match(page, /areEventsExpanded \? "Less" : "More"/);
  assert.match(page, /<span>No-show<\/span>/);
  assert.match(page, /const explanation = item\.event\.explanation\?\.trim\(\) \|\| "n\/a"/);
  assert.match(page, /clockEventLabel\(item\.event, state\.shifts\)/);
  assert.match(page, /return `\$\{pastAction\} \$\{eventTime < scheduledTime \? "early" : "late"\}`/);
  assert.doesNotMatch(page, /event-explanation exception|event-explanation-panel|SelectedEventExplanation|selectedEventExplanation/);
  assert.match(page, /title="Employee events"/);
  assert.match(page, /const allHeaderNotifications = \[/);
  assert.match(page, /const headerNotifications = allHeaderNotifications/);
  assert.doesNotMatch(page, /kind: "message"/);
  assert.doesNotMatch(page, /const messageNotifications/);
  assert.doesNotMatch(page, /\.\.\.messageNotifications/);
  assert.doesNotMatch(page, /notification\.kind === "message"/);
  assert.match(page, /kind: "request"/);
  assert.match(page, /requestId: request\.id/);
  assert.match(page, /requestStatus: request\.status/);
  assert.match(page, /className=\{`notification-request-status \$\{notification\.requestStatus\}`\}/);
  assert.match(styles, /\.notification-request-status\.pending \{\s*color: #755400;\s*font-weight: 800;/);
  assert.match(page, /function openTimeOffRequestFromNotification\(requestId: number\)/);
  assert.match(page, /navigateToView\("time_off"\)/);
  assert.match(page, /request\.status !== "pending"/);
  assert.match(page, /setIsViewingPtoHistory\(true\)/);
  assert.match(page, /setPtoHistoryMonth\(`\$\{request\.startDate\.slice\(0, 7\)\}-01`\)/);
  assert.match(page, /setPtoHistoryStatusFilter\("all"\)/);
  assert.match(page, /setPtoHistoryEmployeeId\("all"\)/);
  assert.match(page, /setArePtoRequestsExpanded\(true\)/);
  assert.match(page, /setHighlightedPtoRequestId\(requestId\)/);
  assert.match(page, /data-pto-request-id=\{request\.id\}/);
  assert.match(page, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(page, /setHighlightedPtoRequestId\(null\), 3000/);
  assert.match(styles, /\.notification-target-highlight \{\s*animation: notification-target-highlight 3s ease-out forwards;/);
  assert.match(styles, /@keyframes notification-target-highlight/);
  assert.doesNotMatch(page, /request\.status === "pending" && request\.employeeId !== activeEmployeeId/);
  assert.match(page, /notification\.kind === "request" && notification\.requestId/);
  assert.match(page, /onClick=\{\(\) => openTimeOffRequestFromNotification\(notification\.requestId!\)\}/);
  assert.match(page, /className="notification-message-item notification-request-item"/);
  assert.match(page, /kind: "alert"/);
  assert.match(page, /eventTargetId: alert\.eventTargetId/);
  assert.match(page, /function openEventFromNotification\(eventTargetId: string\)/);
  assert.match(page, /navigateToView\("clockins"\)/);
  assert.match(page, /if \(eventIndex >= 10\) setAreEventsExpanded\(true\)/);
  assert.match(page, /setHighlightedEventTargetId\(eventTargetId\)/);
  assert.match(page, /data-event-target-id=\{item\.alert\.eventTargetId\}/);
  assert.match(page, /data-event-target-id=\{`clock-\$\{item\.event\.id\}`\}/);
  assert.match(page, /className="notification-message-item notification-alert-item"/);
  assert.match(page, /onClick=\{\(\) => openEventFromNotification\(notification\.eventTargetId!\)\}/);
  assert.match(page, /<small>\{formatOperationalAlertTime\(notification\.at\)\}<\/small>/);
  assert.doesNotMatch(page, /<small>\{capitalize\(notification\.kind\)\} · \{formatOperationalAlertTime\(notification\.at\)\}<\/small>/);
  assert.match(page, /function markHeaderNotificationsOpened/);
  assert.match(page, /openedNotificationIdsByEmployee/);
  assert.match(page, /dismissedNotificationIdsByEmployee/);
  assert.match(page, /function dismissHeaderNotification/);
  assert.match(page, /function clearAllHeaderNotifications/);
  assert.match(page, /aria-label=\{`\$\{unreadNotificationCount\} unread notifications`\}/);
  assert.match(page, /className="notification-message-item notification-request-item"/);
  assert.match(page, /className="notification-dismiss"/);
  assert.match(page, />\s*Clear all\s*<\/button>/);
  assert.match(page, /title="Delete notification"/);
  assert.match(page, /employeeScheduleNotifications/);
  assert.match(page, /state\.scheduleUpdates/);
  assert.match(page, /notification\.employeeId === activeEmployeeId/);
  assert.doesNotMatch(page, /const employeeScheduleNotifications = !activeUserCanManage/);
  assert.match(page, /scheduleHasBeenPublished: true/);
  assert.match(page, /\.\.\.current\.employees\s*\.map\(\(employee\) => \(\{/);
  assert.doesNotMatch(page, /current\.employees\s*\.filter\(\(employee\) => employee\.active\)\s*\.map\(\(employee\) => \(\{/);
  assert.match(page, /\.\.\.\(current\.scheduleUpdates \?\? \[\]\)\.slice\(-200\),\s*\.\.\.current\.employees/);
  assert.match(page, /title: "New schedule published"/);
  assert.match(page, /const publisherName = current\.employees\.find\(\(employee\) => employee\.id === activeEmployeeId\)\?\.name \?\? "A manager"/);
  assert.match(page, /detail: `\$\{publisherName\} published a new schedule for the team\.`/);
  assert.doesNotMatch(page, /<small>Message · \{formatOperationalAlertTime\(notification\.at\)\}<\/small>/);
  assert.doesNotMatch(page, /<small>Request · \{formatOperationalAlertTime\(notification\.at\)\}<\/small>/);
  assert.doesNotMatch(page, /`\$\{capitalize\(notification\.kind\)\} · \$\{formatOperationalAlertTime\(notification\.at\)\}`/);
  assert.match(page, /No new notifications\./);
  assert.match(page, /formatShortDate\(request\.startDate\)/);
  assert.doesNotMatch(page, /formatShortDate\(parseLocalDate\(request\.startDate\)\)/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeNotifications\)/);
  assert.match(styles, /\.topbar\s*\{[^}]*border-bottom: 1px solid var\(--line\)/s);
  assert.match(styles, /\.topbar\s*\{[^}]*width: min\(1200px, 100%\)/s);
  assert.match(styles, /\.notification-item \{[^}]*background: #ffffff;/s);
  assert.match(styles, /\.notification-dismiss \{[^}]*position: absolute;/s);
  assert.match(styles, /\.notification-clear \{/);
  assert.doesNotMatch(styles, /\.operational-alert\.danger/);
  assert.doesNotMatch(styles, /\.account-menu\s*\{[^}]*margin-right: 200px/s);
});

test("team messaging supports filters, group chats, and persisted replies", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /type TeamConversation/);
  assert.match(page, /conversations: TeamConversation\[\]/);
  assert.match(page, /function createTeamConversation/);
  assert.match(page, /function sendTeamMessage/);
  assert.match(page, /function sendTeamMessage[^]*setMessageDraft\(""\);\s*window\.requestAnimationFrame\(\(\) => messageComposerRef\.current\?\.focus\(\)\)/);
  assert.match(page, /const conversationMessagesRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /const messageComposerRef = useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(page, /const hasOpenComposer = selectedConversationId !== null\s*\|\| \(isCreatingConversation && ptoMessageEmployeeId !== null\)/);
  assert.match(page, /window\.requestAnimationFrame\(\(\) => messageComposerRef\.current\?\.focus\(\)\)/);
  assert.equal((page.match(/ref=\{messageComposerRef\}/g) ?? []).length, 2);
  assert.match(page, /const selectedConversationMessageCount = selectedConversation\?\.messages\.length \?\? 0/);
  assert.match(page, /messageList\.scrollTop = messageList\.scrollHeight/);
  assert.match(page, /\[isMessagesOpen, ptoMessageOverlayPosition\?\.height, selectedConversationId, selectedConversationMessageCount\]/);
  assert.match(page, /className="conversation-messages" ref=\{conversationMessagesRef\}/);
  assert.match(styles, /\.conversation-messages::before \{[^}]*content: "";[^}]*margin-top: auto;/s);
  assert.match(page, /function toggleConversationPinned/);
  assert.match(page, /function toggleConversationMuted/);
  assert.match(page, /function deleteConversation/);
  assert.match(page, /function startEditingConversationName/);
  assert.match(page, /function saveConversationName/);
  assert.match(page, /creatorEmployeeId: activeEmployeeId/);
  assert.match(page, /selectedConversation\.creatorEmployeeId === activeEmployeeId/);
  assert.match(page, /conversation\.creatorEmployeeId === activeEmployeeId/);
  assert.match(page, />\s*Edit name\s*<\/button>/);
  assert.match(page, /permanently erase all message history/);
  assert.match(page, /function conversationHasUnreadMessages/);
  assert.match(page, /function conversationUnreadMessageCount/);
  assert.match(page, /const unreadConversationCount = teamConversations\.filter\(\s*\(conversation\) => conversationHasUnreadMessages\(conversation, activeEmployeeId\),\s*\)\.length;/);
  assert.match(page, /const unreadMessageCount = teamConversations\.reduce\(/);
  assert.match(page, /<span className="notification-badge" aria-hidden="true">\{unreadConversationCount\}<\/span>/);
  assert.match(page, /function messageDeliveryStatus/);
  assert.match(page, /allRecipientsHaveRead \? "Read" : "Delivered"/);
  assert.match(page, /const latestOwnMessageId = selectedConversation\?\.messages\.reduce<number \| null>/);
  assert.match(page, /message\.senderEmployeeId === activeEmployeeId && message\.id === latestOwnMessageId \? \(/);
  assert.match(page, /className="message-delivery-status"/);
  assert.match(page, /className="message-day-divider"/);
  assert.doesNotMatch(page, /className="message-avatar-select"/);
  assert.match(page, /className="conversation-options-button"/);
  assert.match(page, /className="conversation-options-popout"\s*role="menu"\s*style=\{\{ top: conversationMenuTop \}\}/);
  assert.match(page, />\s*View info\s*<\/button>/);
  assert.match(page, /"Pin Conversation"/);
  assert.match(page, /"Mute Conversation"/);
  assert.match(page, />\s*Delete Conversation\s*<\/button>/);
  assert.match(page, /pinnedByEmployeeIds/);
  assert.match(page, /mutedByEmployeeIds/);
  assert.match(page, /conversation\.mutedByEmployeeIds\?\.includes\(activeEmployeeId\)/);
  assert.match(styles, /\.message-conversation-row \{[^}]*grid-template-columns: 36px minmax\(0, 1fr\) 30px;/s);
  assert.match(page, /buttonBounds\.bottom - dropdownBounds\.top \+ 4/);
  assert.match(page, /className="message-conversation-list" onScroll=\{\(\) => setConversationMenuId\(null\)\}/);
  assert.match(styles, /\.conversation-options-popout \{[^}]*position: absolute;[^}]*right: 14px;[^}]*width: 210px;/s);
  assert.match(styles, /\.message-dropdown \{[^}]*overflow: visible;/s);
  assert.match(page, /function messagesShareCalendarDay/);
  assert.match(page, /function formatMessageDate/);
  assert.match(page, /aria-label="Message filters"/);
  assert.match(page, />\s*All\s*<\/button>/);
  assert.match(page, /Unread \(\{unreadMessageCount\}\)/);
  assert.match(page, /const conversationUnreadCount = conversationUnreadMessageCount\(conversation, activeEmployeeId\)/);
  assert.match(page, /className="conversation-unread-count"/);
  assert.doesNotMatch(page, /className="unread-dot"/);
  assert.match(styles, /\.conversation-unread-count \{[^}]*min-width: 20px;[^}]*height: 20px;[^}]*background: var\(--blue\);/s);
  assert.match(page, /Add team members/);
  assert.match(page, /\.filter\(\(employee\) => employee\.id !== activeEmployeeId\)\s*\.sort\(\(firstEmployee, secondEmployee\) => firstEmployee\.name\.localeCompare\(secondEmployee\.name\)\)/);
  assert.match(page, /\+<\/span> New message/);
  assert.match(page, /setIsCreatingConversation\(true\);\s*setPtoMessageEmployeeId\(null\);\s*setIsPtoMessageContext\(false\);\s*setSelectedConversationId\(null\);\s*setNewConversationMemberIds\(\[\]\);\s*setNewConversationMessage\(""\)/);
  assert.match(page, /className="message-dropdown-close"/);
  assert.match(page, /setIsMessagesOpen\(false\);\s*setPtoMessageEmployeeId\(null\)/);
  assert.match(page, /aria-label="Dismiss messages"/);
  assert.match(styles, /\.message-dropdown-close \{[^}]*top: 10px;[^}]*right: 10px;/s);
  assert.match(styles, /\.message-dropdown-close > span::before,[^}]*top: 50%;[^}]*left: 50%;[^}]*translate\(-50%, -50%\) rotate\(45deg\)/s);
  assert.match(page, /document\.addEventListener\("pointerdown", closeMessages\)/);
  assert.match(page, /conversations: \(parsed\.conversations \?\? \[\]\)/);
});

test("dismissible popups close from the backdrop while required forms stay protected", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /function dismissModalFromBackdrop\(event: ReactMouseEvent<HTMLDivElement>, dismiss: \(\) => void\)/);
  assert.match(page, /if \(event\.target === event\.currentTarget\) dismiss\(\)/);
  assert.match(styles, /\.modal-backdrop \{[^}]*overscroll-behavior: contain;/s);
  assert.match(styles, /body:has\(\.modal-backdrop\) \{\s*overflow: hidden;/);
  assert.match(page, /dismissModalFromBackdrop\(event, \(\) => setEmployeePendingDeletion\(null\)\)/);
  assert.match(page, /dismissModalFromBackdrop\(event, \(\) => setIsViewingPtoPolicies\(false\)\)/);
  assert.match(page, /dismissModalFromBackdrop\(event, \(\) => setReviewingPtoRequestId\(null\)\)/);
  assert.match(page, /\{ptoRequestForm \? \(\s*<div className="modal-backdrop" role="presentation">/);
  assert.match(page, /mode === "manager" && isAddingShift \? \(\s*<div className="modal-backdrop" role="presentation">/);
  assert.match(page, /pendingTimeException \? \(\s*<div className="modal-backdrop" role="presentation">/);
});

test("manager settings includes a gear icon, copied tabs, and the basic info template", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const expectedTabs = [
    "Basic info",
    "POS connection",
    "Plan & billing",
    "Schedule enforcement",
    "Alerts & permissions",
    "Events & trades",
    "Time clock options",
    "Overtime",
    "Breaks & compliance",
    "Tip settings",
    "Tip Manager",
    "Payroll settings",
    "Time off",
    "Messages",
    "Team permissions",
    "Manager Log",
    "Profile",
    "Locations & PINs",
    "Notifications",
    "Password & security",
    "API access (read only)",
  ];

  assert.match(page, /id: "settings", label: "Settings", icon: "gear", managerOnly: true/);
  expectedTabs.forEach((tab) => assert.match(page, new RegExp(tab.replace(/[&()]/g, "\\$&"))));
  assert.match(page, /className="panel settings-basic-panel"/);
  assert.match(page, /title="Location details"/);
  assert.match(page, /title="Company info"/);
  assert.match(page, /Company locations/);
  assert.match(page, /Add a new location/);
  assert.match(page, /function formatCompanyLocation/);
  assert.match(page, /\[info\.city, info\.stateProvince, info\.postalCode\]/);
  assert.match(page, /basicInfo\.companyName\.toUpperCase\(\)/);
  assert.doesNotMatch(page, /Plus Plan/);
  assert.match(page, /function updateBasicInfo/);
  assert.match(page, /function saveBasicInfo/);
  assert.match(page, /basicInfoStorageKey/);
  assert.match(page, /className=\{info\[field\] \? "settings-value-button" : "settings-add-button"\}/);
  assert.match(page, /onClick=\{\(\) => onEdit\(field\)\}/);
  assert.match(page, /disabled=\{!isBasicInfoDirty\}/);
  assert.match(page, /function formatPhoneNumberInput/);
  assert.match(page, /field === "locationPhone" \|\| field === "companyPhone"/);
  assert.match(page, /maxLength=\{inputType === "tel" \? 14 : undefined\}/);
  assert.match(page, /className="settings-field-pencil"/);
  assert.match(page, /aria-label=\{`Edit \$\{label\}`\}/);
});
