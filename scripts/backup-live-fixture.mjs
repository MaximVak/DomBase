// One clearly fictional certificate on the hosted demo, for real recovery proof.
// Never sets a real person's password/PIN or changes existing Owner grants.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";
import { hash } from "../backup/snapshot.mjs";
if (process.argv.length !== 2) throw new Error("This pinned fixture accepts no overrides.");
const config = await readStagingConfig();
async function query(sql, params = []) {
  const r = await cloudflare(`/accounts/${stagingAccount}/d1/database/${config.d1_databases[0].database_id}/query`, { method: "POST", body: { sql, params } });
  if (r.some(x => !x.success)) throw new Error("Staging recovery fixture query failed."); return r[0].results;
}
const receiptFile = ".wrangler/releases/step9-live-fixture.json";
let prior; try { prior = JSON.parse(await readFile(receiptFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
if (prior && (await query("SELECT id FROM files WHERE id=? AND status='ready'", [prior.fileId])).length) { console.log("Existing fictional recovery certificate preserved."); }
else {
  const [employee] = await query("SELECT id,name,active FROM employees WHERE id=900001");
  if (!employee?.name.startsWith("Demo ") || !employee.active) throw new Error("Expected fictional demo employee is unavailable; no employee was changed.");
  const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
  if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
  const origin = `https://${stagingName}.${subdomain}.workers.dev`;
  const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
  const password = `Private backup verification ${newToken()}`; const email = `backup-proof-${newToken()}@example.test`.toLowerCase();
  let operator;
  const call = (path, cookie, body) => fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": body instanceof Uint8Array ? "application/pdf" : "application/json" }) }, ...(body === undefined ? {} : { method: body instanceof Uint8Array ? "PUT" : "POST", body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  try {
    [operator] = await query("INSERT INTO accounts (email,normalized_email,display_name,access_level) VALUES (?,?,?,'owner') RETURNING id", [email, email, "Disposable backup verification operator"]);
    const token = newToken(); await query("INSERT INTO account_setup_tokens (id,account_id,token_hash,issued_session_version,expires_at) VALUES (?,?,?,1,?)", [newToken(), operator.id, tokenHash(token), new Date(Date.now() + 3600000).toISOString()]);
    assert.equal((await call("/api/auth/setup", "", { token, password })).status, 200);
    const login = await call("/api/auth/login", "", { email, password }); assert.equal(login.status, 200); const cookie = login.headers.getSetCookie().map(s => s.split(";")[0]).find(c => c.startsWith("__Host-dombase-session=")); assert.ok(cookie);
    const fileId = newToken(); const bytes = new TextEncoder().encode("%PDF-1.4\n% FICTIONAL DEMO BACKUP-RECOVERY VERIFICATION ONLY\n%%EOF\n");
    assert.equal((await call("/api/documents/prepare", cookie, { id: fileId, employeeId: employee.id, kind: "certificate", title: "DEMO backup-recovery test", fileName: "fictional-backup-test.pdf", contentType: "application/pdf", sizeBytes: bytes.length, sha256: hash(bytes) })).status, 200);
    assert.equal((await call(`/api/documents/${fileId}/content`, cookie, bytes)).status, 200);
    const download = await call(`/api/documents/${fileId}/download`, cookie); assert.equal(download.status, 200); assert.equal(hash(new Uint8Array(await download.arrayBuffer())), hash(bytes));
    await writeFile(receiptFile, JSON.stringify({ fileId, employeeId: employee.id, sha256: hash(bytes), size: bytes.length, fictional: true, createdAt: new Date().toISOString() }), { mode: 0o600 });
    console.log("Fictional demo recovery certificate uploaded and exact HTTPS download verified.");
  } finally {
    if (operator) { const now = new Date().toISOString(); await query("UPDATE accounts SET login_enabled=0,password_hash=NULL,disabled_at=?,session_version=session_version+1 WHERE id=?", [now, operator.id]); await query("UPDATE account_sessions SET revoked_at=? WHERE account_id=?", [now, operator.id]); await query("UPDATE account_setup_tokens SET used_at=? WHERE account_id=? AND used_at IS NULL", [now, operator.id]); }
  }
}
