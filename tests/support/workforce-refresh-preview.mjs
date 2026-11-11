// Isolated browser QA: commit succeeds, its first reload fails, then recovery works.
import { createServer } from "node:http";
import { startAuthApp } from "./auth-app-fixture.mjs";
import { seedWorkforceFixture } from "./workforce-fixture.mjs";
import { cookiesOf } from "./kiosk-fixture.mjs";
const app = await startAuthApp({ seed: seedWorkforceFixture });
const signed = await fetch(app.origin + "/api/auth/login", { method: "POST", headers: { Origin: app.origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: app.email, password: app.password }) });
if (signed.status !== 200) { await app.close(); throw new Error("Isolated browser login failed."); }
const account = cookiesOf(signed)[0]; let first = true, failedReload = false, failNext = false, commits = 0;
const proxy = createServer(async (request, response) => {
  try {
    if (request.url === "/api/workspace/state" && failNext) { failNext = false; failedReload = true; response.writeHead(503, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end("<h1>Deliberate isolated reload failure</h1>"); return; }
    const headers = new Headers(); for (const [name, value] of Object.entries(request.headers)) if (value && !["host", "connection", "content-length"].includes(name)) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    if (headers.has("origin")) headers.set("origin", app.origin);
    if (first) headers.set("cookie", account);
    const parts = []; for await (const part of request) parts.push(part);
    const body = Buffer.concat(parts); const upstream = await fetch(app.origin + request.url, { method: request.method, headers, redirect: "manual", ...(body.length ? { body } : {}) });
    const outgoing = Object.fromEntries(upstream.headers); for (const name of ["content-length", "content-encoding", "transfer-encoding"]) delete outgoing[name];
    if (first) { first = false; outgoing["set-cookie"] = [`${account}; Path=/; HttpOnly; SameSite=Strict`, "dombase-kiosk-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "dombase-kiosk-person=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"]; }
    if (request.url === "/api/workspace/commit" && upstream.ok) { commits++; if (!failedReload) failNext = true; }
    response.writeHead(upstream.status, outgoing); response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { response.writeHead(503); response.end("Isolated preview unavailable."); }
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
console.log(JSON.stringify({ fixture: "isolated save/reload recovery", browserEntry: `http://127.0.0.1:${proxy.address().port}/` }));
await new Promise(resolve => { process.stdin.setEncoding("utf8"); process.stdin.on("data", data => { if (data.trim() === "close") resolve(); }); process.once("SIGTERM", resolve); });
console.log(JSON.stringify({ confirmedCommits: commits, failedReloadInjected: failedReload }));
await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); }); await app.close();
