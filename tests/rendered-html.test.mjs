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

  assert.match(page, /id: "dashboard", label: "Home", icon: "H"/);
  assert.match(page, /mode === "manager" \? "Manager mode" : "Employee mode"/);
  assert.match(page, /activeViewLabel\(activeView, mode\)/);
});

test("Team is a sidebar dropdown beneath Home with roster and role routes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /label: "Home", icon: "H"[^]*label: "Team", icon: "T"[^]*label: "Schedule", icon: "S"/);
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

test("manager PTO view accrues one hour per 30 hours worked", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /id: "pto", label: "PTO"/);
  assert.match(page, /HoursSectionTab/);
  assert.match(page, /View hours/);
  assert.match(page, /View PTO/);
  assert.match(page, /ptoHours: Math\.floor\(hoursWorked \/ 30\)/);
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

  assert.match(page, /id: "hours", label: "Hours", icon: "H"/);
  assert.match(page, /employee\.id === activeEmployeeId/);
  assert.match(page, /mode === "manager" \? \(/);
  assert.match(page, /mode === "manager" \? hoursRounding : "actual"/);
  assert.match(page, /if \(view === "hours"\) setActiveHoursSectionTab\("hours"\)/);
});

test("employees can submit persistent PTO requests with required details", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /type PtoRequest/);
  assert.match(page, /function submitPtoRequest/);
  assert.match(page, /Sick \/ Emergency/);
  assert.match(page, /Vacation/);
  assert.match(page, /Explain your PTO request/);
  assert.match(page, /Submit request/);
  assert.match(page, /Requested at \{formatDateTime\(request\.requestedAt\)\}/);
  assert.match(page, /You do not have enough PTO hours\. You cannot submit this request\./);
  assert.match(page, /This employee does not have enough PTO hours/);
  assert.match(page, /function ptoHoursForDateRange/);
  assert.match(page, /Specify hours instead of requesting full days/);
  assert.match(page, /type="time"/);
  assert.match(page, /step="3600"/);
  assert.match(page, /PTO can only be requested in whole-hour increments/);
  assert.match(page, /PTO available:/);
  assert.match(page, /PTO used:/);
  assert.match(page, /PTO left:/);
  assert.match(page, /function cancelPtoRequest/);
  assert.match(page, />Cancel<\/button>/);
});

test("managers can approve or deny pending PTO requests", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function decidePtoRequest/);
  assert.match(page, /Approve or deny this PTO request/);
  assert.match(page, /decidePtoRequest\("approved"\)/);
  assert.match(page, /decidePtoRequest\("denied"\)/);
  assert.match(page, /pto-request-panel-button/);
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
  assert.match(page, /aria-label="Messages"/);
  assert.match(page, /aria-label="Stopwatch"/);
  assert.match(page, />\s*Team requests\s*<\/button>/);
  assert.match(page, />\s*Alerts\s*<\/button>/);
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
  assert.match(page, /function conversationHasUnreadMessages/);
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
