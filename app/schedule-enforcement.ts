export const defaultOvertimePolicy = {
  overtimeDailyEnabled: true,
  overtimeWeeklyEnabled: true,
  overtimeSeventhDayEnabled: true,
  overtimeDoubleEnabled: true,
  overtimeDailyHours: 8,
  overtimeWeeklyHours: 40,
  overtimeDoubleHours: 12,
  overtimeSeventhDoubleHours: 8,
  overtimeMultiplier: 1.5,
  overtimeDoubleMultiplier: 2,
};

export type OvertimePolicy = typeof defaultOvertimePolicy;

export type Holiday = { date: string; name: string };
export type HolidayPolicy = { holidayPayEnabled: boolean; holidayPayMultiplier: number; holidays: Holiday[] };
export const holidayFields = ["holidayPayEnabled", "holidayPayMultiplier", "holidays"] as const;
export const holidayMultiplierBounds = { min: 1, max: 5, step: 0.01 };

export type ScheduleEnforcement = OvertimePolicy & HolidayPolicy & {
  clockInPhotos: boolean;
  workWeekStart: number;
  minRestHours: number;
  availabilityReviewDays: number;
  scheduleStartHour: number;
  scheduleEndHour: number;
  lateMinutes: number;
  earlyClockInMinutes: number;
  requireEarlyClockInExplanation: boolean;
  requireLateClockInExplanation: boolean;
  requireClockOutExplanation: boolean;
  requireUnscheduledExplanation: boolean;
  noShowAlerts: boolean;
  noShowMinutes: number;
  automaticClockOut: boolean;
  automaticClockOutMinutes: number;
  roundClockPunches: boolean;
  notifyScheduleChanges: boolean;
  employeesOwnScheduleOnly: boolean;
  requireAvailabilityApproval: boolean;
  restrictManagerDepartments: boolean;
  enableScheduleEvents: boolean;
  mealBreakAfterHours: number;
  mealBreakMinutes: number;
  mandatoryMealBreak: boolean;
  blockEarlyClockIn: boolean;
  blockEarlyBreakReturn: boolean;
  breakWaivers: boolean;
  missedBreakReports: boolean;
  unpaidRestOverage: boolean;
  paidRestMinutes: number;
  breakPremiums: boolean;
  mealPremiumLimit: number;
  restPremiumLimit: number;
  lateAttendanceAlerts: boolean;
  assistedClockIn: boolean;
  assistedClockOut: boolean;
  clockOutReminders: boolean;
  clockOutReminderEmail: boolean;
  clockOutReminderFirst: number;
  clockOutReminderSecond: number;
  clockOutReminderThird: number;
  enableTeamMessaging: boolean;
};

export const defaultScheduleEnforcement: ScheduleEnforcement = {
  ...defaultOvertimePolicy,
  clockInPhotos: false,
  holidayPayEnabled: false,
  holidayPayMultiplier: 1.5,
  holidays: [],
  workWeekStart: 1,
  minRestHours: 10,
  availabilityReviewDays: 90,
  scheduleStartHour: 7,
  scheduleEndHour: 17,
  lateMinutes: 1,
  earlyClockInMinutes: 5,
  requireEarlyClockInExplanation: true,
  requireLateClockInExplanation: true,
  requireClockOutExplanation: true,
  requireUnscheduledExplanation: true,
  noShowAlerts: true,
  noShowMinutes: 5,
  automaticClockOut: true,
  automaticClockOutMinutes: 120,
  roundClockPunches: false,
  notifyScheduleChanges: true,
  employeesOwnScheduleOnly: false,
  requireAvailabilityApproval: true,
  restrictManagerDepartments: false,
  enableScheduleEvents: true,
  mealBreakAfterHours: 5,
  mealBreakMinutes: 30,
  mandatoryMealBreak: true,
  blockEarlyClockIn: true,
  blockEarlyBreakReturn: true,
  breakWaivers: false,
  missedBreakReports: true,
  unpaidRestOverage: false,
  paidRestMinutes: 10,
  breakPremiums: true,
  mealPremiumLimit: 1,
  restPremiumLimit: 1,
  lateAttendanceAlerts: true,
  assistedClockIn: true,
  assistedClockOut: true,
  clockOutReminders: true,
  clockOutReminderEmail: false,
  clockOutReminderFirst: 10,
  clockOutReminderSecond: 60,
  clockOutReminderThird: 120,
  enableTeamMessaging: true,
};

