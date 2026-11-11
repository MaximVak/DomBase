import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";

const password = "Temporary test passphrase for local checks!";

test("password hashing preserves exact input and rejects corrupt verifiers", async () => {
  const { hashPassword, verifyPassword, passwordIsValid } = await loadServerModule("auth/crypto.ts");
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(`${password} `, first), false);
  assert.equal(await verifyPassword(password, "corrupt"), false);
  assert.equal(passwordIsValid("0000"), false);
  assert.equal(passwordIsValid("long enough with spaces"), true);
});

test("setup, authentication and revocation use the local database", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/auth-check-"));
  const { getPlatformProxy } = await import("wrangler");
  let platform;
  t.after(async () => {
    try { await platform?.dispose(); }
    finally { await rm(statePath, { recursive: true, force: true }); }
  });
  await runLocalDb("migrate", [], statePath);
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService, issueSetupToken } = await loadServerModule("auth/service.ts");
  const { tokenHash, verifyPassword } = await loadServerModule("auth/crypto.ts");
  const db = drizzle(platform.env.DB, { schema });
  const service = createAuthService(db, { secret: "isolated-test-secret-with-at-least-32-characters" });
  const origin = "http://localhost:3000";
  function request(action, body, cookie = "", overrides = {}) {
    const method = body === undefined ? "GET" : "POST";
    return service.handle(new Request(`${origin}/api/auth/${action}`, {
      method, headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json" } : {}), Cookie: cookie, ...overrides },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }));
  }
  const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
  const grant = await issueSetupToken(db, { email: "owner@example.test", displayName: "Local owner", accessLevel: "owner" });
  let ownerCookie;
  let ownerId;

  await t.test("operator-issued links are hashed, single-use and account-bound", async () => {
    const [stored] = await db.select().from(schema.accountSetupTokens);
    assert.equal(stored.tokenHash, tokenHash(grant.token));
    assert.equal(JSON.stringify(stored).includes(grant.token), false);
    assert.equal((await db.select().from(schema.accounts))[0].loginEnabled, false);
    assert.equal((await request("signup", { email: "attacker@example.test", accessLevel: "owner" })).status, 404);
    assert.equal((await request("login", { email: grant.email, password })).status, 401);
    const inspect = await request("setup/inspect", { token: grant.token });
    assert.deepEqual(await inspect.json(), { email: grant.email, displayName: grant.displayName });
    assert.equal((await request("setup", { token: grant.token, password: "0000" })).status, 400);
    const attempts = await Promise.all([
      request("setup", { token: grant.token, password }),
      request("setup", { token: grant.token, password }),
    ]);
    assert.deepEqual(attempts.map(response => response.status).sort(), [200, 401]);
    assert.equal((await request("setup", { token: grant.token, password })).status, 401);
    const [account] = await db.select().from(schema.accounts);
    ownerId = account.id;
    assert.equal(account.sessionVersion, 2);
    assert.equal(await verifyPassword(password, account.passwordHash), true);
    assert.equal((await db.select().from(schema.accountSessions)).length, 0);
  });

  await t.test("sign-in returns a protected cookie and a minimal account projection", async () => {
    const response = await request("login", { email: "OWNER@EXAMPLE.TEST", password, accessLevel: "employee", employeeId: 999 });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
    assert.match(response.headers.get("set-cookie"), /Path=\//);
    assert.match(response.headers.get("cache-control"), /no-store/);
    ownerCookie = cookieOf(response);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.account).sort(), ["accessLevel", "displayName", "email", "employeeId", "id"]);
    assert.equal(body.account.accessLevel, "owner");
    const [stored] = await db.select().from(schema.accountSessions);
    assert.notEqual(stored.tokenHash, ownerCookie.split("=")[1]);
    assert.equal((await request("session", undefined, ownerCookie)).status, 200);
    assert.equal((await request("session", undefined, "dombase-session=0000")).status, 401);
    const bad = await request("login", { email: grant.email, password: "wrong password" });
    const absent = await request("login", { email: "missing@example.test", password: "wrong password" });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), await absent.json());
  });

  await t.test("same-origin, content type and size checks reject forged writes", async () => {
    assert.equal((await request("logout", {}, ownerCookie, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await request("logout", {}, ownerCookie, { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await request("login", { email: grant.email, password }, "", { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await request("login", { padding: "x".repeat(9000) })).status, 413);
    assert.equal((await request("login", undefined)).status, 405);
    assert.equal((await request("session", undefined, ownerCookie)).status, 200);
  });

  await t.test("logout revokes the current session; logout-all revokes other devices", async () => {
    const second = cookieOf(await request("login", { email: grant.email, password }));
    const out = await request("logout", {}, second);
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await request("session", undefined, second)).status, 401);
    assert.equal((await request("session", undefined, ownerCookie)).status, 200);
    const third = cookieOf(await request("login", { email: grant.email, password }));
    assert.equal((await request("logout-all", { accountId: 999 }, ownerCookie)).status, 200);
    assert.equal((await request("session", undefined, third)).status, 401);
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
    ownerCookie = cookieOf(await request("login", { email: grant.email, password }));
  });

  await t.test("expiry, idle timeout, account disabling and version changes invalidate sessions", async () => {
    await db.update(schema.accountSessions).set({ expiresAt: "2000-01-01T00:00:00Z" }).where(eq(schema.accountSessions.tokenHash, tokenHash(ownerCookie.split("=")[1])));
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
    ownerCookie = cookieOf(await request("login", { email: grant.email, password }));
    await db.update(schema.accountSessions).set({ lastSeenAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }).where(eq(schema.accountSessions.tokenHash, tokenHash(ownerCookie.split("=")[1])));
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
    ownerCookie = cookieOf(await request("login", { email: grant.email, password }));
    await db.update(schema.accounts).set({ disabledAt: new Date().toISOString() }).where(eq(schema.accounts.id, ownerId));
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
    assert.equal((await request("login", { email: grant.email, password })).status, 401);
    await db.update(schema.accounts).set({ disabledAt: null });
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
    ownerCookie = cookieOf(await request("login", { email: grant.email, password }));
    await db.update(schema.accounts).set({ sessionVersion: 99 }).where(eq(schema.accounts.id, ownerId));
    assert.equal((await request("session", undefined, ownerCookie)).status, 401);
  });

  await t.test("expired and replaced links fail and setup cannot promote a manager", async () => {
    const manager = await issueSetupToken(db, { email: "manager@example.test", displayName: "Local manager", accessLevel: "manager" });
    const replacement = await issueSetupToken(db, { email: manager.email, displayName: manager.displayName, accessLevel: "manager" });
    assert.equal((await request("setup/inspect", { token: manager.token })).status, 401);
    assert.equal((await request("setup", { token: replacement.token, password, accessLevel: "owner" })).status, 200);
    const response = await request("login", { email: manager.email, password });
    assert.equal((await response.json()).account.accessLevel, "manager");
    const expired = await issueSetupToken(db, { email: "expired@example.test", displayName: "Expired", accessLevel: "owner" }, Date.now() - 2 * 60 * 60 * 1000);
    assert.equal((await request("setup", { token: expired.token, password })).status, 401);
  });

  await t.test("rate limits are enforced before repeated password hashing", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await request("login", { email: "rate@example.test", password: "wrong" })).status, 401);
    const blocked = await request("login", { email: "rate@example.test", password: "wrong" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "900");
  });

  await t.test("production cookies require Secure and the host prefix", async () => {
    const url = "https://dombase.example.test/api/auth/login";
    const response = await service.handle(new Request(url, { method: "POST", headers: { Origin: "https://dombase.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ email: grant.email, password }) }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /^__Host-dombase-session=/);
    assert.match(response.headers.get("set-cookie"), /; Secure/);
  });
});
