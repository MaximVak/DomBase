import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { AuthError, json, readAuthBody, sessionCookie } from "../auth/http";
import { dummyHash, newToken, rateKey, tokenHash, tokenIsValid, verifyPassword } from "../auth/crypto";
import type { createAccessService } from "../access/service";
import { deviceSeconds, kioskCookie, registeredDevice } from "./device";
import { atomicBatch } from "./database";
import type { KioskOperatorDatabase } from "./database";
import { KioskRateLimitError, attemptBudget, exactKeys, hashPin, pinIsValid, pinLookup, positiveId } from "./security";

type Access = ReturnType<typeof createAccessService>;
type Actor = Awaited<ReturnType<Access["authorize"]>>;
export function createKioskAdmin(db: KioskOperatorDatabase, access: Access, secret: string) {
  if (secret.length < 32) throw new Error("Kiosk configuration is unavailable.");
  async function reauthenticate(actor: Actor, password: unknown) {
    await attemptBudget(db, secret, `reauth:${actor.account.id}`, 5);
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, actor.account.id)).limit(1);
    const valid = await verifyPassword(typeof password === "string" && password.length <= 512 ? password : "", account?.passwordHash ?? dummyHash);
    if (!valid || !account?.loginEnabled || account.disabledAt) throw new AuthError(401, "Confirm your current dashboard password.");
    await db.delete(schema.authRateLimits).where(eq(schema.authRateLimits.keyHash, rateKey(secret, `kiosk:reauth:${actor.account.id}`)));
  }
  function audit(actor: Actor, action: string, entityType: string, entityId: string, guard = actor.activeActor(), employeeId: number | null = null) {
    return sql`INSERT INTO audit_log (actor_account_id, employee_id, action, entity_type, entity_id)
      SELECT ${actor.account.id}, ${employeeId}, ${action}, ${entityType}, ${entityId} WHERE ${guard}`;
  }
  async function handle(request: Request) {
    try {
      const url = new URL(request.url);
      const action = url.pathname.slice("/api/kiosk-admin/".length);
      if (!["devices", "register", "revoke", "employee-pin", "approval-pin"].includes(action)) throw new AuthError(404, "Not found.");
      if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use your dashboard on another browser to manage tablets.");
      const actor = await access.authorize(request, action === "approval-pin" ? "kiosk.approve" : "kiosk.manage");
      if (action === "devices" && request.method === "GET") return json({
        devices: await db.select({ id: schema.kioskDevices.id, name: schema.kioskDevices.name, registeredAt: schema.kioskDevices.registeredAt, revokedAt: schema.kioskDevices.revokedAt }).from(schema.kioskDevices).orderBy(schema.kioskDevices.registeredAt).limit(200),
        employees: await db.select({ id: schema.employees.id, name: schema.employees.name, enrolled: sql<boolean>`${schema.employees.pinLookup} IS NOT NULL` }).from(schema.employees)
          .where(and(eq(schema.employees.active, true), eq(schema.employees.terminated, false), actor.employeeFilter(schema.employees.id))).orderBy(schema.employees.name).limit(500),
      });
      if (action === "approval-pin" && request.method === "GET") {
        const [credential] = await db.select({ id: schema.managerApprovalCredentials.accountId }).from(schema.managerApprovalCredentials).where(eq(schema.managerApprovalCredentials.accountId, actor.account.id));
        return json({ enrolled: !!credential, displayName: actor.account.displayName });
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: action === "approval-pin" ? "GET, POST" : "POST" });
      const body = await readAuthBody(request);
      const time = new Date().toISOString();
      if (action === "register") {
        exactKeys(body, ["name", "password"]);
        if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) throw new AuthError(400, "Name the tablet (up to 80 characters).");
        await reauthenticate(actor, body.password);
        const deviceId = newToken(); const sessionId = newToken(); const token = newToken();
        const receipt = sql`EXISTS (SELECT 1 FROM kiosk_devices WHERE id = ${deviceId})`;
        const results = await atomicBatch(db, [
          sql`INSERT INTO kiosk_devices (id, name, registered_by_account_id, registered_at)
            SELECT ${deviceId}, ${body.name.trim()}, ${actor.account.id}, ${time} WHERE ${actor.activeActor()}`,
          sql`INSERT INTO device_sessions (id, device_id, token_hash, expires_at, created_at)
            SELECT ${sessionId}, ${deviceId}, ${tokenHash(token)}, ${new Date(Date.now() + deviceSeconds * 1000).toISOString()}, ${time} WHERE ${receipt}`,
          audit(actor, "kiosk.registered", "kiosk_device", deviceId, receipt),
          sql`UPDATE account_sessions SET revoked_at = ${time} WHERE id = ${actor.sessionId} AND ${receipt}`,
        ]);
        if (results[0].meta.changes !== 1) throw new AuthError(409, "Your access changed. Sign in again.");
        const response = json({ registered: true }, 200, { "Set-Cookie": kioskCookie(url, "device", token, deviceSeconds) });
        response.headers.append("Set-Cookie", sessionCookie(url, "", 0));
        response.headers.append("Set-Cookie", kioskCookie(url, "person", "", 0));
        return response;
      }
      if (action === "revoke") {
        exactKeys(body, ["deviceId"]);
        if (!tokenIsValid(body.deviceId)) throw new AuthError(400, "Choose a valid tablet.");
        const id = body.deviceId;
        const results = await atomicBatch(db, [
          db.update(schema.kioskDevices).set({ revokedAt: time }).where(and(eq(schema.kioskDevices.id, id), isNull(schema.kioskDevices.revokedAt), actor.activeActor())),
          sql`UPDATE device_sessions SET revoked_at = ${time} WHERE device_id = ${id} AND EXISTS (SELECT 1 FROM kiosk_devices WHERE id = ${id} AND revoked_at IS NOT NULL)`,
          sql`UPDATE kiosk_interactions SET ended_at = ${time} WHERE device_session_id IN (SELECT id FROM device_sessions WHERE device_id = ${id} AND revoked_at IS NOT NULL)`,
          audit(actor, "kiosk.revoked", "kiosk_device", id, sql`${actor.activeActor()} AND EXISTS (SELECT 1 FROM kiosk_devices WHERE id = ${id} AND revoked_at = ${time})`),
        ]);
        if (results[0].meta.changes !== 1) throw new AuthError(409, "This tablet is already revoked or no longer available.");
        return json({ revoked: true });
      }
      if (action === "employee-pin" || action === "approval-pin") {
        exactKeys(body, action === "employee-pin" ? ["employeeId", "pin", "password"] : ["password"]);
        if (action === "employee-pin" && !pinIsValid(body.pin)) throw new AuthError(400, "Use 4–8 digits. An all-zero PIN is not allowed.");
        const employeeId = action === "employee-pin" ? positiveId(body.employeeId) : null;
        if (employeeId !== null) await actor.requireEmployee(employeeId);
        await reauthenticate(actor, body.password);
        if (employeeId === null) {
          // No caller-selected candidate reaches either lookup table. Both PIN
          // namespaces stay distinct without exposing an employee-PIN oracle.
          for (let attempt = 0; attempt < 8; attempt++) {
            const pin = String(randomInt(10000000, 100000000));
            const lookup = pinLookup(secret, pin); const hash = await hashPin(secret, pin); const revision = newToken();
            const guard = sql`${actor.activeActor()} AND NOT EXISTS (SELECT 1 FROM employees WHERE pin_lookup = ${lookup})
              AND NOT EXISTS (SELECT 1 FROM manager_approval_credentials WHERE pin_lookup = ${lookup} AND account_id <> ${actor.account.id})`;
            const results = await atomicBatch(db, [
              sql`INSERT INTO manager_approval_credentials (account_id, pin_hash, pin_lookup, revision, created_at, updated_at)
                SELECT ${actor.account.id}, ${hash}, ${lookup}, ${revision}, ${time}, ${time} WHERE ${guard}
                ON CONFLICT(account_id) DO UPDATE SET pin_hash = excluded.pin_hash, pin_lookup = excluded.pin_lookup, revision = excluded.revision, updated_at = excluded.updated_at`,
              audit(actor, "kiosk.approval_pin_changed", "account", String(actor.account.id), sql`EXISTS (SELECT 1 FROM manager_approval_credentials WHERE account_id = ${actor.account.id} AND revision = ${revision})`),
            ]);
            if (results[0].meta.changes === 1) return json({ saved: true, pin });
            if (!await db.get(sql`SELECT 1 WHERE ${actor.activeActor()}`)) throw new AuthError(409, "Your access changed. Sign in again.");
          }
          throw new AuthError(503, "Could not generate an approval PIN. Try again shortly.");
        }
        const pin = body.pin as string;
        const lookup = pinLookup(secret, pin); const hash = await hashPin(secret, pin);
        const guard = sql`${actor.activeActor()} AND NOT EXISTS (SELECT 1 FROM manager_approval_credentials WHERE pin_lookup = ${lookup})
          AND NOT EXISTS (SELECT 1 FROM employees WHERE pin_lookup = ${lookup} AND id <> ${employeeId})`;
        const results = await atomicBatch(db, [
          db.update(schema.employees).set({ pinHash: hash, pinLookup: lookup, pinVersion: sql`${schema.employees.pinVersion} + 1`, version: sql`${schema.employees.version} + 1`, updatedAt: time })
            .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.active, true), eq(schema.employees.terminated, false), actor.employeeFilter(schema.employees.id), guard)),
          sql`UPDATE kiosk_interactions SET ended_at = ${time} WHERE employee_id = ${employeeId} AND EXISTS (SELECT 1 FROM employees WHERE id = ${employeeId} AND pin_hash = ${hash})`,
          audit(actor, "kiosk.employee_pin_changed", "employee", String(employeeId), sql`EXISTS (SELECT 1 FROM employees WHERE id = ${employeeId} AND pin_hash = ${hash})`, employeeId),
        ]);
        if (results[0].meta.changes !== 1) throw new AuthError(409, "PIN unavailable or employee access changed. Choose another PIN or reload.");
        return json({ saved: true });
      }
      throw new AuthError(404, "Not found.");
    } catch (error) {
      if (error instanceof KioskRateLimitError) return json({ error: error.message }, error.status, { "Retry-After": String(error.retryAfterSeconds) });
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      console.error("Tablet administration request failed.");
      return json({ error: "Tablet settings are temporarily unavailable. Try again shortly." }, 503);
    }
  }
  return { handle };
}
