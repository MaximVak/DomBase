// Explicit visual-QA fixture only. No normal local or remote database is used.
import { createServer } from "node:http";
import { startAuthApp } from "./auth-app-fixture.mjs";
import { seedKioskFixture, employeePin, cookiesOf } from "./kiosk-fixture.mjs";
const app = await startAuthApp({ seed: seedKioskFixture });
let bootstrap;
const close = async (exitCode = 0) => { bootstrap?.close(); await app.close(); process.exit(exitCode); };
process.once("SIGINT", close); process.once("SIGTERM", close);
process.stdin.setEncoding("utf8");
process.stdin.on("data", value => { if (value.trim() === "close") void close(); });
try {
  const call = (path, cookie, body) => fetch(`${app.origin}${path}`, { method: "POST", headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const logged = await call("/api/auth/login", "", { email: app.email, password: app.password });
  if (logged.status !== 200) throw new Error("Fixture login failed.");
  const owner = cookiesOf(logged)[0];
  for (const [path, body] of [
    ["employee-pin", { employeeId: app.fixtureData.a.id, pin: employeePin, password: app.password }],
    ["approval-pin", { password: app.password }],
  ]) {
    const response = await call(`/api/kiosk-admin/${path}`, owner, body);
    if (response.status !== 200) throw new Error("Fixture PIN setup failed.");
  }
  const registered = await call("/api/kiosk-admin/register", owner, { name: "Local verification tablet", password: app.password });
  if (registered.status !== 200) throw new Error("Fixture registration failed.");
  const device = registered.headers.getSetCookie().find(cookie => cookie.startsWith("dombase-kiosk-device="));
  // A one-use loopback entry point logs the browser into this existing fixture
  // device. Cookies never appear in a URL, console, source file or remote system.
  bootstrap = createServer((request, response) => {
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.writeHead(303, { "Set-Cookie": device, Location: `${app.origin}/kiosk`, "Cache-Control": "no-store" }); response.end(); bootstrap.close();
  });
  await new Promise(resolve => bootstrap.listen(0, "127.0.0.1", resolve));
  console.log(JSON.stringify({ fixture: "isolated local only", browserEntry: `http://127.0.0.1:${bootstrap.address().port}/`, appOrigin: app.origin }));
} catch { console.error("Local visual fixture could not start."); await close(1); }
