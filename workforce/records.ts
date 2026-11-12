import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { newToken } from "../auth/crypto";
import { newRecordId, equal } from "./contract";
import type { Change, WorkspaceData } from "./contract";
import type { Context, Database } from "./context";
import type { WorkspaceTransaction } from "./transaction";
import * as v from "./validation";
import { encryptSsn } from "./private";
import { terminationReasons } from "../team/rules";
import { requireOtherEmployee } from "./self-edit";

type Role = { id: number; name: string; departmentId: number | null; archived: boolean };
export type RecordContext = { db: Database; ctx: Context; tx: WorkspaceTransaction; view: WorkspaceData; roles: Role[]; fieldKey: string; today: string };
function permission(r: RecordContext, key: Parameters<Context["requirePermission"]>[0]) { r.ctx.requirePermission(key); }
export function roleFor(r: RecordContext, name: unknown) {
  const value = v.text(name, 100, true); const role = r.roles.find(role => !role.archived && role.name === value);
  if (!role || (!r.ctx.allDepartments && !r.ctx.departmentIds.includes(role.departmentId ?? -1))) throw new AuthError(403, "Choose an active job role in your departments.");
  return role;
}
export async function employeeInScope(r: RecordContext, id: number, own = false) {
  const [employee] = await r.db.select().from(s.employees).where(and(eq(s.employees.id, id), own && id === r.ctx.account.employeeId ? sql`1 = 1` : r.ctx.employeeFilter(s.employees.id))).limit(1);
  if (!employee) throw new AuthError(404, "Employee is not available."); return employee;
}
function changedFields(change: Change, data: Record<string, unknown>) { return v.changed(change.before, data).filter(key => key !== "id"); }
export async function departmentChange(r: RecordContext, change: Change) {
  permission(r, "departments.manage"); const before = change.before ? v.object(change.before) : null; const after = change.after === null ? null : v.object(change.after);
  if (!r.ctx.allDepartments && !r.ctx.departmentIds.includes(change.id)) throw new AuthError(403, "This department is outside your access.");
  if (!after) {
    if (await r.db.get(sql`SELECT 1 FROM roles ro WHERE ro.department_id = ${change.id} AND (EXISTS (SELECT 1 FROM employee_roles er WHERE er.role_id = ro.id) OR EXISTS (SELECT 1 FROM shifts sh WHERE sh.role_id = ro.id) OR EXISTS (SELECT 1 FROM wage_rates w WHERE w.role_id = ro.id) OR EXISTS (SELECT 1 FROM time_cards tc WHERE tc.role_id = ro.id)) LIMIT 1`)) throw new AuthError(409, "This department has jobs in use. Keep its history and reassign work before changing it.");
    r.tx.update(s.departments, { archived: true, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND archived = 0`);
    r.tx.write(sql`UPDATE roles SET archived = 1, updated_at = ${r.tx.stamp} WHERE department_id = ${change.id} AND ${r.tx.receipt}`);
    r.tx.write(sql`UPDATE employee_roles SET active = 0, updated_at = ${r.tx.stamp} WHERE role_id IN (SELECT id FROM roles WHERE department_id = ${change.id}) AND ${r.tx.receipt}`);
    for (const role of r.roles) if (role.departmentId === change.id) role.archived = true;
    return;
  }
  v.keys(after, ["id", "name", "roles", "managerIds"]); const name = v.text(after.name, 100, true);
  const roleNames = v.list(after.roles, 50).map(value => v.text(value, 100, true));
  if (new Set(roleNames.map(name => name.toLowerCase())).size !== roleNames.length) throw new AuthError(400, "Job role names must be unique.");
  if (before) r.tx.update(s.departments, { name, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND archived = 0`);
  else r.tx.insert(s.departments, { id: change.id, name }, sql`NOT EXISTS (SELECT 1 FROM departments WHERE id = ${change.id})`);
  const oldRoles = r.roles.filter(role => role.departmentId === change.id && !role.archived);
  for (const role of oldRoles.filter(role => !roleNames.includes(role.name))) {
    if (await r.db.get(sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM employee_roles WHERE role_id = ${role.id}) OR EXISTS (SELECT 1 FROM employees WHERE role_id = ${role.id}) OR EXISTS (SELECT 1 FROM shifts WHERE role_id = ${role.id}) OR EXISTS (SELECT 1 FROM wage_rates WHERE role_id = ${role.id}) OR EXISTS (SELECT 1 FROM time_cards WHERE role_id = ${role.id})`)) throw new AuthError(409, "This job is in use and cannot be removed. Its assignments and history are preserved.");
    r.tx.update(s.roles, { archived: true, updatedAt: r.tx.stamp }, sql`id = ${role.id}`); role.archived = true;
    r.tx.write(sql`UPDATE employee_roles SET active = 0, updated_at = ${r.tx.stamp} WHERE role_id = ${role.id} AND ${r.tx.receipt}`);
  }
  for (const name of roleNames.filter(name => !oldRoles.some(role => role.name === name))) {
    const exists = r.roles.find(role => role.name.toLowerCase() === name.toLowerCase());
    if (exists && (!exists.archived || exists.departmentId !== change.id)) throw new AuthError(409, "That job role name is unavailable.");
    const id = exists?.id ?? newRecordId();
    if (exists) { r.tx.update(s.roles, { archived: false, updatedAt: r.tx.stamp }, sql`id = ${id}`); exists.archived = false; }
    else { r.tx.insert(s.roles, { id, name, departmentId: change.id }); r.roles.push({ id, name, departmentId: change.id, archived: false }); }
  }
  if (!equal(before?.managerIds ?? [], after.managerIds ?? [])) {
    if (r.ctx.account.accessLevel !== "owner") throw new AuthError(403, "Only an Owner can change manager assignments.");
    const ids = v.list(after.managerIds, 100).map(id => v.integer(id));
    const accounts = await r.db.select().from(s.accounts);
    const assigned = ids.map(id => accounts.find(a => a.employeeId === id && ["manager", "general_manager"].includes(a.accessLevel) && !a.disabledAt));
    if (assigned.some(a => !a)) throw new AuthError(400, "Choose existing manager dashboard accounts.");
    const previous = await r.db.select().from(s.departmentManagers).where(eq(s.departmentManagers.departmentId, change.id));
    r.tx.remove(s.departmentManagers, sql`department_id = ${change.id}`);
    for (const account of assigned) r.tx.insert(s.departmentManagers, { departmentId: change.id, accountId: account!.id });
    for (const id of new Set([...previous.map(a => a.accountId), ...assigned.map(a => a!.id)])) {
      r.tx.write(sql`UPDATE accounts SET session_version = session_version + 1, access_revision = ${newToken()}, updated_at = ${r.tx.stamp} WHERE id = ${id} AND ${r.tx.receipt}`);
      r.tx.write(sql`UPDATE account_sessions SET revoked_at = ${r.tx.stamp} WHERE account_id = ${id} AND ${r.tx.receipt}`);
    }
  }
}

const basicFields = ["name", "email", "phone", "role", "active", "startDate", "terminated", "terminationDate"];
const administrativeFields = ["payrollId", "payrollClassification", "terminationReason", "terminationNote", "eligibleForRehire", "employmentHistory"];
const selfProfileFields = ["name", "email", "phone", "legalFirstName", "legalMiddleName", "legalLastName", "dateOfBirth", "socialSecurityNumber", "homeAddress", "homeAddressLine2", "homeCity", "homeStateProvince", "homePostalCode", "homeCityStateZip", "emergencyContact", "emergencyContactRelationship", "emergencyContactPhone", "emergencyContactPreference"];
const privateFields = ["legalFirstName", "legalMiddleName", "legalLastName", "dateOfBirth", "socialSecurityNumber", "homeAddress", "homeAddressLine2", "homeCity", "homeStateProvince", "homePostalCode", "homeCityStateZip", "emergencyContact", "emergencyContactRelationship", "emergencyContactPhone", "emergencyContactPreference", "terminationReason", "terminationNote", "eligibleForRehire", "payrollId", "payrollClassification", "employmentHistory"];
export async function employeeChange(r: RecordContext, change: Change) {
  if (change.after === null) throw new AuthError(400, "Deactivate or terminate employees instead of deleting history.");
  const data = v.object(change.after); const before = change.before ? v.object(change.before) : null;
  v.keys(data, ["id", ...basicFields, ...privateFields, "wage", "pin", "accessLevel", "location", "locationSettings", "managerNotes", "certificates", "onboardingDocuments", "onboardingFileIds", "jobs", "wageRates", "photoFileId"]);
  const fields = changedFields(change, data).filter(key => before || !(data[key] === "" || data[key] === undefined || data[key] === null || (Array.isArray(data[key]) && !(data[key] as unknown[]).length) || (key === "onboardingDocuments" && equal(data[key], {})) || (key === "payrollClassification" && data[key] === "W-2 Employee")));
  for (const key of ["jobs", "wageRates", "photoFileId"]) if (fields.includes(key)) throw new AuthError(403, "Use protected team job, wage and photo actions for these fields.");
  if (fields.includes("role") && before && Array.isArray(before.jobs) && before.jobs.length > 1) throw new AuthError(409, "Use Team details to edit multiple job assignments.");
  if (data.terminated === true && data.active !== false) throw new AuthError(400, "A terminated employee cannot be active.");
  if (data.terminated === true && !before?.terminated) {
    v.oneOf(data.terminationReason, terminationReasons);
    const date = v.date(data.terminationDate);
    const history = v.list(before?.employmentHistory ?? []).map(v.object).filter(h => h.type === "rehired").map(h => String(h.date));
    if (date > r.today || date < String(data.startDate || "0000-01-01") || history.some(previous => previous > date)) throw new AuthError(400, "Termination must be between the latest hire/rehire date and today.");
  }
  if (before?.terminated && data.terminated === false) {
    if (before.eligibleForRehire === false && !(r.ctx.account.accessLevel === "owner" && data.eligibleForRehire === true)) throw new AuthError(409, "An Owner must review rehire eligibility before rehiring this employee.");
    const events = v.list(data.employmentHistory ?? []).map(v.object); const latest = events[events.length - 1];
    if (!latest || latest.type !== "rehired" || v.date(latest.date) > r.today || String(latest.date) < String(before.terminationDate)) throw new AuthError(400, "Choose a rehire date between termination and today.");
  }
  if (!equal(data.onboardingFileIds ?? {}, before?.onboardingFileIds ?? {})) throw new AuthError(403, "Document references are managed through protected uploads.");
  const self = change.id === r.ctx.account.employeeId;
  if (data.pin !== "") throw new AuthError(400, "Set PINs through Tablet & PIN access.");
  if ((before && data.accessLevel !== before.accessLevel) || (!before && data.accessLevel !== "Employee")) throw new AuthError(403, "Dashboard access is managed separately from employee job records.");
  if (data.location !== r.view.basicInfo.locationName) throw new AuthError(400, "Use the current company location.");
  if (!before || fields.some(key => !selfProfileFields.includes(key)) || !self) permission(r, "team.manage");
  if (fields.some(key => administrativeFields.includes(key))) permission(r, "team.private.read");
  const existing = before ? await employeeInScope(r, change.id, self) : null;
  if (existing && !r.ctx.allDepartments && fields.some(key => ["role", "active", "terminated"].includes(key))) {
    const outside = await r.db.get(sql`SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = ${change.id} AND er.active = 1 AND NOT (${r.ctx.roleFilter(sql`r.id`)}) LIMIT 1`);
    if (outside) throw new AuthError(403, "An Owner must change the employment or role of a person assigned outside your departments.");
  }
  if (fields.some(key => privateFields.includes(key)) && !self) permission(r, "team.private.read");
  const needsRole = !before || fields.some(key => ["role", "wage"].includes(key));
  const role = needsRole && data.role ? roleFor(r, data.role) : null;
  if (needsRole && !r.ctx.allDepartments && !role) throw new AuthError(403, "Employees need a job role in your departments.");
  if (fields.includes("wage")) {
    requireOtherEmployee(r.ctx, change.id);
    permission(r, "wages.manage");
    if (before?.wage && !data.wage) throw new AuthError(400, "Wage history cannot be removed. Set a new effective wage instead.");
  }
  const values: Record<string, unknown> = { name: v.text(data.name, 100, true), updatedAt: r.tx.stamp };
  if (before?.terminated && data.terminated === false) { values.terminationDate = null; values.terminationReason = null; values.terminationNote = null; }
  if (!before || fields.includes("email")) { const email = v.text(data.email, 254); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, "Enter a valid email."); values.email = email; }
  if (!before || fields.includes("phone")) values.phone = v.text(data.phone, 50);
  for (const key of ["active", "terminated", "eligibleForRehire"]) if (fields.includes(key) && data[key] !== undefined) values[key] = v.boolean(data[key]);
  for (const key of ["terminationReason", "terminationNote", "payrollId"]) if (fields.includes(key)) values[key] = v.text(data[key] ?? "", key === "terminationNote" ? 1000 : 200);
  for (const key of ["startDate", "terminationDate"]) if ((!before || fields.includes(key)) && data[key]) values[key] = v.date(data[key]);
  if (fields.includes("payrollClassification")) values.payrollClassification = v.oneOf(data.payrollClassification, ["W-2 Employee", "1099 Contractor"]);
  if (!before || fields.includes("role")) values.roleId = role?.id ?? null;
  if (existing) { values.version = existing.version + 1; r.tx.update(s.employees, values, sql`id = ${change.id} AND version = ${existing.version}`); }
  else r.tx.insert(s.employees, { ...values, id: change.id, pinHash: `unenrolled:${newToken()}`, active: v.boolean(data.active), terminated: false }, sql`NOT EXISTS (SELECT 1 FROM employees WHERE id = ${change.id})`);
  if (!before || fields.includes("role")) {
    r.tx.write(sql`UPDATE employee_roles SET active = 0, updated_at = ${r.tx.stamp} WHERE employee_id = ${change.id} AND ${r.tx.receipt}`);
    if (role) r.tx.insert(s.employeeRoles, { employeeId: change.id, roleId: role.id, active: true, updatedAt: r.tx.stamp }, sql`1 = 1`, { target: ["employeeId", "roleId"], update: ["active", "updatedAt"] });
  }
  if (fields.some(key => privateFields.includes(key) && !["terminationReason", "terminationNote", "eligibleForRehire", "payrollId", "payrollClassification", "employmentHistory", "homeCityStateZip"].includes(key))) {
    const profile: Record<string, unknown> = { employeeId: change.id, updatedAt: r.tx.stamp };
    for (const key of ["legalFirstName", "legalMiddleName", "legalLastName", "homeAddress", "homeAddressLine2", "homeCity", "homeStateProvince", "homePostalCode", "emergencyContact", "emergencyContactRelationship", "emergencyContactPhone", "emergencyContactPreference"]) if (fields.includes(key)) profile[key] = v.text(data[key] ?? "", 300);
    if (fields.includes("dateOfBirth")) profile.dateOfBirth = data.dateOfBirth ? v.date(data.dateOfBirth) : null;
    if (fields.includes("socialSecurityNumber")) { const value = v.text(data.socialSecurityNumber, 11); if (value && !/^\d{3}-?\d{2}-?\d{4}$/.test(value)) throw new AuthError(400, "Enter a valid SSN or leave it blank."); profile.ssnEncrypted = encryptSsn(value, change.id, r.fieldKey); }
    r.tx.insert(s.employeeProfiles, profile, sql`1 = 1`, { target: ["employeeId"], update: Object.keys(profile).filter(key => key !== "employeeId") });
  }
  if (fields.includes("wage") && data.wage) {
    const wage = v.text(data.wage, 40); const match = /^\$?([\d,]+(?:\.\d{1,2})?)\s*\/(hr|hour|year)$/i.exec(wage);
    if (!match) throw new AuthError(400, "Use an hourly or annual wage."); const amount = Math.round(Number(match[1].replace(/,/g, "")) * 100); v.integer(amount, 0, 1000000000);
    r.tx.insert(s.wageRates, { employeeId: change.id, roleId: role?.id ?? null, amountCents: amount, basis: match[2].toLowerCase() === "year" ? "annual_salary" : "hourly", effectiveDate: r.today, recordedByAccountId: r.ctx.account.id });
  }
  if (fields.includes("locationSettings")) {
    const settings = v.object(data.locationSettings); v.keys(settings, ["showInSchedule", "sendLocationAlerts", "includeInTimeClockErrors", "eligibleForOpenShifts", "canWaiveMissedBreaks"]);
    for (const value of Object.values(settings)) v.boolean(value);
    r.tx.insert(s.employeeSettings, { employeeId: change.id, ...settings, updatedAt: r.tx.stamp }, sql`1 = 1`, { target: ["employeeId"], update: [...Object.keys(settings), "updatedAt"] });
  }
  if (fields.includes("managerNotes")) {
    permission(r, "team.notes.read"); const old = v.list(before?.managerNotes ?? []); const next = v.list(data.managerNotes);
    if (old.some(note => !next.some(value => equal(note, value)))) throw new AuthError(400, "Existing manager notes cannot be overwritten.");
    for (const note of next.filter(value => !old.some(old => equal(old, value)))) { const row = v.object(note); v.keys(row, ["id", "text", "createdAt"]); r.tx.insert(s.employeeNotes, { id: v.integer(row.id), employeeId: change.id, authorAccountId: r.ctx.account.id, body: v.text(row.text, 4000, true), createdAt: r.tx.stamp }); }
  }
  if (fields.includes("employmentHistory")) {
    const old = v.list(before?.employmentHistory ?? []); const next = v.list(data.employmentHistory ?? []);
    const transition = before?.terminated === true && data.terminated === false ? "rehired" : !before?.terminated && data.terminated === true ? "terminated" : null;
    if (!transition || next.length !== old.length + 1 || v.object(next[next.length - 1]).type !== transition) throw new AuthError(400, "Employment history is appended only by a terminate or rehire action.");
    if (old.some(event => !next.some(value => equal(event, value)))) throw new AuthError(400, "Employment history cannot be removed.");
    for (const event of next.filter(value => !old.some(old => equal(old, value)))) { const row = v.object(event); v.keys(row, ["type", "date", "reason"]); r.tx.insert(s.employmentHistory, { employeeId: change.id, eventType: v.oneOf(row.type, ["terminated", "rehired"]), date: v.date(row.date), reason: v.text(row.reason ?? "", 200), actorAccountId: r.ctx.account.id }); }
  }
  if (data.active === false || data.terminated === true) {
    r.tx.write(sql`UPDATE kiosk_interactions SET ended_at = ${r.tx.stamp} WHERE employee_id = ${change.id} AND ended_at IS NULL AND ${r.tx.receipt}`);
    r.tx.write(sql`UPDATE accounts SET disabled_at = ${r.tx.stamp}, session_version = session_version + 1 WHERE employee_id = ${change.id} AND access_level <> 'owner' AND ${r.tx.receipt}`);
    r.tx.write(sql`UPDATE account_sessions SET revoked_at = ${r.tx.stamp} WHERE account_id IN (SELECT id FROM accounts WHERE employee_id = ${change.id} AND access_level <> 'owner') AND ${r.tx.receipt}`);
  }
  if (data.terminated === true && !before?.terminated) {
    r.tx.write(sql`UPDATE employees SET pin_hash = ${`unenrolled:${newToken()}`}, pin_lookup = NULL, pin_version = pin_version + 1 WHERE id = ${change.id} AND ${r.tx.receipt}`);
    r.tx.write(sql`UPDATE account_setup_tokens SET used_at = ${r.tx.stamp} WHERE account_id IN (SELECT id FROM accounts WHERE employee_id = ${change.id} AND access_level <> 'owner') AND used_at IS NULL AND ${r.tx.receipt}`);
    r.tx.write(sql`UPDATE team_invitations SET revoked_at = ${r.tx.stamp} WHERE employee_id = ${change.id} AND used_at IS NULL AND ${r.tx.receipt}`);
    r.tx.write(sql`DELETE FROM manager_approval_credentials WHERE account_id IN (SELECT id FROM accounts WHERE employee_id = ${change.id} AND access_level <> 'owner') AND ${r.tx.receipt}`);
  }
  if (fields.includes("certificates")) {
    permission(r, "documents.read"); permission(r, "documents.manage"); const old = v.list(before?.certificates ?? []); const next = v.list(data.certificates ?? []);
    if (old.some(value => !next.some(row => equal(value, row)))) throw new AuthError(400, "Existing certificates cannot be overwritten here.");
    for (const entry of next.filter(value => !old.some(old => equal(old, value)))) { const row = v.object(entry); v.keys(row, ["id", "name", "fileName", "expirationDate", "fileId"]); if (row.fileId || row.fileName) throw new AuthError(409, "Upload attachments through the protected document service."); r.tx.insert(s.employeeCertificates, { id: v.integer(row.id), employeeId: change.id, name: v.text(row.name, 100, true), expirationDate: row.expirationDate ? v.date(row.expirationDate) : null }); }
  }
  if (fields.includes("onboardingDocuments") && !equal(data.onboardingDocuments, before?.onboardingDocuments ?? {})) throw new AuthError(409, "Upload documents through the protected document service.");
}
