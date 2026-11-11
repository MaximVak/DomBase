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
export async function attemptBudget(db: KioskDatabase, secret: string, key: string, limit: number, now = Date.now()) {
  const time = new Date(now).toISOString();
  const cutoff = new Date(now - 900000).toISOString();
  const [row] = await db.insert(authRateLimits).values({ keyHash: rateKey(secret, `kiosk:${key}`), failedAttempts: 1, windowStartedAt: time })
    .onConflictDoUpdate({ target: authRateLimits.keyHash, set: {
      failedAttempts: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${cutoff} THEN 1 ELSE ${authRateLimits.failedAttempts} + 1 END`,
      windowStartedAt: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${cutoff} THEN ${time} ELSE ${authRateLimits.windowStartedAt} END`,
    } }).returning();
  if (row.failedAttempts > limit) throw new AuthError(429, "Too many attempts. Try again in 15 minutes.");
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
