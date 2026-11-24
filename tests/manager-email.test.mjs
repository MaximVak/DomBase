import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { fieldKey, seedWorkforceFixture } from "./support/workforce-fixture.mjs";

test("manager email follows scheduled attendance, digest periods and current recipient access", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/manager-email-check-"));
  let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const db = drizzle(platform.env.DB, { schema });
  const password = "Isolated manager email fixture password!";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const { createAuthService, createAccessService, createWorkforceService, newToken, runScheduledMaintenance } = await loadServerModule("tests/support/workforce-runtime.ts");
  const { queueManagerEmails, dispatchManagerEmails, runManagerEmailDelivery } = await loadServerModule("workforce/manager-email.ts");
  const now = Date.parse("2026-11-16T16:10:00.000Z");
  const secret = "isolated-manager-email-test-secret-at-least-32";
  const auth = createAuthService(db, { secret });
  const workspace = createWorkforceService(db, createAccessService(db, auth), { secret, fieldKey, now: () => now, managerEmailEnabled: true });
  function request(path, body, cookie = "") {
    return new Request("http://localhost:3000" + path, { method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: "http://localhost:3000", "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const login = await auth.handle(request("/api/auth/login", { email: f.manager.email, password }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const prefsPath = "/api/workspace/notification-preferences";
  const events = { lateArrival: { email: true, inApp: false }, noShow: { email: true }, managerOvertime: { email: true },
    timeOffRequest: { email: true }, dailySummary: { email: true }, weeklySummary: { email: true } };
  const initialResponse = await workspace.handle(request(prefsPath, undefined, cookie));
  assert.equal(initialResponse.status, 200);
  const { revision, version, scheduleVersion, contextToken, managerEmailConfigured } = await initialResponse.json();
  assert.equal(managerEmailConfigured, true);
  const savedResponse = await workspace.handle(request(prefsPath, { id: newToken(), revision, version, scheduleVersion, contextToken, events }, cookie));
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).rows.find(row => row.id === "lateArrival").channels.email, true);
  const allAttendance = { lateArrival: { email: true }, noShow: { email: true }, dailySummary: { email: true }, weeklySummary: { email: true } };
  await db.insert(schema.accountNotificationPreferences).values([
    { accountId: f.owner.id, choices: { events: allAttendance } },
    { accountId: f.generalManager.id, choices: { events: allAttendance } },
    { accountId: f.secondOwner.id, choices: { events: { lateArrival: { email: true }, timeOffRequest: { email: true } } } },
    { accountId: f.unassigned.id, choices: { events: allAttendance } },
    { accountId: f.employeeAccount.id, choices: { events: allAttendance } },
  ]);
  await db.insert(schema.accountPermissions).values({ accountId: f.generalManager.id, permission: "timesheets.read", allowed: false });
  await db.insert(schema.employeeSettings).values({ employeeId: f.multi.id, sendLocationAlerts: false });
  await db.update(schema.locationSettings).set({ lateMinutes: 2, noShowMinutes: 5, overtimeDailyHours: 1 });
  const [publication] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: f.owner.id, notifyMode: "none" }).returning();
  const shift = (employee, role, date, startTime, endTime) => ({
    employeeId: employee.id, roleId: role.id, roleName: role.name, date, startTime, endTime, publicationId: publication.id,
    updatedAt: "2026-11-01T12:00:00.000Z",
  });
  const [late, absent, approaching, priorA, priorB] = await db.insert(schema.shifts).values([
    shift(f.a, f.roleA, "2026-11-16", "08:00", "10:00"), shift(f.b, f.roleB, "2026-11-16", "08:00", "10:00"),
    shift(f.multi, f.roleA, "2026-11-16", "07:20", "10:00"),
    shift(f.a, f.roleA, "2026-11-15", "09:00", "12:00"), shift(f.b, f.roleB, "2026-11-15", "09:00", "12:00"),
    shift(f.a, f.roleA, "2026-11-09", "09:00", "12:00"),
  ]).returning();
  await db.insert(schema.clockEvents).values([
    { employeeId: f.a.id, eventType: "in", occurredAt: "2026-11-15T17:00:00.000Z", shiftId: priorA.id, roleName: f.roleA.name },
    { employeeId: f.a.id, eventType: "out", occurredAt: "2026-11-15T20:00:00.000Z", shiftId: priorA.id, roleName: f.roleA.name },
    { employeeId: f.b.id, eventType: "in", occurredAt: "2026-11-15T17:00:00.000Z", shiftId: priorB.id, roleName: f.roleB.name },
    { employeeId: f.b.id, eventType: "out", occurredAt: "2026-11-15T20:00:00.000Z", shiftId: priorB.id, roleName: f.roleB.name },
    { employeeId: f.a.id, eventType: "in", occurredAt: "2026-11-16T16:04:00.000Z", shiftId: late.id, roleName: f.roleA.name },
    { employeeId: f.multi.id, eventType: "in", occurredAt: "2026-11-16T15:20:00.000Z", shiftId: approaching.id, roleName: f.roleA.name },
  ]);
  await db.insert(schema.timeCards).values([
    { employeeId: f.a.id, roleId: f.roleA.id, workDate: "2026-11-15" }, { employeeId: f.b.id, roleId: f.roleB.id, workDate: "2026-11-15" },
  ]);
  const [leave] = await db.insert(schema.ptoRequests).values({
    employeeId: f.a.id, startDate: "2026-11-20", endDate: "2026-11-20", compensation: "paid", reason: "sick_emergency",
    explanation: "private medical detail to exclude", requestedAt: "2026-11-16T16:07:00.000Z",
  }).returning();
  const captured = [];
  const env = {
    STAGE6_MANAGER_EMAIL_ENABLED: "true", INVITATION_EMAIL_FROM: "sender@example.test", INVITATION_EMAIL_REPLY_TO: "reply@example.test",
    INVITATION_EMAIL_ORIGIN: "https://example.test",
    INVITATION_EMAIL: { send: async mail => { captured.push(mail); return { messageId: "provider-accepted" }; } },
  };
  await runScheduledMaintenance(db, now, () => runManagerEmailDelivery(db, { ...env, STAGE6_MANAGER_EMAIL_ENABLED: undefined }, now));
  assert.equal((await db.select().from(schema.managerEmailDeliveries)).length, 0);
  assert.equal(captured.length, 0);
  const notices = await db.select().from(schema.notifications);
  assert.ok(notices.some(row => row.id === "clock-manager-late-" + late.id && row.title === "Late arrival"));
  assert.ok(notices.some(row => row.id === "clock-manager-no-show-" + absent.id));
  await queueManagerEmails(db, now);
  const queued = await db.select().from(schema.managerEmailDeliveries);
  assert.deepEqual([...new Set(queued.map(row => row.accountId))].sort(), [f.manager.id, f.owner.id, f.secondOwner.id].sort());
  assert.ok(queued.some(row => row.accountId === f.secondOwner.id && row.event === "lateArrival"));
  assert.ok(queued.some(row => row.accountId === f.secondOwner.id && row.target === String(leave.id)));
  assert.ok(queued.some(row => row.accountId === f.manager.id && row.event === "managerOvertime"));
  assert.ok(!queued.some(row => row.accountId === f.manager.id && row.event === "noShow"));
  assert.ok(queued.every(row => /^[0-9a-f]{64}$/.test(row.destinationHash)));
  await db.update(schema.accountNotificationPreferences).set({ choices: { events: { lateArrival: { email: false }, timeOffRequest: { email: false } } } })
    .where(eq(schema.accountNotificationPreferences.accountId, f.secondOwner.id));
  await Promise.all([dispatchManagerEmails(db, env, now), dispatchManagerEmails(db, env, now)]);
  await runScheduledMaintenance(db, now + 60_000, () => runManagerEmailDelivery(db, env, now + 60_000));
  await dispatchManagerEmails(db, env, now + 60_000);
  assert.equal(captured.length, 9);
  assert.equal(new Set(captured.map(mail => mail.to + "|" + mail.subject)).size, captured.length);
  const managerMail = captured.filter(mail => mail.to === f.manager.email);
  assert.deepEqual(managerMail.map(mail => mail.subject).sort(), [
    "DomBase: Approaching overtime", "DomBase: Daily team summary", "DomBase: Late arrival", "DomBase: Time off request", "DomBase: Weekly team summary",
  ]);
  const bySubject = (mails, key) => mails.find(mail => mail.subject.includes(key)).text;
  assert.match(bySubject(managerMail, "Late arrival"), /Local department A worker/);
  assert.match(bySubject(managerMail, "Approaching overtime"), /Multi department worker/);
  assert.match(bySubject(managerMail, "Daily"), /Previous day 2026-11-15\nPublished work shifts: 1\nTime cards: 1/);
  assert.match(bySubject(managerMail, "Weekly"), /Workweek 2026-11-09 to 2026-11-15\nPublished work shifts: 2/);
  assert.match(bySubject(captured.filter(mail => mail.to === f.owner.email), "Daily"), /Published work shifts: 2\nTime cards: 2/);
  assert.ok(!managerMail.some(mail => /Other department private worker|private medical detail/.test(mail.text)));
  const states = await db.select().from(schema.managerEmailDeliveries);
  assert.ok(states.filter(row => row.accountId === f.secondOwner.id).every(row => row.state === "cancelled"));
  assert.equal(states.filter(row => row.state === "accepted").length, 9);

  const nextDay = now + 24 * 60 * 60_000;
  await queueManagerEmails(db, nextDay);
  await db.delete(schema.departmentManagers).where(eq(schema.departmentManagers.accountId, f.manager.id));
  const failingSender = { ...env, INVITATION_EMAIL: { send: async () => { throw new Error("uncertain provider outcome"); } } };
  await dispatchManagerEmails(db, failingSender, nextDay);
  await dispatchManagerEmails(db, env, nextDay + 60_000);
  assert.equal(captured.length, 9);
  const next = (await db.select().from(schema.managerEmailDeliveries)).filter(row => row.event === "dailySummary" && row.occurrence === "2026-11-16");
  assert.deepEqual(next.map(row => [row.accountId, row.state]).sort(), [[f.manager.id, "cancelled"], [f.owner.id, "uncertain"]].sort());
});
