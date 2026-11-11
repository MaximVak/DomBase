import { eq } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, json, readAuthBody } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import type { createAccessService } from "../access/service";
import { WorkspaceTransaction } from "./transaction";
import { workspaceSnapshot } from "./snapshot";
import { departmentChange, employeeChange } from "./records";
import type { RecordContext } from "./records";
import { scheduleChange } from "./schedule";
import { timeOffChange } from "./time-off";
import { conversationChange } from "./messages";
import { timecardChange } from "./timecards";
import { settingsChange } from "./settings";
import { canonical, equal } from "./contract";
import type { Change, WorkspaceData, Entity } from "./contract";
import type { Database } from "./context";
import * as v from "./validation";
import { runClockMaintenance } from "./maintenance";

const entities: Entity[] = ["employee", "department", "schedule-event", "schedule-draft", "schedule-publish", "timecard", "hours-adjustment", "pto-request", "pto-policy", "availability", "conversation", "settings", "business", "notifications"];
function currentRecord(view: WorkspaceData, change: Change, employeeKey: number): unknown {
  const collections = { employee: view.state.employees, department: view.state.departments, "schedule-event": view.state.scheduleEvents, "hours-adjustment": view.state.hoursAdjustments, "pto-request": view.state.ptoRequests, "pto-policy": view.state.ptoPolicies, availability: view.state.availabilityRequests, conversation: view.state.conversations };
  if (change.entity in collections) return collections[change.entity as keyof typeof collections].find(row => row.id === change.id) ?? null;
  if (change.entity === "schedule-draft" || change.entity === "schedule-publish") return view.state.scheduleDraftsByManager[employeeKey] ?? null;
  if (change.entity === "settings") return { ...view.settings, hoursRoundingMinutes: view.state.hoursRoundingMinutes };
  if (change.entity === "business") return view.basicInfo;
  if (change.entity === "notifications") return { opened: view.opened[employeeKey] ?? [], dismissed: view.dismissed[employeeKey] ?? [] };
  if (change.entity === "timecard") {
    const after = v.object(change.after); const ids = v.list(after.eventIds, 100).map(id => v.integer(id));
    return { events: view.state.clockEvents.filter(event => ids.includes(event.id)) };
  }
  throw new AuthError(400, "Unknown operation.");
}
export function createWorkforceService(db: Database, access: ReturnType<typeof createAccessService>, options: { secret: string; fieldKey: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  if (options.secret.length < 32) throw new Error("Workspace configuration unavailable.");
  async function handle(request: Request) {
    try {
      const ctx = await access.workspaceContext(request);
      const action = new URL(request.url).pathname.slice("/api/workspace/".length);
      if (action === "state" && request.method === "GET") return json(await workspaceSnapshot(db, ctx, options.fieldKey));
      if (action === "maintenance" && request.method === "POST") {
        ctx.requirePermission("timesheets.manage");
        if (!ctx.allDepartments) throw new AuthError(403, "This action requires company-wide time management.");
        const body = await readAuthBody(request); v.keys(body, []);
        return json({ recorded: await runClockMaintenance(db, now()) });
      }
      if (action !== "commit") throw new AuthError(404, "Not found.");
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
      const body = await readAuthBody(request, 256 * 1024); v.keys(body, ["id", "revision", "employeeVersions", "changes"]);
      if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
      const revision = v.integer(body.revision, 0); const id = body.id;
      const changes = v.list(body.changes, 100).map(value => {
        const op = v.object(value); v.keys(op, ["entity", "id", "before", "after"]);
        return { entity: v.oneOf(op.entity, entities), id: v.integer(op.id), before: op.before ?? null, after: op.after ?? null } satisfies Change;
      });
      if (!changes.length) throw new AuthError(400, "No changes to save.");
      if (new Set(changes.map(change => `${change.entity}:${change.id}`)).size !== changes.length) throw new AuthError(400, "Duplicate save operation.");
      const hash = rateKey(options.secret, canonical(body));
      const minimal = request.headers.get("prefer") === "return=minimal";
      const [previous] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, id)).limit(1);
      if (previous) {
        if (previous.accountId !== ctx.account.id || previous.bodyHash !== hash) throw new AuthError(409, "This save identifier is already in use.");
        return minimal ? json({ saved: true, id, revision: previous.revision }, 200, { "Preference-Applied": "return=minimal" }) : json(await workspaceSnapshot(db, ctx, options.fieldKey));
      }
      const view = await workspaceSnapshot(db, ctx, options.fieldKey);
      if (revision !== view.revision) throw new AuthError(409, "Someone else saved changes. Reload the latest data and try again.");
      const employeeKey = ctx.account.employeeId ?? -ctx.account.id; const versions = v.object(body.employeeVersions);
      for (const change of changes) {
        if (!equal(change.before, currentRecord(view, change, employeeKey))) throw new AuthError(409, "This record changed or is outside your access. Reload before saving.");
        if (change.entity === "employee" && change.before && versions[String(change.id)] !== view.employeeVersions[change.id]) throw new AuthError(409, "Employee access or data changed. Reload before saving.");
        if (change.after && !["timecard", "schedule-draft", "schedule-publish", "settings", "business", "notifications"].includes(change.entity) && v.object(change.after).id !== change.id) throw new AuthError(400, "Record identifier does not match.");
      }
      const stamp = new Date(now()).toISOString(); const tx = new WorkspaceTransaction(db, ctx, id, stamp);
      const roles = await db.select({ id: s.roles.id, name: s.roles.name, departmentId: s.roles.departmentId, archived: s.roles.archived }).from(s.roles);
      const r: RecordContext = { db, ctx, tx, view, roles, fieldKey: options.fieldKey, today: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now())) };
      const order = (entity: Entity) => entity === "department" ? 0 : entity === "employee" ? 1 : entity === "pto-policy" ? 2 : 3;
      for (const change of [...changes].sort((a, b) => order(a.entity) - order(b.entity))) {
        if (change.entity === "department") await departmentChange(r, change);
        else if (change.entity === "employee") await employeeChange(r, change);
        else if (["schedule-event", "schedule-draft", "schedule-publish"].includes(change.entity)) await scheduleChange(r, change);
        else if (["pto-policy", "pto-request", "availability"].includes(change.entity)) await timeOffChange(r, change);
        else if (change.entity === "conversation") await conversationChange(r, change);
        else if (["timecard", "hours-adjustment"].includes(change.entity)) await timecardChange(r, change);
        else await settingsChange(r, change);
      }
      if (!await tx.commit(revision, hash, [...new Set(changes.map(change => change.entity))])) throw new AuthError(409, "Your access or this workspace changed. Reload before saving.");
      // Reload is a separate request: compiling/projecting a second full snapshot
      // here can exceed the hosted Worker's CPU budget after an already committed save.
      return minimal ? json({ saved: true, id, revision: revision + 1 }, 200, { "Preference-Applied": "return=minimal" }) : json(await workspaceSnapshot(db, ctx, options.fieldKey));
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      // Never log a request, SQL parameter, message, private field or credential.
      // Log only allowlisted failure categories, never SQL/parameters or private input.
      const cause = error instanceof Error ? error.cause : undefined;
      const detail = [error instanceof Error ? error.message : "", cause instanceof Error ? cause.message : ""].join(" ");
      const kind = ["CHECK constraint failed", "FOREIGN KEY constraint failed", "UNIQUE constraint failed", "NOT NULL constraint failed", "too many SQL variables", "too many API requests", "no such table", "no such column", "SQLITE_BUSY", "D1_TYPE_ERROR", "Invalid array length", "Invalid time value"].find(value => detail.toLowerCase().includes(value.toLowerCase())) ?? "unclassified";
      console.error("Shared workspace request failed.", { kind, code: detail.match(/\b(?:SQLITE_[A-Z_]+|D1_[A-Z_]+)\b/)?.[0] ?? "unknown" });
      return json({ error: "Could not confirm the save or load the workspace. Reload the latest data before trying again." }, 503);
    }
  }
  return { handle };
}
