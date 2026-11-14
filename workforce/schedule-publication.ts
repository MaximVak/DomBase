import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { rateKey } from "../auth/crypto";
import { validEmail } from "../backup/email-config.mjs";
import { canonical, newRecordId } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { roleFor } from "./records";
import * as v from "./validation";
import { workspacePeriod } from "./period";
import { changedSchedulePeople } from "../app/schedule-publish-model";
import type { PublishOptions, PublicationDelivery, EmailDeliveryState } from "../app/schedule-publish-model";
import { validateShifts, validatePlan } from "./shift-plan";
import { readScheduleConflicts } from "./conflicts";

export function publishOptions(value: unknown, r: RecordContext): PublishOptions {
  const row = v.object(value);
  const departmentId = row.departmentId === undefined || row.departmentId === null ? null : v.integer(row.departmentId);
  if (departmentId !== null && !r.view.state.departments.some(department => department.id === departmentId)) throw new AuthError(403, "Department is outside your access.");
  return { departmentId, period: row.period === undefined || row.period === null ? null : workspacePeriod(row.period), notify: row.notify === undefined ? "changed" : v.oneOf(row.notify, ["all", "changed", "none"]), inApp: row.inApp === undefined ? true : v.boolean(row.inApp), email: row.email === undefined ? false : v.boolean(row.email) };
}
async function prepare(r: RecordContext, options: PublishOptions) {
  r.ctx.requirePermission("schedule.read"); r.ctx.requirePermission("schedule.manage");
  const [stored] = await r.db.select().from(s.scheduleDrafts).where(and(eq(s.scheduleDrafts.ownerAccountId, r.ctx.account.id), r.ctx.activeActor())).limit(1);
  const all = stored ? await r.db.select({ ...getTableColumns(s.scheduleDraftChanges), originalDate: s.shifts.date }).from(s.scheduleDraftChanges).leftJoin(s.shifts, eq(s.shifts.id, s.scheduleDraftChanges.shiftId)).where(and(eq(s.scheduleDraftChanges.draftId, stored.id), r.ctx.activeActor())).limit(1001) : [];
  if (all.length > 1000) throw new AuthError(503, "This draft is too large to publish safely.");
  const selected = all.filter(row => (options.departmentId === null || r.roles.some(role => role.id === row.roleId && role.departmentId === options.departmentId)) && (!options.period || ((row.date ?? row.originalDate ?? "") >= options.period.start && (row.date ?? row.originalDate ?? "") <= options.period.end)));
  for (const row of selected) {
    const role = r.roles.find(role => role.id === row.roleId); if (!role) throw new AuthError(403, "A draft job is unavailable."); roleFor(r, role.name);
    if (row.shiftId && !r.view.state.shifts.some(shift => shift.id === row.shiftId)) throw new AuthError(403, "A draft shift is outside your current access.");
  }
  const upserts = await validateShifts(r, selected.filter(row => row.operation === "upsert").map(row => ({ id: row.shiftId ?? Number(row.clientKey), employeeId: row.employeeId, date: row.date, start: row.startTime, end: row.endTime, role: row.roleName, station: row.station ?? "Floor", notes: row.notes ?? "", shiftType: row.shiftType, color: row.color })));
  const deleted = selected.filter(row => row.operation === "delete").map(row => row.shiftId!); await validatePlan(r, upserts, deleted);
  const [last] = await r.db.select({ version: s.schedulePublications.version }).from(s.schedulePublications).orderBy(desc(s.schedulePublications.version)).limit(1);
  const changed = changedSchedulePeople(r.view.state.shifts, upserts, deleted);
  const candidates = options.notify === "none" || !selected.length ? [] : await r.db.select({ id: s.employees.id, name: s.employees.name, email: s.employees.email, alerts: s.employeeSettings.sendLocationAlerts, inApp: s.scheduleNotificationPreferences.inApp, emailPreference: s.scheduleNotificationPreferences.email }).from(s.employees)
    .leftJoin(s.employeeSettings, eq(s.employeeSettings.employeeId, s.employees.id)).leftJoin(s.scheduleNotificationPreferences, eq(s.scheduleNotificationPreferences.employeeId, s.employees.id))
    .where(and(eq(s.employees.active, true), eq(s.employees.terminated, false), r.ctx.employeeFilter(s.employees.id), r.ctx.activeActor(), options.notify === "changed" ? sql`${s.employees.id} IN (SELECT value FROM json_each(${JSON.stringify([...changed])}))` : options.departmentId === null ? sql`1=1` : sql`(${s.employees.id} IN (SELECT value FROM json_each(${JSON.stringify([...changed])})) OR EXISTS (SELECT 1 FROM employee_roles er JOIN roles role ON role.id=er.role_id JOIN departments dept ON dept.id=role.department_id WHERE er.employee_id=${s.employees.id} AND er.active=1 AND role.archived=0 AND dept.archived=0 AND dept.id=${options.departmentId}))`)).orderBy(s.employees.id).limit(2001);
  if (candidates.length > 2000) throw new AuthError(503, "Too many recipients to review safely.");
  const master = r.view.settings.notifyScheduleChanges;
  if (master && options.notify !== "none" && options.email && !r.emailEnabled) throw new AuthError(400, "Email delivery is unavailable. Choose in-app notices or nobody, or ask an Owner to check email configuration.");
  const recipients = candidates.map(person => ({ employeeId: person.id, name: person.name, inApp: master && person.alerts !== false && options.inApp && person.inApp !== false, emailRequested: master && person.alerts !== false && options.email && person.emailPreference !== false, address: validEmail(person.email.trim()) ? person.email.trim().toLowerCase() : "" })).filter(person => person.inApp || person.emailRequested);
  const dates = selected.map(row => row.date ?? row.originalDate!).filter(Boolean).sort();
  return { stored, all, selected, upserts, deleted, lastVersion: last?.version ?? 0, needsReview: !!stored && stored.basePublicationVersion !== (last?.version ?? 0), recipients, optedOut: candidates.length - recipients.length, period: options.period ?? (dates.length ? { start: dates[0], end: dates.at(-1)! } : null) };
}
const reviewToken = (r: RecordContext, options: PublishOptions, lastVersion: number) => rateKey(r.publicationSecret ?? "", canonical({ actor: r.ctx.account.id, revision: r.view.revision, options, lastVersion }));

