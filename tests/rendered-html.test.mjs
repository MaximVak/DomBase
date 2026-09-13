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
  assert.match(page, /function updateBasicInfo/);
  assert.match(page, /function saveBasicInfo/);
  assert.match(page, /basicInfoStorageKey/);
  assert.match(page, /className=\{info\[field\] \? "settings-value-button" : "settings-add-button"\}/);
  assert.match(page, /onClick=\{\(\) => onEdit\(field\)\}/);
  assert.match(page, /disabled=\{!isBasicInfoDirty\}/);
  assert.match(page, /function formatPhoneNumberInput/);
  assert.match(page, /field === "locationPhone" \|\| field === "companyPhone"/);
  assert.match(page, /maxLength=\{inputType === "tel" \? 14 : undefined\}/);
});
