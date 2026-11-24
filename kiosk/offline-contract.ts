import type { ActionDetails } from "./break-rules";
import type { ClockType } from "./replay";

export const offlineAccessMs = 72 * 60 * 60 * 1000;

export type OfflineAuthorization = { token: string; id: string; key: string; issuedAt: number; expiresAt: number; idleSeconds: number };
export type OfflineEntry = {
  ticket: string;
  attemptedAt: number;
  eventType: ClockType;
  roleId?: number | null;
  explanation: string;
  details?: ActionDetails;
  offline?: { token: string; previous: string | null; proof: string };
};

export function offlineActionPayload(entry: Omit<OfflineEntry, "offline">, previous: string | null) {
  return JSON.stringify([entry.ticket, previous, entry.attemptedAt, entry.eventType, entry.roleId ?? null, entry.explanation, entry.details ?? null]);
}
