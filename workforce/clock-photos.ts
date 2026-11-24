import { eq, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { AuthError, json } from "../auth/http";
import * as s from "../db/schema";
import type { DocumentBucket } from "../documents/types";
import { downloadHeaders } from "../documents/validation";
import { currentRawPunch } from "./clock-projection";
import type { Context, Database } from "./context";

export function clockRoleScope(ctx: Context, role: SQLWrapper) {
  return ctx.allDepartments ? sql`1 = 1` : sql`EXISTS (SELECT 1 FROM roles named_role WHERE named_role.name = ${role} AND ${ctx.roleFilter(sql`named_role.id`)})`;
}

export async function readClockPhoto(db: Database, ctx: Context, request: Request, bucket?: DocumentBucket) {
  ctx.requirePermission("timesheets.read");
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
  const id = new URL(request.url).searchParams.get("event");
  if (!id || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new AuthError(400, "Select a clock-in photo.");
  const [file] = await db.select({ key: s.clockInPhotos.objectKey, sha: s.clockInPhotos.sha256, size: s.clockInPhotos.sizeBytes })
    .from(s.clockInPhotos).innerJoin(s.clockEvents, eq(s.clockEvents.id, s.clockInPhotos.eventId))
    .where(sql`${s.clockEvents.id} = ${Number(id)} AND ${s.clockInPhotos.readyAt} IS NOT NULL
      AND ${ctx.activeActor()} AND ${ctx.employeeFilter(s.clockEvents.employeeId)} AND ${clockRoleScope(ctx, s.clockEvents.roleName)}
      AND (${currentRawPunch} OR EXISTS (
        SELECT 1 FROM time_cards tc JOIN time_card_edits latest ON latest.card_id = tc.id AND latest.revision = tc.version
        JOIN time_card_edits original ON original.card_id = tc.id AND original.revision = 1
        JOIN json_each(original.before, '$.eventIds') source ON source.value = ${s.clockEvents.id}
        WHERE tc.employee_id = ${s.clockEvents.employeeId} AND ${ctx.roleFilter(sql`tc.role_id`)}
          AND json_array_length(latest.after, '$.events') > 0
      ))`).limit(1);
  if (!file || !bucket) throw new AuthError(404, "Clock-in photo not found.");
  const object = await bucket.get(file.key);
  if (!object || object.size !== file.size || object.customMetadata?.sha256 !== file.sha) throw new AuthError(404, "Clock-in photo not found.");
  return new Response(object.body, { headers: { ...downloadHeaders("clock-in.jpg", "image/jpeg", file.size), "Content-Disposition": "inline" } });
}