export async function latestPublicationDelivery(r: RecordContext): Promise<PublicationDelivery | null> {
  const scope = r.ctx.allDepartments ? sql`1=1` : sql`NOT EXISTS (SELECT 1 FROM json_each(${s.schedulePublications.scopeDepartments}) scope WHERE CAST(scope.value AS INTEGER) NOT IN (SELECT value FROM json_each(${JSON.stringify(r.ctx.departmentIds)})))`;
  const [publication] = await r.db.select().from(s.schedulePublications).where(and(eq(s.schedulePublications.publishedByAccountId, r.ctx.account.id), sql`${s.schedulePublications.notifyMode} IS NOT NULL`, scope, r.ctx.activeActor())).orderBy(desc(s.schedulePublications.version)).limit(1);
  if (!publication) return null;
  const [people, emailRows] = await r.db.batch([
    r.db.select({ employeeId: s.schedulePublicationRecipients.employeeId, name: s.employees.name, inApp: s.schedulePublicationRecipients.inApp, emailRequested: s.schedulePublicationRecipients.emailRequested, state: s.scheduleEmails.state }).from(s.schedulePublicationRecipients).innerJoin(s.employees, eq(s.employees.id, s.schedulePublicationRecipients.employeeId)).leftJoin(s.scheduleEmails, eq(s.scheduleEmails.id, s.schedulePublicationRecipients.emailId)).where(and(eq(s.schedulePublicationRecipients.publicationId, publication.id), r.ctx.employeeFilter(s.employees.id), r.ctx.activeActor())).orderBy(s.employees.name).limit(2001),
    r.db.select({ state: s.scheduleEmails.state }).from(s.scheduleEmails).where(and(eq(s.scheduleEmails.publicationId, publication.id), r.ctx.activeActor())).limit(2001),
  ]);
  if (people.length > 2000 || emailRows.length > 2000) throw new AuthError(503, "Too many delivery receipts to display safely.");
  const emails: Record<EmailDeliveryState, number> = { pending: 0, sending: 0, accepted: 0, uncertain: 0, cancelled: 0 }; for (const row of emailRows) emails[row.state]++;
  return { id: publication.id, version: publication.version, department: publication.departmentId === null ? "All selected departments" : r.view.state.departments.find(department => department.id === publication.departmentId)?.name ?? "Selected department", period: publication.periodStart && publication.periodEnd ? { start: publication.periodStart, end: publication.periodEnd } : null, notify: publication.notifyMode!, inAppCount: people.filter(person => person.inApp).length, emails, recipients: people.map(person => ({ employeeId: person.employeeId, name: person.name, inApp: person.inApp, email: person.state ?? (person.emailRequested ? "no_address" : "not_requested") })) };
}
export async function publicationPreview(r: RecordContext, raw: Record<string, unknown>) {
  v.keys(raw, ["departmentId", "period", "notify", "inApp", "email"]); const options = publishOptions(raw, r), plan = await prepare(r, options);
  const issues: string[] = []; let warnings = null;
  if (plan.period && Date.parse(plan.period.end) - Date.parse(plan.period.start) > 61 * 86400000) issues.push("Review and publish a workweek or a date range of at most 62 days.");
  else if (plan.selected.length && plan.period) warnings = await readScheduleConflicts(r.db, r.ctx, { period: plan.period, revision: r.view.revision, upserts: plan.upserts.map(row => ({ id: row.id, employeeId: row.employeeId, date: row.date, start: row.start, end: row.end, role: row.role, shiftType: row.shiftType })), deletedShiftIds: plan.deleted });
  const describe = (row: typeof plan.upserts[number] | typeof r.view.state.shifts[number] | undefined) => !row ? "None" : `${r.view.state.employees.find(employee => employee.id === row.employeeId)?.name ?? "Team member"} · ${row.date} · ${row.shiftType === "day_off" ? "Day off" : `${row.start}–${row.end}`} · ${row.role} · ${row.color ?? "blue"} · ${row.station || "Floor"}`;
  const entries = [...plan.upserts.map(row => { const old = r.view.state.shifts.find(original => original.id === row.id); return { id: row.id, action: old ? "edit" : "add", employee: r.view.state.employees.find(employee => employee.id === row.employeeId)?.name ?? "Team member", before: describe(old), after: describe(row) }; }), ...plan.deleted.map(id => { const old = r.view.state.shifts.find(row => row.id === id)!; return { id, action: "remove", employee: r.view.state.employees.find(employee => employee.id === old.employeeId)?.name ?? "Team member", before: describe(old), after: "Removed from the published schedule" }; })];
  const latest = await latestPublicationDelivery(r);
  const [current] = await r.db.select({ revision: s.workforceState.revision }).from(s.workforceState).where(and(eq(s.workforceState.id, 1), r.ctx.activeActor()));
  if (!current) throw new AuthError(401, "Sign in to continue."); if (current.revision !== r.view.revision) throw new AuthError(409, "Shared data changed. Close and reload before reviewing publication.");
  return { revision: r.view.revision, reviewToken: reviewToken(r, options, plan.lastVersion), changes: plan.selected.length, remaining: Math.max(0, (r.view.state.scheduleDraftsByManager[r.ctx.account.employeeId ?? -r.ctx.account.id]?.upsertedShifts.length ?? 0) + (r.view.state.scheduleDraftsByManager[r.ctx.account.employeeId ?? -r.ctx.account.id]?.deletedShiftIds.length ?? 0) - plan.selected.length), needsReview: plan.needsReview, issues, warnings, entries, recipients: plan.recipients.map(person => ({ employeeId: person.employeeId, name: person.name, inApp: person.inApp, email: person.emailRequested && !!person.address })), optedOut: plan.optedOut, missingEmail: plan.recipients.filter(person => person.emailRequested && !person.address).length, emailDestinations: new Set(plan.recipients.filter(person => person.emailRequested && person.address).map(person => person.address)).size, emailConfigured: !!r.emailEnabled, masterEnabled: r.view.settings.notifyScheduleChanges, shifts: plan.upserts.map(shift => ({ ...shift, notes: undefined })), latest };
}

