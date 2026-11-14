import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import * as s from "../db/schema";
import type { KioskOperatorDatabase } from "../kiosk/database";
import { atomicBatch } from "../kiosk/database";
import { registeredDevice } from "../kiosk/device";
import { AuthError, isLoopback, json, readAuthBody, readSessionCookie } from "../auth/http";
import { newToken, rateKey, tokenIsValid } from "../auth/crypto";
import type { createAuthService } from "../auth/service";
import { canonical } from "../workforce/contract";
import * as v from "../workforce/validation";
import { profileFields, profileError } from "./profile";
import type { PersonalProfile, MyProfile } from "./profile";
import { readEmployeeSchedule } from "./schedule";
import { readSchedulePreferences, saveSchedulePreferences, readScheduleAlerts, saveScheduleAlertReceipt } from "./schedule-notifications";
import { readMyAvailability, saveMyAvailability } from "./availability";

type Auth = Pick<ReturnType<typeof createAuthService>, "getSession">;
export function createSelfService(db: KioskOperatorDatabase, auth: Auth, secret: string, now = Date.now) {
  if (secret.length < 32) throw new Error("Self-service configuration unavailable.");
  async function context(request: Request) {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
    if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use your own browser for your profile. This browser is registered as a clock tablet.");
    const session = await auth.getSession(readSessionCookie(request.headers.get("cookie"), url));
    if (!session) throw new AuthError(401, "Sign in to continue.");
    if (session.account.accessLevel !== "employee") throw new AuthError(403, "Use your dashboard profile.");
    const { account, sessionId, version } = session;
    const guard = sql`EXISTS (SELECT 1 FROM accounts a JOIN account_sessions acs ON acs.account_id = a.id
      JOIN employees e ON e.id = a.employee_id WHERE a.id = ${account.id} AND a.employee_id = ${account.employeeId}
      AND a.access_level = 'employee' AND a.session_version = ${version} AND a.disabled_at IS NULL AND a.login_enabled = 1
      AND acs.id = ${sessionId} AND acs.session_version = a.session_version AND acs.revoked_at IS NULL
      AND julianday(acs.expires_at) > julianday(${new Date(now()).toISOString()})
      AND julianday(COALESCE(acs.last_seen_at, acs.created_at)) > julianday(${new Date(now() - 30 * 60000).toISOString()})
      AND e.active = 1 AND e.terminated = 0)`;
    const contextToken = rateKey(secret, `self-profile-context:${account.id}:${account.employeeId}:${sessionId}:${version}`);
    return { account, guard, contextToken };
  }
  type Context = Awaited<ReturnType<typeof context>>;
  async function read(ctx: Context): Promise<MyProfile> {
    const e = s.employees; const p = s.employeeProfiles;
    const [row] = await db.select({ name: e.name, email: e.email, phone: e.phone, employeeVersion: e.version,
      profileVersion: p.version, legalFirstName: p.legalFirstName, legalMiddleName: p.legalMiddleName, legalLastName: p.legalLastName,
      dateOfBirth: p.dateOfBirth, homeAddress: p.homeAddress, homeAddressLine2: p.homeAddressLine2, homeCity: p.homeCity,
      homeStateProvince: p.homeStateProvince, homePostalCode: p.homePostalCode, emergencyContact: p.emergencyContact,
      emergencyContactRelationship: p.emergencyContactRelationship, emergencyContactPhone: p.emergencyContactPhone,
      emergencyContactPreference: p.emergencyContactPreference,
    }).from(e).leftJoin(p, eq(p.employeeId, e.id)).where(sql`${e.id} = ${ctx.account.employeeId} AND ${ctx.guard}`).limit(1);
    if (!row) throw new AuthError(401, "Sign in to continue.");
    const values = Object.fromEntries(profileFields.map(field => [field.key, row[field.key] ?? ""])) as PersonalProfile;
    const [photo] = await db.select().from(s.employeePhotos).where(eq(s.employeePhotos.employeeId, ctx.account.employeeId));
    return { accountEmail: ctx.account.email, employeeId: ctx.account.employeeId, photoFileId: photo?.fileId, contextToken: ctx.contextToken, employeeVersion: row.employeeVersion, profileVersion: row.profileVersion ?? 0, values };
  }
  async function save(ctx: Context, body: Record<string, unknown>) {
    v.keys(body, ["id", "contextToken", "employeeVersion", "profileVersion", "values"]);
    if (typeof body.contextToken !== "string" || !/^[a-f0-9]{64}$/.test(body.contextToken)
      || !timingSafeEqual(Buffer.from(body.contextToken), Buffer.from(ctx.contextToken))) {
      throw new AuthError(409, "Your sign-in changed. Reload your profile before making another change.");
    }
    if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
    const id = body.id; const employeeVersion = v.integer(body.employeeVersion); const profileVersion = v.integer(body.profileVersion, 0);
    const supplied = v.object(body.values); v.keys(supplied, profileFields.map(field => field.key));
    const values = Object.fromEntries(profileFields.map(field => [field.key, v.text(supplied[field.key], field.max)])) as PersonalProfile;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
    const error = profileError(values, today); if (error) throw new AuthError(400, error);
    const hash = `self-profile:${rateKey(secret, canonical(body))}:`;
    async function previous() {
      const [row] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, id)).limit(1);
      if (!row) return null;
      if (row.accountId !== ctx.account.id || !row.bodyHash.startsWith(hash)) throw new AuthError(409, "This save identifier is already in use.");
      return { saved: true, id };
    }
    const prior = await previous(); if (prior) return prior;
    const attemptHash = hash + newToken(); const stamp = new Date(now()).toISOString(); const employeeId = ctx.account.employeeId;
    // A unique attempt receipt prevents concurrent identical retries from writing twice.
    const receipt = sql`EXISTS (SELECT 1 FROM workforce_commits WHERE id = ${id} AND account_id = ${ctx.account.id} AND body_hash = ${attemptHash})`;
    const profileKeys = profileFields.map(f => f.key).filter(key => !["name", "email", "phone"].includes(key));
    const columns = profileKeys.map(key => s.employeeProfiles[key as keyof typeof s.employeeProfiles] as typeof s.employeeProfiles.legalFirstName);
    const result = await atomicBatch(db, [
      sql`UPDATE workforce_state SET revision = revision + 1 WHERE id = 1 AND ${ctx.guard}
        AND EXISTS (SELECT 1 FROM employees WHERE id = ${employeeId} AND version = ${employeeVersion})
        AND COALESCE((SELECT version FROM employee_profiles WHERE employee_id = ${employeeId}), 0) = ${profileVersion}
        AND NOT EXISTS (SELECT 1 FROM workforce_commits WHERE id = ${id})`,
      sql`INSERT INTO workforce_commits (id, account_id, body_hash, revision, created_at)
        SELECT ${id}, ${ctx.account.id}, ${attemptHash}, revision, ${stamp} FROM workforce_state WHERE id = 1 AND changes() = 1`,
      sql`UPDATE employees SET name = ${values.name}, email = ${values.email}, phone = ${values.phone},
        version = version + 1, updated_at = ${stamp} WHERE id = ${employeeId} AND version = ${employeeVersion} AND ${receipt}`,
      sql`INSERT INTO workforce_write_checks (id, passed) SELECT ${`${id}:self-employee`}, CASE WHEN changes() = 1 THEN 1 ELSE 0 END WHERE ${receipt}`,
      sql`INSERT INTO employee_profiles (employee_id, ${sql.join(columns.map(c => sql.identifier(c.name)), sql`, `)}, version, updated_at)
        SELECT ${employeeId}, ${sql.join(profileKeys.map(key => sql`${values[key] || (key === "dateOfBirth" ? null : "")}`), sql`, `)}, 1, ${stamp} WHERE ${receipt}
        ON CONFLICT (employee_id) DO UPDATE SET ${sql.join(columns.map(c => sql`${sql.identifier(c.name)} = excluded.${sql.identifier(c.name)}`), sql`, `)}, version = employee_profiles.version + 1, updated_at = ${stamp}`,
      sql`INSERT INTO workforce_write_checks (id, passed) SELECT ${`${id}:self-profile`}, CASE WHEN changes() = 1 THEN 1 ELSE 0 END WHERE ${receipt}`,
      sql`INSERT INTO audit_log (actor_account_id, employee_id, action, entity_type, entity_id, metadata, created_at)
        SELECT ${ctx.account.id}, ${employeeId}, 'employee.self_profile_changed', 'employee', ${String(employeeId)}, ${JSON.stringify({ fields: profileFields.map(f => f.key) })}, ${stamp} WHERE ${receipt}`,
      sql`DELETE FROM workforce_write_checks WHERE id IN (${`${id}:self-employee`}, ${`${id}:self-profile`}) AND ${receipt}`,
    ]);
    if (result[0].meta.changes !== 1) {
      const retry = await previous(); if (retry) return retry;
      throw new AuthError(409, "Your profile or access changed. Reload the saved profile before making another change.");
    }
    return { saved: true, id };
  }
  async function handle(request: Request) {
    try {
      const ctx = await context(request); const url = new URL(request.url);
      if (url.pathname === "/api/self/schedule-preferences") {
        if (url.search) throw new AuthError(400, "Preferences do not accept employee selectors.");
        if (request.method === "GET") return json(await readSchedulePreferences(db, ctx));
        if (request.method === "POST") return json(await saveSchedulePreferences(db, ctx, await readAuthBody(request, 4096), secret, now()));
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
      }
      if (url.pathname === "/api/self/schedule-alerts") {
        if (request.method === "GET") return json(await readScheduleAlerts(db, ctx, url));
        if (url.search) throw new AuthError(400, "Alerts do not accept selectors.");
        if (request.method === "POST") return json(await saveScheduleAlertReceipt(db, ctx, await readAuthBody(request, 4096), now()));
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
      }
      if (url.pathname === "/api/self/availability") {
        if (request.method === "GET") return json(await readMyAvailability(db, ctx, url, now()));
        if (url.search) throw new AuthError(400, "Availability does not accept employee selectors.");
        if (request.method === "POST") return json(await saveMyAvailability(db, ctx, await readAuthBody(request, 32768), secret, now()));
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
      }
      if (url.pathname === "/api/self/schedule") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        return json(await readEmployeeSchedule(db, ctx, url, now()));
      }
      if (url.pathname !== "/api/self/profile") throw new AuthError(404, "Not found.");
      if (url.search) throw new AuthError(400, "Your profile does not accept employee selectors.");
      if (request.method === "GET") return json(await read(ctx));
      if (request.method === "POST") return json(await save(ctx, await readAuthBody(request, 16384)));
      return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      console.error("Self profile request failed.");
      return json({ error: "Could not confirm your profile save or load. Reload the saved profile before making another change." }, 503);
    }
  }
  return { handle };
}
