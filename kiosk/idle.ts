import { eq, sql } from "drizzle-orm";
import type { createAccessService } from "../access/service";
import { AuthError, json, readAuthBody } from "../auth/http";
import { locationSettings } from "../db/schema";
import { defaultInfo } from "../workforce/contract";
import { atomicBatch } from "./database";
import type { KioskOperatorDatabase } from "./database";
import { exactKeys } from "./security";

export async function clockIdleSeconds(db: KioskOperatorDatabase) {
  const [settings] = await db.select({ idle: locationSettings.kioskIdleSeconds }).from(locationSettings).where(eq(locationSettings.businessId, 1));
  return Math.max(5, Math.min(120, settings?.idle ?? 30));
}

export async function clockOptions(request: Request, db: KioskOperatorDatabase, access: ReturnType<typeof createAccessService>) {
  const actor = await access.authorize(request, "settings.manage");
  if (actor.account.accessLevel === "manager") throw new AuthError(403, "An Owner or General Manager must change shared clock settings.");
  if (request.method === "GET") return json({ idleSeconds: await clockIdleSeconds(db) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  const body = await readAuthBody(request);
  exactKeys(body, ["idleSeconds", "expectedSeconds"]);
  const { idleSeconds, expectedSeconds } = body;
  if (typeof idleSeconds !== "number" || !Number.isInteger(idleSeconds) || idleSeconds < 5 || idleSeconds > 120 || !Number.isInteger(expectedSeconds)) {
    throw new AuthError(400, "Enter a whole number from 5 to 120 seconds.");
  }
  const time = new Date().toISOString();
  const [ , saved] = await atomicBatch(db, [
    sql`INSERT INTO business (id, company_name, location_name) SELECT 1, ${defaultInfo.companyName}, ${defaultInfo.locationName}
      WHERE ${actor.activeActor()} AND ${expectedSeconds} = 30 ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO location_settings (business_id, kiosk_idle_seconds, updated_at)
      SELECT 1, ${idleSeconds}, ${time} WHERE ${actor.activeActor()}
      AND COALESCE((SELECT MAX(5, MIN(120, kiosk_idle_seconds)) FROM location_settings WHERE business_id = 1), 30) = ${expectedSeconds}
      ON CONFLICT (business_id) DO UPDATE SET kiosk_idle_seconds = excluded.kiosk_idle_seconds, updated_at = excluded.updated_at`,
    sql`INSERT INTO audit_log (actor_account_id, action, entity_type, entity_id, metadata, created_at)
      SELECT ${actor.account.id}, 'kiosk.idle_changed', 'location_settings', '1', ${JSON.stringify({ idleSeconds })}, ${time} WHERE changes() = 1`,
  ]);
  if (saved.meta.changes !== 1) throw new AuthError(409, "The clock setting changed. Reload before saving again.");
  return json({ idleSeconds });
}
