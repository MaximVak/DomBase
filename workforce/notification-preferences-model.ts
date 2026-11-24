export type NotificationChannel = "inApp" | "email" | "sms";
export type ChannelValues = Partial<Record<NotificationChannel, boolean>>;

export const notificationTypes = [
  { id: "schedule", label: "Published schedules and changes", group: "Schedule", channels: { inApp: true, email: true, sms: false }, planned: ["sms"] },
  { id: "shiftExchange", label: "Shift trades and cover requests", group: "Schedule", channels: { inApp: true, email: true }, planned: [] },
  { id: "openShift", label: "Open shift requests", group: "Schedule", channels: { inApp: true, email: true }, planned: [] },
  { id: "timeOffResponse", label: "Time off request decisions", group: "Schedule", channels: { inApp: true, email: false }, planned: ["inApp", "email"] },
  { id: "shiftStart", label: "Before a shift starts", group: "Reminders", channels: { email: false, sms: false }, planned: ["email", "sms"] },
  { id: "shiftEnd", label: "Before a shift ends", group: "Reminders", channels: { email: false, sms: false }, planned: ["email", "sms"] },
  { id: "clockOut", label: "Forgotten clock-out", group: "Reminders", channels: { inApp: true, email: true, sms: false }, planned: ["sms"] },
  { id: "breakReminder", label: "Break reminders", group: "Reminders", channels: { email: false, sms: false }, planned: ["email", "sms"] },
  { id: "overtimeReminder", label: "Overtime reminders", group: "Reminders", channels: { email: false, sms: false }, planned: ["email", "sms"] },
  { id: "lateArrival", label: "Late arrivals", group: "Manager alerts", channels: { inApp: true, email: false }, planned: ["email"] },
  { id: "noShow", label: "No-shows", group: "Manager alerts", channels: { inApp: true, email: false }, planned: ["email"] },
  { id: "clockExceptions", label: "Other clock and break exceptions", group: "Manager alerts", channels: { inApp: true }, planned: [] },
  { id: "managerShiftExchange", label: "Team shift trade and cover requests", group: "Manager alerts", channels: { inApp: true }, planned: [] },
  { id: "managerOpenShift", label: "Team open shift requests", group: "Manager alerts", channels: { inApp: true }, planned: [] },
  { id: "managerOvertime", label: "Employee overtime", group: "Manager alerts", channels: { email: false }, planned: ["email"] },
  { id: "timeOffRequest", label: "Employee time off requests", group: "Manager alerts", channels: { inApp: true, email: false }, planned: ["email"] },
  { id: "dailySummary", label: "Daily summary", group: "Manager alerts", channels: { email: false }, planned: ["email"] },
  { id: "weeklySummary", label: "Weekly summary", group: "Manager alerts", channels: { email: false }, planned: ["email"] },
  { id: "announcement", label: "Announcement email copies", group: "Messaging", channels: { email: false }, planned: ["email"] },
  { id: "mention", label: "Message mentions", group: "Messaging", channels: { inApp: true }, planned: ["inApp"] },
] as const;

export type NotificationEvent = typeof notificationTypes[number]["id"];
export type NotificationSpec = {
  id: NotificationEvent; label: string; group: string; channels: ChannelValues; planned: readonly NotificationChannel[];
};
export type NotificationChoices = { smsEnabled?: boolean; events?: Partial<Record<NotificationEvent, ChannelValues>> };
export const dashboardNotificationEvents = ["lateArrival", "noShow", "clockExceptions", "managerShiftExchange", "managerOpenShift", "timeOffRequest"] as const;
export type DashboardNotificationFlags = Record<typeof dashboardNotificationEvents[number], boolean>;
export type NotificationPreferences = {
  revision: number; version: number; scheduleVersion: number; contextToken: string;
  smsEnabled: boolean; hasPhone: boolean; hasScheduleEmail: boolean; locationAlerts: boolean; scheduleAlerts: boolean;
  rows: { id: NotificationEvent; channels: ChannelValues }[];
};

export function notificationSpec(event: NotificationEvent): NotificationSpec {
  return notificationTypes.find(type => type.id === event)!;
}
