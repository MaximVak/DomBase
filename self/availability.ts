import { and, desc, eq, getTableColumns, inArray, or, sql, type SQL } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import * as s from "../db/schema";
import type { KioskOperatorDatabase } from "../kiosk/database";
import { AuthError } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { canonical, newRecordId } from "../workforce/contract";
import { WorkspaceTransaction } from "../workforce/transaction";
import { availabilitySlots, appendAvailability } from "../workforce/availability";
import * as v from "../workforce/validation";
import { availabilityWeekdays } from "../app/availability-model";
import type { AvailabilityRequest } from "../workforce/model";

type Context = { account: { id: number; employeeId: number | null }; guard: SQL; contextToken: string };
const stamp = (value: string) => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z").toISOString();
export type MyAvailability = { employeeId: number; name: string; today: string; approvalRequired: boolean; revision: number; contextToken: string; current: AvailabilityRequest | null; requests: AvailabilityRequest[]; nextCursor: string | null };
export async function readMyAvailability(db: KioskOperatorDatabase, ctx: Context, url: URL, now: number): Promise<MyAvailability> {
  if ([...url.searchParams.keys()].some(key => key !== "before") || url.searchParams.getAll("before").length > 1) throw new AuthError(400, "Availability does not accept employee selectors.");
  const before = url.searchParams.get("before"); let cursor: SQL = sql`1 = 1`;
  if (before) {
    const [at, id, extra] = before.split("|");
    if (extra !== undefined || at.length > 40 || !Number.isFinite(Date.parse(at)) || !/^[1-9]\d*$/.test(id ?? "") || !Number.isSafeInteger(Number(id))) throw new AuthError(400, "Invalid history cursor.");
    cursor = sql`(julianday(${s.availabilityRequests.submittedAt}) < julianday(${at}) OR (julianday(${s.availabilityRequests.submittedAt}) = julianday(${at}) AND ${s.availabilityRequests.id} < ${Number(id)}))`;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const scope = and(eq(s.availabilityRequests.employeeId, ctx.account.employeeId ?? -1), ctx.guard);
  const order = [desc(sql`julianday(${s.availabilityRequests.submittedAt})`), desc(s.availabilityRequests.id)];
  const pageIds = db.select({ id: s.availabilityRequests.id }).from(s.availabilityRequests).where(and(scope, cursor)).orderBy(...order).limit(51);
  const currentIds = db.select({ id: s.availabilityRequests.id }).from(s.availabilityRequests).where(and(scope, eq(s.availabilityRequests.status, "approved"), sql`${s.availabilityRequests.effectiveDate} <= ${today}`)).orderBy(desc(s.availabilityRequests.effectiveDate), ...order).limit(1);
  const fields = { ...getTableColumns(s.availabilityRequests), submittedByName: sql<string | null>`(SELECT display_name FROM accounts WHERE id = ${s.availabilityRequests.submittedByAccountId})`.as("submitted_by_name"), decidedByName: sql<string | null>`(SELECT display_name FROM accounts WHERE id = ${s.availabilityRequests.decidedByAccountId})`.as("decided_by_name") };
  // One D1 read transaction applies the live identity guard to every projection.
  const [meta, page, current, slots] = await db.batch([
    db.select({ employeeId: s.employees.id, name: s.employees.name, approvalRequired: s.locationSettings.requireAvailabilityApproval, revision: s.workforceState.revision }).from(s.employees)
      .innerJoin(s.locationSettings, eq(s.locationSettings.businessId, 1)).innerJoin(s.workforceState, eq(s.workforceState.id, 1)).where(and(eq(s.employees.id, ctx.account.employeeId ?? -1), ctx.guard)).limit(1),
    db.select(fields).from(s.availabilityRequests).where(and(scope, cursor)).orderBy(...order).limit(51),
    db.select(fields).from(s.availabilityRequests).where(inArray(s.availabilityRequests.id, currentIds)),
    db.select().from(s.availabilitySlots).where(and(ctx.guard, or(inArray(s.availabilitySlots.requestId, pageIds), inArray(s.availabilitySlots.requestId, currentIds)))),
  ]);
  if (!meta[0]) throw new AuthError(401, "Sign in to continue.");
  const project = (row: typeof page[number]): AvailabilityRequest => ({ id: row.id, employeeId: row.employeeId, effectiveDate: row.effectiveDate, status: row.status, submittedAt: stamp(row.submittedAt), submittedByName: row.submittedByName ?? undefined, decidedByName: row.decidedByName ?? undefined, decidedAt: row.decidedAt ? stamp(row.decidedAt) : undefined, requestNote: row.requestNote || undefined, rejectionNote: row.rejectionNote || undefined, slots: slots.filter(slot => slot.requestId === row.id).map(slot => ({ day: availabilityWeekdays[slot.dayOfWeek], startHour: slot.startMinute / 60, endHour: slot.endMinute / 60, preference: slot.preference, location: "This location" })) });
  const visible = page.slice(0, 50), last = visible.at(-1);
  return { ...meta[0], today, contextToken: ctx.contextToken, current: current[0] ? project(current[0]) : null, requests: visible.map(project), nextCursor: page.length > 50 && last ? `${stamp(last.submittedAt)}|${last.id}` : null };
}
export async function saveMyAvailability(db: KioskOperatorDatabase, ctx: Context, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["id", "contextToken", "revision", "effectiveDate", "slots", "requestNote"]);
  if (typeof body.contextToken !== "string" || !/^[a-f0-9]{64}$/.test(body.contextToken) || !timingSafeEqual(Buffer.from(body.contextToken), Buffer.from(ctx.contextToken))) throw new AuthError(409, "Your sign-in changed. Reload your availability before saving.");
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
  const id = body.id, revision = v.integer(body.revision, 0), effectiveDate = v.date(body.effectiveDate), note = v.text(body.requestNote ?? "", 1000), slots = availabilitySlots(body.slots);
  const hash = `self-availability:${rateKey(secret, canonical(body))}`;
  async function previous() {
    const [row] = await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id, id), ctx.guard)).limit(1);
    if (!row) return false;
    if (row.accountId !== ctx.account.id || row.bodyHash !== hash) throw new AuthError(409, "This save identifier is already in use.");
    return true;
  }
  if (await previous()) return { saved: true };
  const [settings] = await db.select().from(s.locationSettings).where(and(eq(s.locationSettings.businessId, 1), ctx.guard));
  if (!settings) throw new AuthError(401, "Sign in to continue.");
  const tx = new WorkspaceTransaction(db, { account: ctx.account, activeActor: () => ctx.guard }, id, new Date(now).toISOString());
  appendAvailability(tx, { id: newRecordId(), employeeId: ctx.account.employeeId!, accountId: ctx.account.id, effectiveDate, note, slots, approvalRequired: settings.requireAvailabilityApproval });
  if (!await tx.commit(revision, hash, ["availability"]) && !await previous()) throw new AuthError(409, "Availability or company settings changed. Reload the saved history and review your draft before saving again.");
  return { saved: true };
}
