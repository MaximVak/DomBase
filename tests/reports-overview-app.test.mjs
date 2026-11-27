import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";

const week = "start=2026-11-16&end=2026-11-22";

export async function seedReports(db, schema, load, password) {
  const fixture = await seedWorkforceFixture(db, schema, load, password);
  const { owner, manager, a, b, multi, roleA, roleB } = fixture;
  const scheduleEmail = "schedule-only@example.test";
  const [scheduleOnly] = await db.insert(schema.accounts).values({ email: scheduleEmail, normalizedEmail: scheduleEmail,
    displayName: "Schedule-only manager", accessLevel: "general_manager", passwordHash: manager.passwordHash, loginEnabled: true }).returning();
  const [publication] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: owner.id }).returning();
  await db.insert(schema.accountPermissions).values([
    { accountId: manager.id, permission: "reports.read", allowed: true },
    { accountId: manager.id, permission: "wages.read", allowed: true },
    { accountId: scheduleOnly.id, permission: "timesheets.read", allowed: false },
  ]);
  const [shiftA, shiftB] = await db.insert(schema.shifts).values([
    { employeeId: a.id, roleId: roleA.id, startTime: "09:00", endTime: "13:00", date: "2026-11-16", publicationId: publication.id, notes: "Private report shift note" },
    { employeeId: b.id, roleId: roleB.id, startTime: "10:00", endTime: "12:00", date: "2026-11-16", publicationId: publication.id },
    { employeeId: multi.id, roleId: roleB.id, startTime: "09:00", endTime: "10:00", date: "2026-11-17", publicationId: publication.id },
    { employeeId: a.id, roleId: roleA.id, startTime: "09:00", endTime: "17:00", date: "2026-11-20" },
    { employeeId: b.id, roleId: roleB.id, startTime: "22:00", endTime: "02:00", date: "2026-10-04", publicationId: publication.id },
  ]).returning();
  await db.insert(schema.clockEvents).values([
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "in", occurredAt: "2026-11-16T17:00:00.000Z", clockDetails: { california: true } },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "break", occurredAt: "2026-11-16T19:00:00.000Z", clockDetails: { breakKind: "rest" } },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "break_end", occurredAt: "2026-11-16T19:10:00.000Z" },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "out", occurredAt: "2026-11-16T21:00:00.000Z" },
    { employeeId: b.id, shiftId: shiftB.id, roleName: roleB.name, eventType: "in", occurredAt: "2026-11-16T18:04:00.000Z", clockDetails: { california: true } },
    { employeeId: b.id, shiftId: shiftB.id, roleName: roleB.name, eventType: "out", occurredAt: "2026-11-16T20:00:00.000Z" },
    { employeeId: a.id, roleName: roleA.name, eventType: "in", occurredAt: "2026-11-23T17:00:00.000Z" },
    { employeeId: a.id, roleName: roleA.name, eventType: "in", occurredAt: "2026-10-05T16:00:00.000Z", clockDetails: { california: true } },
    { employeeId: a.id, roleName: roleA.name, eventType: "out", occurredAt: "2026-10-05T22:00:00.000Z" },
  ]);
  const [draft] = await db.insert(schema.scheduleDrafts).values({ ownerAccountId: owner.id }).returning();
  await db.insert(schema.scheduleDraftChanges).values({ draftId: draft.id, clientKey: "9001", operation: "upsert", employeeId: a.id,
    roleId: roleA.id, roleName: roleA.name, date: "2026-10-05", startTime: "09:00", endTime: "12:00" });
  await db.insert(schema.ptoRequests).values({ employeeId: a.id, compensation: "paid", startDate: "2026-11-18", endDate: "2026-11-18",
    startTime: "09:00", endTime: "11:00", reason: "vacation", explanation: "Private report leave note", status: "approved" });
  return { ...fixture, scheduleEmail };
}