export const alertsPermissionsFields = ["notifyScheduleChanges", "employeesOwnScheduleOnly", "requireAvailabilityApproval", "restrictManagerDepartments", "noShowAlerts", "noShowMinutes"] as const;
export const eventsTradesFields = ["enableScheduleEvents"] as const;
export const overtimePolicyFields = Object.keys(defaultOvertimePolicy) as (keyof OvertimePolicy)[];
export const overtimeFields = ["workWeekStart", ...overtimePolicyFields, ...holidayFields] as const;
export const breakPolicyFields = ["blockEarlyClockIn", "blockEarlyBreakReturn", "breakWaivers", "missedBreakReports", "unpaidRestOverage", "paidRestMinutes"] as const;
export const breakPremiumFields = ["breakPremiums", "mealPremiumLimit", "restPremiumLimit"] as const;
export const attendancePolicyFields = ["lateAttendanceAlerts", "assistedClockIn", "assistedClockOut", "clockOutReminders", "clockOutReminderEmail", "clockOutReminderFirst", "clockOutReminderSecond", "clockOutReminderThird"] as const;
export const breaksComplianceFields = ["mealBreakAfterHours", "mealBreakMinutes", "mandatoryMealBreak", "blockEarlyBreakReturn", "breakWaivers", "missedBreakReports", "unpaidRestOverage", "paidRestMinutes", ...breakPremiumFields] as const;
export const messagesSettingsFields = ["enableTeamMessaging"] as const;
export const scheduleEnforcementFields = ["workWeekStart", "minRestHours", "availabilityReviewDays", "scheduleStartHour", "scheduleEndHour", "lateMinutes", "earlyClockInMinutes", "blockEarlyClockIn", "requireEarlyClockInExplanation", "requireLateClockInExplanation", "requireClockOutExplanation", "requireUnscheduledExplanation", "noShowAlerts", "noShowMinutes", "automaticClockOut", "automaticClockOutMinutes", ...attendancePolicyFields] as const;

const overtimeNumbers = {
  overtimeDailyHours: { min: .25, max: 24, step: .25 },
  overtimeWeeklyHours: { min: .25, max: 168, step: .25 },
  overtimeDoubleHours: { min: .25, max: 24, step: .25 },
  overtimeSeventhDoubleHours: { min: .25, max: 24, step: .25 },
  overtimeMultiplier: { min: 1.5, max: 5, step: .01 },
  overtimeDoubleMultiplier: { min: 2, max: 5, step: .01 },
};
export { overtimeNumbers };
export type OvertimeNumber = keyof typeof overtimeNumbers;

export function overtimePolicyError(policy: OvertimePolicy) {
  if (policy.overtimeDailyEnabled && policy.overtimeDoubleEnabled && policy.overtimeDoubleHours <= policy.overtimeDailyHours) {
    return "Set double time after daily overtime begins.";
  }
  if (policy.overtimeDoubleEnabled && policy.overtimeDoubleMultiplier < policy.overtimeMultiplier) {
    return "Set the double-time multiplier at least as high as the overtime multiplier.";
  }
  return "";
}

export function schedulingSettingsForSave(saved: ScheduleEnforcement, draft: ScheduleEnforcement, fields: readonly (keyof ScheduleEnforcement)[]) {
  return { ...saved, ...Object.fromEntries(fields.map(field => [field, draft[field]])) } as ScheduleEnforcement;
}

export function canManageScheduleRole(
  role: string,
  manager: { id: number; accessLevel: string } | undefined,
  departments: { roles: string[]; managerIds: number[] }[],
  restricted: boolean,
) {
  if (!manager || !["Admin", "Manager"].includes(manager.accessLevel)) return false;
  if (manager.accessLevel === "Admin" || !restricted) return true;
  return departments.some(department => department.managerIds.includes(manager.id) && department.roles.includes(role.trim()));
}

export function scheduleDraftIsAllowed(
  draft: { upsertedShifts: { id: number; role: string }[]; deletedShiftIds: number[] },
  shifts: { id: number; role: string }[],
  mayManage: (role: string) => boolean,
) {
  return draft.upsertedShifts.every(shift => {
    const original = shifts.find(existing => existing.id === shift.id);
    return mayManage(shift.role) && (!original || mayManage(original.role));
  }) && draft.deletedShiftIds.every(id => {
    const original = shifts.find(shift => shift.id === id);
    return !original || mayManage(original.role);
  });
}

