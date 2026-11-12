import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import * as s from "../db/schema";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { defaultInfo, emptyState } from "./contract";
import type { WorkspaceData, StaffState } from "./contract";
import type { Context, Database } from "./context";
import { decryptSsn } from "./private";
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
import { workspacePeriod, offsetDate } from "./period";
import type { WorkspacePeriod } from "./period";
// SQLite CURRENT_TIMESTAMP is UTC but omits its zone; never let a browser treat it as local time.
const timestamp = (value: string) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + ".000Z" : value;
export async function workspaceSnapshot(db: Database, ctx: Context, fieldKey: string, period: WorkspacePeriod = workspacePeriod()): Promise<WorkspaceData> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  period = workspacePeriod(period);
  const dates = (column: SQLWrapper) => sql`${column} >= ${period.start} AND ${column} <= ${period.end}`;
  // Include whole overnight cards at either edge, including their immutable events
  // and correction history. UTC date padding also covers the location offset/DST.
  const paddedStart = offsetDate(period.start, -2), paddedEnd = offsetDate(period.end, 2);
  const cardDates = (column: SQLWrapper) => sql`${column} >= ${paddedStart} AND ${column} <= ${paddedEnd}`;
  const shiftIds = sql`${s.shifts.id} IN (
    SELECT id FROM shifts WHERE date >= ${period.start} AND date <= ${period.end}
    UNION SELECT dc.shift_id FROM schedule_draft_changes dc JOIN schedule_drafts sd ON sd.id = dc.draft_id WHERE sd.owner_account_id = ${ctx.account.id})`;
  // Drive range reads through the existing (employee_id, occurred_at) index.
  // Carry at most one prior work event and break state per employee when a
  // session crosses the window; never download its entire historical stream.
  const priorWork = sql`(SELECT w.id FROM clock_events w WHERE w.employee_id = e.id AND w.event_type IN ('in','out') AND w.occurred_at < ${paddedStart} ORDER BY w.occurred_at DESC, w.id DESC LIMIT 1)`;
  const clockIds = sql`${s.clockEvents.id} IN (
    SELECT c.id FROM employees e JOIN clock_events c ON c.employee_id = e.id
      WHERE c.occurred_at >= ${paddedStart} AND c.occurred_at < ${offsetDate(paddedEnd, 1)}
    UNION SELECT c.id FROM employees e JOIN clock_events c ON c.id IN (
      ${priorWork}, (SELECT b.id FROM clock_events b WHERE b.employee_id = e.id AND b.event_type IN ('break','break_end') AND b.occurred_at < ${paddedStart} ORDER BY b.occurred_at DESC, b.id DESC LIMIT 1))
      JOIN clock_events w ON w.id = ${priorWork}
      WHERE w.event_type = 'in' AND c.occurred_at >= w.occurred_at
      AND NOT EXISTS (SELECT 1 FROM time_card_edits ed, json_each(ed.before, '$.eventIds') removed WHERE ed.employee_id = e.id AND removed.value = w.id))`;
  const p = ctx.permissions; const hasTeam = p["team.read"] || p["schedule.read"] || p["timesheets.read"] || p["time_off.read"] || p["availability.read"];
  const employeeScope = (column: SQLWrapper) => ctx.employeeFilter(column);
  const canEmployee = (column: SQLWrapper) => or(employeeScope(column), sql`${column} = ${ctx.account.employeeId ?? -1}`)!;
  const deptScope = (column: SQLWrapper) => ctx.allDepartments ? sql`1 = 1` : inArray(column, ctx.departmentIds.length ? ctx.departmentIds : [-1]);
  const allowed = (flag: boolean) => sql`${flag ? 1 : 0} = 1`;
  const member = sql`EXISTS (SELECT 1 FROM conversation_members cm JOIN employees ce ON ce.id = cm.employee_id
    WHERE cm.conversation_id = ${s.conversations.id} AND cm.employee_id = ${ctx.account.employeeId ?? -1}
    AND cm.left_at IS NULL AND ce.active = 1 AND ce.terminated = 0)`;
  const memberConversation = db.select({ id: s.conversations.id }).from(s.conversations).where(and(member, isNull(s.conversations.archivedAt), allowed(p["messages.read"])));
  const clockScope = ctx.allDepartments ? sql`1 = 1` : sql`EXISTS (SELECT 1 FROM roles r JOIN departments d ON d.id = r.department_id
    WHERE r.name = ${s.clockEvents.roleName} AND r.archived = 0 AND d.archived = 0 AND ${deptScope(sql`d.id`)})`;
  const ownEmployee = ctx.account.employeeId ?? -1;
  const privateScope = (column: SQLWrapper) => and(canEmployee(column), or(allowed(p["team.read"] && p["team.private.read"]), sql`${column} = ${ownEmployee}`));
  // Unique SQL names keep D1's positional result mapping intact when several
  // hidden fields are projected as NULL or an empty string.
  const employeeFields = { id: s.employees.id, name: s.employees.name, email: p["team.read"] && p["team.contact.read"] ? s.employees.email : sql<string>`CASE WHEN ${s.employees.id} = ${ownEmployee} THEN ${s.employees.email} ELSE '' END`.as("email"), phone: p["team.read"] && p["team.contact.read"] ? s.employees.phone : sql<string>`CASE WHEN ${s.employees.id} = ${ownEmployee} THEN ${s.employees.phone} ELSE '' END`.as("phone"), active: s.employees.active, terminated: s.employees.terminated, startDate: s.employees.startDate,
    roleId: s.employees.roleId, payrollId: (p["team.read"] && p["team.private.read"]) || (p["timesheets.read"] && p["exports.timesheets"]) ? s.employees.payrollId : sql<string>`''`.as("payroll_id"), payrollClassification: sql<"W-2 Employee" | "1099 Contractor" | null>`CASE WHEN ${s.employees.id} = ${ownEmployee} OR ${p["team.read"] && p["team.private.read"] ? 1 : 0} = 1 THEN ${s.employees.payrollClassification} ELSE NULL END`.as("payroll_classification"),
    terminationReason: p["team.read"] && p["team.private.read"] ? s.employees.terminationReason : sql<string | null>`NULL`.as("termination_reason"), terminationDate: s.employees.terminationDate,
    terminationNote: p["team.read"] && p["team.private.read"] ? s.employees.terminationNote : sql<string | null>`NULL`.as("termination_note"), eligibleForRehire: p["team.read"] && p["team.private.read"] ? s.employees.eligibleForRehire : sql<boolean | null>`NULL`.as("eligible_for_rehire"), version: s.employees.version };
  // D1's read batch provides one transactionally consistent multi-table snapshot.
  const [revision, businesses, settingsRows, accounts, employees, departments, roles, assignments, managers, employeeSettings, profiles, wages, notes, history, certificates, labels,
    shifts, publications, drafts, draftChanges, draftEmployees, events, rawClocks, cards, edits, adjustments, policies, policyAssignments, pto, availability, slots, conversations, members, messages, reads, notices, receipts, photos, teamConfig] = await db.batch([
    db.select().from(s.workforceState), db.select().from(s.business), db.select().from(s.locationSettings),
    db.select({ id: s.accounts.id, employeeId: s.accounts.employeeId, name: s.accounts.displayName, level: s.accounts.accessLevel }).from(s.accounts),
    db.select(employeeFields).from(s.employees).where(and(canEmployee(s.employees.id), or(allowed(hasTeam), eq(s.employees.id, ownEmployee)))).orderBy(s.employees.id),
    db.select().from(s.departments).where(and(eq(s.departments.archived, false), deptScope(s.departments.id))).orderBy(s.departments.id),
    db.select().from(s.roles).where(and(eq(s.roles.archived, false), ctx.roleFilter(s.roles.id))).orderBy(s.roles.id),
    db.select().from(s.employeeRoles).where(and(eq(s.employeeRoles.active, true), canEmployee(s.employeeRoles.employeeId))),
    db.select().from(s.departmentManagers).where(deptScope(s.departmentManagers.departmentId)),
    db.select().from(s.employeeSettings).where(canEmployee(s.employeeSettings.employeeId)),
    db.select().from(s.employeeProfiles).where(privateScope(s.employeeProfiles.employeeId)),
    db.select().from(s.wageRates).where(and(allowed(p["wages.read"] && (p["team.read"] || p["timesheets.read"])), employeeScope(s.wageRates.employeeId), ctx.allDepartments ? sql`1 = 1` : ctx.roleFilter(s.wageRates.roleId))).orderBy(desc(s.wageRates.effectiveDate), desc(s.wageRates.id)),
    db.select().from(s.employeeNotes).where(and(allowed(p["team.read"] && p["team.notes.read"]), employeeScope(s.employeeNotes.employeeId))).orderBy(s.employeeNotes.id),
    db.select().from(s.employmentHistory).where(and(allowed(p["team.read"] && p["team.private.read"]), employeeScope(s.employmentHistory.employeeId))).orderBy(s.employmentHistory.createdAt, s.employmentHistory.id),
    db.select({ id: s.employeeCertificates.id, employeeId: s.employeeCertificates.employeeId, name: s.employeeCertificates.name, expirationDate: s.employeeCertificates.expirationDate, fileId: s.employeeCertificates.fileId, fileName: s.files.fileName }).from(s.employeeCertificates).leftJoin(s.files, and(eq(s.files.id, s.employeeCertificates.fileId), eq(s.files.status, "ready"))).where(and(allowed(p["team.read"] && p["documents.read"]), employeeScope(s.employeeCertificates.employeeId))),
    db.select({ employeeId: s.onboardingDocumentLabels.employeeId, documentName: s.onboardingDocumentLabels.documentName, fileName: s.onboardingDocumentLabels.fileName, fileId: s.onboardingDocumentFiles.fileId }).from(s.onboardingDocumentLabels).leftJoin(s.onboardingDocumentFiles, and(eq(s.onboardingDocumentFiles.employeeId, s.onboardingDocumentLabels.employeeId), eq(s.onboardingDocumentFiles.documentName, s.onboardingDocumentLabels.documentName))).where(and(allowed(p["team.read"] && p["documents.read"] && p["team.private.read"]), employeeScope(s.onboardingDocumentLabels.employeeId))),
    db.select().from(s.shifts).where(and(allowed(p["schedule.read"]), isNull(s.shifts.archivedAt), shiftIds, employeeScope(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId))).orderBy(s.shifts.date, s.shifts.id),
    db.select().from(s.schedulePublications).orderBy(desc(s.schedulePublications.id)).limit(1),
    db.select().from(s.scheduleDrafts).where(and(allowed(p["schedule.manage"]), eq(s.scheduleDrafts.ownerAccountId, ctx.account.id))).limit(1),
    db.select().from(s.scheduleDraftChanges).where(sql`${allowed(p["schedule.manage"])} AND EXISTS (SELECT 1 FROM schedule_drafts sd WHERE sd.id = ${s.scheduleDraftChanges.draftId} AND sd.owner_account_id = ${ctx.account.id}) AND ${ctx.roleFilter(s.scheduleDraftChanges.roleId)}`),
    db.select().from(s.scheduleDraftEmployees).where(sql`EXISTS (SELECT 1 FROM schedule_drafts sd WHERE sd.id = ${s.scheduleDraftEmployees.draftId} AND sd.owner_account_id = ${ctx.account.id}) AND ${employeeScope(s.scheduleDraftEmployees.employeeId)}`),
    db.select().from(s.scheduleEvents).where(and(allowed(p["schedule.read"]), dates(s.scheduleEvents.date))).orderBy(s.scheduleEvents.date),
    db.select().from(s.clockEvents).where(and(allowed(p["timesheets.read"]), employeeScope(s.clockEvents.employeeId), clockScope, clockIds)).orderBy(s.clockEvents.id),
    db.select().from(s.timeCards).where(and(allowed(p["timesheets.read"]), employeeScope(s.timeCards.employeeId), cardDates(s.timeCards.workDate), ctx.allDepartments ? sql`1 = 1` : ctx.roleFilter(s.timeCards.roleId))),
    db.select().from(s.timeCardEdits).where(sql`${allowed(p["timesheets.read"])} AND ${employeeScope(s.timeCardEdits.employeeId)} AND EXISTS (SELECT 1 FROM time_cards tc WHERE tc.id = ${s.timeCardEdits.cardId} AND ${cardDates(sql`tc.work_date`)} AND ${ctx.allDepartments ? sql`1 = 1` : ctx.roleFilter(sql`tc.role_id`)})`).orderBy(s.timeCardEdits.createdAt, s.timeCardEdits.id),
    db.select().from(s.hoursAdjustments).where(and(allowed(p["timesheets.read"] && ctx.allDepartments), employeeScope(s.hoursAdjustments.employeeId), dates(s.hoursAdjustments.date))).orderBy(s.hoursAdjustments.id),
    db.select().from(s.ptoPolicies).where(and(allowed(p["time_off.read"]), eq(s.ptoPolicies.archived, false))).orderBy(s.ptoPolicies.id),
    db.select().from(s.ptoAssignments).where(and(allowed(p["time_off.read"]), employeeScope(s.ptoAssignments.employeeId))),
    db.select().from(s.ptoRequests).where(and(isNull(s.ptoRequests.archivedAt), or(and(allowed(p["time_off.read"]), employeeScope(s.ptoRequests.employeeId)), eq(s.ptoRequests.employeeId, ownEmployee)))).orderBy(s.ptoRequests.requestedAt, s.ptoRequests.id),
    db.select().from(s.availabilityRequests).where(or(and(allowed(p["availability.read"]), employeeScope(s.availabilityRequests.employeeId)), eq(s.availabilityRequests.employeeId, ownEmployee))).orderBy(s.availabilityRequests.submittedAt, s.availabilityRequests.id),
    db.select().from(s.availabilitySlots).where(sql`EXISTS (SELECT 1 FROM availability_requests ar WHERE ar.id = ${s.availabilitySlots.requestId} AND (${allowed(p["availability.read"])} AND ${employeeScope(sql`ar.employee_id`)} OR ar.employee_id = ${ownEmployee}))`),
    db.select().from(s.conversations).where(and(member, isNull(s.conversations.archivedAt), allowed(p["messages.read"]))).orderBy(s.conversations.id),
    db.select().from(s.conversationMembers).where(inArray(s.conversationMembers.conversationId, memberConversation)),
    db.select().from(s.messages).where(inArray(s.messages.conversationId, memberConversation)).orderBy(s.messages.sentAt, s.messages.id),
    db.select().from(s.messageReads).where(inArray(s.messageReads.conversationId, memberConversation)),
    db.select().from(s.notifications).where(eq(s.notifications.employeeId, ownEmployee)).orderBy(s.notifications.occurredAt),
    db.select().from(s.notificationReceipts).where(eq(s.notificationReceipts.accountId, ctx.account.id)),
    db.select().from(s.employeePhotos).where(canEmployee(s.employeePhotos.employeeId)),
    db.select().from(s.teamSettings).limit(1),
  ]);
  const business = businesses[0]; const settings = normalizeScheduleEnforcement(settingsRows[0]);
  const owner = accounts.find(row => row.id === business?.primaryOwnerAccountId);
  const basicInfo = { ...defaultInfo, ...Object.fromEntries(Object.keys(defaultInfo).filter(key => key !== "accountOwner").map(key => [key, business?.[key as keyof typeof business] ?? defaultInfo[key as keyof typeof defaultInfo]])), accountOwner: owner?.name ?? "" };
  const state = emptyState();
  state.employees = employees.map(employee => {
    const profile = profiles.find(row => row.employeeId === employee.id); const account = accounts.find(row => row.employeeId === employee.id);
    const role = roles.find(role => role.id === employee.roleId) ?? roles.find(role => assignments.some(a => a.employeeId === employee.id && a.roleId === role.id));
    const wage = wages.find(row => row.employeeId === employee.id && row.effectiveDate <= today && (!role || row.roleId === role.id || row.roleId === null));
    const locationSettings = employeeSettings.find(row => row.employeeId === employee.id);
    return { id: employee.id, name: employee.name, email: employee.email, phone: employee.phone, accessLevel: account?.level === "owner" ? "Admin" : account?.level === "manager" || account?.level === "general_manager" ? "Manager" : "Employee",
      location: basicInfo.locationName, role: role?.name ?? "", wage: wage ? `$${(wage.amountCents / 100).toFixed(2)}${wage.basis === "annual_salary" ? "/year" : "/hr"}` : "", pin: "", active: employee.active, terminated: employee.terminated,
      jobs: roles.filter(role => assignments.some(a => a.employeeId === employee.id && a.roleId === role.id)).sort((a, b) => Number(b.id === employee.roleId) - Number(a.id === employee.roleId) || a.id - b.id).map(role => ({ id: role.id, name: role.name, departmentId: role.departmentId })),
      wageRates: wages.filter(w => w.employeeId === employee.id).map(w => ({ id: w.id, roleId: w.roleId, role: roles.find(r => r.id === w.roleId)?.name ?? "", amountCents: w.amountCents, basis: w.basis, effectiveDate: w.effectiveDate, overtimeExempt: w.overtimeExempt })),
      photoFileId: photos.find(photo => photo.employeeId === employee.id)?.fileId,
      startDate: employee.startDate ?? "", payrollId: employee.payrollId, payrollClassification: employee.payrollClassification ?? undefined,
      legalFirstName: profile?.legalFirstName ?? "", legalMiddleName: profile?.legalMiddleName ?? "", legalLastName: profile?.legalLastName ?? "", dateOfBirth: profile?.dateOfBirth ?? "", socialSecurityNumber: profile?.ssnEncrypted ? `•••-••-${decryptSsn(profile.ssnEncrypted, employee.id, fieldKey).replace(/\D/g, "").slice(-4)}` : "",
      homeAddress: profile?.homeAddress ?? "", homeAddressLine2: profile?.homeAddressLine2 ?? "", homeCity: profile?.homeCity ?? "", homeStateProvince: profile?.homeStateProvince ?? "", homePostalCode: profile?.homePostalCode ?? "", homeCityStateZip: [profile?.homeCity, profile?.homeStateProvince, profile?.homePostalCode].filter(Boolean).join(" "),
      emergencyContact: profile?.emergencyContact ?? "", emergencyContactRelationship: profile?.emergencyContactRelationship ?? "", emergencyContactPhone: profile?.emergencyContactPhone ?? "", emergencyContactPreference: profile?.emergencyContactPreference ?? "",
      locationSettings: { showInSchedule: locationSettings?.showInSchedule ?? true, sendLocationAlerts: locationSettings?.sendLocationAlerts ?? true, includeInTimeClockErrors: locationSettings?.includeInTimeClockErrors ?? true, eligibleForOpenShifts: locationSettings?.eligibleForOpenShifts ?? true, canWaiveMissedBreaks: locationSettings?.canWaiveMissedBreaks ?? false },
      terminationReason: employee.terminationReason ?? undefined, terminationDate: employee.terminationDate ?? undefined, terminationNote: employee.terminationNote ?? undefined, eligibleForRehire: employee.eligibleForRehire ?? undefined,
      employmentHistory: history.filter(row => row.employeeId === employee.id).map(row => ({ type: row.eventType, date: row.date, reason: row.reason || undefined })),
      managerNotes: notes.filter(row => row.employeeId === employee.id).map(row => ({ id: row.id, text: row.body, createdAt: row.createdAt })),
      certificates: certificates.filter(row => row.employeeId === employee.id).map(row => ({ id: row.id, name: row.name, expirationDate: row.expirationDate ?? undefined, fileName: row.fileName ?? "", fileId: row.fileId ?? undefined })),
      onboardingDocuments: Object.fromEntries(labels.filter(row => row.employeeId === employee.id).map(row => [row.documentName, row.fileName])),
      onboardingFileIds: Object.fromEntries(labels.filter(row => row.employeeId === employee.id && row.fileId).map(row => [row.documentName, row.fileId!])),
    };
  });
  state.departments = departments.map(dept => ({ id: dept.id, name: dept.name, roles: roles.filter(role => role.departmentId === dept.id).map(role => role.name), managerIds: managers.filter(row => row.departmentId === dept.id).flatMap(row => { const account = accounts.find(a => a.id === row.accountId); return account?.employeeId ? [account.employeeId] : []; }) }));
  state.shifts = shifts.map(row => ({ id: row.id, employeeId: row.employeeId, date: row.date, start: row.startTime, end: row.endTime, role: row.roleName || roles.find(role => role.id === row.roleId)?.name || "", station: row.station, ...(p["schedule.notes.read"] ? { notes: row.notes } : {}) }));
  state.scheduleHasBeenPublished = publications.length > 0;
  const draftKey = ctx.account.employeeId ?? -ctx.account.id;
  if (drafts[0]) state.scheduleDraftsByManager[draftKey] = {
    upsertedShifts: draftChanges.filter(row => row.operation === "upsert").map(row => ({ id: row.shiftId ?? Number(row.clientKey), employeeId: row.employeeId!, date: row.date!, start: row.startTime!, end: row.endTime!, role: row.roleName!, station: row.station ?? "Floor", ...(p["schedule.notes.read"] ? { notes: row.notes ?? "" } : {}) })),
    deletedShiftIds: draftChanges.filter(row => row.operation === "delete").map(row => row.shiftId!), affectedEmployeeIds: draftEmployees.map(row => row.employeeId),
  };
  state.scheduleEvents = events.map(row => ({ id: row.id, date: row.date, title: row.title, notes: p["schedule.notes.read"] ? row.notes : "" }));
  state.clockEvents = rawClocks.map(row => ({ id: row.id, employeeId: row.employeeId, type: row.eventType, at: timestamp(row.occurredAt), role: row.roleName || undefined, explanation: row.explanation || undefined, automatic: row.automatic, cardId: row.cardId ?? undefined }));
  for (const edit of edits) {
    if (Array.isArray(edit.before.eventIds) && Array.isArray(edit.after.events)) {
      const removed = new Set(edit.before.eventIds as number[]);
      state.clockEvents = [...state.clockEvents.filter(event => !removed.has(event.id)), ...edit.after.events as StaffState["clockEvents"]];
    }
  }
  state.clockEvents.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  state.timeCardEdits = edits.map(row => ({ id: row.id, employeeId: row.employeeId, date: cards.find(card => card.id === row.cardId)?.workDate ?? "", at: timestamp(row.createdAt), actor: accounts.find(account => account.id === row.actorAccountId)?.name ?? "Manager", before: typeof row.before.description === "string" ? row.before.description : "Original time card", after: typeof row.after.description === "string" ? row.after.description : "Corrected time card", cardId: row.cardId }));
  state.hoursAdjustments = adjustments.map(row => ({ id: row.id, employeeId: row.employeeId, date: row.date, hours: row.adjustmentSeconds / 3600 }));
  state.ptoPolicies = policies.filter(policy => ctx.allDepartments || policyAssignments.some(a => a.policyId === policy.id)).map(row => { const own = policyAssignments.filter(a => a.policyId === row.id); return { id: row.id, name: row.name, method: row.method, fixedHours: row.fixedAllowanceSeconds / 3600, earnedHours: row.earnedSeconds / 3600, workedHours: row.perWorkedSeconds / 3600, employeeIds: own.map(a => a.employeeId), startingBalances: Object.fromEntries(own.map(a => [a.employeeId, { startDate: a.startDate, balance: a.openingBalanceSeconds / 3600 }])) }; });
  state.ptoRequests = pto.map(row => ({ id: row.id, employeeId: row.employeeId, compensation: row.compensation, startDate: row.startDate, endDate: row.endDate, startTime: row.startTime ?? undefined, endTime: row.endTime ?? undefined, reason: row.reason, explanation: p["team.read"] && p["team.private.read"] || row.employeeId === ownEmployee ? row.explanation : "", status: row.status, requestedAt: timestamp(row.requestedAt), decidedAt: row.decidedAt ? timestamp(row.decidedAt) : undefined, decidedByEmployeeId: accounts.find(a => a.id === row.decidedByAccountId)?.employeeId ?? undefined }));
  state.availabilityRequests = availability.map(row => ({ id: row.id, employeeId: row.employeeId, effectiveDate: row.effectiveDate, status: row.status, slots: slots.filter(slot => slot.requestId === row.id).map(slot => ({ day: days[slot.dayOfWeek], preference: slot.preference, startHour: slot.startMinute / 60, endHour: slot.endMinute / 60, location: basicInfo.locationName })), submittedAt: timestamp(row.submittedAt), requestNote: row.requestNote || undefined, decidedAt: row.decidedAt ? timestamp(row.decidedAt) : undefined, decidedByEmployeeId: accounts.find(a => a.id === row.decidedByAccountId)?.employeeId ?? undefined, rejectionNote: row.rejectionNote || undefined }));
  state.conversations = settings.enableTeamMessaging ? conversations.map(row => ({ id: row.id, name: row.name ?? undefined, creatorEmployeeId: row.creatorEmployeeId, participantIds: members.filter(m => m.conversationId === row.id && !m.leftAt).map(m => m.employeeId), pinnedByEmployeeIds: members.filter(m => m.conversationId === row.id && m.pinned && m.employeeId === ownEmployee).map(m => m.employeeId), mutedByEmployeeIds: members.filter(m => m.conversationId === row.id && m.muted && m.employeeId === ownEmployee).map(m => m.employeeId), messages: messages.filter(message => message.conversationId === row.id).map(message => ({ id: message.id, senderEmployeeId: message.senderEmployeeId, body: message.body, sentAt: timestamp(message.sentAt), readByEmployeeIds: reads.filter(read => read.messageId === message.id).map(read => read.employeeId) })) })) : [];
  state.scheduleUpdates = notices.filter(row => row.kind === "schedule").map(row => ({ id: row.id, employeeId: row.employeeId, title: row.title, detail: row.detail, at: row.occurredAt }));
  state.hoursRoundingMinutes = settingsRows[0]?.hoursRoundingMinutes as 5 | 10 | 15 ?? 15;
  return { period, revision: revision[0]?.revision ?? 0, state, settings, basicInfo, teamPeriod: { payPeriod: teamConfig[0]?.payPeriod ?? "weekly", anchorDate: teamConfig[0]?.anchorDate ?? "2026-11-02" }, primaryOwnerEmployeeId: owner?.employeeId ?? null, permissions: p, employeeVersions: Object.fromEntries(employees.map(e => [e.id, e.version])), opened: { [draftKey]: receipts.filter(row => row.openedAt).map(row => row.sourceKey) }, dismissed: { [draftKey]: receipts.filter(row => row.dismissedAt).map(row => row.sourceKey) } };
}