export async function publishSchedule(r: RecordContext, change: Change) {
  const row = change.after ? v.object(change.after) : {}; v.keys(row, ["publish", "departmentId", "period", "notify", "inApp", "email", "reviewToken", "reviewLatest"]);
  if (row.publish !== undefined && row.publish !== true) throw new AuthError(400, "Confirm publication.");
  const options = publishOptions(row, r), plan = await prepare(r, options);
  if (!plan.stored) throw new AuthError(409, "Save a draft before publishing."); if (!plan.selected.length) throw new AuthError(400, "No draft changes in that department or date range.");
  const reviewed = typeof row.reviewToken === "string" && row.reviewToken === reviewToken(r, options, plan.lastVersion);
  if (row.reviewToken !== undefined || ["period", "notify", "inApp", "email", "reviewLatest"].some(field => row[field] !== undefined)) { if (!r.publicationSecret || !reviewed) throw new AuthError(409, "Review these exact publication choices before publishing."); }
  if (plan.needsReview && (!reviewed || row.reviewLatest !== true)) throw new AuthError(409, "Another manager published. Reload and review the latest schedule before publishing your draft.");
  if (row.reviewLatest !== undefined) v.boolean(row.reviewLatest);
  if (reviewed && plan.period && Date.parse(plan.period.end) - Date.parse(plan.period.start) > 61 * 86400000) throw new AuthError(400, "Review and publish a workweek or a date range of at most 62 days.");
  const publicationId = newRecordId(), version = plan.lastVersion + 1;
  r.tx.insert(s.schedulePublications, { id: publicationId, version, publishedByAccountId: r.ctx.account.id, publishedAt: r.tx.stamp, departmentId: options.departmentId, periodStart: plan.period?.start ?? null, periodEnd: plan.period?.end ?? null, notifyMode: options.notify, notifyInApp: options.inApp, notifyEmail: options.email, scopeDepartments: options.departmentId !== null ? [options.departmentId] : r.ctx.allDepartments ? r.view.state.departments.map(department => department.id) : r.ctx.departmentIds });
  const newRows: Record<string, unknown>[] = [], editedRows: Record<string, unknown>[] = [], auditRows: Record<string, unknown>[] = [];
  for (const item of plan.selected) {
    const before = r.view.state.shifts.find(shift => shift.id === item.shiftId);
    const shift = plan.upserts.find(shift => shift.id === (item.shiftId ?? Number(item.clientKey)));
    const planned = (value: typeof before) => value ? { employeeId: value.employeeId, date: value.date, start: value.start, end: value.end, role: value.role, shiftType: value.shiftType ?? "work", color: value.color ?? "blue" } : null;
    auditRows.push({ actorAccountId: r.ctx.account.id, employeeId: shift?.employeeId ?? before!.employeeId, action: "schedule.shift_changed", entityType: "shift", entityId: String(shift?.id ?? item.shiftId), metadata: { before: planned(before), after: planned(shift), publicationId }, createdAt: r.tx.stamp });
    if (!shift) continue;
    const role = roleFor(r, shift.role), values = { id: shift.id, employeeId: shift.employeeId, roleId: role.id, roleName: role.name, date: shift.date, startTime: shift.start, endTime: shift.end, station: shift.station, shiftType: shift.shiftType, color: shift.color, updatedAt: r.tx.stamp, ...(!item.shiftId || r.ctx.permissions["schedule.notes.manage"] ? { notes: shift.notes ?? "" } : {}), publicationId };
    (item.shiftId ? editedRows : newRows).push(values);
  }
  const assignmentGuard = sql`EXISTS (SELECT 1 FROM employees e JOIN employee_roles er ON er.employee_id=e.id WHERE e.id=json_extract(entry.value,'$.employeeId') AND e.active=1 AND e.terminated=0 AND er.role_id=json_extract(entry.value,'$.roleId') AND er.active=1)`;
  if (plan.deleted.length) r.tx.update(s.shifts, { archivedAt: r.tx.stamp, publicationId }, sql`id IN (SELECT value FROM json_each(${JSON.stringify(plan.deleted)})) AND archived_at IS NULL`, plan.deleted.length);
  r.tx.insertRows(s.auditLog, auditRows); r.tx.updateRows(s.shifts, editedRows, "id", sql`archived_at IS NULL AND ${assignmentGuard}`); r.tx.insertRows(s.shifts, newRows, assignmentGuard);
  const emailGroups = new Map<string, string>(); for (const person of plan.recipients) if (person.emailRequested && person.address) emailGroups.set(person.address, `schedule-email-${publicationId}-${createHash("sha256").update(person.address).digest("hex")}`);
  r.tx.insertRows(s.scheduleEmails, [...emailGroups].map(([recipient, id]) => ({ id, publicationId, recipient, state: "pending", createdAt: r.tx.stamp, updatedAt: r.tx.stamp })));
  r.tx.insertRows(s.schedulePublicationRecipients, plan.recipients.map(person => ({ publicationId, employeeId: person.employeeId, inApp: person.inApp, emailRequested: person.emailRequested, emailId: person.emailRequested && person.address ? emailGroups.get(person.address) : null })));
  r.tx.insertRows(s.notifications, plan.recipients.filter(person => person.inApp).map(person => ({ id: `schedule-${publicationId}-${person.employeeId}`, employeeId: person.employeeId, sourceKey: `publication:${publicationId}`, kind: "schedule", title: "Schedule published", detail: "Your published schedule was updated. Open My schedule to review it.", occurredAt: r.tx.stamp, publicationId })));
  const selectedIds = new Set(plan.selected.map(row => row.id)), remaining = plan.all.filter(row => !selectedIds.has(row.id));
  r.tx.remove(s.scheduleDraftChanges, sql`id IN (SELECT value FROM json_each(${JSON.stringify([...selectedIds])})) AND draft_id=${plan.stored.id}`); r.tx.remove(s.scheduleDraftEmployees, sql`draft_id=${plan.stored.id}`);
  if (remaining.length) { r.tx.update(s.scheduleDrafts, { basePublicationVersion: version, version: plan.stored.version + 1, updatedAt: r.tx.stamp }, sql`id=${plan.stored.id} AND version=${plan.stored.version}`); r.tx.insertRows(s.scheduleDraftEmployees, [...new Set(remaining.map(row => row.employeeId ?? r.view.state.shifts.find(shift => shift.id === row.shiftId)?.employeeId).filter((id): id is number => !!id))].map(employeeId => ({ draftId: plan.stored!.id, employeeId }))); }
  else r.tx.remove(s.scheduleDrafts, sql`id=${plan.stored.id}`);
}
