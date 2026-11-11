import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { equal } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope } from "./records";
import * as v from "./validation";
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export async function timeOffChange(r: RecordContext, change: Change) {
  if (change.entity === "pto-policy") {
    r.ctx.requirePermission("settings.manage");
    if (!r.ctx.allDepartments) throw new AuthError(403, "An Owner or General Manager must manage company time-off policies.");
    if (change.after === null) { r.tx.update(s.ptoPolicies, { archived: true, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND archived = 0`); r.tx.remove(s.ptoAssignments, sql`policy_id = ${change.id}`); return; }
    const data = v.object(change.after); v.keys(data, ["id", "name", "method", "fixedHours", "earnedHours", "workedHours", "employeeIds", "startingBalances"]);
    const method = v.oneOf(data.method, ["fixed", "rate"]); const fixed = v.number(data.fixedHours, 0, 10000); const earned = v.number(data.earnedHours, 0, 1000); const worked = v.number(data.workedHours, 0, 10000);
    if (method === "fixed" ? fixed <= 0 : earned <= 0 || worked <= 0) throw new AuthError(400, "Enter a positive policy allowance or accrual rate.");
    const ids = v.list(data.employeeIds, 500).map(id => v.integer(id)); if (!ids.length || new Set(ids).size !== ids.length) throw new AuthError(400, "Choose employees once each.");
    const balances = v.object(data.startingBalances); if (Object.keys(balances).some(key => !ids.includes(Number(key)))) throw new AuthError(400, "Unexpected policy employee.");
    const values = { name: v.text(data.name, 100, true), method, fixedAllowanceSeconds: Math.round(fixed * 3600), earnedSeconds: Math.round(earned * 3600), perWorkedSeconds: Math.round(worked * 3600), updatedAt: r.tx.stamp };
    if (change.before) r.tx.update(s.ptoPolicies, values, sql`id = ${change.id} AND archived = 0`); else r.tx.insert(s.ptoPolicies, { id: change.id, ...values });
    r.tx.remove(s.ptoAssignments, sql`policy_id = ${change.id}`);
    for (const id of ids) {
      await employeeInScope(r, id); const balance = v.object(balances[String(id)]); v.keys(balance, ["startDate", "balance"]);
      r.tx.insert(s.ptoAssignments, { employeeId: id, policyId: change.id, startDate: v.date(balance.startDate), openingBalanceSeconds: Math.round(v.number(balance.balance, -10000, 10000) * 3600), updatedAt: r.tx.stamp }, sql`1 = 1`, { target: ["employeeId"], update: ["policyId", "startDate", "openingBalanceSeconds", "updatedAt"] });
    }
    return;
  }
  if (change.entity === "pto-request") {
    const before = change.before ? v.object(change.before) : null;
    if (change.after === null) {
      r.ctx.requirePermission("time_off.approve"); if (!before) throw new AuthError(404, "Request unavailable.");
      await employeeInScope(r, v.integer(before.employeeId));
      r.tx.update(s.ptoRequests, { archivedAt: r.tx.stamp }, sql`id = ${change.id} AND archived_at IS NULL AND status <> 'pending'`); return;
    }
    const data = v.object(change.after); v.keys(data, ["id", "employeeId", "compensation", "startDate", "endDate", "startTime", "endTime", "reason", "explanation", "status", "requestedAt", "decidedAt", "decidedByEmployeeId"]);
    const employeeId = v.integer(data.employeeId); const self = employeeId === r.ctx.account.employeeId;
    await employeeInScope(r, employeeId, self);
    if (!before) {
      if (!self) throw new AuthError(403, "Submit time off only for your linked employee profile.");
      const employee = r.view.state.employees.find(e => e.id === employeeId); if (!employee?.active || employee.terminated) throw new AuthError(403, "This employee profile is inactive.");
      const startDate = v.date(data.startDate); const endDate = v.date(data.endDate); if (endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 366 * 86400000) throw new AuthError(400, "Choose a valid time-off range up to one year.");
      const startTime = data.startTime ? v.time(data.startTime) : null; const endTime = data.endTime ? v.time(data.endTime) : null;
      if ((startTime === null) !== (endTime === null) || startTime && endTime && (startDate !== endDate || endTime <= startTime)) throw new AuthError(400, "Choose a valid partial-day time range.");
      const status = r.ctx.account.accessLevel === "owner" ? "approved" : "pending";
      r.tx.insert(s.ptoRequests, { id: change.id, employeeId, compensation: v.oneOf(data.compensation, ["paid", "unpaid"]), startDate, endDate, startTime, endTime, reason: v.oneOf(data.reason, ["sick_emergency", "vacation"]), explanation: v.text(data.explanation, 1000), status, requestedAt: r.tx.stamp, decidedAt: status === "approved" ? r.tx.stamp : null, decidedByAccountId: status === "approved" ? r.ctx.account.id : null });
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
    r.tx.update(s.ptoRequests, { status, decidedAt: r.tx.stamp, decidedByAccountId: r.ctx.account.id, version: stored.version + 1 }, sql`id = ${change.id} AND version = ${stored.version} AND archived_at IS NULL`);
    r.tx.insert(s.ptoDecisions, { requestId: change.id, status, actorAccountId: r.ctx.account.id });
    return;
  }
  if (change.entity === "availability") {
    if (!change.after) throw new AuthError(400, "Availability history cannot be deleted.");
    const data = v.object(change.after); v.keys(data, ["id", "employeeId", "effectiveDate", "status", "slots", "submittedAt", "requestNote", "decidedAt", "decidedByEmployeeId", "rejectionNote"]);
    const before = change.before ? v.object(change.before) : null; const employeeId = v.integer(data.employeeId); const self = employeeId === r.ctx.account.employeeId;
    await employeeInScope(r, employeeId, self);
    if (!before) {
      if (!self) r.ctx.requirePermission("availability.approve");
      const status = r.view.settings.requireAvailabilityApproval ? "pending" : "approved";
      r.tx.insert(s.availabilityRequests, { id: change.id, employeeId, effectiveDate: v.date(data.effectiveDate), status, requestNote: v.text(data.requestNote ?? "", 1000), submittedAt: r.tx.stamp, decidedAt: status === "approved" ? r.tx.stamp : null });
      const entries = v.list(data.slots, 100); const unique = new Set<string>();
      for (const entry of entries) {
        const slot = v.object(entry); v.keys(slot, ["day", "preference", "startHour", "endHour", "location"]);
        const day = days.indexOf(v.text(slot.day, 10)); const startMinute = Math.round(v.number(slot.startHour, 0, 24) * 60); const endMinute = Math.round(v.number(slot.endHour, 0, 24) * 60); const preference = v.oneOf(slot.preference, ["preferred", "unavailable"]);
        if (day < 0 || endMinute <= startMinute || startMinute > 1439) throw new AuthError(400, "Invalid availability hours.");
        const key = `${day}:${startMinute}:${endMinute}:${preference}`; if (unique.has(key)) throw new AuthError(400, "Duplicate availability slot."); unique.add(key);
        r.tx.insert(s.availabilitySlots, { requestId: change.id, dayOfWeek: day, startMinute, endMinute, preference });
      }
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