test("built Reports Overview shares date filters and scopes aggregates to live grants", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedReports });
  t.after(app.close);
  const fixture = app.fixtureData;
  const call = (path, cookie = "", body) => fetch(app.origin + path, {
    redirect: "manual", signal: AbortSignal.timeout(20000),
    headers: { Cookie: cookie, ...(body ? { Origin: app.origin, "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  }).catch(error => { throw new Error(`Local Worker request failed for ${path}`, { cause: error }); });
  const login = async email => {
    const result = await call("/api/auth/login", "", { email, password: app.password });
    assert.equal(result.status, 200);
    return result.headers.get("set-cookie").split(";")[0];
  };
  const [owner, manager, general, unassigned, scheduleOnly] = await Promise.all([
    login(app.email), login(fixture.manager.email), login(fixture.generalManager.email), login(fixture.unassigned.email),
    login(fixture.scheduleEmail),
  ]);
  const api = "/api/workspace/reports-overview";
  const report = (cookie, query = week) => call(`${api}?${query}`, cookie);
  const hours = (cookie, query = week) => call(`/api/workspace/reports-hours?${query}`, cookie);
  const read = async response => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  };

  await t.test("published work, approved PTO and exact authorized wages appear in the page and API", async () => {
    const data = await read(await report(owner));
    assert.deepEqual(data, {
      period: { start: "2026-11-16", end: "2026-11-22" }, location: "Local QA location", companyWide: true,
      schedule: { shifts: 3, paidSeconds: 25200 },
      time: { workedSeconds: 21360, paidLeaveSeconds: 7200, needsReview: false },
      attendance: { onTime: 1, late: 1, noShows: 1, punctualityRate: 50 }, labor: { estimatedCents: 32340 },
    });
    const page = await call(`/reports?${week}`, owner);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /no-store/);
    const html = await page.text();
    assert.match(html, /<h1>Reports<\/h1>/);
    assert.match(html, /\$323\.40/);
    assert.match(html, /7h 00m/);
    assert.doesNotMatch(html, /Private report|Private legal name|Local department A worker|Other department private worker/);
  });
  await t.test("department scope, wage access, Employee and tablet boundaries also apply to direct requests", async () => {
    const scoped = await read(await report(manager));
    assert.deepEqual(scoped.schedule, { shifts: 1, paidSeconds: 14400 });
    assert.deepEqual(scoped.time, { workedSeconds: 14400, paidLeaveSeconds: 7200, needsReview: false });
    assert.deepEqual(scoped.attendance, { onTime: 1, late: 0, noShows: 0, punctualityRate: 100 });
    assert.deepEqual(scoped.labor, { estimatedCents: null });
    assert.equal(scoped.companyWide, false);
    assert.equal((await read(await report(general))).labor, undefined);
    assert.doesNotMatch(await (await call(`/reports?${week}`, general)).text(), /Estimated wages|\$323\.40/);
    assert.equal((await report(unassigned)).status, 403);
    assert.equal((await call("/reports", unassigned)).headers.get("location"), "/");
    assert.equal((await report("")).status, 401);
    assert.equal((await report(`dombase-session=${fixture.employeeToken}`)).status, 401);
    const device = `dombase-kiosk-device=${fixture.deviceToken}; ${owner}`;
    assert.equal((await report(device)).status, 403);
    assert.equal((await call("/reports", device)).headers.get("location"), "/kiosk");
    assert.equal((await call("/reports")).headers.get("location"), "/login");
  });
  await t.test("dates control empty results and provisional time; forged selectors and writes are rejected", async () => {
    const empty = await read(await report(owner, "start=2026-11-01&end=2026-11-01"));
    assert.equal(empty.schedule.shifts, 0);
    assert.equal(empty.labor.estimatedCents, 0);
    const pending = await read(await report(owner, "start=2026-11-23&end=2026-11-23"));
    assert.deepEqual(pending.time, { workedSeconds: 0, paidLeaveSeconds: 0, needsReview: true });
    assert.equal(pending.labor.estimatedCents, null);
    assert.equal((await report(owner, `${week}&department=1`)).status, 400);
    assert.equal((await report(owner, `${week}&start=2026-11-17`)).status, 400);
    assert.equal((await report(owner, "start=2026-11-01&end=2026-12-02")).status, 400);
    assert.equal((await call(api, owner, { start: "2026-11-16" })).status, 405);
    const invalid = await call("/reports?start=2026-11-22&end=2026-11-16", owner);
    assert.match(await invalid.text(), /role="alert"/);
  });
  await t.test("Scheduled vs. Actual shows the same range, variance, paid leave and useful daily and team rows", async () => {
    const data = await read(await hours(owner));
    assert.deepEqual(data.totals, { scheduledSeconds: 25200, workedSeconds: 21360, varianceSeconds: -3840,
      paidLeaveSeconds: 7200, breakPremiumSeconds: 0, needsReview: false });
    assert.deepEqual(data.days.map(({ date }) => date), ["2026-11-16", "2026-11-17", "2026-11-18"]);
    assert.deepEqual(data.team.map(({ id, paidLeaveSeconds }) => [id, paidLeaveSeconds]), [
      [fixture.a.id, 7200], [fixture.multi.id, 0], [fixture.b.id, 0],
    ]);
    for (const key of ["scheduledSeconds", "workedSeconds", "varianceSeconds", "paidLeaveSeconds"]) {
      assert.equal(data.days.reduce((sum, row) => sum + row[key], 0), data.totals[key]);
      assert.equal(data.team.reduce((sum, row) => sum + row[key], 0), data.totals[key]);
    }
    const html = await (await call(`/reports/hours?${week}`, owner)).text();
    assert.match(html, /Scheduled vs\. Actual Hours/);
    assert.match(html, /−1h 04m/);
    assert.match(html, /href="\/reports\?start=2026-11-16&amp;end=2026-11-22"/);
    assert.doesNotMatch(html, /Private report|Private legal name|Estimated wages/);
    const overview = await (await call(`/reports?${week}`, owner)).text();
    assert.match(overview, /href="\/reports\/hours\?start=2026-11-16&amp;end=2026-11-22"/);
  });
  await t.test("overnight schedule carryover, completed unscheduled work, premiums and unresolved cards stay distinct", async () => {
    const monday = "start=2026-10-05&end=2026-10-05";
    const overnight = await read(await hours(owner, monday));
    assert.deepEqual(overnight.totals, { scheduledSeconds: 7200, workedSeconds: 21600, varianceSeconds: 14400,
      paidLeaveSeconds: 0, breakPremiumSeconds: 7200, needsReview: false });
    assert.equal((await read(await report(owner, monday))).schedule.paidSeconds, 7200);
    const pending = await read(await hours(owner, "start=2026-11-23&end=2026-11-23"));
    assert.equal(pending.totals.workedSeconds, 0);
    assert.equal(pending.totals.needsReview, true);
    assert.equal(pending.totals.breakPremiumSeconds, null);
    assert.equal(pending.team[0].id, fixture.a.id);
    assert.equal(pending.team[0].needsReview, true);
  });
  await t.test("Hours detail enforces read grants and department scope without exposing wage data", async () => {
    const scope = await read(await hours(manager));
    assert.equal(scope.totals.scheduledSeconds, 14400);
    assert.deepEqual(scope.team.map(person => person.id), [fixture.a.id]);
    assert.equal(scope.totals.breakPremiumSeconds, null);
    const withoutWages = await read(await hours(general));
    assert.equal(withoutWages.totals.workedSeconds, 21360);
    assert.equal(withoutWages.totals.breakPremiumSeconds, null);
    assert.doesNotMatch(JSON.stringify(withoutWages), /wages|rate|phone|email|payrollId|explanation/);
    assert.equal((await hours(scheduleOnly)).status, 403);
    assert.equal((await call("/reports/hours", scheduleOnly)).headers.get("location"), "/");
    assert.doesNotMatch(await (await call(`/reports?${week}`, scheduleOnly)).text(), /Scheduled vs\. Actual Hours/);
    assert.equal((await hours(unassigned)).status, 403);
    assert.equal((await hours("")).status, 401);
    assert.equal((await hours(`dombase-session=${fixture.employeeToken}`)).status, 401);
    const device = `dombase-kiosk-device=${fixture.deviceToken}; ${owner}`;
    assert.equal((await hours(device)).status, 403);
    assert.equal((await call("/reports/hours", device)).headers.get("location"), "/kiosk");
    assert.equal((await hours(owner, `${week}&department=1`)).status, 400);
    assert.equal((await call("/api/workspace/reports-hours", owner, { start: "2026-11-16" })).status, 405);
  });
});
