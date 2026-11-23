import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import * as s from "../db/schema";
import type { KioskOperatorDatabase } from "../kiosk/database";
import { AuthError } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { canonical, newRecordId } from "../workforce/contract";
import { leaveCategory, leaveRequestMinutes, type LeaveCategory } from "../workforce/leave-duration";
import { ownLeaveScope, readLeaveBalances } from "../workforce/leave-balances";
import type { LeaveAccount } from "../workforce/leave-policy";
import type { PtoRequest } from "../workforce/model";
import { timeOffDates } from "../workforce/time-off";
import { WorkspaceTransaction } from "../workforce/transaction";
import * as v from "../workforce/validation";

type Context = { account: { id: number; employeeId: number | null }; guard: SQL; contextToken: string };
type OwnRequest = Pick<PtoRequest, "id" | "startDate" | "endDate" | "startTime" | "endTime" | "status"> & { category: LeaveCategory; minutes: number };
export type MyTimeOff = { today: string; contextToken: string; revision: number; requests: OwnRequest[]; balances: LeaveAccount[] };

export async function readMyTimeOff(db: KioskOperatorDatabase, ctx: Context, now: number): Promise<MyTimeOff> {
  const [metadata, requests] = await db.batch([
    db.select({ revision: s.workforceState.revision }).from(s.workforceState).where(and(eq(s.workforceState.id, 1), ctx.guard)),
    db.select({ id: s.ptoRequests.id, compensation: s.ptoRequests.compensation, category: s.ptoRequests.category,
      startDate: s.ptoRequests.startDate, endDate: s.ptoRequests.endDate, startTime: s.ptoRequests.startTime, endTime: s.ptoRequests.endTime,
      status: s.ptoRequests.status }).from(s.ptoRequests)
      .where(and(eq(s.ptoRequests.employeeId, ctx.account.employeeId ?? -1), isNull(s.ptoRequests.archivedAt), ctx.guard))
      .orderBy(desc(sql`julianday(${s.ptoRequests.requestedAt})`), desc(s.ptoRequests.id)).limit(30),
  ]);
  if (!metadata[0]) throw new AuthError(401, "Sign in to continue.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [own] = await readLeaveBalances(db, ownLeaveScope(ctx.guard, ctx.account.employeeId ?? -1), now);
  return { ...metadata[0], today, contextToken: ctx.contextToken, balances: own?.balances ?? [],
    requests: requests.map(({ compensation, category, startTime, endTime, ...request }) => ({
      ...request, startTime: startTime ?? undefined, endTime: endTime ?? undefined,
      category: leaveCategory({ category, compensation }), minutes: leaveRequestMinutes({ ...request, startTime, endTime }),
    })),
  };
}

export async function submitMyTimeOff(db: KioskOperatorDatabase, ctx: Context, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["id", "contextToken", "revision", "category", "startDate", "endDate", "startTime", "endTime", "reason", "explanation"]);
  if (typeof body.contextToken !== "string" || !/^[a-f0-9]{64}$/.test(body.contextToken)
    || !timingSafeEqual(Buffer.from(body.contextToken), Buffer.from(ctx.contextToken))) {
    throw new AuthError(409, "Your sign-in changed. Reload time off before submitting.");
  }
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid submission identifier.");
  const id = body.id;
  const revision = v.integer(body.revision, 0);
  const category = v.oneOf(body.category, ["pto", "sick", "unpaid"]);
  const reason = v.oneOf(body.reason, ["sick_emergency", "vacation"]);
  const explanation = v.text(body.explanation ?? "", 1000);
  const dates = timeOffDates(body);
  // Reloading after a conflict supplies a fresh revision for the same submission.
  const hash = `self-time-off:${rateKey(secret, canonical({ category, reason, explanation, ...dates }))}`;
  async function previous() {
    const [row] = await db.select({ accountId: s.workforceCommits.accountId, bodyHash: s.workforceCommits.bodyHash })
      .from(s.workforceCommits).where(and(eq(s.workforceCommits.id, id), ctx.guard)).limit(1);
    if (!row) return false;
    if (row.accountId !== ctx.account.id || row.bodyHash !== hash) throw new AuthError(409, "This submission identifier is already in use.");
    return true;
  }
  if (await previous()) return { saved: true };
  const tx = new WorkspaceTransaction(db, { account: ctx.account, activeActor: () => sql`${ctx.guard}
    AND NOT EXISTS (SELECT 1 FROM workforce_commits WHERE id = ${id})` }, id, new Date(now).toISOString());
  tx.insert(s.ptoRequests, { id: newRecordId(), employeeId: ctx.account.employeeId, category, compensation: category === "unpaid" ? "unpaid" : "paid",
    ...dates, reason, explanation, status: "pending", requestedAt: tx.stamp });
  if (!await tx.commit(revision, hash, ["pto-request"]) && !await previous()) throw new AuthError(409, "Shared data changed. Reload time off and review your request before submitting again.");
  return { saved: true };
}
