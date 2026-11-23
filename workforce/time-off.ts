import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { equal } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope } from "./records";
import * as v from "./validation";
import { availabilitySlots, appendAvailability } from "./availability";
import { periodLockByDate, requireTimesheetUnlocked } from "./timesheet-lock-guards";
import { requireLeaveAvailable, type PaidRequest } from "./leave-balances";

async function reserveLeave(r: RecordContext, request: PaidRequest) {
  await requireLeaveAvailable(r.db, r.ctx, Date.parse(r.tx.stamp), request, undefined, r.pendingLeave);
  (r.pendingLeave ??= []).push(request);
}

function policySettings(data: Record<string, unknown>) {
  const category = v.oneOf(data.category ?? "pto", ["pto", "sick"]);
  const method = v.oneOf(data.method, ["fixed", "rate"]);
  const fixedFrequency = v.oneOf(data.fixedFrequency ?? "annual", ["annual", "pay_period"]);
  const fixed = v.number(data.fixedHours, 0, 10000);
  const earned = v.number(data.earnedHours, 0, 1000);
  const worked = v.number(data.workedHours, 0, 10000);
  if (method === "fixed" ? fixed <= 0 : earned <= 0 || worked <= 0) throw new AuthError(400, "Enter a positive policy allowance or accrual rate.");
  const optionalHours = (value: unknown, min: number) => value == null ? null : Math.round(v.number(value, min, 10000) * 3600);
  const maxBalanceSeconds = optionalHours(data.maxBalanceHours, category === "sick" ? 80 : 0.01);
  const carryoverSeconds = optionalHours(data.carryoverHours, 0);
  if (carryoverSeconds !== null && (category !== "sick" || method !== "fixed" || fixedFrequency !== "annual")) {
    throw new AuthError(400, "A year-end carryover limit is available for annually front-loaded sick leave.");
  }
  const waitingDays = v.integer(data.waitingDays ?? 0, 0, category === "sick" ? 90 : 365);
  const tenureBonuses = v.list(data.tenureBonuses ?? [], 20).map(row => {
    const bonus = v.object(row);
    v.keys(bonus, ["years", "hours"]);
    return { years: v.integer(bonus.years, 1, 100), seconds: Math.round(v.number(bonus.hours, 0.01, 10000) * 3600) };
  }).sort((a, b) => a.years - b.years);
  if (new Set(tenureBonuses.map(row => row.years)).size !== tenureBonuses.length) throw new AuthError(400, "Choose each tenure anniversary once.");
  if (category === "sick" && (method === "fixed" ? fixed < 40 : earned * 30 < worked)) {
    throw new AuthError(400, "Use at least 40 annual sick hours or an hourly rate of at least one hour per 30 worked hours.");
  }
  return { category, method, fixedFrequency, maxBalanceSeconds, carryoverSeconds, waitingDays, tenureBonuses,
    fixedAllowanceSeconds: Math.round(fixed * 3600), earnedSeconds: Math.round(earned * 3600), perWorkedSeconds: Math.round(worked * 3600) };
}

