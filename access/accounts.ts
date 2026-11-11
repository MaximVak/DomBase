import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newToken, tokenHash } from "../auth/crypto";
import type { Context, Database } from "./service";
import { atomicBatch } from "../kiosk/database";

type Guards = {
  activeActor: (ctx: Context) => SQL;
  accountAccess: (ctx: Context, id: number) => Promise<unknown>;
};
const editableLevels = ["general_manager", "manager", "employee"];
function keys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AuthError(400, "Unexpected account setting.");
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AuthError(400, "Provide the current account version.");
  return Number(value);
}
function identity(body: Record<string, unknown>) {
  if (typeof body.email !== "string" || body.email.length > 254 || !/^[\x21-\x7e]+$/.test(body.email.trim())
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw new AuthError(400, "Enter a valid sign-in email.");
  if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.length > 100) throw new AuthError(400, "Enter a name up to 100 characters.");
  if (typeof body.accessLevel !== "string" || !editableLevels.includes(body.accessLevel)) throw new AuthError(400, "Choose Manager, General Manager or Employee.");
  if (body.employeeId !== null && (!Number.isSafeInteger(body.employeeId) || Number(body.employeeId) < 1)) throw new AuthError(400, "Choose an employee or no employee link.");
  if (!Array.isArray(body.departmentIds) || body.departmentIds.length > 100
    || body.departmentIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(body.departmentIds).size !== body.departmentIds.length) throw new AuthError(400, "Choose valid departments.");
  if (body.accessLevel !== "manager" && body.departmentIds.length) throw new AuthError(400, "Only department managers need department assignments.");
  return { email: body.email.trim(), normalizedEmail: body.email.trim().toLowerCase(), displayName: body.displayName.trim(),
    accessLevel: body.accessLevel as "general_manager" | "manager" | "employee", employeeId: body.employeeId as number | null, departmentIds: body.departmentIds as number[] };
}