export function canViewTeamSchedule(employeeId: number, viewerId: number, manager: boolean, publicView: boolean, ownOnly: boolean) {
  return manager || !ownOnly || (!publicView && employeeId === viewerId);
}

export function normalizeScheduleEnforcement(value: unknown): ScheduleEnforcement {
  const result = { ...defaultScheduleEnforcement };
  if (!value || typeof value !== "object") return result;
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(result) as (keyof ScheduleEnforcement)[]) {
    if (key === "holidays") {
      const entries = input[key];
      if (!Array.isArray(entries) || entries.length > 366) continue;
      const dates = new Set<string>();
      const holidays: Holiday[] = [];
      for (const entry of entries) {
        const date = entry?.date;
        const name = entry?.name;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || dates.has(date) ||
          !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
          typeof name !== "string" || !name.trim() || name.length > 100) break;
        dates.add(date);
        holidays.push({ date, name: name.trim() });
      }
      if (holidays.length === entries.length) result.holidays = holidays;
      continue;
    }
    if (key === "holidayPayMultiplier") {
      const rate = input[key];
      const { min, max, step } = holidayMultiplierBounds;
      if (typeof rate === "number" && rate >= min && rate <= max && Math.abs(rate / step - Math.round(rate / step)) < 1e-7) result[key] = rate;
      continue;
    }
    if (typeof result[key] === "boolean") {
      if (typeof input[key] === "boolean") Object.assign(result, { [key]: input[key] });
      continue;
    }
    if (key === "mealPremiumLimit" || key === "restPremiumLimit") {
      if (input[key] === 1 || input[key] === 2) result[key] = input[key];
      continue;
    }
    if (Object.hasOwn(overtimeNumbers, key)) {
      const bounds = overtimeNumbers[key as OvertimeNumber];
      const candidate = input[key];
      if (typeof candidate === "number" && candidate >= bounds.min && candidate <= bounds.max &&
        Math.abs(candidate / bounds.step - Math.round(candidate / bounds.step)) < 1e-7) {
        Object.assign(result, { [key]: candidate });
      }
      continue;
    }
    const maximum = key === "workWeekStart" ? 6 : key === "minRestHours" ? 24 : key === "availabilityReviewDays" ? 365
      : key === "scheduleStartHour" ? 23
      : key === "scheduleEndHour" ? 24
      : key === "automaticClockOutMinutes" || key.startsWith("clockOutReminder") ? 1440 : key === "mealBreakAfterHours" ? 24 : 120;
    const minimum = key === "mealBreakMinutes" ? 30 : key === "paidRestMinutes" ? 10 : key === "scheduleEndHour" || key === "automaticClockOutMinutes" || key.startsWith("clockOutReminder") || key === "lateMinutes" || key === "mealBreakAfterHours" ? 1 : 0;
    const candidate = input[key];
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= minimum && candidate <= maximum) {
      Object.assign(result, { [key]: candidate });
    }
  }
  if (result.scheduleEndHour <= result.scheduleStartHour) {
    result.scheduleStartHour = defaultScheduleEnforcement.scheduleStartHour;
    result.scheduleEndHour = defaultScheduleEnforcement.scheduleEndHour;
  }
  if (!(result.clockOutReminderFirst < result.clockOutReminderSecond && result.clockOutReminderSecond < result.clockOutReminderThird)) {
    result.clockOutReminderFirst = defaultScheduleEnforcement.clockOutReminderFirst;
    result.clockOutReminderSecond = defaultScheduleEnforcement.clockOutReminderSecond;
    result.clockOutReminderThird = defaultScheduleEnforcement.clockOutReminderThird;
  }
  if (overtimePolicyError(result)) Object.assign(result, defaultOvertimePolicy);
  return result;
}

export function clockInTiming(currentTime: number, scheduledTime: number, settings: ScheduleEnforcement) {
  if (currentTime < scheduledTime - settings.earlyClockInMinutes * 60000) return "early";
  const lateThreshold = scheduledTime + settings.lateMinutes * 60000;
  return currentTime >= lateThreshold ? "late" : "on-time";
}

export function automaticClockOutAt(scheduledEnd: number, settings: ScheduleEnforcement): number | null {
  return settings.automaticClockOut && !settings.breakWaivers ? scheduledEnd + settings.automaticClockOutMinutes * 60000 : null;
}

export function workWeekOffset(day: number, weekStart: number) {
  return (day - weekStart + 7) % 7;
}
