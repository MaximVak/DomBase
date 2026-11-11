// Disposable local browser QA only; never a normal/hosted seed.
import { createServer } from "node:http";
import { startAuthApp } from "./auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./workforce-fixture.mjs";
import { cookiesOf } from "./kiosk-fixture.mjs";
const app = await startAuthApp({ seed: seedWorkforceFixture }); let bootstrap;
const close = async (code = 0) => { bootstrap?.close(); await app.close(); process.exit(code); };
process.stdin.setEncoding("utf8"); process.stdin.on("data", data => { if (data.trim() === "close") void close(); });
process.once("SIGINT", close); process.once("SIGTERM", close);
try {
  const response = await fetch(`${app.origin}/api/auth/login`, { method: "POST", headers: { Origin: app.origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: app.email, password: app.password }) });
  if (response.status !== 200) throw new Error(); const account = cookiesOf(response)[0];
  bootstrap = createServer((request, response) => {
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.writeHead(303, { "Set-Cookie": [`${account}; Path=/; HttpOnly; SameSite=Strict`, "dombase-kiosk-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "dombase-kiosk-person=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"], Location: `${app.origin}/`, "Cache-Control": "no-store" }); response.end(); bootstrap.close();
  });
  await new Promise(resolve => bootstrap.listen(0, "127.0.0.1", resolve));
  console.log(JSON.stringify({ fixture: "isolated shared workspace", browserEntry: `http://127.0.0.1:${bootstrap.address().port}/`, appOrigin: app.origin }));
} catch { console.error("Shared workspace preview failed to start."); await close(1); }
