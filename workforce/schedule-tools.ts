import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { canonical, newRecordId } from "./contract";
import { WorkspaceTransaction } from "./transaction";
import { workspaceSnapshot } from "./snapshot";
import { scheduleChange } from "./schedule";
import { readScheduleConflicts } from "./conflicts";
import * as v from "./validation";
import type { Context, Database } from "./context";
import type { Shift } from "./model";
import { buildScheduleToolPlan, buildClearedSchedule, maxScheduleEntries, offsetScheduleDate, weekFor, workingPlan } from "../app/schedule-tools-model";
import type { ScheduleSelection, ScheduleSource, ScheduleToolChoice } from "../app/schedule-tools-model";

type Options = { secret: string; fieldKey: string; now?: () => number };
const canNotes = (ctx: Context) => ctx.permissions["schedule.notes.read"] && ctx.permissions["schedule.notes.manage"];
function selection(value: unknown): ScheduleSelection {
  const row = v.object(value); v.keys(row, ["departmentId", "roleId", "employeeIds"]);
  const employeeIds = row.employeeIds === null ? null : v.list(row.employeeIds, 500).map(id => v.integer(id));
  if (employeeIds && new Set(employeeIds).size !== employeeIds.length) throw new AuthError(400, "Select each team member once.");
  return { departmentId: row.departmentId === null ? null : v.integer(row.departmentId), roleId: row.roleId === null ? null : v.integer(row.roleId), employeeIds };
}
function week(value: unknown, start: number) {
  const date = v.date(value);
  if (date < "0002-01-01" || date > "9997-12-01" || weekFor(date, start) !== date) throw new AuthError(400, "Select the first day of a company workweek.");
  return date;
}
function source(value: unknown, start: number): ScheduleSource {
  const row = v.object(value), kind = v.oneOf(row.kind, ["week", "template"]);
  v.keys(row, kind === "week" ? ["kind", "weekStart"] : ["kind", "id"]);
  return kind === "week" ? { kind, weekStart: week(row.weekStart, start) } : { kind, id: v.integer(row.id) };
}
function templateScope(ctx: Context) { return sql`NOT EXISTS (SELECT 1 FROM schedule_template_entries te WHERE te.template_id = ${s.scheduleTemplates.id} AND (NOT (${ctx.employeeFilter(sql`te.employee_id`)}) OR NOT (${ctx.roleFilter(sql`te.role_id`)})))`; }
async function template(db: Database, ctx: Context, id: number) {
  const [header] = await db.select().from(s.scheduleTemplates).where(and(eq(s.scheduleTemplates.id, id), templateScope(ctx), ctx.activeActor())).limit(1);
  if (!header) throw new AuthError(404, "Template is not available in your current access.");
  return header;
}
async function revision(db: Database, ctx: Context, expected?: number) {
  const [row] = await db.select({ revision: s.workforceState.revision, start: s.locationSettings.workWeekStart }).from(s.workforceState).innerJoin(s.locationSettings, eq(s.locationSettings.businessId, 1)).where(and(eq(s.workforceState.id, 1), ctx.activeActor()));
  if (!row) throw new AuthError(401, "Sign in to continue.");
  if (expected !== undefined && row.revision !== expected) throw new AuthError(409, "Shared data changed. Close this dialog and reload before reviewing again.");
  return row;
}
async function context(db: Database, ctx: Context, options: Options, start: string, end: string, expected: number) {
  const view = await workspaceSnapshot(db, ctx, options.fieldKey, { start, end });
  if (view.revision !== expected) throw new AuthError(409, "Shared data changed. Reload before reviewing again.");
  const [roles, assignments, draftCount] = await db.batch([
    db.select().from(s.roles).where(and(eq(s.roles.archived, false), ctx.roleFilter(s.roles.id), ctx.activeActor())).limit(2001),
    db.select({ employeeId: s.employeeRoles.employeeId, roleId: s.employeeRoles.roleId }).from(s.employeeRoles).where(and(eq(s.employeeRoles.active, true), ctx.employeeFilter(s.employeeRoles.employeeId), ctx.activeActor())).limit(10001),
    db.select({ count: sql<number>`count(*)` }).from(s.scheduleDraftChanges).innerJoin(s.scheduleDrafts, eq(s.scheduleDrafts.id, s.scheduleDraftChanges.draftId)).where(and(eq(s.scheduleDrafts.ownerAccountId, ctx.account.id), ctx.activeActor())),
  ]);
  const draft = view.state.scheduleDraftsByManager[ctx.account.employeeId ?? -ctx.account.id];
  if (draftCount[0].count !== (draft?.upsertedShifts.length ?? 0) + (draft?.deletedShiftIds.length ?? 0)) throw new AuthError(403, "Your draft includes work outside your current access. Ask an Owner to help review it first.");
  if (roles.length > 2000 || assignments.length > 10000) throw new AuthError(503, "Too many assignments to review this operation safely.");
  return { view, draft, roles, assignments: new Set(assignments.map(row => `${row.employeeId}:${row.roleId}`)) };
}
function selectedRows(data: Awaited<ReturnType<typeof context>>, selected: ScheduleSelection) {
  if (selected.departmentId !== null && !data.view.state.departments.some(dept => dept.id === selected.departmentId)) throw new AuthError(403, "Department is outside your access.");
  if (selected.roleId !== null && !data.roles.some(role => role.id === selected.roleId)) throw new AuthError(403, "Role is outside your access.");
  if (selected.employeeIds?.some(id => !data.view.state.employees.some(employee => employee.id === id))) throw new AuthError(403, "Team member is outside your access.");
  return (shift: Shift) => data.roles.some(role => role.name === shift.role && (selected.roleId === null || selected.roleId === role.id) && (selected.departmentId === null || selected.departmentId === role.departmentId)) && (selected.employeeIds === null || selected.employeeIds.includes(shift.employeeId));
}
async function sourceRows(db: Database, ctx: Context, from: ScheduleSource, data: Awaited<ReturnType<typeof context>>, start: number): Promise<Shift[]> {
  if (from.kind === "template") {
    const header = await template(db, ctx, from.id); if (header.archivedAt) throw new AuthError(409, "Restore this template before applying it.");
    const rows = await db.select().from(s.scheduleTemplateEntries).where(and(eq(s.scheduleTemplateEntries.templateId, header.id), ctx.activeActor())).limit(maxScheduleEntries + 1);
    if (rows.length > maxScheduleEntries) throw new AuthError(400, "This template is too large.");
    return rows.map(row => ({ id: row.id, employeeId: row.employeeId, date: offsetScheduleDate("2026-11-08", row.dayOfWeek), start: row.startTime, end: row.endTime, role: data.roles.find(role => role.id === row.roleId)?.name ?? "Unavailable role", station: row.station, notes: canNotes(ctx) ? row.notes : "", shiftType: row.shiftType, color: row.color }));
  }
  const rows = await db.select({ id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime, role: sql<string>`COALESCE(${s.roles.name}, ${s.shifts.roleName})`.as("source_role"), station: s.shifts.station, notes: canNotes(ctx) ? s.shifts.notes : sql<string>`''`.as("notes"), shiftType: s.shifts.shiftType, color: s.shifts.color }).from(s.shifts).leftJoin(s.roles, eq(s.roles.id, s.shifts.roleId)).where(and(isNull(s.shifts.archivedAt), sql`${s.shifts.date} BETWEEN ${from.weekStart} AND ${offsetScheduleDate(from.weekStart, 6)}`, ctx.employeeFilter(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId), ctx.activeActor())).limit(2001);
  if (rows.length > 2000) throw new AuthError(400, "Choose a smaller source week.");
  return workingPlan(rows, data.draft).filter(shift => weekFor(shift.date, start) === from.weekStart);
}
function sourceIssues(rows: Shift[], data: Awaited<ReturnType<typeof context>>) {
  const issues = new Set<string>();
  for (const row of rows) {
    const employee = data.view.state.employees.find(employee => employee.id === row.employeeId), role = data.roles.find(role => role.name === row.role);
    if (!employee?.active || employee.terminated || !role || !data.assignments.has(`${row.employeeId}:${role.id}`)) issues.add(`${employee?.name ?? "A source team member"}: this entry needs an active employee and a currently assigned job. Update the source week/template before copying.`);
  }
  return [...issues];
}

