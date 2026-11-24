import { plusDays } from "../team/rules";
import type { WageRate } from "../team/rules";
import type { OvertimePolicy } from "./schedule-enforcement";
import type { TimeCard } from "./timesheets-model";

export type WorkweekScope = { companyWide: boolean; dataPeriod?: { start: string; end: string } };
type PayableCard = { card: TimeCard; hours: number; rate?: WageRate | null; hourly: number | null };

const money = (value: number) => Math.round(value * 100) / 100;
const hasHours = (row: PayableCard) => (row.card.metrics.actual ?? 0) > 0 || (row.card.metrics.pto ?? 0) > 0;
const hour = 3600000;

export function allocateWorkedTime(rows: { date: string; worked: number; hasActual: boolean }[], week: string, policy: OvertimePolicy, exempt = false) {
  const seventhDate = plusDays(week, 6);
  const workedDays = new Set(rows.filter(row => row.hasActual).map(row => row.date));
  const seventhDayApplies = policy.overtimeSeventhDayEnabled && workedDays.size === 7;
  const weeklyLimit = policy.overtimeWeeklyEnabled ? policy.overtimeWeeklyHours * hour : Infinity;
  let weekRegular = 0;
  let workedToday = 0;
  let date = "";
  return rows.map(({ date: workDate, worked }) => {
    if (workDate !== date) { date = workDate; workedToday = 0; }
    const seventh = seventhDayApplies && date === seventhDate;
    const dailyLimit = seventh ? 0 : policy.overtimeDailyEnabled ? policy.overtimeDailyHours * hour : Infinity;
    const doubleLimit = policy.overtimeDoubleEnabled ? Math.min(policy.overtimeDoubleHours, seventh ? policy.overtimeSeventhDoubleHours : Infinity) * hour : Infinity;
    // A double-time hour takes precedence. Only hours still at straight time
    // consume the weekly allowance, so daily and weekly premiums do not stack.
    const regular = exempt ? worked : Math.max(0, Math.min(worked, dailyLimit - workedToday, doubleLimit - workedToday, weeklyLimit - weekRegular));
    const doubleTime = exempt ? 0 : Math.max(0, worked - Math.max(0, doubleLimit - workedToday));
    weekRegular += regular;
    workedToday += worked;
    return { regular, overtime: Math.max(0, worked - regular - doubleTime), doubleTime };
  });
}

function allocateOvertime(rows: PayableCard[], week: string, policy: OvertimePolicy, exempt: boolean) {
  const allocation = allocateWorkedTime(rows.map(({ card, hours }) => ({ date: card.date, worked: Math.round(hours * hour), hasActual: (card.metrics.actual ?? 0) > 0 })), week, policy, exempt);
  rows.forEach(({ card }, index) => {
    const { regular, overtime, doubleTime } = allocation[index];
    card.metrics.regular = regular / hour;
    card.metrics.ot = overtime / hour;
    card.metrics.doubleOt = doubleTime / hour;
  });
}

export function priceWorkweek(rows: PayableCard[], week: string, policy: OvertimePolicy, scope?: WorkweekScope) {
  const fullWeek = !scope?.dataPeriod || (scope.dataPeriod.start <= week && scope.dataPeriod.end >= plusDays(week, 6));
  const payable = rows.filter(hasHours);
  const salaries = payable.filter(row => row.rate?.basis === "annual_salary");
  const salaryTerms = new Set(salaries.map(row => `${row.rate!.amountCents}/${Boolean(row.rate!.overtimeExempt)}`));
  const mixedBasis = salaries.length > 0 && (salaries.length !== payable.length || salaryTerms.size > 1);
  const companyWide = scope?.companyWide ?? true;
  const needsReview = mixedBasis || !companyWide || !fullWeek;
  const exempt = salaries.length > 0 && !mixedBasis && salaries[0].rate?.overtimeExempt === true;
  if (!needsReview) allocateOvertime(rows, week, policy, exempt);

  const worked = rows.filter(row => (row.card.metrics.actual ?? 0) > 0);
  const workedHours = worked.reduce((sum, { card }) => sum + (card.metrics.actual ?? 0), 0);
  const knownRates = worked.every(row => row.hourly !== null);
  const weighted = knownRates && workedHours > 0 ? worked.reduce((sum, row) =>
    sum + (row.card.metrics.actual ?? 0) * (row.hourly ?? 0), 0) / workedHours : null;
  const hasMultipleRates = new Set(worked.map(row => row.hourly)).size > 1;

  for (const row of rows) {
    const { card, rate, hourly, hours } = row;
    if (rate) card.wageLabel = `$${(rate.amountCents / 100).toFixed(2)}/${rate.basis === "annual_salary" ? "year" : "hr"}`;
    else if (rate === null) card.wageLabel = "—";
    const premium = (card.metrics.mealPremium ?? 0) + (card.metrics.restPremium ?? 0);
    const premiumPay = premium ? weighted !== null && !needsReview && !salaries.length ? money(weighted * premium) : null : 0;
    card.metrics.premiumPay = premiumPay;

    if (needsReview && hasHours(row)) {
      card.metrics.regular = card.metrics.ot = card.metrics.doubleOt = null;
      if (mixedBasis) card.issues.push("Review changes between hourly or salary rates");
      else if (!companyWide) card.issues.push("Review overtime in company-wide Timesheets");
      continue;
    }
    if (premiumPay === null && hasHours(row)) card.issues.push("Review break premium wage rate");
    const overtime = card.metrics.ot ?? 0, doubleTime = card.metrics.doubleOt ?? 0;
    const pto = card.metrics.pto ?? 0;
    if (hourly === null || premiumPay === null || ((overtime || doubleTime) && weighted === null)) {
      if ((overtime || doubleTime) && hourly !== null) card.issues.push("Review the workweek overtime rate");
      continue;
    }
    if (rate?.basis === "annual_salary") {
      // The regular portion is allocated to this card. A nonexempt salary
      // covers regular hours, so overtime gets its full applicable multiplier.
      card.metrics.wages = money(hourly * ((card.metrics.regular ?? 0) + pto
        + overtime * policy.overtimeMultiplier + doubleTime * policy.overtimeDoubleMultiplier));
      continue;
    }
    const additional = (weighted ?? 0) * (overtime * (policy.overtimeMultiplier - 1) + doubleTime * (policy.overtimeDoubleMultiplier - 1));
    card.metrics.wages = money(hourly * (hours + pto) + additional + premiumPay);
    if (weighted !== null && hasMultipleRates && (overtime || doubleTime)) {
      card.notes.push(`Weighted workweek rate: $${weighted.toFixed(2)}/hr`);
    }
  }
}
