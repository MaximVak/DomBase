import { AuthError } from "../auth/http";
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthError(400, "Invalid record.");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new AuthError(400, "Unexpected record field.");
}
export function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new AuthError(400, "Invalid numeric value.");
  return Number(value);
}
export function number(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new AuthError(400, "Invalid amount.");
  return value;
}
export function text(value: unknown, max = 200, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new AuthError(400, "Invalid or missing text.");
  return value.trim();
}
export function boolean(value: unknown) { if (typeof value !== "boolean") throw new AuthError(400, "Invalid switch."); return value; }
export function date(value: unknown) {
  const result = text(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T12:00:00Z`)) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) throw new AuthError(400, "Invalid date.");
  return result;
}
export function time(value: unknown) { const result = text(value, 5, true); if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new AuthError(400, "Invalid time."); return result; }
export function list(value: unknown, max = 500): unknown[] { if (!Array.isArray(value) || value.length > max) throw new AuthError(400, "Invalid or oversized list."); return value; }
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T { if (typeof value !== "string" || !allowed.includes(value as T)) throw new AuthError(400, "Invalid choice."); return value as T; }
export function changed(before: unknown, after: Record<string, unknown>) { const previous = before ? object(before) : {}; return Object.keys(after).filter(key => JSON.stringify(previous[key]) !== JSON.stringify(after[key])); }
