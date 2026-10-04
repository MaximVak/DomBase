export type ScheduleEnforcement = {
  workWeekStart: number;
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
  mandatoryMealBreak: boolean;
  enableTeamMessaging: boolean;
};

export const defaultScheduleEnforcement: ScheduleEnforcement = {
  workWeekStart: 1,
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
  mandatoryMealBreak: true,
  enableTeamMessaging: true,
};

export const alertsPermissionsFields = ["notifyScheduleChanges", "employeesOwnScheduleOnly", "requireAvailabilityApproval", "restrictManagerDepartments", "noShowAlerts", "noShowMinutes"] as const;
export const eventsTradesFields = ["enableScheduleEvents"] as const;
export const overtimeFields = ["workWeekStart"] as const;
export const breaksComplianceFields = ["mealBreakAfterHours", "mandatoryMealBreak"] as const;
export const messagesSettingsFields = ["enableTeamMessaging"] as const;
export const scheduleEnforcementFields = ["workWeekStart", "scheduleStartHour", "scheduleEndHour", "lateMinutes", "earlyClockInMinutes", "requireEarlyClockInExplanation", "requireLateClockInExplanation", "requireClockOutExplanation", "requireUnscheduledExplanation", "noShowAlerts", "noShowMinutes", "automaticClockOut", "automaticClockOutMinutes"] as const;

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
    const maximum = key === "workWeekStart" ? 6
      : key === "scheduleStartHour" ? 23
      : key === "scheduleEndHour" ? 24
      : key === "automaticClockOutMinutes" ? 1440 : key === "mealBreakAfterHours" ? 24 : 120;
    const minimum = key === "scheduleEndHour" || key === "automaticClockOutMinutes" || key === "lateMinutes" || key === "mealBreakAfterHours" ? 1 : 0;
    const candidate = input[key];
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= minimum && candidate <= maximum) {
      Object.assign(result, { [key]: candidate });
    }
  }
  if (result.scheduleEndHour <= result.scheduleStartHour) {
    result.scheduleStartHour = defaultScheduleEnforcement.scheduleStartHour;
    result.scheduleEndHour = defaultScheduleEnforcement.scheduleEndHour;
  }
  return result;
}

export function clockInTiming(currentTime: number, scheduledTime: number, settings: ScheduleEnforcement) {
  if (currentTime < scheduledTime - settings.earlyClockInMinutes * 60000) return "early";
  const lateThreshold = scheduledTime + settings.lateMinutes * 60000;
  return currentTime >= lateThreshold ? "late" : "on-time";
}

export function automaticClockOutAt(scheduledEnd: number, settings: ScheduleEnforcement): number | null {
  return settings.automaticClockOut ? scheduledEnd + settings.automaticClockOutMinutes * 60000 : null;
}

export function workWeekOffset(day: number, weekStart: number) {
  return (day - weekStart + 7) % 7;
}
