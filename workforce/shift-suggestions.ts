import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import type { Database, Context } from "./context";
import { AuthError } from "../auth/http";
import * as v from "./validation";

export async function frequentShifts(db: Database, ctx: Context, url: URL) {
  ctx.requirePermission("schedule.manage");
  if ([...url.searchParams.keys()].some(key => !["employeeId", "date"].includes(key))
    || [...url.searchParams.keys()].length !== 2) throw new AuthError(400, "Choose one employee and date.");
  const employeeId = v.integer(Number(url.searchParams.get("employeeId")));
  const date = v.date(url.searchParams.get("date"));
  await ctx.requireEmployee(employeeId, "schedule.manage");
  const count = sql<number>`count(*)`;
  const suggestions = await db.select({ start: s.shifts.startTime, end: s.shifts.endTime, role: s.roles.name, color: s.shifts.color, count })
    .from(s.shifts).innerJoin(s.roles, eq(s.roles.id, s.shifts.roleId))
    .innerJoin(s.employeeRoles, sql`${s.employeeRoles.employeeId} = ${employeeId} AND ${s.employeeRoles.roleId} = ${s.roles.id} AND ${s.employeeRoles.active} = 1`)
    .where(sql`${ctx.activeActor()} AND ${ctx.roleFilter(s.roles.id)} AND ${s.shifts.employeeId} = ${employeeId}
      AND ${s.shifts.archivedAt} IS NULL AND ${s.shifts.shiftType} = 'work'
      AND ${s.shifts.date} >= date(${date}, '-56 days') AND ${s.shifts.date} < ${date}`)
    .groupBy(s.shifts.startTime, s.shifts.endTime, s.roles.name, s.shifts.color)
    .orderBy(sql`${count} DESC`, s.shifts.startTime, s.roles.name, s.shifts.color).limit(5);
  return { suggestions };
}
