import type { ScheduleEvent } from "../app/schedule-events";
import type { TimeCardEdit } from "../app/timesheets-model";

export type Mode = "manager" | "employee";
export type ViewId = "dashboard" | "employees" | "departments_roles" | "schedule" | "time_off" | "my_availability" | "team_availability" | "clockins" | "hours" | "settings" | "profile" | "team_members";
export type CalendarTab = "today" | "week" | "month";
export type SettingsTab =
  | "Basic info"
  | "POS connection"
  | "Schedule enforcement"
  | "Alerts & permissions"
  | "Events & trades"
  | "Time clock options"
  | "Overtime"
  | "Breaks & compliance"
  | "Tip settings"
  | "Payroll settings"
  | "Time off"
  | "Messages"
  | "Team permissions"
  | "Manager Log"
  | "Profile"
  | "Locations & PINs"
  | "Notifications"
  | "Password & security";
export type BasicInfo = {
  locationName: string;
  locationPhone: string;
  address1: string;
  address2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  timeZone: string;
  businessType: string;
  businessCategory: string;
  website: string;
  companyName: string;
  accountOwner: string;
  companyPhone: string;
};
export type BasicInfoField = keyof BasicInfo;
export type CompanyLocation = {
  name: string;
  zip: string;
};
export type NewLocationDraft = CompanyLocation;
export type EmployeeScheduleTab = "day" | "week" | "month";
export type HoursRoundingMinutes = 5 | 10 | 15;
export type HoursRounding = "actual" | HoursRoundingMinutes;
export type HoursDisplay = "actual" | "rounded";
export type TeamMemberProfileTab = "job" | "personal" | "documents" | "performance";
export type PayrollClassification = "W-2 Employee" | "1099 Contractor";
export type AccessLevel = "Admin" | "Manager" | "Employee" | "";
export type EmployeeLocationSettings = {
  showInSchedule: boolean;
  sendLocationAlerts: boolean;
  includeInTimeClockErrors: boolean;
  eligibleForOpenShifts: boolean;
  canWaiveMissedBreaks: boolean;
};
export type EmploymentHistoryEvent = {
  type: "terminated" | "rehired";
  date: string;
  reason?: string;
};
export type EmployeeCertificate = {
  id: number;
  name: string;
  fileName: string;
  expirationDate?: string;
  fileId?: string;
};
export type ManagerNote = {
  id: number;
  text: string;
  createdAt: string;
};
export type EmployeePerformance = {
  onTimeRate: number;
  averageHoursPerWeek: number;
  missedClockOuts: number;
  noShows: number;
  shiftsWorked: number;
  missedBreaks: number;
  roleHours: { role: string; hours: number; percentage: number }[];
};
export type PtoHistoryStatusFilter = "all" | Exclude<PtoRequest["status"], "pending">;
export type TimeExceptionAction = "in" | "out" | "break_end";
export type Employee = {
  id: number;
  name: string;
  email: string;
  phone: string;
  accessLevel: AccessLevel;
  location: string;
  role: string;
  wage: string;
  jobs?: { id: number; name: string; departmentId: number | null }[];
  wageRates?: import("../team/rules").WageRate[];
  photoFileId?: string;
  pin: string;
  active: boolean;
  terminated?: boolean;
  startDate: string;
  payrollId: string;
  payrollClassification?: PayrollClassification;
  legalFirstName?: string;
  legalMiddleName?: string;
  legalLastName?: string;
  dateOfBirth: string;
  socialSecurityNumber: string;
  homeAddress: string;
  homeCityStateZip: string;
  homeAddressLine2?: string;
  homeCity?: string;
  homeStateProvince?: string;
  homePostalCode?: string;
  emergencyContact: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  emergencyContactPreference: string;
  locationSettings: EmployeeLocationSettings;
  terminationReason?: string;
  terminationDate?: string;
  eligibleForRehire?: boolean;
  terminationNote?: string;
  employmentHistory?: EmploymentHistoryEvent[];
  certificates?: EmployeeCertificate[];
  onboardingDocuments?: Record<string, string>;
  onboardingFileIds?: Record<string, string>;
  managerNotes?: ManagerNote[];
};

