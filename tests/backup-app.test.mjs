import assert from "node:assert/strict";
import test from "node:test";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";

test("built backup status page/API allow only personal Owner sessions and report unconfigured local storage", { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedWorkforceFixture }); t.after(app.close);
  const call = async (path, cookie = "", body) => { try { return await fetch(app.origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { Cookie: cookie, Connection: "close", ...(body === undefined ? {} : { Origin: app.origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }); } catch { throw new Error(`Isolated backup HTTP timeout at ${path}`); } };
  const login = async email => { const r = await call("/api/auth/login", "", { email, password: app.password }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
  assert.equal((await call("/backups")).headers.get("location"), "/login");
  assert.equal((await call("/api/backups/status")).status, 401);
  const owner = await login(app.email), manager = await login(app.fixtureData.manager.email);
  const page = await call("/backups", owner); assert.equal(page.status, 200); assert.match(await page.text(), /Automatic hosted backups are not configured in this environment/);
  assert.match(page.headers.get("cache-control"), /no-store/); assert.equal(page.headers.get("x-frame-options"), "DENY");
  const status = await call("/api/backups/status", owner); assert.equal(status.status, 200); assert.deepEqual(await status.json(), { configured: false });
  assert.equal((await call("/api/backups/status", owner, {})).status, 405);
  assert.equal((await call("/api/backups/status", manager)).status, 403); assert.equal((await call("/backups", manager)).headers.get("location"), "/");
  const kiosk = `dombase-kiosk-device=${app.fixtureData.deviceToken}; ${owner}`;
  assert.equal((await call("/api/backups/status", kiosk)).status, 403); assert.equal((await call("/backups", kiosk)).headers.get("location"), "/kiosk");
  await call("/api/auth/logout", owner, {}); assert.equal((await call("/api/backups/status", owner)).status, 401);
});
