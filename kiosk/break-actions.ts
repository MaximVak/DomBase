import { eq, sql } from "drizzle-orm";
import { AuthError } from "../auth/http";
import * as schema from "../db/schema";
import { defaultScheduleEnforcement } from "../app/schedule-enforcement";
import { zonedTimestamp } from "../workforce/time";
import { inspectBreaks, requiredBreaks } from "./break-rules";
import type { ActionDetails, BreakReport, ClockDetails } from "./break-rules";
import type { KioskOperatorDatabase } from "./database";
import type { ClockDraft, ClockType } from "./replay";
import { exactKeys } from "./security";

const invalid = () => new AuthError(400, "Invalid clock action details.");
type ClockEvent = typeof schema.clockEvents.$inferSelect;

export function parseActionDetails(type: ClockType, value: unknown): ActionDetails | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  exactKeys(data, type === "break" ? ["breakKind"] : type === "out" ? ["reports"] : type === "in" ? ["worked"] : ["worked", "offDutyExtension"]);
  if (type === "break") {
    if (data.breakKind !== "meal" && data.breakKind !== "rest") throw invalid();
    return { breakKind: data.breakKind };
  }
  if (type === "out") {
    if (!Array.isArray(data.reports) || data.reports.length > 10) throw invalid();
    const reports: BreakReport[] = data.reports.map(row => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw invalid();
      exactKeys(row, ["kind", "slot", "outcome", "reason"]);
      const { kind, slot, outcome, reason } = row;
      if ((kind !== "meal" && kind !== "rest") || !Number.isInteger(slot) || slot < 1 || slot > 8
        || !["missed", "unrecorded", "waived"].includes(outcome) || (reason !== undefined && (typeof reason !== "string" || reason.length > 300))
        || (outcome !== "missed" && !reason?.trim())) throw invalid();
      return { kind, slot, outcome, ...(reason?.trim() ? { reason: reason.trim() } : {}) };
    });
    if (new Set(reports.map(report => report.kind + report.slot)).size !== reports.length) throw invalid();
    return { reports };
  }
  if ((data.worked !== undefined && typeof data.worked !== "boolean") || (data.offDutyExtension !== undefined && typeof data.offDutyExtension !== "boolean")) throw invalid();
  return { ...(data.worked ? { worked: true } : {}), ...(data.offDutyExtension ? { offDutyExtension: true } : {}) };
}

export async function clockPolicy(db: KioskOperatorDatabase) {
  const [[settings], [business]] = await Promise.all([
    db.select().from(schema.locationSettings).where(eq(schema.locationSettings.businessId, 1)),
    db.select({ zone: schema.business.timeZone }).from(schema.business).where(eq(schema.business.id, 1)),
  ]);
  return { ...defaultScheduleEnforcement, ...settings, zone: business?.zone ?? "America/Los_Angeles" };
}
export type ClockPolicy = Awaited<ReturnType<typeof clockPolicy>>;

export function workplaceDate(time: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
}

async function breakIssues(db: KioskOperatorDatabase, employeeId: number, time: number, policy: ClockPolicy) {
  const start = zonedTimestamp(workplaceDate(time, policy.zone), "00:00", policy.zone);
  const isoStart = new Date(start).toISOString();
  const [events, [employeeSetting]] = await Promise.all([
    db.all<{ event_type: ClockType; occurred_at: string; clock_details: string | null }>(sql`
      WITH prior AS (SELECT id, event_type FROM clock_events
        WHERE employee_id = ${employeeId} AND event_type IN ('in','out') AND julianday(occurred_at) < julianday(${isoStart})
        ORDER BY julianday(occurred_at) DESC, id DESC LIMIT 1)
      SELECT event_type, occurred_at, clock_details FROM clock_events
      WHERE employee_id = ${employeeId} AND julianday(occurred_at) <= julianday(${new Date(time).toISOString()})
        AND (occurred_at >= ${isoStart} OR id >= (SELECT id FROM prior WHERE event_type = 'in'))
      ORDER BY julianday(occurred_at), id`),
    db.select({ canWaive: schema.employeeSettings.canWaiveMissedBreaks }).from(schema.employeeSettings).where(eq(schema.employeeSettings.employeeId, employeeId)),
  ]);
  const converted = events.map(event => ({
    type: event.event_type, at: Date.parse(event.occurred_at), details: event.clock_details ? JSON.parse(event.clock_details) as ClockDetails : undefined,
  }));
  const reported = converted.flatMap(event => event.type === "out" ? event.details?.reports ?? [] : []);
  const missing = requiredBreaks(inspectBreaks(converted, start, time), policy, policy.breakWaivers && employeeSetting?.canWaive === true);
  return missing.filter(issue => !reported.some(report => report.kind === issue.kind && report.slot === issue.slot && (report.outcome !== "waived" || issue.canWaive)));
}

export async function kioskBreakView(db: KioskOperatorDatabase, employeeId: number, previous: ClockEvent | null, time: number) {
  const policy = await clockPolicy(db);
  const start = previous?.eventType === "break" ? previous : null;
  const min = start?.clockDetails?.minimumMinutes;
  return {
    issues: previous && previous.eventType !== "out" && policy.missedBreakReports ? await breakIssues(db, employeeId, time, policy) : [],
    ...(start ? { active: {
      kind: start.clockDetails?.breakKind ?? "meal",
      availableAt: policy.blockEarlyBreakReturn && min ? Date.parse(start.occurredAt) + min * 60000 : 0,
      extensionAt: policy.unpaidRestOverage && start.clockDetails?.breakKind === "rest" && min ? Date.parse(start.occurredAt) + min * 60000 : 0,
    } } : {}),
  };
}

export async function resolveBreakDetails(db: KioskOperatorDatabase, employeeId: number, previous: ClockEvent | null, draft: ClockDraft, time: number, policy: ClockPolicy): Promise<ClockDetails | null> {
  const data = draft.details;
  if (draft.eventType === "break") {
    const breakKind = data?.breakKind ?? "meal";
    return { breakKind, minimumMinutes: breakKind === "rest" ? policy.paidRestMinutes : policy.mealBreakMinutes };
  }
  if (draft.eventType === "break_end") {
    const at = Date.parse(previous?.occurredAt ?? "");
    const minimum = previous?.clockDetails?.minimumMinutes;
    if (!minimum || !Number.isFinite(at)) return null;
    const additional = Math.floor((time - at - minimum * 60000) / 1000);
    if (additional < 0 && policy.blockEarlyBreakReturn && !data?.worked) throw new AuthError(422, "Your break is still in progress.");
    if (additional < 0 && data?.worked) return { earlyWork: true };
    if (additional > 0 && previous?.clockDetails?.breakKind === "rest" && policy.unpaidRestOverage && data?.offDutyExtension) {
      return { unpaidSeconds: additional };
    }
    return null;
  }
  if (draft.eventType === "out" && data?.reports) {
    const issues = policy.missedBreakReports ? await breakIssues(db, employeeId, time, policy) : [];
    const reports = data.reports;
    if (reports.length !== issues.length || reports.some(report => !issues.some(issue => issue.kind === report.kind && issue.slot === report.slot
      && (report.outcome !== "waived" || issue.canWaive)))) throw new AuthError(422, "Break requirements changed. Enter your PIN again to review them.");
    return { california: true, ...(reports.length ? { reports } : {}) };
  }
  return draft.eventType === "in" ? { california: true, ...(data?.worked ? { earlyWork: true } : {}) } : null;
}
