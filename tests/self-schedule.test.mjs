import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedSelfScheduleFixture } from "./support/self-schedule-fixture.mjs";

test("employee schedule reads enforce live identity, publication and privacy boundaries", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/self-schedule-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  const s = await loadServerModule("db/schema.ts");
  const { createAuthService, createSelfService } = await loadServerModule("tests/support/workforce-runtime.ts");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const db = drizzle(platform.env.DB, { schema: s }), secret = "isolated-schedule-secret-at-least-32-characters";
  const auth = createAuthService(db, { secret }), self = createSelfService(db, auth, secret);
  const password = "Isolated schedule test passphrase!", f = await seedSelfScheduleFixture(db, s, loadServerModule, password);
  const origin = "http://localhost:3000";
  const request = (path, cookie = "", body) => new Request(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = async response => { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const login = async account => { const response = await auth.handle(request("/api/auth/login", "", { email: account.email, password })); await ok(response); return response.headers.get("set-cookie").split(";")[0]; };
  let first = await login(f.employeeAccount); const second = await login(f.secondAccount), owner = await login(f.owner);
  const path = "/api/self/schedule?date=2026-11-12";
  const call = (cookie = first, suffix = path, body) => self.handle(request(suffix, cookie, body));
  await t.test("two employee accounts receive only their own published shifts when privacy is enabled", async () => {
    const response = await call(); assert.match(response.headers.get("cache-control"), /no-store/);
    const a = await ok(response), b = await ok(await call(second));
    assert.equal(a.ownOnly, true); assert.equal(a.startDate, "2026-11-09"); assert.equal(a.endDate, "2026-11-15");
    assert.deepEqual(a.shifts.map(shift => shift.id), [f.scheduledShifts[0].id]);
    assert.deepEqual(b.shifts.map(shift => shift.id), [f.scheduledShifts[1].id]);
    assert.doesNotMatch(JSON.stringify(a), /Second schedule employee|UNPUBLISHED|Private|wage|payroll|email|phone|ssn|pin|password|notes|token/i);
    assert.deepEqual(Object.keys(a.shifts[0]).sort(), ["date", "employeeId", "employeeName", "end", "id", "role", "start", "station"]);
  });
  await t.test("team visibility follows the live setting on each request, without exposing private fields", async () => {
    await db.update(s.locationSettings).set({ employeesOwnScheduleOnly: false }).where(eq(s.locationSettings.businessId, 1));
    const team = await ok(await call()); assert.equal(team.ownOnly, false); assert.equal(team.shifts.length, 2);
    assert.equal(team.shifts.some(shift => shift.employeeId === f.secondPerson.id), true);
    assert.doesNotMatch(JSON.stringify(team), /notes|wage|phone|email|ssn|UNPUBLISHED|Private/i);
    await db.update(s.locationSettings).set({ employeesOwnScheduleOnly: true }).where(eq(s.locationSettings.businessId, 1));
    assert.equal((await ok(await call())).shifts.length, 1);
    assert.equal((await ok(await call(second))).shifts.length, 1);
  });
  await t.test("date navigation is bounded to one workweek, including changed week starts and DST", async () => {
    assert.equal((await ok(await call(first, "/api/self/schedule?date=2026-11-16"))).shifts[0].id, f.scheduledShifts[2].id);
    const empty = await ok(await call(first, "/api/self/schedule?date=2027-02-02")); assert.deepEqual(empty.shifts, []);
    await db.update(s.locationSettings).set({ workWeekStart: 0 }).where(eq(s.locationSettings.businessId, 1));
    const dst = await ok(await call(first, "/api/self/schedule?date=2026-11-01"));
    assert.equal(dst.startDate, "2026-11-01"); assert.equal(dst.endDate, "2026-11-07"); assert.equal(dst.timeZone, "America/Los_Angeles");
    await db.update(s.locationSettings).set({ workWeekStart: 1 }).where(eq(s.locationSettings.businessId, 1));
    const fixed = createSelfService(db, auth, secret, () => Date.parse("2026-11-13T07:30:00Z"));
    assert.equal((await ok(await fixed.handle(request("/api/self/schedule", first)))).today, "2026-11-12");
  });
  await t.test("selectors, malformed ranges, writes and non-employee credentials fail closed", async () => {
    for (const query of ["employeeId=2", "date=2026-02-30", "date=2026-11-12&date=2026-11-13", "start=2026-01-01&end=2026-12-31", "date="]) {
      assert.equal((await call(first, `/api/self/schedule?${query}`)).status, 400);
    }
    assert.equal((await call(first, "/api/self/schedule/2")).status, 404);
    assert.equal((await call(first, path, { employeeId: f.secondPerson.id })).status, 405);
    for (const cookie of ["", `dombase-session=${f.deviceToken}`, `dombase-session=${f.legacyToken}`]) assert.equal((await call(cookie)).status, 401);
    assert.equal((await call(owner)).status, 403);
    assert.equal((await call(`dombase-kiosk-device=${f.deviceToken}; ${first}`)).status, 403);
  });
  await t.test("revocation after authentication is enforced inside the read transaction", async () => {
    const guarded = createSelfService(db, { getSession: async token => {
      const session = await auth.getSession(token);
      await db.update(s.accounts).set({ sessionVersion: sql`session_version + 1` }).where(eq(s.accounts.id, f.employeeAccount.id));
      return session;
    } }, secret);
    assert.equal((await guarded.handle(request(path, first))).status, 401);
    first = await login(f.employeeAccount);
    await db.update(s.employees).set({ active: false }).where(eq(s.employees.id, f.a.id));
    assert.equal((await call()).status, 401);
    await db.update(s.employees).set({ active: true }).where(eq(s.employees.id, f.a.id));
    assert.equal((await call()).status, 401); first = await login(f.employeeAccount);
    await ok(await auth.handle(request("/api/auth/logout", first, {}))); assert.equal((await call()).status, 401);
    assert.equal((await call(second)).status, 200);
  });
});
