import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { AuthError, isLoopback, json, readAuthBody, readSessionCookie } from "../auth/http";
import { newToken } from "../auth/crypto";
import type { createAuthService } from "../auth/service";
import type { DashboardAccount } from "../auth/types";
import { isPermission, permissionsFor } from "./policy";
import type { Permission, PermissionMap } from "./policy";
import { registeredDevice } from "../kiosk/device";
import { createAccountLifecycle } from "./accounts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
type Auth = Pick<ReturnType<typeof createAuthService>, "getSession">;
export type Context = {
  account: DashboardAccount;
  sessionId: string;
  version: number;
  permissions: PermissionMap;
  departmentIds: number[];
  allDepartments: boolean;
};

function positiveId(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new AuthError(404, "Not found.");
  return Number(value);
}

export function createAccessService(db: Database, auth: Auth) {
  async function context(request: Request): Promise<Context> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
    if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "This browser is registered as a clock tablet.");
    const session = await auth.getSession(readSessionCookie(request.headers.get("cookie"), url));
    if (!session) throw new AuthError(401, "Sign in to continue.");
    // Recheck the version after authentication: changes must not leave stale grants.
    const [current] = await db.select({ account: schema.accounts }).from(schema.accounts)
      .innerJoin(schema.accountSessions, eq(schema.accountSessions.accountId, schema.accounts.id))
      .where(and(eq(schema.accountSessions.id, session.sessionId), isNull(schema.accountSessions.revokedAt),
        eq(schema.accountSessions.sessionVersion, schema.accounts.sessionVersion), eq(schema.accounts.loginEnabled, true),
        isNull(schema.accounts.disabledAt))).limit(1);
    if (!current || !["owner", "general_manager", "manager"].includes(current.account.accessLevel)) throw new AuthError(401, "Sign in to continue.");
    const overrides = await db.select().from(schema.accountPermissions).where(eq(schema.accountPermissions.accountId, current.account.id));
    const departments = await db.select({ id: schema.departments.id }).from(schema.departmentManagers)
      .innerJoin(schema.departments, eq(schema.departmentManagers.departmentId, schema.departments.id))
      .where(and(eq(schema.departmentManagers.accountId, current.account.id), eq(schema.departments.archived, false)));
    return { account: { id: current.account.id, employeeId: current.account.employeeId, email: current.account.email,
      displayName: current.account.displayName, accessLevel: current.account.accessLevel as DashboardAccount["accessLevel"] },
      sessionId: session.sessionId, version: current.account.sessionVersion,
      permissions: permissionsFor(current.account.accessLevel, overrides), departmentIds: departments.map(row => row.id),
      allDepartments: current.account.accessLevel !== "manager" };
  }

  function requirePermission(ctx: Context, permission: Permission) {
    if (!ctx.permissions[permission]) throw new AuthError(403, "You do not have access to this action.");
  }

  function requireOwner(ctx: Context) {
    if (ctx.account.accessLevel !== "owner") throw new AuthError(403, "Only an Owner can manage account access.");
  }

  // Resource filters are built from stored assignments, never request IDs/roles.
  function roleScope(ctx: Context, roleId: SQLWrapper): SQL {
    if (ctx.allDepartments) return sql`1 = 1`;
    if (!ctx.departmentIds.length) return sql`0 = 1`;
    return sql`EXISTS (SELECT 1 FROM roles r JOIN departments d ON d.id = r.department_id
      WHERE r.id = ${roleId} AND r.archived = 0 AND d.archived = 0 AND ${inArray(sql`d.id`, ctx.departmentIds)})`;
  }

  function employeeScope(ctx: Context, employeeId: SQLWrapper): SQL {
    if (ctx.allDepartments) return sql`1 = 1`;
    if (!ctx.departmentIds.length) return sql`0 = 1`;
    return sql`EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id
      JOIN departments d ON d.id = r.department_id WHERE er.employee_id = ${employeeId}
      AND er.active = 1 AND r.archived = 0 AND d.archived = 0 AND ${inArray(sql`d.id`, ctx.departmentIds)})`;
  }

  async function requireEmployee(ctx: Context, employeeId: number, permission: Permission) {
    requirePermission(ctx, permission);
    const [row] = await db.select({ id: schema.employees.id }).from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), employeeScope(ctx, schema.employees.id))).limit(1);
    if (!row) throw new AuthError(404, "Not found.");
  }

  function activeActor(ctx: Context): SQL {
    return sql`EXISTS (SELECT 1 FROM accounts a JOIN account_sessions s ON s.account_id = a.id
      WHERE a.id = ${ctx.account.id} AND a.session_version = ${ctx.version} AND a.login_enabled = 1
      AND a.employee_id IS ${ctx.account.employeeId}
      AND a.disabled_at IS NULL AND a.access_level = ${ctx.account.accessLevel} AND s.id = ${ctx.sessionId}
      AND s.session_version = a.session_version AND s.revoked_at IS NULL AND s.expires_at > ${new Date().toISOString()}
      AND julianday(COALESCE(s.last_seen_at, s.created_at)) > julianday(${new Date(Date.now() - 30 * 60000).toISOString()}))`;
  }

  const accountFields = { id: schema.accounts.id, employeeId: schema.accounts.employeeId, email: schema.accounts.email,
    displayName: schema.accounts.displayName, accessLevel: schema.accounts.accessLevel, version: schema.accounts.sessionVersion,
    loginEnabled: schema.accounts.loginEnabled, disabledAt: schema.accounts.disabledAt };

  function auditInsert(ctx: Context, action: string, entityId: number, metadata: Record<string, unknown>, guard: SQL, employeeId: number | null = null) {
    return db.insert(schema.auditLog).select(db.select({
      id: sql<number>`NULL`.as("id"), actorAccountId: sql<number>`${ctx.account.id}`.as("actorAccountId"), employeeId: sql<number | null>`${employeeId}`.as("employeeId"),
      deviceId: sql<string | null>`NULL`.as("deviceId"), action: sql<string>`${action}`.as("action"),
      entityType: sql<string>`${employeeId === null ? "account" : "employee"}`.as("entityType"), entityId: sql<string>`${String(entityId)}`.as("entityId"),
      metadata: sql<Record<string, unknown>>`${JSON.stringify(metadata)}`.as("metadata"), createdAt: sql<string>`${new Date().toISOString()}`.as("createdAt"),
    }).from(sql`(SELECT 1)`).where(guard));
  }

  async function accountAccess(ctx: Context, id: number) {
    requireOwner(ctx);
    const [account] = await db.select(accountFields).from(schema.accounts).where(eq(schema.accounts.id, id)).limit(1);
    if (!account) throw new AuthError(404, "Not found.");
    const overrides = await db.select({ permission: schema.accountPermissions.permission, allowed: schema.accountPermissions.allowed })
      .from(schema.accountPermissions).where(eq(schema.accountPermissions.accountId, id));
    const assignments = await db.select({ id: schema.departmentManagers.departmentId }).from(schema.departmentManagers)
      .innerJoin(schema.departments, eq(schema.departments.id, schema.departmentManagers.departmentId))
      .where(and(eq(schema.departmentManagers.accountId, id), eq(schema.departments.archived, false)));
    return { account, permissions: permissionsFor(account.accessLevel, overrides), departmentIds: account.accessLevel === "manager" ? assignments.map(row => row.id) : [] };
  }

  async function updateAccess(ctx: Context, id: number, body: Record<string, unknown>) {
    requireOwner(ctx);
    if (Object.keys(body).some(key => !["version", "permissions", "departmentIds"].includes(key))) throw new AuthError(400, "Unexpected access setting.");
    const target = await accountAccess(ctx, id);
    if (!["manager", "general_manager"].includes(target.account.accessLevel)) throw new AuthError(403, "Owner and employee access cannot be changed here.");
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1 || !body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions)) throw new AuthError(400, "Invalid access settings.");
    const entries = Object.entries(body.permissions);
    if (entries.length > 30 || entries.some(([key, value]) => !isPermission(key) || typeof value !== "boolean")) throw new AuthError(400, "Unknown permission or invalid value.");
    if (!Array.isArray(body.departmentIds) || body.departmentIds.length > 100 || body.departmentIds.some(id => !Number.isSafeInteger(id) || id < 1)
      || new Set(body.departmentIds).size !== body.departmentIds.length) throw new AuthError(400, "Invalid departments.");
    const departmentIds = body.departmentIds as number[];
    if (target.account.accessLevel !== "manager" && departmentIds.length) throw new AuthError(400, "Only Managers have department assignments. General Managers have company-wide access.");
    if (departmentIds.length) {
      const found = await db.select({ id: schema.departments.id }).from(schema.departments).where(and(inArray(schema.departments.id, departmentIds), eq(schema.departments.archived, false)));
      if (found.length !== departmentIds.length) throw new AuthError(400, "Choose active departments.");
    }
    const revision = newToken();
    const time = new Date().toISOString();
    const receipt = sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${id} AND access_revision = ${revision})`;
    // Every statement shares this unique receipt. A lost CAS cannot overwrite the winner.
    const result = await db.batch([
      db.update(schema.accounts).set({ sessionVersion: sql`${schema.accounts.sessionVersion} + 1`, accessRevision: revision, updatedAt: time })
        .where(and(eq(schema.accounts.id, id), eq(schema.accounts.sessionVersion, Number(body.version)),
          inArray(schema.accounts.accessLevel, ["manager", "general_manager"]), activeActor(ctx))),
      db.delete(schema.accountPermissions).where(and(eq(schema.accountPermissions.accountId, id), receipt)),
      ...entries.map(([permission, allowed]) => db.insert(schema.accountPermissions).select(db.select({
        accountId: sql<number>`${id}`.as("accountId"), permission: sql<string>`${permission}`.as("permission"), allowed: sql<boolean>`${allowed ? 1 : 0}`.as("allowed"),
      }).from(schema.accounts).where(and(eq(schema.accounts.id, id), receipt)))),
      db.delete(schema.departmentManagers).where(and(eq(schema.departmentManagers.accountId, id), receipt)),
      ...departmentIds.map(departmentId => db.insert(schema.departmentManagers).select(db.select({
        departmentId: sql<number>`${departmentId}`.as("departmentId"), accountId: sql<number>`${id}`.as("accountId"),
      }).from(schema.accounts).where(and(eq(schema.accounts.id, id), receipt)))),
      db.update(schema.accountSessions).set({ revokedAt: time }).where(and(eq(schema.accountSessions.accountId, id), receipt)),
      auditInsert(ctx, "account.access_changed", id, { permissionKeys: entries.map(([key]) => key), departmentIds }, receipt),
    ]);
    if (result[0].meta.changes !== 1) throw new AuthError(409, "Access changed while you were editing. Reload and try again.");
    return accountAccess(ctx, id);
  }

  async function employeeRead(ctx: Context, id: number, section?: string) {
    await requireEmployee(ctx, id, "team.read");
    if (!section) {
      const [employee] = await db.select(employeeFields(ctx)).from(schema.employees).where(and(eq(schema.employees.id, id), employeeScope(ctx, schema.employees.id)));
      if (!employee) throw new AuthError(404, "Not found.");
      return { employee };
    }
    if (section === "wages") {
      requirePermission(ctx, "wages.read");
      const wages = await db.select({ id: schema.wageRates.id, employeeId: schema.wageRates.employeeId, roleId: schema.wageRates.roleId,
        basis: schema.wageRates.basis, amountCents: schema.wageRates.amountCents, effectiveDate: schema.wageRates.effectiveDate })
        .from(schema.wageRates).where(and(eq(schema.wageRates.employeeId, id), roleScope(ctx, schema.wageRates.roleId), employeeScope(ctx, schema.wageRates.employeeId))).limit(500);
      return { wages };
    }
    if (section === "profile") {
      requirePermission(ctx, "team.private.read");
      // ssnEncrypted is never returned, even to an Owner; no decrypt/collection flow exists.
      const p = schema.employeeProfiles;
      const [profile] = await db.select({ employeeId: p.employeeId, legalFirstName: p.legalFirstName, legalMiddleName: p.legalMiddleName,
        legalLastName: p.legalLastName, dateOfBirth: p.dateOfBirth, homeAddress: p.homeAddress, homeAddressLine2: p.homeAddressLine2,
        homeCity: p.homeCity, homeStateProvince: p.homeStateProvince, homePostalCode: p.homePostalCode,
        emergencyContact: p.emergencyContact, emergencyContactRelationship: p.emergencyContactRelationship,
        emergencyContactPhone: p.emergencyContactPhone, emergencyContactPreference: p.emergencyContactPreference, version: p.version })
        .from(p).where(and(eq(p.employeeId, id), employeeScope(ctx, p.employeeId)));
      return { profile: profile ?? null };
    }
    if (section === "notes") {
      requirePermission(ctx, "team.notes.read");
      const notes = await db.select({ id: schema.employeeNotes.id, body: schema.employeeNotes.body, createdAt: schema.employeeNotes.createdAt })
        .from(schema.employeeNotes).where(and(eq(schema.employeeNotes.employeeId, id), employeeScope(ctx, schema.employeeNotes.employeeId))).limit(500);
      return { notes };
    }
    if (section === "files") {
      requirePermission(ctx, "documents.read");
      const files = await db.select({ id: schema.files.id, fileName: schema.files.fileName, contentType: schema.files.contentType, sizeBytes: schema.files.sizeBytes })
        .from(schema.files).where(and(eq(schema.files.employeeId, id), eq(schema.files.status, "ready"), employeeScope(ctx, schema.files.employeeId),
          ctx.permissions["team.private.read"] ? sql`1 = 1` : sql`NOT EXISTS (SELECT 1 FROM document_uploads du WHERE du.file_id = ${schema.files.id} AND du.kind = 'onboarding')`)).limit(500);
      return { files }; // Never object keys, credential-bearing URLs or bytes.
    }
    throw new AuthError(404, "Not found.");
  }

  function employeeFields(ctx: Context) {
    return { id: schema.employees.id, name: schema.employees.name, active: schema.employees.active, terminated: schema.employees.terminated,
      version: schema.employees.version,
      ...(ctx.permissions["team.contact.read"] ? { email: schema.employees.email, phone: schema.employees.phone } : {}) };
  }

  async function updateContact(ctx: Context, id: number, body: Record<string, unknown>) {
    await requireEmployee(ctx, id, "team.manage");
    if (Object.keys(body).some(key => !["version", "email", "phone"].includes(key)) || !Number.isSafeInteger(body.version)
      || ![body.email, body.phone].every(value => typeof value === "string")
      || String(body.email).length > 254 || String(body.phone).length > 40) throw new AuthError(400, "Provide a version, email and phone only.");
    const changed = await db.batch([db.update(schema.employees).set({ email: String(body.email).trim(), phone: String(body.phone).trim(),
      version: sql`${schema.employees.version} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.employees.id, id), eq(schema.employees.version, Number(body.version)),
        employeeScope(ctx, schema.employees.id), activeActor(ctx))),
      // changes() refers only to the immediately preceding contact UPDATE in this batch.
      auditInsert(ctx, "employee.contact_changed", id, { fields: ["email", "phone"] }, sql`changes() = 1`, id),
    ]);
    if (changed[0].meta.changes !== 1) throw new AuthError(409, "The record or your access changed. Reload and try again.");
    return { updated: true };
  }

  async function workforce(ctx: Context, request: Request, segments: string[]) {
    const [resource, idString, section] = segments;
    if (segments.length > 3) throw new AuthError(404, "Not found.");
    if (request.method === "POST" && resource === "employees" && idString && section === "contact") return updateContact(ctx, positiveId(idString), await readAuthBody(request));
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (resource === "employees") {
      if (idString) return employeeRead(ctx, positiveId(idString), section);
      requirePermission(ctx, "team.read");
      return { employees: await db.select(employeeFields(ctx)).from(schema.employees).where(employeeScope(ctx, schema.employees.id)).orderBy(schema.employees.id).limit(500) };
    }
    if (resource === "shifts" && !idString) {
      requirePermission(ctx, "schedule.read");
      const s = schema.shifts;
      return { shifts: await db.select({ id: s.id, employeeId: s.employeeId, roleId: s.roleId, roleName: s.roleName, date: s.date,
        startTime: s.startTime, endTime: s.endTime, station: s.station, version: s.version,
        ...(ctx.permissions["schedule.notes.read"] ? { notes: s.notes } : {}) }).from(s)
        .where(and(isNull(s.archivedAt), roleScope(ctx, s.roleId), employeeScope(ctx, s.employeeId))).orderBy(s.id).limit(500) };
    }
    if (resource === "time-cards" && !idString) {
      requirePermission(ctx, "timesheets.read");
      const c = schema.timeCards;
      return { timeCards: await db.select({ id: c.id, employeeId: c.employeeId, roleId: c.roleId, roleName: c.roleName, workDate: c.workDate, source: c.source, version: c.version })
        .from(c).where(and(employeeScope(ctx, c.employeeId), roleScope(ctx, c.roleId))).orderBy(c.id).limit(500) };
    }
    if (resource === "time-off" && !idString) {
      requirePermission(ctx, "time_off.read");
      const p = schema.ptoRequests;
      return { requests: await db.select({ id: p.id, employeeId: p.employeeId, startDate: p.startDate, endDate: p.endDate, compensation: p.compensation, status: p.status, version: p.version })
        .from(p).where(and(isNull(p.archivedAt), employeeScope(ctx, p.employeeId))).orderBy(p.id).limit(500) };
    }
    if (resource === "conversations" && idString && section === "messages") {
      requirePermission(ctx, "messages.read");
      const id = positiveId(idString);
      if (!ctx.account.employeeId) throw new AuthError(404, "Not found.");
      const [member] = await db.select({ id: schema.conversationMembers.employeeId }).from(schema.conversationMembers)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
        .innerJoin(schema.employees, eq(schema.employees.id, schema.conversationMembers.employeeId))
        .where(and(eq(schema.conversationMembers.conversationId, id), eq(schema.conversationMembers.employeeId, ctx.account.employeeId),
          isNull(schema.conversationMembers.leftAt), isNull(schema.conversations.archivedAt), eq(schema.employees.active, true), eq(schema.employees.terminated, false))).limit(1);
      if (!member) throw new AuthError(404, "Not found.");
      const enabled = await db.select({ enabled: schema.locationSettings.enableTeamMessaging }).from(schema.locationSettings).limit(1);
      if (enabled[0]?.enabled === false) throw new AuthError(403, "Team messaging is disabled.");
      return { messages: await db.select({ id: schema.messages.id, senderEmployeeId: schema.messages.senderEmployeeId, body: schema.messages.body, sentAt: schema.messages.sentAt })
        .from(schema.messages).where(and(eq(schema.messages.conversationId, id), sql`EXISTS (
          SELECT 1 FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
          JOIN employees e ON e.id = cm.employee_id WHERE cm.conversation_id = ${schema.messages.conversationId}
          AND cm.employee_id = ${ctx.account.employeeId} AND cm.left_at IS NULL AND c.archived_at IS NULL AND e.active = 1 AND e.terminated = 0
        )`)).orderBy(schema.messages.id).limit(500) };
    }
    if (resource === "notifications" && !idString) {
      if (!ctx.account.employeeId) return { notifications: [] };
      return { notifications: await db.select({ id: schema.notifications.id, kind: schema.notifications.kind, title: schema.notifications.title,
        detail: schema.notifications.detail, openedAt: schema.notifications.openedAt }).from(schema.notifications)
        .where(eq(schema.notifications.employeeId, ctx.account.employeeId)).orderBy(schema.notifications.id).limit(500) };
    }
    throw new AuthError(404, "Not found.");
  }

  async function handle(request: Request) {
    try {
      const ctx = await context(request);
      const url = new URL(request.url);
      const segments = url.pathname.split("/").slice(3);
      const accessPath = url.pathname.startsWith("/api/access/");
      let result;
      if (!accessPath) result = await workforce(ctx, request, segments);
      else if (segments[0] === "me" && segments.length === 1 && request.method === "GET") {
        result = { account: ctx.account, permissions: ctx.permissions, departmentIds: ctx.departmentIds, allDepartments: ctx.allDepartments, canManageAccess: ctx.account.accessLevel === "owner" };
      } else if (segments[0] === "accounts") {
        requireOwner(ctx);
        if (segments.length === 1 && request.method === "GET") result = {
          accounts: await db.select(accountFields).from(schema.accounts).orderBy(schema.accounts.id).limit(500),
          departmentAssignments: await db.select({ accountId: schema.departmentManagers.accountId, departmentId: schema.departmentManagers.departmentId }).from(schema.departmentManagers)
            .innerJoin(schema.accounts, eq(schema.accounts.id, schema.departmentManagers.accountId))
            .innerJoin(schema.departments, eq(schema.departments.id, schema.departmentManagers.departmentId))
            .where(and(eq(schema.accounts.accessLevel, "manager"), eq(schema.departments.archived, false))),
          departments: await db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.archived, false)).orderBy(schema.departments.id).limit(500),
          employees: await db.select({ id: schema.employees.id, name: schema.employees.name }).from(schema.employees)
            .where(and(eq(schema.employees.active, true), eq(schema.employees.terminated, false))).orderBy(schema.employees.name).limit(500),
        };
        else if (segments.length === 1 && request.method === "POST") result = await lifecycle.create(ctx, await readAuthBody(request));
        else if (segments.length === 3 && segments[2] === "lifecycle" && request.method === "POST") result = await lifecycle.update(ctx, positiveId(segments[1]), await readAuthBody(request));
        else if (segments.length === 3 && segments[2] === "setup" && request.method === "POST") result = await lifecycle.setup(ctx, positiveId(segments[1]), await readAuthBody(request));
        else if (segments.length === 2 && request.method === "GET") result = await accountAccess(ctx, positiveId(segments[1]));
        else if (segments.length === 2 && request.method === "POST") result = await updateAccess(ctx, positiveId(segments[1]), await readAuthBody(request));
        else return json({ error: "Method not allowed." }, 405, { Allow: segments.length === 1 ? "GET" : "GET, POST" });
      } else throw new AuthError(404, "Not found.");
      return result instanceof Response ? result : json(result);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      console.error("Access request failed.");
      return json({ error: "This request is temporarily unavailable. Try again shortly." }, 503);
    }
  }

  const lifecycle = createAccountLifecycle(db, { activeActor, accountAccess });

  // Future workflow handlers must obtain these guards for each request, then
  // apply the returned filters/actor predicate inside their reads and mutations.
  async function authorize(request: Request, permission: Permission) {
    if (!isPermission(permission)) throw new AuthError(403, "Unknown permission.");
    const ctx = await context(request);
    requirePermission(ctx, permission);
    return {
      account: ctx.account,
      sessionId: ctx.sessionId,
      employeeFilter: (column: SQLWrapper) => employeeScope(ctx, column),
      roleFilter: (column: SQLWrapper) => roleScope(ctx, column),
      requireEmployee: (id: number) => requireEmployee(ctx, id, permission),
      activeActor: () => activeActor(ctx),
    };
  }

  async function workspaceContext(request: Request) {
    const ctx = await context(request);
    return {
      ...ctx,
      employeeFilter: (column: SQLWrapper) => employeeScope(ctx, column),
      roleFilter: (column: SQLWrapper) => roleScope(ctx, column),
      activeActor: () => activeActor(ctx),
      requirePermission: (permission: Permission) => requirePermission(ctx, permission),
      requireEmployee: (id: number, permission: Permission) => requireEmployee(ctx, id, permission),
    };
  }

  return { handle, authorize, workspaceContext };
}