export type Department = {
  id: number;
  name: string;
  roles: string[];
  managerIds: number[];
};

export type Shift = {
  shiftType?: import("../app/shift-builder").ShiftType;
  color?: import("../app/shift-builder").ShiftColor;
  id: number;
  employeeId: number;
  date: string;
  start: string;
  end: string;
  role: string;
  station: string;
  notes?: string;
};

export type ClockEvent = {
  id: number;
  employeeId: number;
  type: "in" | "out" | "break" | "break_end";
  at: string;
  durationMinutes?: 30 | 45;
  durationSeconds?: 5;
  explanation?: string;
  automatic?: boolean;
  role?: string;
  cardId?: number;
};

export type OperationalAlert = {
  id: string;
  employeeId: number;
  title: string;
  detail: string;
  at: string;
  severity: "warning" | "danger";
  eventTargetId: string;
};

export type HeaderNotification = {
  id: string;
  kind: "alert" | "request" | "schedule";
  title: string;
  detail: string;
  at: string;
  requestId?: number;
  eventTargetId?: string;
  requestDate?: string;
  requestStatus?: PtoRequest["status"];
};

export type ScheduleUpdateNotification = {
  id: string;
  employeeId: number;
  title: string;
  detail: string;
  at: string;
};

export type HoursAdjustment = {
  id: number;
  employeeId: number;
  date: string;
  hours: number;
};

export type PtoRequest = {
  id: number;
  employeeId: number;
  compensation: "paid" | "unpaid";
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  reason: "sick_emergency" | "vacation";
  explanation: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  requestedAt: string;
  decidedAt?: string;
  decidedByEmployeeId?: number;
};

export type PtoPolicyMethod = "fixed" | "rate";

export type PtoPolicy = {
  id: number;
  name: string;
  method: PtoPolicyMethod;
  fixedHours: number;
  earnedHours: number;
  workedHours: number;
  employeeIds: number[];
  startingBalances: Record<number, { startDate: string; balance: number }>;
};

export type PtoPolicyForm = {
  name: string;
  method: PtoPolicyMethod;
  fixedHours: string;
  earnedHours: string;
  workedHours: string;
  employeeIds: number[];
  startingBalances: Record<number, { startDate: string; balance: string }>;
};

export type TeamMessage = {
  id: number;
  senderEmployeeId: number;
  body: string;
  sentAt: string;
  readByEmployeeIds: number[];
};

export type TeamConversation = {
  id: number;
  name?: string;
  creatorEmployeeId: number;
  participantIds: number[];
  messages: TeamMessage[];
  pinnedByEmployeeIds?: number[];
  mutedByEmployeeIds?: number[];
};

export type ScheduleDraft = {
  upsertedShifts: Shift[];
  deletedShiftIds: number[];
  affectedEmployeeIds: number[];
};

export type AvailabilityRequestSlot = {
  day: string;
  preference: "preferred" | "unavailable";
  startHour: number;
  endHour: number;
  location: string;
};

export type AvailabilityRequest = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  status: "pending" | "approved" | "rejected";
  slots: AvailabilityRequestSlot[];
  submittedAt: string;
  submittedByName?: string;
  decidedByName?: string;
  requestNote?: string;
  decidedAt?: string;
  decidedByEmployeeId?: number;
  rejectionNote?: string;
};

export type StaffState = {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  scheduleEvents: ScheduleEvent[];
  clockEvents: ClockEvent[];
  hoursAdjustments: HoursAdjustment[];
  timeCardEdits?: TimeCardEdit[];
  ptoRequests: PtoRequest[];
  ptoPolicies: PtoPolicy[];
  conversations: TeamConversation[];
  scheduleUpdates: ScheduleUpdateNotification[];
  scheduleHasBeenPublished: boolean;
  pendingScheduleUpdateEmployeeIds: number[];
  scheduleDraftsByManager: Record<number, ScheduleDraft>;
  availabilityRequests: AvailabilityRequest[];
  hoursRoundingMinutes: HoursRoundingMinutes;
};
