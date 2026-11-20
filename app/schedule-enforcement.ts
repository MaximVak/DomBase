export type ScheduleEnforcement = {
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
export const overtimeFields = ["workWeekStart"] as const;
export const breakPolicyFields = ["blockEarlyClockIn", "blockEarlyBreakReturn", "breakWaivers", "missedBreakReports", "unpaidRestOverage", "paidRestMinutes"] as const;
export const breakPremiumFields = ["breakPremiums", "mealPremiumLimit", "restPremiumLimit"] as const;
export const attendancePolicyFields = ["lateAttendanceAlerts", "assistedClockIn", "assistedClockOut", "clockOutReminders", "clockOutReminderEmail", "clockOutReminderFirst", "clockOutReminderSecond", "clockOutReminderThird"] as const;
export const breaksComplianceFields = ["mealBreakAfterHours", "mealBreakMinutes", "mandatoryMealBreak", "blockEarlyBreakReturn", "breakWaivers", "missedBreakReports", "unpaidRestOverage", "paidRestMinutes", ...breakPremiumFields] as const;
export const messagesSettingsFields = ["enableTeamMessaging"] as const;
export const scheduleEnforcementFields = ["workWeekStart", "minRestHours", "availabilityReviewDays", "scheduleStartHour", "scheduleEndHour", "lateMinutes", "earlyClockInMinutes", "blockEarlyClockIn", "requireEarlyClockInExplanation", "requireLateClockInExplanation", "requireClockOutExplanation", "requireUnscheduledExplanation", "noShowAlerts", "noShowMinutes", "automaticClockOut", "automaticClockOutMinutes", ...attendancePolicyFields] as const;

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
    if (typeof result[key] === "boolean") {
      if (typeof input[key] === "boolean") Object.assign(result, { [key]: input[key] });
      continue;
    }
    if (key === "mealPremiumLimit" || key === "restPremiumLimit") {
      if (input[key] === 1 || input[key] === 2) result[key] = input[key];
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
