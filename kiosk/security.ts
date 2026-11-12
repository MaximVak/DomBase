import { and, eq, sql } from "drizzle-orm";
import { authRateLimits } from "../db/schema";
import { AuthError } from "../auth/http";
import { hashPassword, rateKey, verifyPassword } from "../auth/crypto";
import type { KioskDatabase } from "./device";

export const pinIsValid = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4,8}$/.test(pin) && !/^0+$/.test(pin);
export const pinLookup = (secret: string, pin: string) => rateKey(secret, `kiosk-pin:${pin}`);
// Keyed input protects short PIN verifiers from an offline small-space search.
export const hashPin = (secret: string, pin: string) => hashPassword(rateKey(secret, `kiosk-verifier:${pin}`));
export const verifyPin = (secret: string, pin: string, hash: string) => verifyPassword(rateKey(secret, `kiosk-verifier:${pin}`), hash);
export const pinAttemptLimits = { employeeDevice: 20, approvalDevice: 10, pin: 5, windowSeconds: 900 } as const;
export class KioskRateLimitError extends AuthError {
  constructor(readonly retryAfterSeconds: number, readonly limitScope: "device" | "pin" | "password") {
    super(429, limitScope === "device" ? "Too many PIN attempts on this tablet. PIN entry is temporarily locked." : limitScope === "pin" ? "Too many attempts with this PIN. Wait before trying it again, or use a different PIN." : "Too many password attempts. Try again later.");
  }
}
const remaining = (startedAt: string, now: number) => Math.max(0, Math.ceil((Date.parse(startedAt) + pinAttemptLimits.windowSeconds * 1000 - now) / 1000));
export async function devicePinLockouts(db: KioskDatabase, secret: string, deviceId: string, now: number) {
  const entries = await Promise.all([["employee-device", pinAttemptLimits.employeeDevice], ["approval-device", pinAttemptLimits.approvalDevice]].map(async ([kind, limit]) => {
    const [row] = await db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, rateKey(secret, `kiosk:${kind}:${deviceId}`))).limit(1);
    return row && row.failedAttempts > Number(limit) ? remaining(row.windowStartedAt, now) : 0;
  }));
  return { pinRetryAfterSeconds: entries[0], approvalRetryAfterSeconds: entries[1] };
}
export async function attemptBudget(db: KioskDatabase, secret: string, key: string, limit: number, now = Date.now()) {
  const time = new Date(now).toISOString();
  const cutoff = new Date(now - 900000).toISOString();
  const [row] = await db.insert(authRateLimits).values({ keyHash: rateKey(secret, `kiosk:${key}`), failedAttempts: 1, windowStartedAt: time })
    .onConflictDoUpdate({ target: authRateLimits.keyHash, set: {
      failedAttempts: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${cutoff} THEN 1 ELSE ${authRateLimits.failedAttempts} + 1 END`,
      windowStartedAt: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${cutoff} THEN ${time} ELSE ${authRateLimits.windowStartedAt} END`,
    } }).returning();
  if (row.failedAttempts > limit) throw new KioskRateLimitError(remaining(row.windowStartedAt, now), key.startsWith("reauth:") ? "password" : key.includes("-device:") ? "device" : "pin");
  return { keyHash: row.keyHash, windowStartedAt: row.windowStartedAt };
}
// Remove only this successful attempt, retaining earlier failures and never
// decrementing a newer window. Knowing one's own PIN cannot clear failed guesses.
export async function releaseAttempt(db: KioskDatabase, receipt: { keyHash: string; windowStartedAt: string }) {
  await db.update(authRateLimits).set({ failedAttempts: sql`${authRateLimits.failedAttempts} - 1` }).where(and(
    eq(authRateLimits.keyHash, receipt.keyHash), eq(authRateLimits.windowStartedAt, receipt.windowStartedAt), sql`${authRateLimits.failedAttempts} > 0`,
  ));
}
export function exactKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AuthError(400, "Unexpected field.");
}
export function positiveId(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AuthError(400, "Choose a valid record.");
  return Number(value);
}
