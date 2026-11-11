import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { tokenHash, tokenIsValid } from "../auth/crypto";

export type KioskDatabase = DrizzleD1Database<typeof schema>;
export const deviceSeconds = 365 * 24 * 60 * 60;
export type KioskCookie = "device" | "person";

export function kioskCookieName(url: URL, kind: KioskCookie) {
  return `${url.protocol === "https:" ? "__Host-" : ""}dombase-kiosk-${kind}`;
}
export function kioskCookie(url: URL, kind: KioskCookie, token: string, seconds: number) {
  return `${kioskCookieName(url, kind)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${url.protocol === "https:" ? "; Secure" : ""}`;
}
export function readKioskCookie(cookie: string | null, url: URL, kind: KioskCookie) {
  const name = kioskCookieName(url, kind);
  const parts = (cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return parts.length === 1 ? parts[0].slice(name.length + 1) : "";
}
export async function registeredDevice(db: KioskDatabase, cookie: string | null, url: URL, time = Date.now()) {
  const token = readKioskCookie(cookie, url, "device");
  if (!tokenIsValid(token)) return null;
  const [row] = await db.select({ session: schema.deviceSessions, device: schema.kioskDevices })
    .from(schema.deviceSessions).innerJoin(schema.kioskDevices, eq(schema.deviceSessions.deviceId, schema.kioskDevices.id))
    .where(and(eq(schema.deviceSessions.tokenHash, tokenHash(token)), isNull(schema.deviceSessions.revokedAt),
      isNull(schema.kioskDevices.revokedAt), sql`${schema.deviceSessions.expiresAt} > ${new Date(time).toISOString()}`)).limit(1);
  return row ?? null;
}
export type RegisteredDevice = NonNullable<Awaited<ReturnType<typeof registeredDevice>>>;