export function timeOffDates(data: Record<string, unknown>) {
  const startDate = v.date(data.startDate);
  const endDate = v.date(data.endDate);
  if (endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 366 * 86400000) throw new AuthError(400, "Choose a valid time-off range up to one year.");
  const startTime = data.startTime == null || data.startTime === "" ? null : v.time(data.startTime);
  const endTime = data.endTime == null || data.endTime === "" ? null : v.time(data.endTime);
  if ((startTime === null) !== (endTime === null) || startTime && endTime && (startDate !== endDate || endTime <= startTime)) throw new AuthError(400, "Enter a start and end time on the same day, with the end after the start.");
  return { startDate, endDate, startTime, endTime };
}
export async function timeOffChange(r: RecordContext, change: Change) {
  if (change.entity === "pto-policy") {
    r.ctx.requirePermission("settings.manage");
    if (!r.ctx.allDepartments) throw new AuthError(403, "An Owner or General Manager must manage company time-off policies.");
    if (change.after === null) { r.tx.update(s.ptoPolicies, { archived: true, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND archived = 0`); r.tx.remove(s.ptoAssignments, sql`policy_id = ${change.id}`); return; }
    const data = v.object(change.after); v.keys(data, ["id", "name", "method", "fixedHours", "earnedHours", "workedHours", "employeeIds", "startingBalances",
      "category", "fixedFrequency", "maxBalanceHours", "carryoverHours", "waitingDays", "tenureBonuses"]);
    const settings = policySettings(data);
    if (change.before && settings.category !== (v.object(change.before).category ?? "pto")) throw new AuthError(400, "Choose the leave category when creating a policy.");
    const ids = v.list(data.employeeIds, 500).map(id => v.integer(id)); if (!ids.length || new Set(ids).size !== ids.length) throw new AuthError(400, "Choose employees once each.");
    const balances = v.object(data.startingBalances); if (Object.keys(balances).some(key => !ids.includes(Number(key)))) throw new AuthError(400, "Unexpected policy employee.");
    const values = { name: v.text(data.name, 100, true), ...settings, updatedAt: r.tx.stamp };
    if (change.before) r.tx.update(s.ptoPolicies, values, sql`id = ${change.id} AND archived = 0`); else r.tx.insert(s.ptoPolicies, { id: change.id, ...values });
    const previous = await r.db.select().from(s.ptoAssignments).where(eq(s.ptoAssignments.policyId, change.id));
    r.tx.remove(s.ptoAssignments, sql`policy_id = ${change.id} AND employee_id NOT IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
    for (const id of ids) {
      await employeeInScope(r, id); const balance = v.object(balances[String(id)]); v.keys(balance, ["startDate", "balance"]);
      const startDate = v.date(balance.startDate);
      const old = previous.find(entry => entry.employeeId === id);
      const openingBalanceSeconds = Math.round(v.number(balance.balance, old?.openingBalanceSeconds && old.openingBalanceSeconds < 0 ? old.openingBalanceSeconds / 3600 : 0, 10000) * 3600);
      const legacyBalanceYear = old?.startDate === startDate && old.openingBalanceSeconds === openingBalanceSeconds ? old.legacyBalanceYear : null;
      r.tx.insert(s.ptoAssignments, { employeeId: id, policyId: change.id, category: settings.category, startDate, openingBalanceSeconds, legacyBalanceYear, updatedAt: r.tx.stamp },
        sql`1 = 1`, { target: ["employeeId", "category"], update: ["policyId", "startDate", "openingBalanceSeconds", "legacyBalanceYear", "updatedAt"] });
    }
    return;
  }
  if (change.entity === "pto-request") {
    const before = change.before ? v.object(change.before) : null;
    if (change.after === null) {
      r.ctx.requirePermission("time_off.approve"); if (!before) throw new AuthError(404, "Request unavailable.");
      await employeeInScope(r, v.integer(before.employeeId));
      if (before.status === "approved" && before.compensation === "paid") await requireTimesheetUnlocked(r.db, periodLockByDate(v.date(before.startDate), v.date(before.endDate)));
      r.tx.update(s.ptoRequests, { archivedAt: r.tx.stamp }, sql`id = ${change.id} AND archived_at IS NULL AND status <> 'pending'`); return;
    }
    const data = v.object(change.after); v.keys(data, ["id", "employeeId", "compensation", "category", "startDate", "endDate", "startTime", "endTime", "reason", "explanation", "status", "requestedAt", "decidedAt", "decidedByEmployeeId"]);
    const employeeId = v.integer(data.employeeId); const self = employeeId === r.ctx.account.employeeId;
    await employeeInScope(r, employeeId, self);
    if (!before) {
      if (!self) throw new AuthError(403, "Submit time off only for your linked employee profile.");
      const employee = r.view.state.employees.find(e => e.id === employeeId); if (!employee?.active || employee.terminated) throw new AuthError(403, "This employee profile is inactive.");
      const dates = timeOffDates(data);
      const compensation = v.oneOf(data.compensation, ["paid", "unpaid"]);
      const category = data.category === undefined ? null : v.oneOf(data.category, ["pto", "sick", "unpaid"]);
      if (category && (category === "unpaid") !== (compensation === "unpaid")) throw new AuthError(400, "The time-off category and pay type must agree.");
      const status = r.ctx.account.accessLevel === "owner" ? "approved" : "pending";
      if (status === "approved" && compensation === "paid") {
        await requireTimesheetUnlocked(r.db, periodLockByDate(dates.startDate, dates.endDate));
        await reserveLeave(r, { ...dates, id: change.id, employeeId, category, compensation });
      }
      r.tx.insert(s.ptoRequests, { id: change.id, employeeId, compensation, category, ...dates, reason: v.oneOf(data.reason, ["sick_emergency", "vacation"]), explanation: v.text(data.explanation, 1000), status, requestedAt: r.tx.stamp, decidedAt: status === "approved" ? r.tx.stamp : null, decidedByAccountId: status === "approved" ? r.ctx.account.id : null });
      if (status === "approved") r.tx.insert(s.ptoDecisions, { requestId: change.id, status, actorAccountId: r.ctx.account.id });
      return;
    }
    if (employeeId !== before.employeeId) throw new AuthError(403, "A request cannot be moved to another employee.");
    const changed = v.changed(before, data); if (changed.some(key => !["status", "decidedAt", "decidedByEmployeeId"].includes(key))) throw new AuthError(400, "Cancel and resubmit instead of changing an existing request.");
    const status = v.oneOf(data.status, ["approved", "denied", "cancelled"]);
    if (status === "cancelled") { if (!self && !r.ctx.permissions["time_off.approve"]) throw new AuthError(403, "Only the employee or an authorized manager can cancel this request."); }
    else { r.ctx.requirePermission("time_off.approve"); if (self) throw new AuthError(403, "Another manager must review your own request."); }
    const [stored] = await r.db.select().from(s.ptoRequests).where(eq(s.ptoRequests.id, change.id));
    if (!stored || (status !== "cancelled" && stored.status !== "pending") || stored.status === "cancelled" || stored.status === "denied") throw new AuthError(409, "This request has already been decided.");
    if (stored.compensation === "paid" && (status === "approved" || stored.status === "approved")) await requireTimesheetUnlocked(r.db, periodLockByDate(stored.startDate, stored.endDate));
    if (status === "approved" && stored.compensation === "paid") await reserveLeave(r, stored);
    r.tx.update(s.ptoRequests, { status, decidedAt: r.tx.stamp, decidedByAccountId: r.ctx.account.id, version: stored.version + 1 }, sql`id = ${change.id} AND version = ${stored.version} AND archived_at IS NULL`);
    r.tx.insert(s.ptoDecisions, { requestId: change.id, status, actorAccountId: r.ctx.account.id });
    return;
  }
  if (change.entity === "availability") {
    if (!change.after) throw new AuthError(400, "Availability history cannot be deleted.");
    const data = v.object(change.after); v.keys(data, ["id", "employeeId", "effectiveDate", "status", "slots", "submittedAt", "submittedByName", "decidedByName", "requestNote", "decidedAt", "decidedByEmployeeId", "rejectionNote"]);
    const before = change.before ? v.object(change.before) : null; const employeeId = v.integer(data.employeeId); const self = employeeId === r.ctx.account.employeeId;
    const person = await employeeInScope(r, employeeId, self);
    if (!person.active || person.terminated) throw new AuthError(409, "Inactive employees retain their availability history but cannot submit or receive new availability decisions.");
    if (!before) {
      if (!self) r.ctx.requirePermission("availability.approve");
      appendAvailability(r.tx, { id: change.id, employeeId, accountId: r.ctx.account.id, effectiveDate: v.date(data.effectiveDate), note: v.text(data.requestNote ?? "", 1000), slots: availabilitySlots(data.slots), approvalRequired: r.view.settings.requireAvailabilityApproval });
      return;
    }
    r.ctx.requirePermission("availability.approve"); if (employeeId !== before.employeeId || !equal(data.slots, before.slots) || data.effectiveDate !== before.effectiveDate || data.requestNote !== before.requestNote) throw new AuthError(400, "Only the availability decision can change.");
    if (self) throw new AuthError(403, "Another manager must review your own availability.");
    const decision = v.oneOf(data.status, ["approved", "rejected"]); const note = v.text(data.rejectionNote ?? "", 1000); if (decision === "rejected" && !note) throw new AuthError(400, "Explain why this availability was rejected.");
    const [stored] = await r.db.select().from(s.availabilityRequests).where(eq(s.availabilityRequests.id, change.id)); if (!stored || stored.status !== "pending") throw new AuthError(409, "This availability request has already been decided.");
    r.tx.update(s.availabilityRequests, { status: decision, decidedAt: r.tx.stamp, decidedByAccountId: r.ctx.account.id, rejectionNote: note, version: stored.version + 1 }, sql`id = ${change.id} AND version = ${stored.version} AND status = 'pending'`);
    r.tx.insert(s.availabilityDecisions, { requestId: change.id, decision, actorAccountId: r.ctx.account.id, note });
  }
}
