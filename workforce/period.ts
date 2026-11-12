import { AuthError } from "../auth/http";
import * as v from "./validation";

export type WorkspacePeriod = { start: string; end: string };
export function workspacePeriod(value?: unknown, now = Date.now()): WorkspacePeriod {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (value === undefined) return { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
  const data = v.object(value); v.keys(data, ["start", "end"]);
  const start = v.date(data.start), end = v.date(data.end);
  if (end < start || Date.parse(end) - Date.parse(start) > 365 * 86400000) throw new AuthError(400, "Choose a date range of at most 366 days.");
  return { start, end };
}
export function requestPeriod(url: URL, now = Date.now()) {
  const start = url.searchParams.get("start"), end = url.searchParams.get("end");
  return workspacePeriod(start === null && end === null ? undefined : { start, end }, now);
}
export function offsetDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
