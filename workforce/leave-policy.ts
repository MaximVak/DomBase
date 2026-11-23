import { periodFor, plusDays, type PayCalendar } from "../team/rules";
import { approvedLeaveMinutesByDay, type LeaveCategory, type LeaveDates } from "./leave-duration";

export type PaidLeaveCategory = Exclude<LeaveCategory, "unpaid">;
export type LeaveTerms = {
  category: PaidLeaveCategory;
  method: "fixed" | "rate";
  fixedFrequency: "annual" | "pay_period";
  fixedAllowanceSeconds: number;
  earnedSeconds: number;
  perWorkedSeconds: number;
  maxBalanceSeconds: number | null;
  carryoverSeconds: number | null;
  waitingDays: number;
  tenureBonuses: { years: number; seconds: number }[];
};
type Enrollment = { startDate: string; openingBalanceSeconds: number; legacyBalanceYear: number | null };
export type LeaveAccount = {
  category: PaidLeaveCategory;
  policyId: number;
  name: string;
  availableSeconds: number;
  yearEarnedSeconds: number;
  yearUsedSeconds: number;
  reservedSeconds: number;
  usableFrom: string;
};
export type EmployeeLeaveBalances = { employeeId: number; verifiedWorkedSeconds: number; balances: LeaveAccount[] };
const yearStart = (year: number) => String(year).padStart(4, "0") + "-01-01";
const yearEnd = (year: number) => String(year).padStart(4, "0") + "-12-31";
const yearOf = (date: string) => Number(date.slice(0, 4));
const later = (left: string, right: string) => left > right ? left : right;

export function leaveUsageStarts(terms: LeaveTerms, start: string, hireDate: string | null) {
  return later(start, plusDays(hireDate || start, terms.waitingDays));
}

function anniversary(date: string, years: number) {
  const year = yearOf(date) + years;
  const next = String(year).padStart(4, "0") + date.slice(4);
  if (date.endsWith("-02-29") && new Date(next + "T12:00:00Z").getUTCMonth() !== 1) return next.slice(0, -2) + "28";
  return next;
}

function payDates(year: number, calendar: PayCalendar) {
  let end = periodFor(yearStart(year), calendar.payPeriod, calendar.anchorDate).end;
  const dates: string[] = [];
  while (end <= yearEnd(year)) {
    dates.push(end);
    end = periodFor(plusDays(end, 1), calendar.payPeriod, calendar.anchorDate).end;
  }
  return dates;
}

export function leaveBalance(input: {
  terms: LeaveTerms; enrollment: Enrollment; hireDate: string | null; calendar: PayCalendar; today: string;
  approved: LeaveDates[]; worked: ReadonlyMap<string, number>;
}): Omit<LeaveAccount, "category" | "policyId" | "name"> {
  const { terms, enrollment, hireDate, calendar, today, approved, worked } = input;
  const { startDate, legacyBalanceYear, openingBalanceSeconds } = enrollment;
  const splitSick = terms.category === "sick" && terms.method === "fixed" && terms.fixedFrequency === "pay_period";
  const currentYear = yearOf(today);
  const anchor = legacyBalanceYear === null ? startDate : yearStart(legacyBalanceYear);
  const enrolledFrom = later(anchor, startDate);
  const usableFrom = leaveUsageStarts(terms, startDate, hireDate);
  const accrualStart = terms.category === "sick" ? enrolledFrom : later(enrolledFrom, usableFrom);
  const maxDate = approved.reduce((end, request) => later(end, request.endDate), today);
  const usedByDate = approvedLeaveMinutesByDay(approved, { start: anchor, end: maxDate });
  let balance = anchor <= today && (legacyBalanceYear !== null || startDate <= today) ? openingBalanceSeconds : 0;
  let yearUsedSeconds = 0, reservedSeconds = 0, yearEarnedSeconds = 0;
  const entries = new Map<string, { credit: number; installment: number; debit: number; floor: number; initialFloor: number }>();
  function entry(date: string) {
    const current = entries.get(date);
    if (current) return current;
    const fresh = { credit: 0, installment: 0, debit: 0, floor: 0, initialFloor: 0 };
    entries.set(date, fresh);
    return fresh;
  }
  for (const [date, minutes] of usedByDate) {
    const amount = minutes * 60;
    if (date > today) reservedSeconds += amount;
    else entry(date).debit += amount;
    if (yearOf(date) === currentYear) yearUsedSeconds += amount;
  }
  if (terms.method === "rate") {
    for (const [date, seconds] of worked) {
      if (date >= accrualStart && date <= today && seconds > 0) entry(date).credit += seconds * terms.earnedSeconds / terms.perWorkedSeconds;
    }
  }
  for (let year = yearOf(anchor); year <= currentYear; year++) {
    const first = yearStart(year);
    if (first > anchor) entry(first);
    if (terms.method === "fixed" && terms.fixedFrequency === "annual") {
      const date = later(first, accrualStart);
      if (date <= today && yearOf(date) === year) entry(date).credit += terms.fixedAllowanceSeconds;
    }
    if (terms.method === "fixed" && terms.fixedFrequency === "pay_period") {
      const dates = payDates(year, calendar);
      for (const date of dates) if (date >= accrualStart && date <= today) entry(date).installment += terms.fixedAllowanceSeconds / dates.length;
      // The alternative sick schedule pays enough of the annual allowance at each milestone.
      if (splitSick && first > accrualStart) {
        for (const [days, hours] of [[120, 24], [200, 40]]) {
          const date = plusDays(first, days - 1);
          if (date <= today) entry(date).floor = hours * 3600;
        }
      }
    }
  }
  if (splitSick) {
    for (const [days, hours] of [[120, 24], [200, 40]]) {
      const date = plusDays(accrualStart, days - 1);
      if (date <= today) entry(date).initialFloor = hours * 3600;
    }
  }
  if (hireDate) for (const bonus of terms.tenureBonuses) {
    const date = anniversary(hireDate, bonus.years);
    if (date >= accrualStart && date <= today) entry(date).credit += bonus.seconds;
  }

  let activeYear = yearOf(anchor), earned = 0, scheduledEarned = 0, earnedSinceEnrollment = 0;
  for (const [date, { credit, installment, debit, floor, initialFloor }] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const year = yearOf(date);
    if (year !== activeYear) {
      if (terms.category === "sick" && terms.method === "fixed" && terms.fixedFrequency === "annual" && terms.carryoverSeconds !== null) {
        balance = Math.min(balance, terms.carryoverSeconds);
      }
      activeYear = year;
      earned = 0;
      scheduledEarned = 0;
    }
    const scheduled = splitSick ? Math.max(0, Math.min(installment, terms.fixedAllowanceSeconds - scheduledEarned), floor - earned, initialFloor - earnedSinceEnrollment) : installment;
    const grant = credit + scheduled;
    const credited = Math.min(grant, terms.maxBalanceSeconds === null ? grant : Math.max(0, terms.maxBalanceSeconds - balance));
    balance += credited - debit;
    earned += credited;
    scheduledEarned += Math.min(scheduled, credited);
    earnedSinceEnrollment += credited;
    if (year === currentYear) yearEarnedSeconds = earned;
  }
  return {
    availableSeconds: Math.round(balance - reservedSeconds), yearEarnedSeconds: Math.round(yearEarnedSeconds),
    yearUsedSeconds, reservedSeconds, usableFrom,
  };
}
