import { sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { equal, defaultInfo } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import * as v from "./validation";
export async function settingsChange(r: RecordContext, change: Change) {
  if (change.entity === "notifications") {
    const data = v.object(change.after); v.keys(data, ["opened", "dismissed"]);
    for (const property of ["opened", "dismissed"]) for (const key of v.list(data[property], 500)) {
      const sourceKey = v.text(key, 150, true); if (!/^(?:alert|request|schedule)-[A-Za-z0-9:_-]+$/.test(sourceKey)) throw new AuthError(400, "Invalid notification reference.");
      const column = property === "opened" ? "openedAt" : "dismissedAt";
      r.tx.insert(s.notificationReceipts, { accountId: r.ctx.account.id, sourceKey, [column]: r.tx.stamp }, sql`1 = 1`, { target: ["accountId", "sourceKey"], update: [column] });
    }
    return;
  }
  r.ctx.requirePermission("settings.manage"); if (!r.ctx.allDepartments) throw new AuthError(403, "An Owner or General Manager must change company settings.");
  if (change.entity === "business") {
    const data = v.object(change.after); v.keys(data, Object.keys(defaultInfo));
    if (data.accountOwner !== r.view.basicInfo.accountOwner) throw new AuthError(403, "Primary Owner is managed separately from company contact details.");
    if (data.timeZone !== "America/Los_Angeles") throw new AuthError(400, "This location uses America/Los_Angeles.");
    const values = Object.fromEntries(Object.keys(defaultInfo).filter(key => key !== "accountOwner").map(key => [key, v.text(data[key], key === "website" ? 500 : 200, ["companyName", "locationName"].includes(key))]));
    r.tx.insert(s.business, { id: 1, ...values, updatedAt: r.tx.stamp }, sql`1 = 1`, { target: ["id"], update: [...Object.keys(values), "updatedAt"] }); return;
  }
  const data = v.object(change.after); v.keys(data, [...Object.keys(r.view.settings), "hoursRoundingMinutes"]);
  const { hoursRoundingMinutes, ...rest } = data; const settings = normalizeScheduleEnforcement(rest);
  if (!equal(rest, settings)) throw new AuthError(400, "Settings contain an invalid switch, time or limit.");
  const rounding = hoursRoundingMinutes === undefined ? r.view.state.hoursRoundingMinutes : v.integer(hoursRoundingMinutes, 5, 15);
  if (![5, 10, 15].includes(rounding)) throw new AuthError(400, "Choose 5, 10 or 15 minutes for rounding.");
  // Setting initialization does not infer an Owner from an employee number/name.
  r.tx.write(sql`INSERT INTO business (id, company_name, location_name) SELECT 1, ${r.view.basicInfo.companyName}, ${r.view.basicInfo.locationName} WHERE NOT EXISTS (SELECT 1 FROM business WHERE id = 1) AND ${r.tx.receipt}`);
  r.tx.insert(s.locationSettings, { businessId: 1, ...settings, hoursRoundingMinutes: rounding, updatedAt: r.tx.stamp }, sql`1 = 1`, { target: ["businessId"], update: [...Object.keys(settings), "hoursRoundingMinutes", "updatedAt"] });
}
