export type PayPeriod = "weekly" | "biweekly" | "semimonthly" | "monthly";
const day = (value: string) => new Date(`${value}T12:00:00Z`);
export function plusDays(value: string, count: number) { const d = day(value); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function periodFor(date: string, period: PayPeriod = "weekly", anchor = "2026-11-02"): { start: string; end: string } {
  if (period === "monthly") return { start: date.slice(0, 7) + "-01", end: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0, 12)).toISOString().slice(0, 10) };
  if (period === "semimonthly") return Number(date.slice(8)) <= 15 ? { start: date.slice(0, 7) + "-01", end: date.slice(0, 7) + "-15" } : { start: date.slice(0, 7) + "-16", end: periodFor(date, "monthly").end };
  const length = period === "biweekly" ? 14 : 7; const offset = Math.floor((day(date).getTime() - day(anchor).getTime()) / 86400000 / length) * length;
  const start = plusDays(anchor, offset); return { start, end: plusDays(start, length - 1) };
}
export function retainedThrough(termination: string, weekStart: number, period: PayPeriod, anchor: string) {
  const endOfWeek = plusDays(termination, 6 - ((day(termination).getUTCDay() - weekStart + 7) % 7));
  return endOfWeek > periodFor(termination, period, anchor).end ? endOfWeek : periodFor(termination, period, anchor).end;
}
export function tenure(start: string, today: string) {
  if (!start || start > today) return "Not started";
  let months = (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(start.slice(5, 7));
  if (today.slice(8) < start.slice(8)) months--;
  const years = Math.floor(months / 12), remainder = months % 12;
  return years ? `${years} ${years === 1 ? "year" : "years"}, ${remainder} ${remainder === 1 ? "month" : "months"}` : `${Math.max(0, months)} ${months === 1 ? "month" : "months"}`;
}
export const terminationReasons = ["Absenteeism / Late", "Admin Error / Accidental Account", "Availability Change", "Business Conditions", "Contractor", "Inadequate Job Performance", "Poor Fit - Culture", "Poor Fit - Experience", "Project Completed", "Requested via Clover", "Seasonal", "Unacceptable Behavior", "Voluntary Resignation"] as const;
export type WageRate = { id: number; roleId: number | null; role: string; amountCents: number; basis: "hourly" | "annual_salary"; effectiveDate: string; overtimeExempt?: boolean };
export function rateFor(rates: WageRate[], role: string, date: string) {
  return rates.filter(rate => (rate.role === role || rate.roleId === null) && rate.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id)[0];
}
export function hourlyRate(rate: WageRate | undefined) { return rate ? rate.amountCents / 100 / (rate.basis === "annual_salary" ? 52 * 40 : 1) : null; }
export function normalizePhone(value: string): string | null {
  if (!value.trim()) return "";
  const compact = value.replace(/[ ().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^\d{10}$/.test(compact)) return `+1${compact}`;
  if (/^1\d{10}$/.test(compact)) return `+${compact}`;
  return null;
}
