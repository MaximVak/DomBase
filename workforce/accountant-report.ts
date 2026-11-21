import type { WorkspacePeriod } from "./period";

export const accountantColumns = ["Employee name", "Payroll ID", "Pay period", "Regular hours", "Overtime hours", "Double time hours", "PTO hours", "Total hours"] as const;
export const salariedReferenceColumn = "Salaried reference hours";
export const defaultReferenceHours = 40;
export const unverifiedHours = "Review required";

export type AccountantRow = {
  employeeId: number;
  name: string;
  payrollId: string;
  regular: number | null;
  overtime: number | null;
  doubleTime: number | null;
  pto: number;
  total: number | null;
  salaryEligible: boolean;
};

export type AccountantReport = {
  period: WorkspacePeriod;
  location: string;
  periodsPerYear: number | null;
  rows: AccountantRow[];
};

export type AccountantCell = string | number;
export const roundReportHours = (hours: number) => Math.round(hours * 100 + 1e-9) / 100;
export const payPeriodLabel = (period: WorkspacePeriod) => `${period.start} to ${period.end}`;

export function accountantCells(report: AccountantReport, weeklyHours?: ReadonlyMap<number, number>): AccountantCell[][] {
  const periods = report.periodsPerYear;
  const reference = weeklyHours !== undefined && periods !== null;
  const payPeriod = payPeriodLabel(report.period);
  return [[...accountantColumns, ...(reference ? [salariedReferenceColumn] : [])], ...report.rows.map(row => [
    row.name, row.payrollId, payPeriod, row.regular ?? unverifiedHours, row.overtime ?? unverifiedHours,
    row.doubleTime ?? unverifiedHours, row.pto, row.total ?? unverifiedHours,
    ...(reference ? [row.salaryEligible
      ? roundReportHours((weeklyHours.get(row.employeeId) ?? defaultReferenceHours) * 52 / periods) : ""] : []),
  ])];
}
