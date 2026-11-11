// Browser acceptance of the same demo, in a disposable database and fake login.
import { createServer } from "node:http";
import { startAuthApp } from "./auth-app-fixture.mjs";
import { loadServerModule } from "../../scripts/server-runtime.mjs";
import { cookiesOf } from "./kiosk-fixture.mjs";
const { seedDemo } = await loadServerModule("demo/seed.ts");
const app = await startAuthApp({ seed: db => seedDemo(db, { weekStart: "2026-11-02" }) });
const response = await fetch(app.origin + "/api/auth/login", { method: "POST", headers: { Origin: app.origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: app.email, password: app.password }) });
if (response.status !== 200) { await app.close(); throw new Error("Isolated demo preview login failed."); }
const cookie = cookiesOf(response)[0];
const entry = createServer((request, response) => {
  if (request.url !== "/") { response.writeHead(404); response.end(); return; }
  response.writeHead(303, { "Set-Cookie": [`${cookie}; Path=/; HttpOnly; SameSite=Strict`, "dombase-kiosk-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "dombase-kiosk-person=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"], Location: app.origin, "Cache-Control": "no-store" }); response.end(); entry.close();
});
await new Promise(resolve => entry.listen(0, "127.0.0.1", resolve));
console.log(JSON.stringify({ fixture: "isolated Step 8 demo", browserEntry: `http://127.0.0.1:${entry.address().port}/` }));
await new Promise(resolve => { process.stdin.setEncoding("utf8"); process.stdin.on("data", data => { if (data.trim() === "close") resolve(); }); process.once("SIGTERM", resolve); });
entry.close(); entry.closeAllConnections(); await app.close();
