import { sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, json } from "../auth/http";
import type { createAccessService } from "../access/service";
import type { Database } from "../workforce/context";
import { workspaceSnapshot } from "../workforce/snapshot";
import * as v from "../workforce/validation";
import { plusDays } from "./rules";
import { certificationStatusFor, milestonesFor, reliabilityFor, reliabilityTotals } from "./insights-rules";

export function createTeamInsights(db: Database, access: ReturnType<typeof createAccessService>, fieldKey: string, now = Date.now) {
  return { async handle(request: Request) {
    try {
      if (request.method !== "GET") throw new AuthError(405, "Use GET to read team reports.");
      const ctx = await access.workspaceContext(request); ctx.requirePermission("team.read");
      const url = new URL(request.url); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
      const start = v.date(url.searchParams.get("start") || today.slice(0, 8) + "01"), end = v.date(url.searchParams.get("end") || today);
      if (end < start || Date.parse(end) - Date.parse(start) > 365 * 86400000) throw new AuthError(400, "Choose a report range of at most 366 days.");
      const view = await workspaceSnapshot(db, ctx, fieldKey, { start, end });
      const [business] = await db.select({ zone: s.business.timeZone }).from(s.business).limit(1); const zone = business?.zone ?? "America/Los_Angeles";
      const canCertificates = ctx.permissions["documents.read"], canReliability = ctx.permissions["reports.read"] && ctx.permissions["timesheets.read"] && ctx.permissions["schedule.read"];
      const certificates = canCertificates ? view.state.employees.flatMap(e => (e.certificates ?? []).map(c => ({ employeeId: e.id, name: e.name, active: e.active, certificateId: c.id, title: c.name, expirationDate: c.expirationDate ?? null, status: certificationStatusFor(c, e.certificates ?? [], today) }))) : [];
      const sharedBirthdays = await db.all<{ employeeId: number; monthDay: string }>(sql`SELECT p.employee_id AS employeeId, substr(p.date_of_birth,6,5) AS monthDay FROM employee_profiles p JOIN recognition_preferences rp ON rp.employee_id = p.employee_id AND rp.share_birthday = 1 WHERE ${ctx.employeeFilter(sql`p.employee_id`)} AND ${ctx.activeActor()} AND length(p.date_of_birth) = 10`);
      const milestones = view.state.employees.filter(e => e.active && !e.terminated).flatMap(e => milestonesFor({ id: e.id, name: e.name, startDate: e.startDate, birthdayMonthDay: sharedBirthdays.find(p => p.employeeId === e.id)?.monthDay }, today, plusDays(today, 30))).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      let shifts: ReturnType<typeof reliabilityFor> = [];
      if (canReliability) {
        // Only leave dates enter the calculation; reasons/medical details never enter the report.
        const approved = await db.select().from(s.ptoRequests).where(sql`status = 'approved' AND start_date <= ${end} AND end_date >= ${start} AND archived_at IS NULL AND ${ctx.employeeFilter(s.ptoRequests.employeeId)}`).limit(10001);
        if (approved.length > 10000) throw new AuthError(413, "Reduce the report data before continuing.");
        const ptoRequests = approved.map(p => ({ id: p.id, employeeId: p.employeeId, compensation: p.compensation, status: p.status, startDate: p.startDate, endDate: p.endDate, startTime: p.startTime ?? undefined, endTime: p.endTime ?? undefined, reason: p.reason, requestedAt: p.requestedAt }));
        shifts = reliabilityFor({ ...view.state, ptoRequests }, start, end, now(), view.settings, zone);
      }
      if (!await db.get(sql`SELECT 1 WHERE ${ctx.activeActor()}`)) throw new AuthError(401, "Your access changed. Sign in again.");
      return json({ today, start, end, zone, revision: view.revision, canCertificates, canReliability, certificates, certificateWarnings: certificates.filter(c => c.active && ["Expired", "Expires today", "Due within 10 days"].includes(c.status)), milestones, shifts,
        totals: canReliability ? reliabilityTotals(shifts) : null, people: canReliability ? view.state.employees.map(e => ({ id: e.id, name: e.name, ...reliabilityTotals(shifts.filter(s => s.employeeId === e.id)) })) : [] });
    } catch (error) { if (error instanceof AuthError) return json({ error: error.message }, error.status); console.error("Team reports unavailable."); return json({ error: "Team reports could not load. Try reloading." }, 503); }
  } };
}
