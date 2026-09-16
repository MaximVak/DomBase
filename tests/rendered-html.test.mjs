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
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>DomBase<\/title>/i);
  assert.match(html, /DomBase/);
  assert.match(html, /PIN/);
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

  assert.match(page, /placeholder="Start time"/);
  assert.match(page, /placeholder="End time"/);
  assert.match(page, /aria-label="Shift role"[^]*availableRoles\.map\(\(role\)/);
  assert.doesNotMatch(page, /placeholder="Start shift"|placeholder="End shift"/);
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
  assert.match(page, /<span>Manager<\/span>/);
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
  assert.match(page, /setEmployeePendingDeletion\(employee\)/);
  assert.match(page, /className="employee-delete-modal"/);
  assert.match(page, />Delete employee<\/button>/);
  assert.doesNotMatch(page, /window\.confirm\("Are you sure you want to remove this employee\?"\)/);
  assert.match(page, /data-editing-employee-row=\{isEditing \? employee\.id : undefined\}/);
  assert.match(page, /function finishRosterEditing/);
  assert.match(page, /document\.addEventListener\("pointerdown", finishRosterEditing\)/);
  assert.match(page, /const numericPin = pin\.replace\(\/\\D\/g, ""\)/);
  assert.match(page, /pin: event\.target\.value\.replace\(\/\\D\/g, ""\)/);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.roster-actions \{[^}]*justify-content: center;[^}]*padding-right: 28px;/s);
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
  assert.match(page, /function ptoHoursEarnedForPolicy/);
  assert.match(page, /setPtoPolicyStep\("balances"\)/);
  assert.match(page, /"Starting balances"/);
  assert.match(page, />PTO start balance</);
  assert.match(page, /startingBalances:/);
  assert.match(page, /earnedHours: 1,[^]*workedHours: 30/);
  assert.match(page, />Fixed <small>/);
  assert.match(page, />Rate <small>/);
  assert.match(page, /function savePtoPolicy/);
  assert.match(page, /View policies/);
  assert.match(page, /isViewingPtoPolicies/);
  assert.match(page, />Saved policies</);
  assert.match(page, /function editPtoPolicy/);
  assert.match(page, /className="pto-policy-edit-button"/);
  assert.match(page, /"Edit PTO policy"/);
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

  assert.match(page, /type PtoRequest/);
  assert.match(page, /function submitPtoRequest/);
  assert.match(page, /Sick \/ Emergency/);
  assert.match(page, /Vacation/);
  assert.match(page, /Explain your time off request/);
  assert.match(page, />Paid time off</);
  assert.match(page, />Unpaid time off</);
  assert.match(page, /compensation: ptoRequestForm\.compensation/);
  assert.match(page, /Submit request/);
  assert.match(page, /Requested \{formatRequestTimestamp\(request\.requestedAt\)\}/);
  assert.match(page, /You do not have enough PTO hours\. You cannot submit this request\./);
  assert.match(page, /This employee does not have enough PTO hours/);
  assert.match(page, /function ptoHoursForDateRange/);
  assert.doesNotMatch(page, /useCustomTime/);
  assert.doesNotMatch(page, /Specify hours instead of requesting full days/);
  assert.match(page, /Each selected weekday counts as one full 8-hour day/);
  assert.match(page, /return weekdays \* 8/);
  assert.match(page, /PTO available:/);
  assert.match(page, /PTO used:/);
  assert.match(page, /PTO left:/);
  assert.match(page, /function cancelPtoRequest/);
  assert.match(page, />Cancel<\/button>/);
  assert.match(page, /pendingPtoRequests/);
  assert.match(page, /filteredHistoricalPtoRequests/);
  assert.match(page, /View history/);
  assert.match(page, /Back to requests/);
  assert.match(page, /pto-current-request-table/);
  assert.match(page, />Total hours</);
});

