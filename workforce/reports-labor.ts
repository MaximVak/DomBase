import type { TimeCard } from "../app/timesheets-model";
import { weekStart } from "./period";

const unverifiedPremium = new Set(["Review salaried break premium", "Review break premium wage rate", "Confirm time and breaks before calculating premiums"]);
const decimalMoney = new Intl.NumberFormat("en-US", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (amount: number) => Math.round(amount * 100);

export type LaborAmounts = {
  estimatedCents: number | null;
  breakPremiumCents: number | null;
  holidayPremiumCents: number | null;
  totalCents: number | null;
};

export type LaborRole = LaborAmounts & { role: string; department: string };
export type LaborDepartment = LaborAmounts & { id: number | null; name: string };

type LaborEntry = { role: string; estimatedCents: number | null; breakPremiumCents: number | null; holidayDollars: number | null };
type RoleDepartment = { name: string; departmentId: number | null; department: string | null };

export function hasUnverifiedBreakPremium(card: TimeCard) {
  return card.issues.some(issue => unverifiedPremium.has(issue));
}

export function laborEntries(selected: TimeCard[], unresolved: ReadonlySet<TimeCard>, workWeekStart: number, holidayPayEnabled: boolean): LaborEntry[] {
  const key = (card: TimeCard) => `${card.employeeId}:${weekStart(card.date, workWeekStart)}`;
  const unresolvedWeeks = new Set([...unresolved].map(key));
  return selected.flatMap(card => {
    const { metrics } = card;
    if (!unresolved.has(card) && !metrics.actual && !metrics.pto && !metrics.mealPremium && !metrics.restPremium) return [];
    const incomplete = unresolvedWeeks.has(key(card)) || hasUnverifiedBreakPremium(card);
    return [{ role: card.role, estimatedCents: incomplete || metrics.wages === null ? null : cents(metrics.wages),
      breakPremiumCents: incomplete || metrics.premiumPay === null ? null : cents(metrics.premiumPay),
      holidayDollars: holidayPayEnabled && !incomplete ? metrics.holidayPremium : null }];
  });
}

function sumAvailable<T>(rows: T[], amount: (row: T) => number | null) {
  let total = 0;
  for (const row of rows) {
    const value = amount(row);
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function estimatedLaborCents(entries: LaborEntry[]) {
  return sumAvailable(entries, entry => entry.estimatedCents);
}

function amounts(estimatedCents: number | null, breakPremiumCents: number | null, holidayPremiumCents: number | null, holidayPayEnabled: boolean): LaborAmounts {
  return { estimatedCents, breakPremiumCents, holidayPremiumCents,
    totalCents: estimatedCents === null || (holidayPayEnabled && holidayPremiumCents === null) ? null : estimatedCents + (holidayPremiumCents ?? 0) };
}

export function laborBreakdown(entries: LaborEntry[], roleDepartments: RoleDepartment[], holidayPayEnabled: boolean) {
  const directory = new Map(roleDepartments.map(role => [role.name, role]));
  const byRole = Map.groupBy(entries, entry => entry.role);
  const allocatedHoliday = new Map<string, number>();
  if (holidayPayEnabled) {
    const known = [...byRole].flatMap(([role, group]) => {
      const dollars = sumAvailable(group, entry => entry.holidayDollars);
      return dollars === null ? [] : [{ role, exactCents: dollars * 100 }];
    });
    const knownRoles = new Set(known.map(row => row.role));
    // Timesheets displays the holiday premium after summing its unrounded amounts.
    // Allocate the rounded total across roles, favoring the largest remaining fractions.
    const dollars = entries.reduce((sum, entry) => sum + (knownRoles.has(entry.role) ? entry.holidayDollars ?? 0 : 0), 0);
    const target = cents(Number(decimalMoney.format(dollars)));
    let remaining = target - known.reduce((sum, row) => sum + Math.floor(row.exactCents), 0);
    known.sort((a, b) => (b.exactCents % 1) - (a.exactCents % 1) || a.role.localeCompare(b.role));
    for (const { role, exactCents } of known) {
      allocatedHoliday.set(role, Math.floor(exactCents) + (remaining > 0 ? 1 : 0));
      remaining--;
    }
  }

  const roles = [...byRole].sort(([a], [b]) => a.localeCompare(b)).map(([role, group]) => {
    const match = directory.get(role);
    return { role, department: match?.department ?? "Unassigned department", departmentId: match?.departmentId ?? null,
      ...amounts(estimatedLaborCents(group), sumAvailable(group, entry => entry.breakPremiumCents), allocatedHoliday.get(role) ?? null, holidayPayEnabled) };
  });
  const departments: LaborDepartment[] = [...Map.groupBy(roles, role => role.departmentId).values()].map(group => ({
    id: group[0].departmentId, name: group[0].department, ...amounts(sumAvailable(group, row => row.estimatedCents), sumAvailable(group, row => row.breakPremiumCents),
      holidayPayEnabled ? sumAvailable(group, row => row.holidayPremiumCents) : null, holidayPayEnabled),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    roles: roles.map(({ role, department, estimatedCents, breakPremiumCents, holidayPremiumCents, totalCents }): LaborRole => (
      { role, department, estimatedCents, breakPremiumCents, holidayPremiumCents, totalCents }
    )),
    departments,
    totals: amounts(estimatedLaborCents(entries), sumAvailable(roles, row => row.breakPremiumCents),
      holidayPayEnabled ? sumAvailable(roles, row => row.holidayPremiumCents) : null, holidayPayEnabled),
  };
}