export function createAccountLifecycle(db: Database, guards: Guards) {
  function owner(ctx: Context) {
    if (ctx.account.accessLevel !== "owner") throw new AuthError(403, "Only an Owner can manage accounts.");
  }
  function employeeGuard(employeeId: number | null): SQL {
    return employeeId === null ? sql`1 = 1` : sql`EXISTS (SELECT 1 FROM employees WHERE id = ${employeeId} AND active = 1 AND terminated = 0)`;
  }
  function departmentsGuard(ids: number[]): SQL {
    return ids.length ? sql`(SELECT COUNT(*) FROM departments WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND archived = 0) = ${ids.length}` : sql`1 = 1`;
  }
  function audit(ctx: Context, revision: string, action: string, metadata: Record<string, unknown>, stamp: string) {
    return sql`INSERT INTO audit_log (actor_account_id, action, entity_type, entity_id, metadata, created_at)
      SELECT ${ctx.account.id}, ${action}, 'account', CAST(id AS TEXT), ${JSON.stringify(metadata)}, ${stamp}
      FROM accounts WHERE access_revision = ${revision}`;
  }
  function invalidate(id: number, receipt: SQL, stamp: string) {
    return [
      sql`UPDATE account_sessions SET revoked_at = ${stamp} WHERE account_id = ${id} AND ${receipt}`,
      sql`UPDATE account_setup_tokens SET used_at = ${stamp} WHERE account_id = ${id} AND used_at IS NULL AND ${receipt}`,
      sql`UPDATE kiosk_approval_sessions SET used_at = ${stamp} WHERE account_id = ${id} AND used_at IS NULL AND ${receipt}`,
      // Never carry an old person's or a demoted manager's approval PIN forward.
      sql`DELETE FROM manager_approval_credentials WHERE account_id = ${id} AND ${receipt}`,
    ];
  }
  async function target(ctx: Context, id: number) {
    owner(ctx);
    const [row] = await db.select().from(s.accounts).where(eq(s.accounts.id, id)).limit(1);
    if (!row) throw new AuthError(404, "Account not found.");
    if (row.accessLevel === "owner") throw new AuthError(403, "Existing Owner accounts are protected. Ownership changes are not available here.");
    return row;
  }
  async function create(ctx: Context, body: Record<string, unknown>) {
    owner(ctx); keys(body, ["email", "displayName", "employeeId", "accessLevel", "departmentIds"]);
    const data = identity(body); const revision = newToken(); const stamp = new Date().toISOString();
    const result = await atomicBatch(db, [
      sql`INSERT INTO accounts (email, normalized_email, display_name, employee_id, access_level, access_revision, updated_at)
        SELECT ${data.email}, ${data.normalizedEmail}, ${data.displayName}, ${data.employeeId}, ${data.accessLevel}, ${revision}, ${stamp}
        WHERE ${guards.activeActor(ctx)} AND ${employeeGuard(data.employeeId)} AND ${departmentsGuard(data.departmentIds)}
        AND NOT EXISTS (SELECT 1 FROM accounts WHERE normalized_email = ${data.normalizedEmail} OR (employee_id IS NOT NULL AND employee_id = ${data.employeeId}))`,
      ...data.departmentIds.map(id => sql`INSERT INTO department_managers (department_id, account_id)
        SELECT ${id}, id FROM accounts WHERE access_revision = ${revision}`),
      audit(ctx, revision, "account.created", { accessLevel: data.accessLevel, employeeId: data.employeeId, departmentIds: data.departmentIds }, stamp),
    ]);
    if (result[0].meta.changes !== 1) throw new AuthError(409, "Email or employee is already linked, the employee/department is inactive, or your access changed. Reload and review accounts.");
    const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.normalizedEmail, data.normalizedEmail));
    if (!row) throw new AuthError(409, "Account was saved but changed again. Reload accounts before continuing.");
    return guards.accountAccess(ctx, row.id);
  }
  async function update(ctx: Context, id: number, body: Record<string, unknown>) {
    const old = await target(ctx, id);
    keys(body, ["version", "email", "displayName", "employeeId", "accessLevel", "departmentIds", "disabled"]);
    const expected = version(body.version); const data = identity(body);
    if (old.sessionVersion !== expected) throw new AuthError(409, "Account changed while you were editing. Reload and try again.");
    if (typeof body.disabled !== "boolean") throw new AuthError(400, "Choose enabled or disabled access.");
    if (old.employeeId !== null && old.employeeId !== data.employeeId) throw new AuthError(400, "An existing employee link cannot be reassigned. Disable this account and review the person's identity.");
    const revision = newToken(); const stamp = new Date().toISOString();
    const receipt = sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${id} AND access_revision = ${revision})`;
    const changingPerson = old.employeeId !== data.employeeId;
    const result = await atomicBatch(db, [
      sql`UPDATE accounts SET email = ${data.email}, normalized_email = ${data.normalizedEmail}, display_name = ${data.displayName},
        employee_id = ${data.employeeId}, access_level = ${data.accessLevel}, disabled_at = ${body.disabled ? stamp : null},
        session_version = session_version + 1, access_revision = ${revision}, updated_at = ${stamp}
        WHERE id = ${id} AND session_version = ${expected} AND access_level <> 'owner'
        AND ${guards.activeActor(ctx)} AND ${departmentsGuard(data.departmentIds)}
        AND (${body.disabled ? 1 : 0} = 1 OR ${employeeGuard(data.employeeId)})
        AND NOT EXISTS (SELECT 1 FROM accounts WHERE id <> ${id} AND (normalized_email = ${data.normalizedEmail} OR (employee_id IS NOT NULL AND employee_id = ${data.employeeId})))`,
      ...invalidate(id, receipt, stamp),
      // Explicit grants must not silently survive a change in access level or linked person.
      ...(old.accessLevel !== data.accessLevel || changingPerson ? [sql`DELETE FROM account_permissions WHERE account_id = ${id} AND ${receipt}`] : []),
      sql`DELETE FROM department_managers WHERE account_id = ${id} AND ${receipt}`,
      ...data.departmentIds.map(departmentId => sql`INSERT INTO department_managers (department_id, account_id) SELECT ${departmentId}, ${id} WHERE ${receipt}`),
      audit(ctx, revision, "account.lifecycle_changed", { accessLevel: data.accessLevel, employeeId: data.employeeId,
        departmentIds: data.departmentIds, disabled: body.disabled, grantsReset: old.accessLevel !== data.accessLevel || changingPerson }, stamp),
    ]);
    if (result[0].meta.changes !== 1) throw new AuthError(409, "Account, employee, departments or your access changed. Reload and try again.");
    return guards.accountAccess(ctx, id);
  }
  async function setup(ctx: Context, id: number, body: Record<string, unknown>) {
    const old = await target(ctx, id); keys(body, ["version"]); const expected = version(body.version);
    if (old.sessionVersion !== expected) throw new AuthError(409, "Account changed while you were editing. Reload and try again.");
    if (old.loginEnabled || old.disabledAt || (old.accessLevel === "employee" && old.employeeId === null)) throw new AuthError(409, "Initial setup requires an enabled account awaiting a password. Employees must be linked to an active team member.");
    const revision = newToken(); const stamp = new Date().toISOString(); const token = newToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const receipt = sql`EXISTS (SELECT 1 FROM accounts WHERE id = ${id} AND access_revision = ${revision})`;
    const result = await atomicBatch(db, [
      sql`UPDATE accounts SET session_version = session_version + 1, access_revision = ${revision}, updated_at = ${stamp}
        WHERE id = ${id} AND session_version = ${expected} AND login_enabled = 0 AND disabled_at IS NULL
        AND access_level IN ('manager', 'general_manager', 'employee') AND ${employeeGuard(old.employeeId)} AND ${guards.activeActor(ctx)}`,
      ...invalidate(id, receipt, stamp),
      sql`INSERT INTO account_setup_tokens (id, account_id, token_hash, issued_session_version, expires_at)
        SELECT ${newToken()}, id, ${tokenHash(token)}, session_version, ${expiresAt} FROM accounts WHERE id = ${id} AND ${receipt}`,
      audit(ctx, revision, "account.setup_issued", {}, stamp),
    ]);
    if (result[0].meta.changes !== 1) throw new AuthError(409, "Account or your access changed. Reload and try again.");
    return { access: await guards.accountAccess(ctx, id), token, expiresAt };
  }
  return { create, update, setup };
}
