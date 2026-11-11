import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";

const config = await readStagingConfig();
const databaseId = config.d1_databases[0].database_id;
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid staging subdomain.");
const origin = `https://${stagingName}.${subdomain}.workers.dev`;
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
const email = `staging-check-${randomUUID()}@example.test`;
const displayName = "Staging verification";
const password = `Private verification ${newToken()}`;
const setupToken = newToken();
let accountId;

async function query(sql, params = []) {
  const result = await cloudflare(`/accounts/${stagingAccount}/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(result) || result.some(row => !row.success)) throw new Error("Staging verification database operation failed.");
  return result[0].results;
}

async function call(path, { cookie = "", body, requestOrigin = origin } = {}) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { Origin: requestOrigin, "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (/1102|Worker exceeded resource limits/.test(text)) throw new Error("Cloudflare rejected authentication due to the current Worker CPU limit; no billing changes were made.");
  let json;
  try { json = JSON.parse(text); } catch { /* HTML endpoints are tested separately. */ }
  return { status: response.status, headers: response.headers, text, json };
}

try {
  const health = await call("/api/health");
  assert.equal(health.status, 200, "Hosted database health must return 200");
  assert.equal(health.json?.database, "ok");
  assert.equal((await call("/")).headers.get("location"), "/login");
  assert.equal((await call("/login")).status, 200);
  assert.equal((await call("/api/workforce/employees")).status, 401);
  assert.equal((await call("/api/access/accounts")).status, 401);
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  [ { id: accountId } ] = await query("INSERT INTO accounts (email, normalized_email, display_name, access_level) VALUES (?, ?, ?, 'manager') RETURNING id", [email, email, displayName]);
  await query("INSERT INTO account_setup_tokens (id, account_id, token_hash, issued_session_version, expires_at) VALUES (?, ?, ?, 1, ?)",
    [newToken(), accountId, tokenHash(setupToken), new Date(Date.now() + 3600000).toISOString()]);
  const inspection = await call("/api/auth/setup/inspect", { body: { token: setupToken } });
  assert.equal(inspection.status, 200);
  assert.equal(inspection.json?.email, email);
  assert.equal((await call("/api/auth/setup", { body: { token: setupToken, password } })).status, 200, "Private password setup must succeed in the hosted Worker");
  assert.equal((await call("/api/auth/setup", { body: { token: setupToken, password } })).status, 401);
  assert.equal((await call("/api/auth/login", { body: { email, password: "0000" } })).status, 401);
  const login = await call("/api/auth/login", { body: { email, password, accessLevel: "owner", employeeId: 1 } });
  assert.equal(login.status, 200, "Hosted email/password login must succeed");
  assert.equal(login.json?.account.accessLevel, "manager");
  const setCookie = login.headers.get("set-cookie") ?? "";
  for (const flag of [/__Host-dombase-session=/, /HttpOnly/i, /SameSite=Strict/i, /Secure/i]) assert.ok(flag.test(setCookie), "Required secure session-cookie attribute missing");
  const cookie = setCookie.split(";")[0];
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const dashboard = await call("/", { cookie });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.headers.get("cache-control") ?? "", /no-store/);
  assert.ok(dashboard.text.includes(displayName));
  assert.equal(dashboard.text.includes(password) || dashboard.text.includes(token), false);
  assert.equal((await call("/api/auth/session", { cookie })).status, 200);
  const access = await call("/api/access/me", { cookie });
  assert.equal(access.status, 200);
  assert.equal(access.json?.canManageAccess, false);
  assert.equal(access.json?.permissions["wages.read"], false);
  assert.equal((await call("/api/access/accounts", { cookie })).status, 403);
  const roster = (await call("/api/workforce/employees", { cookie })).json?.employees;
  assert.ok(Array.isArray(roster) && roster.length === 0, "Unassigned Manager must not receive workforce records");
  assert.equal((await call("/api/workforce/employees/1", { cookie })).status, 404);
  assert.equal((await call("/api/auth/logout", { cookie, body: {}, requestOrigin: "https://wrong-origin.invalid" })).status, 403);
  assert.equal((await call("/api/auth/session", { cookie })).status, 200);
  assert.equal((await call("/api/auth/logout", { cookie, body: {} })).status, 200);
  assert.equal((await call("/api/auth/session", { cookie })).status, 401);
  console.log(JSON.stringify({ origin, health: "passed", privatePasswordSetup: "passed", singleUseSetup: "passed", defaultPinRejected: true,
    secureCookie: "passed", protectedDashboard: "passed", sessionPersistence: "passed", managerPermissions: "passed", crossOriginRejected: true, logoutRevocation: "passed", foreignKeys: "passed" }));
} finally {
  // Retain the audit-linked fixture identity but remove all usable access.
  const rows = await query("SELECT id FROM accounts WHERE normalized_email = ?", [email]);
  if (rows.length) {
    const id = rows[0].id;
    const time = new Date().toISOString();
    await query("UPDATE accounts SET login_enabled = 0, password_hash = NULL, disabled_at = ?, session_version = session_version + 1 WHERE id = ?", [time, id]);
    await query("UPDATE account_sessions SET revoked_at = ? WHERE account_id = ?", [time, id]);
    await query("UPDATE account_setup_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL", [time, id]);
    console.log("Verification fixture disabled, verifier removed, sessions/grants revoked; audit preserved.");
  }
}