export async function scheduleTools(db: Database, ctx: Context, body: Record<string, unknown>, options: Options) {
  ctx.requirePermission("schedule.read"); ctx.requirePermission("schedule.manage");
  const action = v.oneOf(body.action, ["list", "save-template", "rename-template", "archive-template", "preview", "apply", "clear-preview", "clear"]);
  if (action === "list") {
    v.keys(body, ["action", "archived", "cursor"]); const archived = v.boolean(body.archived), cursor = body.cursor === undefined ? Number.MAX_SAFE_INTEGER : v.integer(body.cursor);
    const meta = await revision(db, ctx);
    const rows = await db.select({ id: s.scheduleTemplates.id, name: s.scheduleTemplates.name, version: s.scheduleTemplates.version, archivedAt: s.scheduleTemplates.archivedAt, entries: sql<number>`(SELECT count(*) FROM schedule_template_entries te WHERE te.template_id = schedule_templates.id)` }).from(s.scheduleTemplates).where(and(templateScope(ctx), ctx.activeActor(), archived ? sql`${s.scheduleTemplates.archivedAt} IS NOT NULL` : isNull(s.scheduleTemplates.archivedAt), sql`${s.scheduleTemplates.id} < ${cursor}`)).orderBy(desc(s.scheduleTemplates.id)).limit(51);
    const roles = await db.select({ id: s.roles.id, name: s.roles.name, departmentId: s.roles.departmentId }).from(s.roles).where(and(eq(s.roles.archived, false), ctx.roleFilter(s.roles.id), ctx.activeActor())).limit(2001);
    if (roles.length > 2000) throw new AuthError(503, "Too many job roles to review safely.");
    await revision(db, ctx, meta.revision);
    return { roles, revision: meta.revision, templates: rows.slice(0, 50).map(row => ({ id: row.id, name: row.name, version: row.version, entries: row.entries, archived: !!row.archivedAt })), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  const expected = v.integer(body.revision, 0), mutation = action !== "preview" && action !== "clear-preview";
  const id = mutation && tokenIsValid(body.id) ? body.id : null;
  if (mutation && !id) throw new AuthError(400, "Invalid save identifier.");
  const hash = rateKey(options.secret, canonical(body));
  if (id) {
    const [previous] = await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id, id), ctx.activeActor())).limit(1);
    if (previous) { if (previous.accountId !== ctx.account.id || previous.bodyHash !== hash) throw new AuthError(409, "This save identifier is already in use."); return { saved: true, revision: previous.revision }; }
  }
  const meta = await revision(db, ctx, expected), stamp = new Date((options.now ?? Date.now)()).toISOString();
  const tx = new WorkspaceTransaction(db, ctx, id ?? "preview", stamp);
  async function commit(result: Record<string, unknown>, entity: string) {
    if (!await tx.commit(expected, hash, [entity])) throw new AuthError(409, "Your access or this workspace changed. Reload before saving.");
    return { saved: true, revision: expected + 1, ...result };
  }
  if (action === "rename-template" || action === "archive-template") {
    v.keys(body, ["action", "id", "revision", "templateId", ...(action === "rename-template" ? ["name"] : ["archived"])]);
    const header = await template(db, ctx, v.integer(body.templateId));
    const values = action === "rename-template" ? { name: v.text(body.name, 100, true) } : { archivedAt: v.boolean(body.archived) ? stamp : null };
    tx.update(s.scheduleTemplates, { ...values, version: header.version + 1, updatedAt: stamp }, sql`id = ${header.id} AND version = ${header.version}`);
    tx.insert(s.auditLog, { actorAccountId: ctx.account.id, action: `schedule.template_${action === "rename-template" ? "renamed" : body.archived ? "archived" : "restored"}`, entityType: "schedule-template", entityId: String(header.id), metadata: { version: header.version + 1 }, createdAt: stamp });
    return commit({ templateId: header.id }, "schedule-template");
  }
  if (action === "clear-preview" || action === "clear") {
    v.keys(body, ["action", "revision", "weekStart", "selection", "templateName", "includeNotes", ...(action === "clear" ? ["id", "reviewToken"] : [])]);
    const from = week(body.weekStart, meta.start), selected = selection(body.selection), templateName = body.templateName === null ? null : v.text(body.templateName, 100, true), includeNotes = v.boolean(body.includeNotes);
    if (includeNotes && templateName && !canNotes(ctx)) throw new AuthError(403, "Viewing and managing notes are required to include them in a template.");
    const data = await context(db, ctx, options, from, offsetScheduleDate(from, 6), expected), matches = selectedRows(data, selected);
    const result = buildClearedSchedule(data.view.state.shifts, data.draft, row => weekFor(row.date, meta.start) === from && matches(row));
    const issues = templateName ? sourceIssues(result.removed, data) : [];
    if (!result.removed.length) issues.push("There are no entries to clear in this selection.");
    if (result.draft.upsertedShifts.length > maxScheduleEntries || result.draft.deletedShiftIds.length > maxScheduleEntries) issues.push("This would exceed the 500-entry draft limit. Clear a smaller selection.");
    const reviewed = rateKey(options.secret, canonical({ actor: ctx.account.id, revision: expected, from, selected, templateName, includeNotes }));
    if (action === "clear-preview") { await revision(db, ctx, expected); return { revision: expected, reviewToken: reviewed, cleared: result.removed.length, publishedRemovals: result.publishedRemovals.length, discardedDraftEntries: result.discardedDraftEntries, templateEntries: templateName ? result.removed.length : 0, issues, entries: result.removed.map(row => ({ id: row.id, employee: data.view.state.employees.find(employee => employee.id === row.employeeId)?.name ?? "Team member", date: row.date, label: `${row.shiftType === "day_off" ? "Day off" : `${row.start}–${row.end}`} · ${row.role}` })) }; }
    if (body.reviewToken !== reviewed) throw new AuthError(409, "Review these exact clearing choices before saving.");
    if (issues.length) throw new AuthError(409, issues[0]);
    let templateId: number | undefined;
    if (templateName) {
      templateId = newRecordId(); tx.insert(s.scheduleTemplates, { id: templateId, name: templateName, createdByAccountId: ctx.account.id });
      tx.insertRows(s.scheduleTemplateEntries, result.removed.map(row => ({ templateId, employeeId: row.employeeId, roleId: data.roles.find(role => role.name === row.role)!.id, dayOfWeek: new Date(`${row.date}T12:00:00Z`).getUTCDay(), startTime: row.start, endTime: row.end, station: row.station, notes: includeNotes ? row.notes ?? "" : "", shiftType: row.shiftType ?? "work", color: row.color ?? "blue" })));
      tx.insert(s.auditLog, { actorAccountId: ctx.account.id, action: "schedule.template_created_before_clear", entityType: "schedule-template", entityId: String(templateId), metadata: { entries: result.removed.length, sourceWeek: from }, createdAt: stamp });
    }
    await scheduleChange({ db, ctx, tx, view: data.view, roles: data.roles, fieldKey: options.fieldKey, today: stamp.slice(0, 10) }, { entity: "schedule-draft", id: 1, before: data.draft ?? null, after: result.draft });
    tx.insert(s.auditLog, { actorAccountId: ctx.account.id, action: "schedule.week_cleared_in_draft", entityType: "schedule-draft", entityId: String(ctx.account.id), metadata: { weekStart: from, entries: result.removed.length, savedTemplate: !!templateId }, createdAt: stamp });
    return commit({ cleared: result.removed.length, ...(templateId ? { templateId } : {}) }, "schedule-draft");
  }
  if (action === "save-template") {
    v.keys(body, ["action", "id", "revision", "name", "weekStart", "selection", "includeNotes", "templateId"]);
    const from = week(body.weekStart, meta.start), data = await context(db, ctx, options, from, offsetScheduleDate(from, 6), expected), selected = selectedRows(data, selection(body.selection));
    const notes = v.boolean(body.includeNotes); if (notes && !canNotes(ctx)) throw new AuthError(403, "Viewing and managing shift notes are required to include them.");
    const rows = (await sourceRows(db, ctx, { kind: "week", weekStart: from }, data, meta.start)).filter(selected);
    if (!rows.length || rows.length > maxScheduleEntries) throw new AuthError(400, `Choose between 1 and ${maxScheduleEntries} entries to save.`);
    const issues = sourceIssues(rows, data); if (issues.length) throw new AuthError(409, issues[0]);
    const header = body.templateId === undefined ? null : await template(db, ctx, v.integer(body.templateId));
    if (header?.archivedAt) throw new AuthError(409, "Restore this template before replacing it.");
    if (header && !ctx.permissions["schedule.notes.manage"] && await db.get(sql`SELECT 1 FROM schedule_template_entries WHERE template_id = ${header.id} AND notes != '' LIMIT 1`)) throw new AuthError(403, "Managing shift notes is required to replace a template containing notes.");
    const templateId = header?.id ?? newRecordId(), name = v.text(body.name, 100, true);
    if (header) { tx.update(s.scheduleTemplates, { name, version: header.version + 1, updatedAt: stamp }, sql`id = ${templateId} AND version = ${header.version}`); tx.remove(s.scheduleTemplateEntries, sql`template_id = ${templateId}`); }
    else tx.insert(s.scheduleTemplates, { id: templateId, name, createdByAccountId: ctx.account.id });
    tx.insertRows(s.scheduleTemplateEntries, rows.map(row => ({ templateId, employeeId: row.employeeId, roleId: data.roles.find(role => role.name === row.role)!.id, dayOfWeek: new Date(`${row.date}T12:00:00Z`).getUTCDay(), startTime: row.start, endTime: row.end, station: row.station, notes: notes ? row.notes ?? "" : "", shiftType: row.shiftType ?? "work", color: row.color ?? "blue" })));
    tx.insert(s.auditLog, { actorAccountId: ctx.account.id, action: header ? "schedule.template_replaced" : "schedule.template_created", entityType: "schedule-template", entityId: String(templateId), metadata: { entries: rows.length, sourceWeek: from }, createdAt: stamp });
    return commit({ templateId }, "schedule-template");
  }
  v.keys(body, ["action", "revision", "source", "targets", "selection", "mode", "includeNotes", ...(action === "apply" ? ["id", "reviewToken"] : [])]);
  const from = source(body.source, meta.start), targets = v.list(body.targets, 4).map(date => week(date, meta.start)).sort();
  if (!targets.length || new Set(targets).size !== targets.length || Date.parse(targets.at(-1)!) - Date.parse(targets[0]) > 21 * 86400000) throw new AuthError(400, "Choose one to four weeks within a four-week period.");
  if (from.kind === "week" && targets.some(date => date <= from.weekStart)) throw new AuthError(400, "Copy a week to a later workweek.");
  const choice: ScheduleToolChoice = { revision: expected, source: from, targets, selection: selection(body.selection), mode: v.oneOf(body.mode, ["add", "replace"]), includeNotes: v.boolean(body.includeNotes) };
  if (choice.includeNotes && !canNotes(ctx)) throw new AuthError(403, "Viewing and managing shift notes are required to include them.");
  const reviewToken = rateKey(options.secret, canonical({ actor: ctx.account.id, choice }));
  if (action === "apply" && body.reviewToken !== reviewToken) throw new AuthError(409, "Review these exact draft changes before applying them.");
  const data = await context(db, ctx, options, targets[0], offsetScheduleDate(targets.at(-1)!, 6), expected), selected = selectedRows(data, choice.selection);
  const allSource = await sourceRows(db, ctx, from, data, meta.start);
  // Missing/archived template jobs must be disclosed, never silently dropped.
  const unavailable = allSource.filter(row => !data.roles.some(role => role.name === row.role));
  const rows = allSource.filter(selected);
  let next = 0;
  const result = buildScheduleToolPlan({ source: rows, targets, weekStart: meta.start, published: data.view.state.shifts, draft: data.draft, mode: choice.mode, selected, includeNotes: choice.includeNotes, nextId: action === "preview" ? () => --next : newRecordId });
  result.issues.push(...sourceIssues([...rows, ...unavailable], data));
  // Check complete employee days, including private shifts from other departments.
  const affected = [...new Set(result.copied.map(row => row.employeeId))];
  const privateRows = await db.select({ id: s.shifts.id, employeeId: s.shifts.employeeId, date: s.shifts.date, start: s.shifts.startTime, end: s.shifts.endTime, shiftType: s.shifts.shiftType }).from(s.shifts).where(and(isNull(s.shifts.archivedAt), sql`${s.shifts.date} BETWEEN ${targets[0]} AND ${offsetScheduleDate(targets.at(-1)!, 6)}`, sql`${s.shifts.employeeId} IN (SELECT value FROM json_each(${JSON.stringify(affected)}))`, ctx.employeeFilter(s.shifts.employeeId), ctx.activeActor())).limit(5001);
  if (privateRows.length > 5000) throw new AuthError(503, "Too many scheduled entries to review safely.");
  const { shiftLayoutError } = await import("../app/shift-builder");
  const privatePlan = workingPlan(privateRows.map(row => ({ ...row, role: "", station: "" })), result.draft);
  const layoutError = shiftLayoutError(privatePlan); if (layoutError && !result.issues.includes(layoutError)) result.issues.push(layoutError);
  if (action === "preview") {
    await revision(db, ctx, expected);
    const warnings = result.issues.length ? { revision: expected, availability: ctx.permissions["availability.read"], timeOff: ctx.permissions["time_off.read"], warnings: [] } : await readScheduleConflicts(db, ctx, { period: { start: targets[0], end: offsetScheduleDate(targets.at(-1)!, 6) }, revision: expected, upserts: result.draft.upsertedShifts.map(row => ({ id: row.id, employeeId: row.employeeId, date: row.date, start: row.start, end: row.end, role: row.role, shiftType: row.shiftType ?? "work" })), deletedShiftIds: result.draft.deletedShiftIds });
    return { revision: expected, reviewToken, added: result.copied.length, replaced: result.removed.length, targets, shifts: result.plan.filter(row => targets.includes(weekFor(row.date, meta.start))).map(row => ({ ...row, notes: ctx.permissions["schedule.notes.read"] ? row.notes : "" })), warnings, issues: result.issues };
  }
  if (result.issues.length) throw new AuthError(409, result.issues[0]);
  await scheduleChange({ db, ctx, tx, view: data.view, roles: data.roles, fieldKey: options.fieldKey, today: stamp.slice(0, 10) }, { entity: "schedule-draft", id: 1, before: data.draft ?? null, after: result.draft });
  tx.insert(s.auditLog, { actorAccountId: ctx.account.id, action: "schedule.draft_copied", entityType: "schedule-draft", entityId: String(ctx.account.id), metadata: { source: from, targets, mode: choice.mode, added: result.copied.length, replaced: result.removed.length }, createdAt: stamp });
  return commit({ added: result.copied.length, replaced: result.removed.length }, "schedule-draft");
}
