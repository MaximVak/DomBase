import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AuthenticatedAccount, DashboardAccount } from "./types";
import { dummyHash, hashPassword, newToken, passwordIsValid, rateKey, tokenHash, tokenIsValid, verifyPassword } from "./crypto";
import { AuthError, isLoopback, json, readAuthBody, readSessionCookie, sessionCookie } from "./http";
import { registeredDevice } from "../kiosk/device";

type Database = DrizzleD1Database<typeof schema>;
const sessionSeconds = 8 * 60 * 60;
const idleMs = 30 * 60 * 1000;
const budgetMs = 15 * 60 * 1000;
const dashboardLevels = ["owner", "general_manager", "manager"];
const levels = [...dashboardLevels, "employee"];
// Employee password sessions require a real, active person. Legacy/demo/system
// accounts without an employee link never become self-service identities.
const employeeEligibility = sql`(access_level <> 'employee' OR EXISTS
  (SELECT 1 FROM employees e WHERE e.id = accounts.employee_id AND e.active = 1 AND e.terminated = 0))`;
const invalidLogin = () => new AuthError(401, "Invalid email or password.");
const invalidSetup = () => new AuthError(401, "This setup link is invalid or expired. Ask for a new link.");
const asUtc = (value: string) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);

function normalizedEmail(value: unknown) {
  if (typeof value !== "string" || value.length > 254 || !/^[\x21-\x7e]+$/.test(value.trim()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "";
  return value.trim().toLowerCase();
}

function publicAccount(account: typeof schema.accounts.$inferSelect): AuthenticatedAccount {
  return { id: account.id, employeeId: account.employeeId, email: account.email,
    displayName: account.displayName, accessLevel: account.accessLevel } as AuthenticatedAccount;
}

export function createAuthService(db: Database, options: { secret: string; now?: () => number }) {
  if (!options.secret || options.secret.length < 32) throw new Error("Authentication configuration is unavailable.");
  const now = options.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();
  async function personEligible(account: typeof schema.accounts.$inferSelect) {
    return account.accessLevel !== "employee" || Boolean(await db.get(sql`SELECT 1 FROM employees WHERE id = ${account.employeeId} AND active = 1 AND terminated = 0`));
  }

  async function budget(key: string, limit: number) {
    const time = stamp();
    const cutoff = new Date(now() - budgetMs).toISOString();
    const keyHash = rateKey(options.secret, key);
    const [row] = await db.insert(schema.authRateLimits).values({ keyHash, failedAttempts: 1, windowStartedAt: time })
      .onConflictDoUpdate({ target: schema.authRateLimits.keyHash, set: {
        failedAttempts: sql`CASE WHEN ${schema.authRateLimits.windowStartedAt} <= ${cutoff} THEN 1 ELSE ${schema.authRateLimits.failedAttempts} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${schema.authRateLimits.windowStartedAt} <= ${cutoff} THEN ${time} ELSE ${schema.authRateLimits.windowStartedAt} END`,
      } }).returning();
    if (row.failedAttempts > limit) throw new AuthError(429, "Too many attempts. Try again in 15 minutes.");
  }

  async function audit(accountId: number, action: string, entityId: string) {
    await db.insert(schema.auditLog).values({ actorAccountId: accountId, action, entityType: "account", entityId });
  }

  async function getSession(token: string) {
    if (!tokenIsValid(token)) return null;
    const [row] = await db.select({ session: schema.accountSessions, account: schema.accounts })
      .from(schema.accountSessions).innerJoin(schema.accounts, eq(schema.accountSessions.accountId, schema.accounts.id))
      .where(eq(schema.accountSessions.tokenHash, tokenHash(token))).limit(1);
    if (!row) return null;
    const { session, account } = row;
    if (session.revokedAt || asUtc(session.expiresAt) <= now() || !Number.isFinite(asUtc(session.expiresAt))
      || asUtc(session.lastSeenAt ?? session.createdAt) + idleMs <= now()
      || !Number.isFinite(asUtc(session.lastSeenAt ?? session.createdAt))
      || !account.loginEnabled || !account.passwordHash || account.disabledAt
      || account.sessionVersion !== session.sessionVersion || !levels.includes(account.accessLevel) || !await personEligible(account)) {
      if (!session.revokedAt) await db.update(schema.accountSessions).set({ revokedAt: stamp() }).where(eq(schema.accountSessions.id, session.id));
      return null;
    }
    const touched = await db.update(schema.accountSessions).set({ lastSeenAt: stamp() })
      .where(and(eq(schema.accountSessions.id, session.id), isNull(schema.accountSessions.revokedAt), sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${account.id} AND session_version = ${session.sessionVersion} AND disabled_at IS NULL AND login_enabled = 1 AND access_level = ${account.accessLevel} AND ${employeeEligibility})`)).returning({ id: schema.accountSessions.id });
    return touched.length ? { account: publicAccount(account), sessionId: session.id, version: account.sessionVersion } : null;
  }

  async function inspectSetup(token: unknown) {
    if (!tokenIsValid(token)) throw invalidSetup();
    const [row] = await db.select({ grant: schema.accountSetupTokens, account: schema.accounts })
      .from(schema.accountSetupTokens).innerJoin(schema.accounts, eq(schema.accountSetupTokens.accountId, schema.accounts.id))
      .where(eq(schema.accountSetupTokens.tokenHash, tokenHash(token))).limit(1);
    if (!row || row.grant.usedAt || !(asUtc(row.grant.expiresAt) > now()) || row.account.loginEnabled
      || row.account.disabledAt || row.account.sessionVersion !== row.grant.issuedSessionVersion
      || !levels.includes(row.account.accessLevel) || !await personEligible(row.account)) throw invalidSetup();
    return row;
  }

  async function completeSetup(token: unknown, password: unknown) {
    const { grant, account } = await inspectSetup(token);
    if (!passwordIsValid(password)) throw new AuthError(400, "Use a password with 15–128 characters.");
    const passwordHash = await hashPassword(password);
    const time = stamp();
    const claimed = await db.update(schema.accountSetupTokens).set({ usedAt: time }).where(and(
      eq(schema.accountSetupTokens.id, grant.id), isNull(schema.accountSetupTokens.usedAt),
      sql`${schema.accountSetupTokens.expiresAt} > ${time}`,
      sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${account.id} AND session_version = ${grant.issuedSessionVersion} AND login_enabled = 0 AND disabled_at IS NULL AND access_level = ${account.accessLevel} AND ${employeeEligibility})`,
    )).returning({ id: schema.accountSetupTokens.id });
    if (!claimed.length) throw invalidSetup();
    const results = await db.batch([
      db.update(schema.accounts).set({ passwordHash, loginEnabled: true, sessionVersion: account.sessionVersion + 1, updatedAt: time })
        .where(and(eq(schema.accounts.id, account.id), eq(schema.accounts.sessionVersion, grant.issuedSessionVersion), eq(schema.accounts.loginEnabled, false), isNull(schema.accounts.disabledAt), eq(schema.accounts.accessLevel, account.accessLevel), employeeEligibility)),
      db.update(schema.accountSessions).set({ revokedAt: time }).where(and(eq(schema.accountSessions.accountId, account.id),
        sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${account.id} AND password_hash = ${passwordHash} AND session_version = ${account.sessionVersion + 1})`)),
    ]);
    if (results[0].meta.changes !== 1) throw invalidSetup();
    await db.delete(schema.authRateLimits).where(eq(schema.authRateLimits.keyHash, rateKey(options.secret, `email:${account.normalizedEmail}`)));
    await audit(account.id, "account.password_set", String(account.id));
  }

  async function login(emailValue: unknown, password: unknown, oldToken: string) {
    const email = normalizedEmail(emailValue);
    if (!email || typeof password !== "string" || password.length > 512) throw invalidLogin();
    await budget(`email:${email}`, 5);
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.normalizedEmail, email)).limit(1);
    const eligible = account && account.loginEnabled && !account.disabledAt && levels.includes(account.accessLevel) && await personEligible(account);
    const valid = await verifyPassword(password, eligible && account.passwordHash ? account.passwordHash : dummyHash);
    if (!valid || !eligible) throw invalidLogin();
    const token = newToken();
    const sessionId = newToken();
    const time = stamp();
    const expires = new Date(now() + sessionSeconds * 1000).toISOString();
    // A password reset/revocation/disable concurrent with hashing must win.
    const inserted = await db.run(sql`INSERT INTO account_sessions
      (id, account_id, token_hash, session_version, expires_at, last_seen_at, created_at)
      SELECT ${sessionId}, id, ${tokenHash(token)}, session_version, ${expires}, ${time}, ${time}
      FROM accounts WHERE id = ${account.id} AND session_version = ${account.sessionVersion}
      AND password_hash = ${account.passwordHash} AND login_enabled = 1 AND disabled_at IS NULL
      AND access_level = ${account.accessLevel} AND ${employeeEligibility}`);
    if (inserted.meta.changes !== 1) throw invalidLogin();
    if (tokenIsValid(oldToken)) await db.update(schema.accountSessions).set({ revokedAt: time }).where(eq(schema.accountSessions.tokenHash, tokenHash(oldToken)));
    await db.delete(schema.authRateLimits).where(eq(schema.authRateLimits.keyHash, rateKey(options.secret, `email:${email}`)));
    await audit(account.id, "account.login", sessionId);
    return { token, account: publicAccount(account) };
  }

  async function handle(request: Request) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
      if (await registeredDevice(db, request.headers.get("cookie"), url, now())) throw new AuthError(403, "This browser is registered as a clock tablet. Use another browser for the dashboard.");
      const action = url.pathname.slice("/api/auth/".length);
      const token = readSessionCookie(request.headers.get("cookie"), url);
      if (action === "session" && request.method === "GET") {
        const session = await getSession(token);
        return session ? json({ account: session.account }) : json({ error: "Sign in to continue." }, 401, { "Set-Cookie": sessionCookie(url, "", 0) });
      }
      if (!["login", "setup", "setup/inspect", "logout", "logout-all"].includes(action)) throw new AuthError(404, "Not found.");
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
      const body = await readAuthBody(request);
      if (["login", "setup", "setup/inspect"].includes(action)) {
        const network = isLoopback(url.hostname) ? "local" : request.headers.get("cf-connecting-ip") ?? "unknown";
        await budget(`network:${network}`, 60);
      }
      if (action === "login") {
        const result = await login(body.email, body.password, token);
        return json({ account: result.account }, 200, { "Set-Cookie": sessionCookie(url, result.token, sessionSeconds) });
      }
      if (action === "setup/inspect") {
        const { account } = await inspectSetup(body.token);
        return json({ email: account.email, displayName: account.displayName });
      }
      if (action === "setup") {
        await completeSetup(body.token, body.password);
        return json({ ready: true });
      }
      if (action === "logout-all") {
        const session = await getSession(token);
        if (!session) throw new AuthError(401, "Sign in to continue.");
        await db.batch([
          db.update(schema.accounts).set({ sessionVersion: sql`${schema.accounts.sessionVersion} + 1`, updatedAt: stamp() }).where(eq(schema.accounts.id, session.account.id)),
          db.update(schema.accountSessions).set({ revokedAt: stamp() }).where(eq(schema.accountSessions.accountId, session.account.id)),
        ]);
        await audit(session.account.id, "account.logout_all", String(session.account.id));
      } else if (tokenIsValid(token)) {
        await db.update(schema.accountSessions).set({ revokedAt: stamp() }).where(eq(schema.accountSessions.tokenHash, tokenHash(token)));
      }
      return json({ signedOut: true }, 200, { "Set-Cookie": sessionCookie(url, "", 0) });
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      // No request body, password, setup link, session token or SQL detail is logged.
      const causes: string[] = []; let current: unknown = error;
      for (let depth = 0; depth < 5 && current instanceof Error; depth++) { causes.push(current.message); current = current.cause; }
      const detail = causes.join(" ");
      console.error("Authentication request failed.", {
        code: detail.match(/\b(?:ERR_[A-Z_]+|SQLITE_[A-Z_]+|D1_[A-Z_]+)\b/)?.[0] ?? "unknown",
        category: ["scrypt", "memory", "too many API requests", "constraint failed", "SQLITE_BUSY", "Invalid number", "Invalid typed array", "no such table"].find(value => detail.toLowerCase().includes(value.toLowerCase())) ?? "unclassified",
      });
      return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
    }
  }

  return { handle, getSession };
}

// Local operator entry point only. No HTTP endpoint calls this function.
export async function issueSetupToken(db: Database, input: { email: string; displayName: string; accessLevel: DashboardAccount["accessLevel"] }, time = Date.now()) {
  const email = normalizedEmail(input.email);
  if (!email || !input.displayName.trim() || input.displayName.length > 100 || !dashboardLevels.includes(input.accessLevel)) throw new Error("Provide a valid email, name and dashboard access level.");
  await db.insert(schema.accounts).values({ email: input.email.trim(), normalizedEmail: email, displayName: input.displayName.trim(), accessLevel: input.accessLevel }).onConflictDoNothing();
  const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.normalizedEmail, email)).limit(1);
  if (!account || account.loginEnabled || account.disabledAt || account.accessLevel !== input.accessLevel) throw new Error("This account cannot receive an initial setup link.");
  const token = newToken();
  await db.batch([
    db.update(schema.accountSetupTokens).set({ usedAt: new Date(time).toISOString() }).where(and(eq(schema.accountSetupTokens.accountId, account.id), isNull(schema.accountSetupTokens.usedAt))),
    db.insert(schema.accountSetupTokens).values({ id: newToken(), accountId: account.id, tokenHash: tokenHash(token), issuedSessionVersion: account.sessionVersion, expiresAt: new Date(time + 60 * 60 * 1000).toISOString() }),
  ]);
  return { token, email: account.email, displayName: account.displayName };
}
