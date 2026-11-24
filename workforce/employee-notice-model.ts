export const employeeNoticeEvents = ["schedule", "shiftStart", "shiftEnd", "clockOut", "breakReminder", "overtimeReminder"] as const;
export type EmployeeNoticeEvent = typeof employeeNoticeEvents[number];
export type EmployeeReminderEvent = Exclude<EmployeeNoticeEvent, "schedule">;
export type EmployeeNoticeChannel = "email" | "sms";
export type NoticeDeliveryState = "pending" | "sending" | "accepted" | "uncertain" | "cancelled";

export const shiftStartLeadMinutes = 240;
export const employeeReminderLeadMinutes = 15;

export const employeeNoticeText: Record<EmployeeNoticeEvent, { subject: string; text: string }> = {
  schedule: { subject: "Schedule update", text: "Your published schedule has been updated." },
  shiftStart: { subject: "Upcoming shift", text: "Your next shift is coming up. Check your published schedule for the start time." },
  shiftEnd: { subject: "Shift ending soon", text: "Your scheduled shift ends soon. Use the time clock when you finish working." },
  clockOut: { subject: "Clock-out reminder", text: "Your scheduled shift has ended. Use the time clock to record when you finished working." },
  breakReminder: { subject: "Break reminder", text: "Based on your recorded time, a break is coming up. Check your break timing and record your break on the time clock." },
  overtimeReminder: { subject: "Overtime reminder", text: "Your recorded time is approaching an overtime threshold. Contact your manager if you have questions and record all time worked." },
};
