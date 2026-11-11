import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { AuthError, isLoopback, json, readAuthBody } from "../auth/http";
import { dummyHash, newToken, tokenHash, tokenIsValid } from "../auth/crypto";
import { kioskCookie, readKioskCookie, registeredDevice } from "./device";
import type { RegisteredDevice } from "./device";
import { atomicBatch } from "./database";
import type { KioskOperatorDatabase } from "./database";
import { attemptBudget, exactKeys, pinIsValid, pinLookup, positiveId, releaseAttempt, verifyPin } from "./security";

type ClockType = "in" | "out" | "break" | "break_end";
type Person = { interaction: typeof schema.kioskInteractions.$inferSelect; employee: typeof schema.employees.$inferSelect };
type Approval = { accountId: number; sessionVersion: number; credentialRevision: string };
const expired = () => new AuthError(401, "Enter your employee PIN again.");
const eventAllowed = (last: string | null, next: ClockType) => last === null || last === "out" ? next === "in"
  : last === "break" ? next === "break_end" : next === "out" || next === "break";

export function createKioskService(db: KioskOperatorDatabase, options: { secret: string; now?: () => number }) {
  if (options.secret.length < 32) throw new Error("Kiosk configuration is unavailable.");
  const now = options.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();
  async function deviceFor(request: Request) {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
    const device = await registeredDevice(db, request.headers.get("cookie"), url, now());
    if (!device) throw new AuthError(401, "This tablet needs registration. Ask a manager.");
    return device;
  }
  function activeDevice(device: RegisteredDevice) {
    return sql`EXISTS (SELECT 1 FROM device_sessions ds JOIN kiosk_devices kd ON kd.id = ds.device_id
      WHERE ds.id = ${device.session.id} AND ds.revoked_at IS NULL AND kd.revoked_at IS NULL AND ds.expires_at > ${stamp()})`;
  }
  function activePerson(device: RegisteredDevice, person: Person) {
    return sql`${activeDevice(device)} AND EXISTS (SELECT 1 FROM kiosk_interactions ki JOIN employees e ON e.id = ki.employee_id
      WHERE ki.id = ${person.interaction.id} AND ki.device_session_id = ${device.session.id} AND ki.ended_at IS NULL
      AND ki.expires_at > ${stamp()} AND ki.pin_version = e.pin_version AND e.active = 1 AND e.terminated = 0 AND e.pin_lookup IS NOT NULL)`;
  }
  async function personFor(request: Request, device: RegisteredDevice): Promise<Person> {
    const token = readKioskCookie(request.headers.get("cookie"), new URL(request.url), "person");
    if (!tokenIsValid(token)) throw expired();
    const [person] = await db.select({ interaction: schema.kioskInteractions, employee: schema.employees }).from(schema.kioskInteractions)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.kioskInteractions.employeeId))
      .where(and(eq(schema.kioskInteractions.tokenHash, tokenHash(token)), eq(schema.kioskInteractions.deviceSessionId, device.session.id),
        isNull(schema.kioskInteractions.endedAt), sql`${schema.kioskInteractions.expiresAt} > ${stamp()}`,
        eq(schema.kioskInteractions.pinVersion, schema.employees.pinVersion), eq(schema.employees.active, true), eq(schema.employees.terminated, false),
        sql`${schema.employees.pinLookup} IS NOT NULL`)).limit(1);
    if (!person) throw expired();
    return person;
  }
  async function rolesFor(employeeId: number) {
    return db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.employeeRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.employeeRoles.roleId))
      .innerJoin(schema.departments, eq(schema.departments.id, schema.roles.departmentId))
      .where(and(eq(schema.employeeRoles.employeeId, employeeId), eq(schema.employeeRoles.active, true),
        eq(schema.roles.archived, false), eq(schema.departments.archived, false))).orderBy(schema.roles.id);
  }
  async function lastEvent(employeeId: number) {
    const [event] = await db.select().from(schema.clockEvents).where(eq(schema.clockEvents.employeeId, employeeId)).orderBy(desc(schema.clockEvents.id)).limit(1);
    return event ?? null;
  }
  async function lock(device: RegisteredDevice) {
    await atomicBatch(db, [
      db.update(schema.kioskInteractions).set({ endedAt: stamp() }).where(and(eq(schema.kioskInteractions.deviceSessionId, device.session.id), isNull(schema.kioskInteractions.endedAt))),
      db.update(schema.kioskApprovalSessions).set({ usedAt: stamp() }).where(and(eq(schema.kioskApprovalSessions.deviceSessionId, device.session.id), isNull(schema.kioskApprovalSessions.usedAt))),
    ]);
  }
  async function signIn(request: Request, device: RegisteredDevice, pin: unknown) {
    if (!pinIsValid(pin)) throw new AuthError(401, "Invalid employee PIN.");
    const lookup = pinLookup(options.secret, pin);
    const deviceAttempt = await attemptBudget(db, options.secret, `employee-device:${device.device.id}`, 20, now());
    const pinAttempt = await attemptBudget(db, options.secret, `employee-pin:${lookup}`, 5, now());
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.pinLookup, lookup)).limit(1);
    const valid = await verifyPin(options.secret, pin, employee?.pinHash ?? dummyHash);
    if (!valid || !employee?.active || employee.terminated) throw new AuthError(401, "Invalid employee PIN.");
    const [settings] = await db.select({ seconds: schema.locationSettings.kioskIdleSeconds }).from(schema.locationSettings).limit(1);
    // Bounded person sessions never inherit the persistent device lifetime.
    const seconds = Math.max(5, Math.min(120, settings?.seconds ?? 30));
    const token = newToken(); const id = newToken(); const expiresAt = new Date(now() + seconds * 1000).toISOString();
    const results = await atomicBatch(db, [
      db.update(schema.kioskInteractions).set({ endedAt: stamp() }).where(and(eq(schema.kioskInteractions.deviceSessionId, device.session.id), isNull(schema.kioskInteractions.endedAt))),
      sql`INSERT INTO kiosk_interactions (id, device_session_id, employee_id, pin_version, token_hash, expires_at, created_at)
        SELECT ${id}, ${device.session.id}, id, pin_version, ${tokenHash(token)}, ${expiresAt}, ${stamp()}
        FROM employees WHERE id = ${employee.id} AND active = 1 AND terminated = 0 AND pin_hash = ${employee.pinHash}
        AND pin_version = ${employee.pinVersion} AND ${activeDevice(device)}`,
    ]);
    if (results[1].meta.changes !== 1) throw expired();
    await releaseAttempt(db, deviceAttempt); await releaseAttempt(db, pinAttempt);
    const event = await lastEvent(employee.id);
    return json({ employee: { id: employee.id, name: employee.name }, roles: await rolesFor(employee.id),
      state: event?.eventType ?? "out", expiresAt }, 200, { "Set-Cookie": kioskCookie(new URL(request.url), "person", token, seconds) });
  }
  function approvalActor(approval: Approval, roleId: number | null): SQL {
    return sql`EXISTS (SELECT 1 FROM accounts a JOIN manager_approval_credentials mc ON mc.account_id = a.id
      WHERE a.id = ${approval.accountId} AND a.session_version = ${approval.sessionVersion} AND a.login_enabled = 1
      AND a.disabled_at IS NULL AND mc.revision = ${approval.credentialRevision} AND mc.revision <> 'legacy-unenrolled'
      AND (a.access_level = 'owner' OR (a.access_level IN ('general_manager', 'manager')
        AND NOT EXISTS (SELECT 1 FROM account_permissions ap WHERE ap.account_id = a.id AND ap.permission = 'kiosk.approve' AND ap.allowed = 0)))
      AND (a.access_level IN ('owner', 'general_manager') OR EXISTS (
        SELECT 1 FROM department_managers dm JOIN departments d ON d.id = dm.department_id JOIN roles r ON r.department_id = d.id
        WHERE dm.account_id = a.id AND r.id = ${roleId} AND r.archived = 0 AND d.archived = 0)))`;
  }
  async function commitClock(device: RegisteredDevice, person: Person, pending: typeof schema.kioskClockRequests.$inferSelect, approval?: Approval) {
    const time = stamp();
    const guard = sql`${activePerson(device, person)} AND EXISTS (SELECT 1 FROM kiosk_clock_requests cr
      WHERE cr.id = ${pending.id} AND cr.interaction_id = ${person.interaction.id} AND cr.completed_at IS NULL
      AND cr.cancelled_at IS NULL AND cr.expires_at > ${time})
      AND COALESCE((SELECT MAX(id) FROM clock_events WHERE employee_id = ${person.employee.id}), 0) = ${pending.previousEventId ?? 0}
      AND (${pending.eventType !== "in" ? 1 : 0} = 1 OR EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id
        JOIN departments d ON d.id = r.department_id WHERE er.employee_id = ${person.employee.id} AND er.role_id = ${pending.roleId}
        AND er.active = 1 AND r.archived = 0 AND d.archived = 0))
      AND (${pending.eventType !== "in" || pending.requiresApproval ? 1 : 0} = 1 OR EXISTS (SELECT 1 FROM shifts s
        WHERE s.id = ${pending.shiftId} AND s.employee_id = ${person.employee.id} AND s.role_id = ${pending.roleId}
        AND s.publication_id IS NOT NULL AND s.archived_at IS NULL))
      AND ${pending.requiresApproval ? (approval ? approvalActor(approval, pending.roleId) : sql`0 = 1`) : sql`1 = 1`}`;
    const result = await atomicBatch(db, [
      sql`INSERT INTO clock_events (employee_id, event_type, occurred_at, shift_id, role_name, explanation, source, device_id, recorded_by_account_id, received_at, idempotency_key)
        SELECT ${person.employee.id}, ${pending.eventType}, ${time}, ${pending.shiftId}, ${pending.roleName}, ${pending.explanation}, 'kiosk', ${device.device.id}, ${approval?.accountId ?? null}, ${time}, ${pending.id}
        WHERE ${guard}`,
      ...(approval ? [sql`INSERT INTO kiosk_approval_sessions (id, device_session_id, account_id, session_version, credential_revision, token_hash, action, target_id, expires_at, used_at, created_at)
        SELECT ${newToken()}, ${device.session.id}, ${approval.accountId}, ${approval.sessionVersion}, ${approval.credentialRevision}, ${tokenHash(newToken())}, ${`clock.${pending.eventType}`}, ${pending.id}, ${new Date(now() + 60000).toISOString()}, ${time}, ${time} WHERE changes() = 1`] : []),
      sql`INSERT INTO audit_log (actor_account_id, employee_id, device_id, action, entity_type, entity_id)
        SELECT ${approval?.accountId ?? null}, ${person.employee.id}, ${device.device.id}, ${approval ? "kiosk.clock_approved" : "kiosk.clock_recorded"}, 'clock_request', ${pending.id} WHERE changes() = 1`,
      sql`UPDATE kiosk_clock_requests SET completed_at = ${time} WHERE id = ${pending.id} AND changes() = 1 AND completed_at IS NULL`,
      sql`UPDATE kiosk_interactions SET ended_at = ${time} WHERE id = ${person.interaction.id} AND changes() = 1`,
    ]);
    if (result[0].meta.changes !== 1) throw new AuthError(409, "The clock or access changed. Enter your PIN and try again.");
    return { recorded: true, eventType: pending.eventType };
  }
  async function prepareClock(device: RegisteredDevice, person: Person, body: Record<string, unknown>) {
    exactKeys(body, ["eventType", "roleId", "explanation"]);
    if (!["in", "out", "break", "break_end"].includes(String(body.eventType))) throw new AuthError(400, "Choose a clock action.");
    const eventType = body.eventType as ClockType;
    const previous = await lastEvent(person.employee.id);
    if (!eventAllowed(previous?.eventType ?? null, eventType)) throw new AuthError(409, "Your clock status changed. Enter your PIN again.");
    if (typeof body.explanation !== "string" || body.explanation.length > 1000) throw new AuthError(400, "Use an explanation of up to 1,000 characters.");
    let roleId: number | null = null; let roleName = previous?.roleName ?? ""; let shiftId = previous?.shiftId ?? null;
    let requiresApproval = false; let approvalReason = "";
    if (eventType === "in") {
      roleId = positiveId(body.roleId);
      const role = (await rolesFor(person.employee.id)).find(role => role.id === roleId);
      if (!role) throw new AuthError(403, "Choose one of your active job roles.");
      roleName = role.name;
      const [business] = await db.select({ zone: schema.business.timeZone }).from(schema.business).limit(1);
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: business?.zone ?? "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now()));
      const part = (name: string) => parts.find(part => part.type === name)!.value;
      const localTime = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
      const [settings] = await db.select({ early: schema.locationSettings.earlyClockInMinutes }).from(schema.locationSettings).limit(1);
      const shifts = await db.select().from(schema.shifts).where(and(eq(schema.shifts.employeeId, person.employee.id), eq(schema.shifts.roleId, roleId), isNull(schema.shifts.archivedAt), sql`${schema.shifts.publicationId} IS NOT NULL`, sql`${schema.shifts.date} BETWEEN date(${localTime.slice(0, 10)}, '-1 day') AND ${localTime.slice(0, 10)}`));
      const shift = shifts.find(shift => {
        const start = new Date(`${shift.date}T${shift.startTime}:00Z`);
        const end = new Date(`${shift.date}T${shift.endTime}:00Z`);
        if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
        start.setUTCMinutes(start.getUTCMinutes() - (settings?.early ?? 5));
        const clock = new Date(`${localTime}:00Z`);
        return clock >= start && clock < end;
      });
      shiftId = shift?.id ?? null;
      requiresApproval = !shift;
      approvalReason = requiresApproval ? "Clock-in is outside a published shift. A manager must approve it." : "";
    } else if (body.roleId !== undefined && body.roleId !== null) throw new AuthError(400, "A job role is chosen only when clocking in.");
    const id = newToken();
    const result = await atomicBatch(db, [
      db.update(schema.kioskClockRequests).set({ cancelledAt: stamp() }).where(and(eq(schema.kioskClockRequests.interactionId, person.interaction.id), isNull(schema.kioskClockRequests.completedAt), isNull(schema.kioskClockRequests.cancelledAt))),
      sql`INSERT INTO kiosk_clock_requests (id, interaction_id, event_type, role_id, shift_id, role_name, previous_event_id, explanation, requires_approval, approval_reason, expires_at, created_at)
        SELECT ${id}, ${person.interaction.id}, ${eventType}, ${roleId}, ${shiftId}, ${roleName}, ${previous?.id ?? null}, ${body.explanation.trim()}, ${requiresApproval ? 1 : 0}, ${approvalReason}, ${person.interaction.expiresAt}, ${stamp()}
        WHERE ${activePerson(device, person)}`,
    ]);
    if (result[1].meta.changes !== 1) throw expired();
    const [pending] = await db.select().from(schema.kioskClockRequests).where(eq(schema.kioskClockRequests.id, id));
    return pending;
  }
  async function approve(device: RegisteredDevice, person: Person, body: Record<string, unknown>) {
    exactKeys(body, ["requestId", "pin"]);
    if (!tokenIsValid(body.requestId) || !pinIsValid(body.pin)) throw new AuthError(401, "Invalid manager approval PIN.");
    const [pending] = await db.select().from(schema.kioskClockRequests).where(and(eq(schema.kioskClockRequests.id, body.requestId), eq(schema.kioskClockRequests.interactionId, person.interaction.id), eq(schema.kioskClockRequests.requiresApproval, true), isNull(schema.kioskClockRequests.completedAt), isNull(schema.kioskClockRequests.cancelledAt), sql`${schema.kioskClockRequests.expiresAt} > ${stamp()}`)).limit(1);
    if (!pending) throw new AuthError(409, "This approval request is no longer available. Enter your employee PIN again.");
    const lookup = pinLookup(options.secret, body.pin);
    const deviceAttempt = await attemptBudget(db, options.secret, `approval-device:${device.device.id}`, 10, now());
    const pinAttempt = await attemptBudget(db, options.secret, `approval-pin:${lookup}`, 5, now());
    const [credential] = await db.select().from(schema.managerApprovalCredentials).where(eq(schema.managerApprovalCredentials.pinLookup, lookup));
    const valid = await verifyPin(options.secret, body.pin, credential?.pinHash ?? dummyHash);
    if (!valid || !credential || credential.revision === "legacy-unenrolled") throw new AuthError(401, "Invalid manager approval PIN.");
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, credential.accountId));
    if (!account) throw new AuthError(401, "Invalid manager approval PIN.");
    const approval = { accountId: account.id, sessionVersion: account.sessionVersion, credentialRevision: credential.revision };
    const eligible = await db.get(sql`SELECT 1 AS allowed WHERE ${approvalActor(approval, pending.roleId)}`);
    if (!eligible) throw new AuthError(403, "This manager cannot approve this clock request.");
    const result = await commitClock(device, person, pending, approval);
    await releaseAttempt(db, deviceAttempt); await releaseAttempt(db, pinAttempt);
    return result;
  }
  async function handle(request: Request) {
    try {
      const url = new URL(request.url); const action = url.pathname.slice("/api/kiosk/".length);
      if (!["status", "pin", "lock", "clock", "approve"].includes(action)) throw new AuthError(404, "Not found.");
      const device = await deviceFor(request);
      if (action === "status" && request.method === "GET") return json({ registered: true, deviceName: device.device.name });
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: action === "status" ? "GET" : "POST" });
      const body = await readAuthBody(request);
      if (action === "lock") { exactKeys(body, []); await lock(device); return json({ locked: true }, 200, { "Set-Cookie": kioskCookie(url, "person", "", 0) }); }
      if (action === "pin") { exactKeys(body, ["pin"]); return await signIn(request, device, body.pin); }
      const person = await personFor(request, device);
      let result;
      if (action === "approve") result = await approve(device, person, body);
      else if (action === "clock") {
        const pending = await prepareClock(device, person, body);
        if (pending.requiresApproval) return json({ approvalRequired: true, requestId: pending.id, reason: pending.approvalReason }, 202);
        result = await commitClock(device, person, pending);
      } else throw new AuthError(405, "Method not allowed.");
      return json(result, 200, { "Set-Cookie": kioskCookie(url, "person", "", 0) });
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      console.error("Kiosk request failed.");
      return json({ error: "The time clock is unavailable. Nothing is confirmed until you see a success message. Try again." }, 503);
    }
  }
  return { handle };
}
