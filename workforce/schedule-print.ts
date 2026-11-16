import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import type { Context, Database } from "./context";
import * as v from "./validation";
import { workspaceSnapshot } from "./snapshot";
import { printPeriod, schedulePrintDocument } from "../app/schedule-print-model";

export async function readSchedulePrint(db: Database, ctx: Context, url: URL, fieldKey: string, now: number) {
  ctx.requirePermission("schedule.read");
  const keys = ["date", "view", "employees", "draft"];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => url.searchParams.getAll(key).length > 1)) throw new AuthError(400, "Invalid print options.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const date = v.date(url.searchParams.get("date") ?? today), view = v.oneOf(url.searchParams.get("view") ?? "week", ["day", "week", "month"]);
  const draft = v.oneOf(url.searchParams.get("draft") ?? "false", ["true", "false"]) === "true";
  if (draft) ctx.requirePermission("schedule.manage");
  const filter = url.searchParams.get("employees");
  if (filter !== null && (filter.length > 34000 || filter && !/^\d+(,\d+)*$/.test(filter))) throw new AuthError(400, "Invalid team member filter.");
  const ids = filter === null ? null : filter === "" ? [] : filter.split(",").map(id => v.integer(Number(id)));
  if (ids && (ids.length > 2000 || new Set(ids).size !== ids.length)) throw new AuthError(400, "Choose up to 2,000 different team members.");
  const [settings] = await db.select({ weekStart: s.locationSettings.workWeekStart }).from(s.locationSettings).where(ctx.activeActor()).limit(1);
  if (!settings) throw new AuthError(401, "Sign in to print your schedule.");
  const period = printPeriod(date, view, settings.weekStart), data = await workspaceSnapshot(db, ctx, fieldKey, period);
  const published = await db.select({ id: s.shifts.id }).from(s.shifts).where(and(ctx.activeActor(), ctx.employeeFilter(s.shifts.employeeId), ctx.roleFilter(s.shifts.roleId), isNull(s.shifts.archivedAt), sql`${s.shifts.publicationId} IS NOT NULL AND ${s.shifts.date} BETWEEN ${period.start} AND ${period.end}`));
  const publishedIds = new Set(published.map(row => row.id));
  if (ids?.some(id => !data.state.employees.some(person => person.id === id))) throw new AuthError(404, "A selected team member is outside your access.");
  const people = data.state.employees.filter(person => ids ? ids.includes(person.id) : person.active || data.state.shifts.some(row => row.employeeId === person.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const document = schedulePrintDocument({ location: data.basicInfo.locationName, timeZone: data.basicInfo.timeZone,
    ...period, weekStart: settings.weekStart, capturedAt: new Date(now).toISOString(), draft, canPrintDraft: data.permissions["schedule.manage"],
    scope: ids === null ? "All team members in your access" : `${people.length} selected team member${people.length === 1 ? "" : "s"}`,
    employees: people, shifts: data.state.shifts.filter(row => publishedIds.has(row.id)), draftChanges: data.state.scheduleDraftsByManager[ctx.account.employeeId ?? -ctx.account.id],
    open: data.openSchedule, events: data.settings.enableScheduleEvents ? data.state.scheduleEvents : [],
    leave: data.permissions["time_off.read"] ? data.state.ptoRequests : [],
  });
  const [current] = await db.select({ revision: s.workforceState.revision }).from(s.workforceState).where(and(eq(s.workforceState.id, 1), ctx.activeActor())).limit(1);
  if (!current) throw new AuthError(401, "Sign in to print your schedule.");
  if (current.revision !== data.revision) throw new AuthError(409, "The schedule changed while preparing this printout. Reload and try again.");
  return document;
}
