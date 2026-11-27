import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";

const week = "start=2026-11-16&end=2026-11-22";

export async function seedReports(db, schema, load, password) {
  const fixture = await seedWorkforceFixture(db, schema, load, password);
  const { owner, manager, a, b, multi, roleA, roleB } = fixture;
  const [publication] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: owner.id }).returning();
  await db.insert(schema.accountPermissions).values([
    { accountId: manager.id, permission: "reports.read", allowed: true },
    { accountId: manager.id, permission: "wages.read", allowed: true },
  ]);
  const [shiftA, shiftB] = await db.insert(schema.shifts).values([
    { employeeId: a.id, roleId: roleA.id, startTime: "09:00", endTime: "13:00", date: "2026-11-16", publicationId: publication.id, notes: "Private report shift note" },
    { employeeId: b.id, roleId: roleB.id, startTime: "10:00", endTime: "12:00", date: "2026-11-16", publicationId: publication.id },
    { employeeId: multi.id, roleId: roleB.id, startTime: "09:00", endTime: "10:00", date: "2026-11-17", publicationId: publication.id },
    { employeeId: a.id, roleId: roleA.id, startTime: "09:00", endTime: "17:00", date: "2026-11-20" },
  ]).returning();
  await db.insert(schema.clockEvents).values([
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "in", occurredAt: "2026-11-16T17:00:00.000Z", clockDetails: { california: true } },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "break", occurredAt: "2026-11-16T19:00:00.000Z", clockDetails: { breakKind: "rest" } },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "break_end", occurredAt: "2026-11-16T19:10:00.000Z" },
    { employeeId: a.id, shiftId: shiftA.id, roleName: roleA.name, eventType: "out", occurredAt: "2026-11-16T21:00:00.000Z" },
    { employeeId: b.id, shiftId: shiftB.id, roleName: roleB.name, eventType: "in", occurredAt: "2026-11-16T18:04:00.000Z", clockDetails: { california: true } },
    { employeeId: b.id, shiftId: shiftB.id, roleName: roleB.name, eventType: "out", occurredAt: "2026-11-16T20:00:00.000Z" },
    { employeeId: a.id, roleName: roleA.name, eventType: "in", occurredAt: "2026-11-23T17:00:00.000Z" },
  ]);
  await db.insert(schema.ptoRequests).values({ employeeId: a.id, compensation: "paid", startDate: "2026-11-18", endDate: "2026-11-18",
    startTime: "09:00", endTime: "11:00", reason: "vacation", explanation: "Private report leave note", status: "approved" });
  return fixture;
}

test("built Reports Overview shares date filters and scopes aggregates to live grants", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedReports });
  t.after(app.close);
  const fixture = app.fixtureData;
  const call = (path, cookie = "", body) => fetch(app.origin + path, {
    redirect: "manual", signal: AbortSignal.timeout(20000),
    headers: { Cookie: cookie, ...(body ? { Origin: app.origin, "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  const login = async email => {
    const result = await call("/api/auth/login", "", { email, password: app.password });
    assert.equal(result.status, 200);
    return result.headers.get("set-cookie").split(";")[0];
  };
  const [owner, manager, general, unassigned] = await Promise.all([
    login(app.email), login(fixture.manager.email), login(fixture.generalManager.email), login(fixture.unassigned.email),
  ]);
  const api = "/api/workspace/reports-overview";
  const report = (cookie, query = week) => call(`${api}?${query}`, cookie);
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
});
