import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { and, eq, sql } from "drizzle-orm";
import { rateKey } from "../auth/crypto";
import { AuthError, json } from "../auth/http";
import { clockInPhotos, locationSettings } from "../db/schema";
import type { DocumentBucket } from "../documents/types";
import { fileBytes, sameOrigin, validateSignature } from "../documents/validation";
import type { KioskOperatorDatabase } from "./database";
import type { RegisteredDevice } from "./device";

const lifetime = 2 * 60 * 1000;
export const maxClockPhotoBytes = 128 * 1024;
const signature = (secret: string, device: RegisteredDevice, grant: string) => rateKey(secret, `clock-photo:${device.session.id}:${grant}`);

export async function kioskPhotosEnabled(db: KioskOperatorDatabase) {
  const [settings] = await db.select({ enabled: locationSettings.clockInPhotos }).from(locationSettings).where(eq(locationSettings.businessId, 1));
  return !!settings?.enabled;
}

export function clockPhotoGrant(secret: string, device: RegisteredDevice, eventId: number, now: number) {
  const grant = `${eventId}.${now + lifetime}`;
  return `${grant}.${signature(secret, device, grant)}`;
}

export async function saveClockPhoto(db: KioskOperatorDatabase, bucket: DocumentBucket | undefined,
  device: RegisteredDevice, secret: string, request: Request, now: number) {
  sameOrigin(request);
  const match = /^([1-9]\d{0,15})\.(\d{13})\.([a-f0-9]{64})$/.exec(request.headers.get("x-clock-photo-grant") ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[2]) <= now || Number(match[2]) > now + lifetime ||
    !timingSafeEqual(Buffer.from(match[3], "hex"), Buffer.from(signature(secret, device, `${match[1]}.${match[2]}`), "hex"))) {
    throw new AuthError(403, "This clock-in photo request has expired or is invalid.");
  }
  if (!bucket || !await kioskPhotosEnabled(db)) throw new AuthError(409, "Clock-in photos are unavailable.");
  if (request.headers.get("content-type") !== "image/jpeg") throw new AuthError(415, "Use a JPEG clock-in photo.");
  const bytes = await fileBytes(request, maxClockPhotoBytes, "Clock-in photos must be 128 KB or smaller.");
  validateSignature(bytes, "image/jpeg");
  if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new AuthError(415, "The clock-in photo is incomplete.");
  const eventId = Number(match[1]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `clock-in/${eventId}/${sha}.jpg`;
  // Claim the exact bytes before contacting R2. Retries can finish the same
  // attachment and a second photo cannot replace the original.
  await db.run(sql`INSERT INTO clock_in_photos (event_id, object_key, size_bytes, sha256)
    SELECT id, ${key}, ${bytes.byteLength}, ${sha} FROM clock_events WHERE id = ${eventId}
    AND event_type = 'in' AND source = 'kiosk' AND device_id = ${device.device.id}
    AND NOT EXISTS (SELECT 1 FROM assisted_clock_reports WHERE event_id = ${eventId})
    ON CONFLICT (event_id) DO NOTHING`);
  const [claim] = await db.select().from(clockInPhotos).where(eq(clockInPhotos.eventId, eventId));
  if (claim?.sha256 !== sha) throw new AuthError(409, "Only one photo can be attached to a clock-in.");
  if (!claim.readyAt) {
    await bucket.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: sha } });
    await db.update(clockInPhotos).set({ readyAt: new Date(now).toISOString() })
      .where(and(eq(clockInPhotos.eventId, eventId), eq(clockInPhotos.sha256, sha), sql`${clockInPhotos.readyAt} IS NULL`));
  }
  return json({ attached: true });
}