test("request history supports month, status, and employee filters", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /ptoHistoryMonth/);
  assert.match(page, /ptoHistoryStatusFilter/);
  assert.match(page, /ptoHistoryEmployeeId/);
  assert.match(page, /aria-label="Previous request-history month"/);
  assert.match(page, /aria-label="Filter request history by status"/);
  assert.match(page, /<option value="pending">To Review<\/option>/);
  assert.match(page, /aria-label="Filter request history by employee"/);
  assert.match(page, /className="pto-history-employee-divider"/);
  assert.match(page, /className="pto-history-employee-menu"/);
  assert.match(page, /className="pto-request-card-open"/);
  assert.match(page, /function formatPtoHistoryMonth/);
  assert.match(page, /function ptoHistoryStatusLabel/);
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

  assert.match(page, /function decidePtoRequest/);
  assert.match(page, /Approve or deny this time off request/);
  assert.match(page, /request\.compensation !== "unpaid"/);
  assert.match(page, /decidePtoRequest\("approved"\)/);
  assert.match(page, /decidePtoRequest\("denied"\)/);
  assert.match(page, /pto-request-list-header/);
  assert.match(page, /pto-request-icon-action/);
  assert.match(page, /function deletePtoRequest/);
  assert.match(page, /function messagePtoRequestEmployee/);
  assert.match(page, /className="pto-message-employee-action"/);
  assert.match(page, /setNewConversationMemberIds\(\[employeeId\]\)/);
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
  assert.match(page, /aria-label=\{mode === "manager" \? "Notifications" : "Schedule updates"\}/);
  assert.match(page, /aria-label="Messages"/);
  assert.match(page, /aria-label="Stopwatch"/);
  assert.match(page, />\s*Team requests\s*<\/button>/);
  assert.match(page, />\s*Alerts\s*<\/button>/);
  assert.match(page, /notificationRequests = mode === "manager"/);
  assert.match(page, /employeeScheduleNotifications/);
  assert.match(page, /shift\.employeeId === activeEmployeeId/);
  assert.match(page, /No schedule updates\./);
  assert.match(page, /formatShortDate\(request\.startDate\)/);
  assert.doesNotMatch(page, /formatShortDate\(parseLocalDate\(request\.startDate\)\)/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeNotifications\)/);
  assert.match(styles, /\.topbar\s*\{[^}]*border-bottom: 1px solid var\(--line\)/s);
  assert.match(styles, /\.topbar\s*\{[^}]*width: min\(1200px, 100%\)/s);
  assert.doesNotMatch(styles, /\.account-menu\s*\{[^}]*margin-right: 200px/s);
});

test("team messaging supports filters, group chats, and persisted replies", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /type TeamConversation/);
  assert.match(page, /conversations: TeamConversation\[\]/);
  assert.match(page, /function createTeamConversation/);
  assert.match(page, /function sendTeamMessage/);
  assert.match(page, /function toggleConversationSelection/);
  assert.match(page, /function deleteSelectedConversations/);
  assert.match(page, /function startEditingConversationName/);
  assert.match(page, /function saveConversationName/);
  assert.match(page, /creatorEmployeeId: activeEmployeeId/);
  assert.match(page, /selectedConversation\.creatorEmployeeId === activeEmployeeId/);
  assert.match(page, /conversation\.creatorEmployeeId === activeEmployeeId/);
  assert.match(page, />\s*Edit name\s*<\/button>/);
  assert.match(page, /permanently erase all message history/);
  assert.match(page, /function conversationHasUnreadMessages/);
  assert.match(page, /function messageDeliveryStatus/);
  assert.match(page, /allRecipientsHaveRead \? "Read" : "Delivered"/);
  assert.match(page, /className="message-delivery-status"/);
  assert.match(page, /className="message-day-divider"/);
  assert.match(page, /className="message-avatar-select"/);
  assert.match(page, /className="delete-conversations-button"/);
  assert.match(page, /function messagesShareCalendarDay/);
  assert.match(page, /function formatMessageDate/);
  assert.match(page, /aria-label="Message filters"/);
  assert.match(page, />\s*All\s*<\/button>/);
  assert.match(page, />\s*Unread\s*<\/button>/);
  assert.match(page, /Add team members/);
  assert.match(page, /\+<\/span> New message/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeMessages\)/);
  assert.match(page, /conversations: \(parsed\.conversations \?\? \[\]\)/);
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
