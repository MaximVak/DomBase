"use client";

import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AvailabilityEditor } from "./availability-editor";
import { AvailabilityHistory } from "./availability-history";
import { ShiftAvailability } from "./shift-availability";
import { approvedAvailability, availabilityForDate, availabilityTime, newestAvailability } from "./availability-model";
import { useScheduleWarnings, ScheduleWarningPanel, ShiftWarningBadge } from "./schedule-warning-panel";
import type { PlannedShift } from "./schedule-estimates";
import { ShiftBuilderOptions } from "./shift-builder-options";
import { isWorkShift, shiftLayoutError } from "./shift-builder";
import { estimateSchedule } from "./schedule-estimates";
import { ScheduleEstimateSummary } from "./schedule-estimate-summary";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DepartmentManagerCell, DepartmentManagerFeedback, useDepartmentManagers } from "./department-managers";
import { useSharedWorkspace } from "./shared-workspace";
import { equal, newRecordId } from "../workforce/contract";
import { PrintTable } from "./print-table";
import { rosterCopyHeaders, rosterCopyRows, rosterCsv } from "./roster-export";
import { alertsPermissionsFields, automaticClockOutAt, canManageScheduleRole, canViewTeamSchedule, clockInTiming, defaultScheduleEnforcement, normalizeScheduleEnforcement, scheduleDraftIsAllowed, scheduleEnforcementFields, schedulingSettingsForSave, workWeekOffset } from "./schedule-enforcement";
import type { ScheduleEnforcement } from "./schedule-enforcement";
import { breaksComplianceFields, eventsTradesFields, overtimeFields, messagesSettingsFields } from "./schedule-enforcement";
import { normalizeScheduleEvents, scheduleEventsForDate, validEventDate } from "./schedule-events";
import type { ScheduleEvent } from "./schedule-events";
import { TimeClockOptionsPanel } from "./time-clock-options";
import { OvertimeOptionsPanel } from "./overtime-options";
import { BreaksCompliancePanel } from "./breaks-compliance";
import { MessagesSettingsPanel } from "./messages-settings";
import { EmployeeReliabilityPanel } from "./team/employee-reliability";
import { retainedThrough } from "../team/rules";
import { TeamPermissionsPanel } from "./team-permissions";
import { AccountProfilePanel } from "./account-profile-panel";
import { LocationsPinsPanel } from "./locations-pins";
import { NotificationsSettingsPanel } from "./notifications-settings";
import { SchedulingHourSelect } from "./scheduling-hour-select";
import { profileUpdate, profileValues } from "./account-profile";
import { TimesheetsPanel } from "./timesheets-panel";
import { MobileNavigation } from "./mobile-navigation";
import { SidebarNavIcon } from "./sidebar-nav-icon";
import { timeCardEvents, validateTimeCard } from "./timesheets-model";
import type { TimeCardDraft, TimeCardEdit } from "./timesheets-model";
import type { ProfileValues } from "./account-profile";
import type { DashboardAccount } from "../auth/types";

import type { Mode, ViewId, CalendarTab, SettingsTab, BasicInfo, BasicInfoField, CompanyLocation, NewLocationDraft, EmployeeScheduleTab, HoursRoundingMinutes, HoursRounding, HoursDisplay, TeamMemberProfileTab, PayrollClassification, AccessLevel, EmployeeLocationSettings, EmploymentHistoryEvent, EmployeeCertificate, ManagerNote, PtoHistoryStatusFilter, TimeExceptionAction, Employee, Department, Shift, ClockEvent, OperationalAlert, HeaderNotification, ScheduleUpdateNotification, HoursAdjustment, PtoRequest, PtoPolicyMethod, PtoPolicy, PtoPolicyForm, TeamMessage, TeamConversation, ScheduleDraft, AvailabilityRequestSlot, AvailabilityRequest, StaffState } from "../workforce/model";
export type { BasicInfo, Employee, StaffState } from "../workforce/model";

import { TimeExceptionDialog } from "./time-exception-dialog";
import { BackupMonitor } from "./backup-monitor";

const timeExceptionExplanationLimit = 250;
const automaticClockOutExplanation = "Automatically clocked out two hours after the scheduled shift ended.";
const operationalAlertLookbackMs = 7 * 24 * 60 * 60 * 1000;
const shiftWeekdayOptions = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];
const maximumNewLocations = 5;
const emptyNewLocationDraft = (): NewLocationDraft => ({ name: "", zip: "" });
const defaultEmployeeLocationSettings = (): EmployeeLocationSettings => ({
  showInSchedule: true,
  sendLocationAlerts: true,
  includeInTimeClockErrors: true,
  eligibleForOpenShifts: true,
  canWaiveMissedBreaks: false,
});
const onboardingDocumentNames = [
  "W-4 Form",
  "I-9 Form",
  "State Withholding Form",
  "W-9 Form",
  "Payment Method Form",
];

const navItems: { id: ViewId; label: string; icon: string; managerOnly?: boolean }[] = [
  { id: "dashboard", label: "Home", icon: "home" },
  { id: "employees", label: "Team", icon: "person", managerOnly: true },
  { id: "schedule", label: "Schedule", icon: "calendar" },
  { id: "hours", label: "Timesheets", icon: "clock" },
  { id: "clockins", label: "Events", icon: "flag", managerOnly: true },
  { id: "settings", label: "Settings", icon: "gear", managerOnly: true },
];

const settingsGroups: { label: string; items: SettingsTab[] }[] = [
  { label: "Location", items: ["Basic info", "POS connection"] },
  { label: "Scheduling", items: ["Schedule enforcement", "Alerts & permissions", "Events & trades"] },
  { label: "Time tracking", items: ["Time clock options", "Overtime", "Breaks & compliance"] },
  { label: "Tips", items: ["Tip settings"] },
  { label: "Payroll", items: ["Payroll settings"] },
  { label: "Team management", items: ["Time off", "Messages", "Team permissions", "Manager Log"] },
  { label: "Account", items: ["Profile", "Locations & PINs", "Notifications", "Password & security"] },
];

const defaultBasicInfo: BasicInfo = {
  locationName: "DomBase",
  locationPhone: "",
  address1: "",
  address2: "",
  city: "",
  stateProvince: "",
  postalCode: "",
  country: "United States",
  timeZone: "Pacific Time (US & Canada)",
  businessType: "",
  businessCategory: "",
  website: "",
  companyName: "DomBase",
  accountOwner: "",
  companyPhone: "",
};

const emptyEmployeeForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  role: "",
  wage: "",
  pin: "",
  accessLevel: "Employee" as AccessLevel,
  active: true,
};

const blankEmployee: Employee = {
  id: 0, name: "", email: "", phone: "", accessLevel: "Employee", location: "", role: "", wage: "", pin: "", active: false, startDate: "", payrollId: "", payrollClassification: "W-2 Employee", dateOfBirth: "", socialSecurityNumber: "", homeAddress: "", homeCityStateZip: "", emergencyContact: "", emergencyContactPreference: "", locationSettings: defaultEmployeeLocationSettings(),
};

const emergencyContactNotificationLabel = "Notify my emergency contact in case of arrest or detention while at work";

const payrollStates = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"], ["AS", "American Samoa"], ["GU", "Guam"], ["MP", "Northern Mariana Islands"],
  ["PR", "Puerto Rico"], ["VI", "U.S. Virgin Islands"],
];

function personalPayrollForm(employee: Employee) {
  const [firstName = "", ...remainingName] = employee.name.trim().split(/\s+/);
  const legacyAddress = employee.homeCityStateZip.match(/^(.+?),\s*(.+?),?\s+(\d{5}(?:-\d{4})?)$/);
  const savedState = employee.homeStateProvince ?? legacyAddress?.[2]?.replace(/,$/, "") ?? "";
  return {
    legalFirstName: employee.legalFirstName ?? firstName,
    legalMiddleName: employee.legalMiddleName ?? "",
    legalLastName: employee.legalLastName ?? remainingName.join(" "),
    dateOfBirth: employee.dateOfBirth,
    socialSecurityNumber: employee.socialSecurityNumber,
    homeAddress: employee.homeAddress,
    homeAddressLine2: employee.homeAddressLine2 ?? "",
    homeCity: employee.homeCity ?? legacyAddress?.[1] ?? employee.homeCityStateZip,
    homeStateProvince: payrollStates.find(([abbreviation, name]) => abbreviation === savedState || name === savedState)?.[1] ?? savedState,
    homePostalCode: employee.homePostalCode ?? legacyAddress?.[3] ?? "",
  };
}

function employeeLegalName(employee: Employee) {
  const payroll = personalPayrollForm(employee);
  return [payroll.legalFirstName, payroll.legalMiddleName, payroll.legalLastName].filter(Boolean).join(" ");
}

function personalContactForm(employee: Employee) {
  const [firstName = "", ...lastName] = employee.name.trim().split(/\s+/);
  return {
    firstName,
    lastName: lastName.join(" "),
    email: employee.email,
    phone: employee.phone,
    emergencyContact: employee.emergencyContact,
    emergencyContactRelationship: employee.emergencyContactRelationship ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
    notifyEmergencyContact: employee.emergencyContactPreference === emergencyContactNotificationLabel,
  };
}

export default function Home({ account }: { account: DashboardAccount }) {
  const today = getLocalDateValue();
  const shared = useSharedWorkspace();
  const state = shared.data.state;
  const setState = shared.setState;
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isPublicSchedule = false;
  const [mode] = useState<Mode>("manager");
  const activeEmployeeId = account.employeeId ?? -account.id;
  const [isTimesheetSummary, setIsTimesheetSummary] = useState(false);
  const [isSharedTimeCardEditing, setIsSharedTimeCardEditing] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isTeamNavOpen, setIsTeamNavOpen] = useState(false);
  const [isScheduleNavOpen, setIsScheduleNavOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTabValue] = useState<SettingsTab>("Basic info");
  function setActiveSettingsTab(tab: SettingsTab) { setScheduleEnforcementDraft(shared.data.settings); setActiveSettingsTabValue(tab); }
  const scheduleEnforcement = shared.data.settings;
  const [scheduleEnforcementDraft, setScheduleEnforcementDraft] = useState<ScheduleEnforcement>(shared.data.settings);
  const [scheduleEnforcementMessage, setScheduleEnforcementMessage] = useState("");
  const [alertsPermissionsMessage, setAlertsPermissionsMessage] = useState("");
  const [eventsTradesMessage, setEventsTradesMessage] = useState("");
  const [overtimeMessage, setOvertimeMessage] = useState("");
  const [breaksComplianceMessage, setBreaksComplianceMessage] = useState("");
  const [messagesSettingsMessage, setMessagesSettingsMessage] = useState("");
  const [scheduleEventDraft, setScheduleEventDraft] = useState<ScheduleEvent | null>(null);
  const [schedulePermissionError, setSchedulePermissionError] = useState("");
  const [basicInfo, setBasicInfo] = useState<BasicInfo>(shared.data.basicInfo);
  const savedBasicInfoSnapshot = JSON.stringify(shared.data.basicInfo);
  const [editingBasicInfoField, setEditingBasicInfoFieldValue] = useState<BasicInfoField | null>(null);
  function setEditingBasicInfoField(field: BasicInfoField | null) { if (field !== null && editingBasicInfoField === null) setBasicInfo(shared.data.basicInfo); setEditingBasicInfoFieldValue(field); }
  const companyLocations: CompanyLocation[] = [];
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [newLocationDrafts, setNewLocationDrafts] = useState<NewLocationDraft[]>([emptyNewLocationDraft()]);
  const [newLocationError, setNewLocationError] = useState("");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const openedNotificationIdsByEmployee = shared.data.opened;
  const dismissedNotificationIdsByEmployee = shared.data.dismissed;
  function setNotificationReceipts(kind: "opened" | "dismissed", update: Record<number, string[]> | ((current: Record<number, string[]>) => Record<number, string[]>)) {
    const previous = shared.data[kind]; const next = typeof update === "function" ? update(previous) : update;
    if (equal(previous, next)) return;
    const before = { opened: shared.data.opened[activeEmployeeId] ?? [], dismissed: shared.data.dismissed[activeEmployeeId] ?? [] };
    void shared.save([{ entity: "notifications", id: 1, before, after: { ...before, [kind]: next[activeEmployeeId] ?? [] } }]);
  }
  const setOpenedNotificationIdsByEmployee = (update: Record<number, string[]> | ((current: Record<number, string[]>) => Record<number, string[]>)) => setNotificationReceipts("opened", update);
  const setDismissedNotificationIdsByEmployee = (update: Record<number, string[]> | ((current: Record<number, string[]>) => Record<number, string[]>)) => setNotificationReceipts("dismissed", update);
  const [messageFilter, setMessageFilter] = useState<"all" | "unread">("all");
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [conversationMenuId, setConversationMenuId] = useState<number | null>(null);
  const [conversationMenuTop, setConversationMenuTop] = useState(0);
  const [viewingConversationInfoId, setViewingConversationInfoId] = useState<number | null>(null);
  const [editingConversationNameId, setEditingConversationNameId] = useState<number | null>(null);
  const [conversationNameDraft, setConversationNameDraft] = useState("");
  const [newConversationMemberIds, setNewConversationMemberIds] = useState<number[]>([]);
  const [ptoMessageEmployeeId, setPtoMessageEmployeeId] = useState<number | null>(null);
  const [isPtoMessageContext, setIsPtoMessageContext] = useState(false);
  const [newConversationMessage, setNewConversationMessage] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageError, setMessageError] = useState("");
  const [ptoMessageOverlayPosition, setPtoMessageOverlayPosition] = useState<{ top: number; left: number; height: number } | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const conversationMessagesRef = useRef<HTMLDivElement>(null);
  const messageComposerRef = useRef<HTMLTextAreaElement>(null);
  const ptoReviewModalRef = useRef<HTMLDivElement>(null);
  const employeeFilterRef = useRef<HTMLDivElement>(null);
  const ptoHistoryEmployeeFilterRef = useRef<HTMLDivElement>(null);
  const [activeCalendarTab, setActiveCalendarTab] = useState<CalendarTab>("today");
  const [activeHoursTab, setActiveHoursTab] = useState<CalendarTab>("today");
  const [hoursRounding, setHoursRounding] = useState<HoursRounding>("actual");
  const [hoursDisplay, setHoursDisplay] = useState<HoursDisplay>("actual");
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (response.status === 401) { setIsUnlocked(false); window.location.replace("/login"); }
      } catch { /* Network failures are retried; server requests still fail closed. */ }
    }
    const timer = window.setInterval(() => { void checkSession(); }, 60000);
    const onFocus = () => { void checkSession(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, []);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [isAddingEmployeeRole, setIsAddingEmployeeRole] = useState(false);
  const [newEmployeeRole, setNewEmployeeRole] = useState("");
  const employeeRoleInputRef = useRef<HTMLInputElement>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [viewingRosterEmployeeId, setViewingRosterEmployeeId] = useState<number | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [showTerminatedEmployees, setShowTerminatedEmployees] = useState(false);
  const [isRosterFilterOpen, setIsRosterFilterOpen] = useState(false);
  const [rosterAccessFilter, setRosterAccessFilter] = useState("");
  const [rosterRoleFilter, setRosterRoleFilter] = useState("");
  const [rosterMissingFilter, setRosterMissingFilter] = useState("");
  const [rosterActionEmployeeId, setRosterActionEmployeeId] = useState<number | null>(null);
  const [rosterActionPosition, setRosterActionPosition] = useState({ top: 0, left: 0 });
  const rosterActionButtonRef = useRef<HTMLButtonElement | null>(null);
  const rosterActionMenuRef = useRef<HTMLDivElement>(null);
  const [teamMemberProfileTab, setTeamMemberProfileTab] = useState<TeamMemberProfileTab>("job");
  const [editingPayrollEmployeeId, setEditingPayrollEmployeeId] = useState<number | null>(null);
  const [payrollClassificationDraft, setPayrollClassificationDraft] = useState<PayrollClassification>("W-2 Employee");
  const [editingPersonalPayrollEmployeeId, setEditingPersonalPayrollEmployeeId] = useState<number | null>(null);
  const [personalPayrollDraft, setPersonalPayrollDraft] = useState(() => personalPayrollForm(blankEmployee));
  const personalPayrollFirstNameRef = useRef<HTMLInputElement>(null);
  const [editingPersonalContactEmployeeId, setEditingPersonalContactEmployeeId] = useState<number | null>(null);
  const [personalContactDraft, setPersonalContactDraft] = useState(() => personalContactForm(blankEmployee));
  const [personalContactError, setPersonalContactError] = useState("");
  const personalContactFirstNameRef = useRef<HTMLInputElement>(null);
  const [managerNoteDraft, setManagerNoteDraft] = useState("");
  const [certificateEmployeeId, setCertificateEmployeeId] = useState<number | null>(null);
  const [certificateDraft, setCertificateDraft] = useState({ name: "", expirationDate: "" });
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateError, setCertificateError] = useState("");
  const [certificateDownloadError, setCertificateDownloadError] = useState("");
  const [isSavingCertificate, setIsSavingCertificate] = useState(false);
  const [isDraggingCertificate, setIsDraggingCertificate] = useState(false);
  const certificateNameRef = useRef<HTMLInputElement>(null);
  const addCertificateButtonRef = useRef<HTMLButtonElement>(null);
  const [terminatingEmployeeId, setTerminatingEmployeeId] = useState<number | null>(null);
  const [terminationStep, setTerminationStep] = useState<"notice" | "details" | "success">("notice");
  const [terminationReason, setTerminationReason] = useState("");
  const [terminationDate, setTerminationDate] = useState(today);
  const [eligibleForRehire, setEligibleForRehire] = useState(true);
  const [terminationNote, setTerminationNote] = useState("");
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentRoleDrafts, setDepartmentRoleDrafts] = useState<Record<number, string>>({});
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [departmentNameDraft, setDepartmentNameDraft] = useState("");
  const [scheduleDate, setScheduleDate] = useState(today);
  const [hoursDate, setHoursDate] = useState(today);
  const setWorkspacePeriod = shared.setPeriod;
  useEffect(() => {
    if (activeView === "hours") return; // Timesheets owns its day/pay-period range.
    if (activeView === "schedule") {
      const date = parseLocalDate(scheduleDate);
      if (!Number.isFinite(date.getTime())) return;
      const start = new Date(date.getFullYear(), date.getMonth(), 1); start.setDate(start.getDate() - 7);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); end.setDate(end.getDate() + 7);
      setWorkspacePeriod({ start: toDateInputValue(start), end: toDateInputValue(end) });
    } else {
      // Dashboard/PTO need complete current-year accrual, never all-time punches.
      setWorkspacePeriod({ start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` });
    }
  }, [activeView, scheduleDate, today, setWorkspacePeriod]);
  const [editingHours, setEditingHours] = useState<{
    employee: Employee;
    hours: string;
    minutes: string;
  } | null>(null);
  const [showHoursChangeWarning, setShowHoursChangeWarning] = useState(false);
  const [ptoRequestForm, setPtoRequestForm] = useState<{
    compensation: PtoRequest["compensation"];
    startDate: string;
    endDate: string;
    reason: PtoRequest["reason"] | "";
    explanation: string;
  } | null>(null);
  const [ptoRequestError, setPtoRequestError] = useState("");
  const [reviewingPtoRequestId, setReviewingPtoRequestId] = useState<number | null>(null);
  const [scheduleTimeOffRequestId, setScheduleTimeOffRequestId] = useState<number | null>(null);
  const [scheduleTimeOffPosition, setScheduleTimeOffPosition] = useState({ top: 0, left: 0 });
  const scheduleTimeOffTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scheduleTimeOffPopoverRef = useRef<HTMLDivElement>(null);
  const [highlightedPtoRequestId, setHighlightedPtoRequestId] = useState<number | null>(null);
  const [highlightedEventTargetId, setHighlightedEventTargetId] = useState<string | null>(null);
  const [ptoReviewError, setPtoReviewError] = useState("");
  const [arePtoRequestsExpanded, setArePtoRequestsExpanded] = useState(false);
  const [areEventsExpanded, setAreEventsExpanded] = useState(false);
  const [isViewingPtoHistory, setIsViewingPtoHistory] = useState(false);
  const [ptoHistoryMonth, setPtoHistoryMonth] = useState(`${today.slice(0, 7)}-01`);
  const [ptoHistoryStatusFilter, setPtoHistoryStatusFilter] = useState<PtoHistoryStatusFilter>("all");
  const [ptoHistoryEmployeeId, setPtoHistoryEmployeeId] = useState<number | "all">("all");
  const [isPtoHistoryEmployeeFilterOpen, setIsPtoHistoryEmployeeFilterOpen] = useState(false);
  const [ptoPolicyForm, setPtoPolicyForm] = useState<PtoPolicyForm | null>(null);
  const [ptoPolicyStep, setPtoPolicyStep] = useState<"details" | "employees" | "balances">("details");
  const [ptoPolicyError, setPtoPolicyError] = useState("");
  const [isViewingPtoPolicies, setIsViewingPtoPolicies] = useState(false);
  const [editingPtoPolicyId, setEditingPtoPolicyId] = useState<number | null>(null);
  const [employeeScheduleTab, setEmployeeScheduleTab] = useState<EmployeeScheduleTab>("week");
  const [isEmployeeFilterOpen, setIsEmployeeFilterOpen] = useState(false);
  const [visibleEmployeeIds, setVisibleEmployeeIds] = useState<number[] | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [createShiftWeekdays, setCreateShiftWeekdays] = useState<number[]>([]);
  const [editingShiftWeekdays, setEditingShiftWeekdays] = useState<number[]>([]);
  const [isAddingShift, setIsAddingShift] = useState(false);
  const [createShiftError, setCreateShiftError] = useState("");
  const [editShiftError, setEditShiftError] = useState("");
  const [createdShiftTimes, setCreatedShiftTimes] = useState<Record<number, number>>({});
  const [editedShiftTimes, setEditedShiftTimes] = useState<Record<number, number>>({});
  const [lastEditedShiftId, setLastEditedShiftId] = useState<number | null>(null);
  const [showBreakOptions, setShowBreakOptions] = useState(false);
  const [pendingTimeException, setPendingTimeException] = useState<TimeExceptionAction | null>(null);
  const [timeExceptionExplanation, setTimeExceptionExplanation] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [copiedShift, setCopiedShift] = useState<Shift | null>(null);
  const draggedShift = useRef<Shift | null>(null);
  const [shiftForm, setShiftForm] = useState<Shift & { notes: string }>({
    id: 0,
    employeeId: 0,
    date: today,
    start: "",
    end: "",
    role: "",
    station: "Floor",
    notes: "",
  });

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (rosterActionEmployeeId === null) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !rosterActionMenuRef.current?.contains(event.target) && !rosterActionButtonRef.current?.contains(event.target)) {
        setRosterActionEmployeeId(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRosterActionEmployeeId(null);
        rosterActionButtonRef.current?.focus();
      }
    };
    const dismissOnLayoutChange = (event: Event) => {
      if (!(event.target instanceof Node && rosterActionMenuRef.current?.contains(event.target))) setRosterActionEmployeeId(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    document.addEventListener("scroll", dismissOnLayoutChange, true);
    window.addEventListener("resize", dismissOnLayoutChange);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
      document.removeEventListener("scroll", dismissOnLayoutChange, true);
      window.removeEventListener("resize", dismissOnLayoutChange);
    };
  }, [rosterActionEmployeeId]);

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    function closeAccountMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setIsAccountMenuOpen(false);
        return;
      }

      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenu);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenu);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    function closeNotifications(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setIsNotificationsOpen(false);
        return;
      }

      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeNotifications);
    document.addEventListener("keydown", closeNotifications);
    return () => {
      document.removeEventListener("pointerdown", closeNotifications);
      document.removeEventListener("keydown", closeNotifications);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!isMessagesOpen) return;

    function closeMessages(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setIsMessagesOpen(false);
        return;
      }

      if (!messageMenuRef.current?.contains(event.target as Node)) {
        setIsMessagesOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMessages);
    document.addEventListener("keydown", closeMessages);
    return () => {
      document.removeEventListener("pointerdown", closeMessages);
      document.removeEventListener("keydown", closeMessages);
    };
  }, [isMessagesOpen]);

  useEffect(() => {
    if (reviewingPtoRequestId === null || !isMessagesOpen) {
      setPtoMessageOverlayPosition(null);
      return;
    }

    function positionMessageBesidePtoReview() {
      const reviewModal = ptoReviewModalRef.current;
      const messageDropdown = messageMenuRef.current?.querySelector<HTMLElement>(".message-dropdown");
      if (!reviewModal || !messageDropdown) return;

      const reviewBounds = reviewModal.getBoundingClientRect();
      const edgePadding = 14;
      const gap = 12;
      const dropdownWidth = messageDropdown.offsetWidth;
      const rightSideLeft = reviewBounds.right + gap;
      const left = rightSideLeft + dropdownWidth <= window.innerWidth - edgePadding
        ? rightSideLeft
        : Math.max(edgePadding, window.innerWidth - dropdownWidth - edgePadding);
      const top = Math.max(
        edgePadding,
        Math.min(reviewBounds.top, window.innerHeight - reviewBounds.height - edgePadding),
      );

      setPtoMessageOverlayPosition({ top, left, height: reviewBounds.height });
    }

    const animationFrame = window.requestAnimationFrame(positionMessageBesidePtoReview);
    window.addEventListener("resize", positionMessageBesidePtoReview);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", positionMessageBesidePtoReview);
    };
  }, [isCreatingConversation, isMessagesOpen, isPtoMessageContext, reviewingPtoRequestId, selectedConversationId, viewingConversationInfoId]);

  useEffect(() => {
    if (highlightedPtoRequestId === null) return;

    const animationFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-pto-request-id="${highlightedPtoRequestId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const highlightTimeout = window.setTimeout(() => setHighlightedPtoRequestId(null), 3000);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(highlightTimeout);
    };
  }, [highlightedPtoRequestId]);

  useEffect(() => {
    if (highlightedEventTargetId === null) return;

    const animationFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-event-target-id="${highlightedEventTargetId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const highlightTimeout = window.setTimeout(() => setHighlightedEventTargetId(null), 3000);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(highlightTimeout);
    };
  }, [highlightedEventTargetId]);

  useEffect(() => {
    if (!isEmployeeFilterOpen) return;

    function closeEmployeeFilter(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setIsEmployeeFilterOpen(false);
        return;
      }
      if (!employeeFilterRef.current?.contains(event.target as Node)) setIsEmployeeFilterOpen(false);
    }

    document.addEventListener("pointerdown", closeEmployeeFilter);
    document.addEventListener("keydown", closeEmployeeFilter);
    return () => {
      document.removeEventListener("pointerdown", closeEmployeeFilter);
      document.removeEventListener("keydown", closeEmployeeFilter);
    };
  }, [isEmployeeFilterOpen]);

  useEffect(() => {
    if (!isPtoHistoryEmployeeFilterOpen) return;

    function closePtoHistoryEmployeeFilter(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setIsPtoHistoryEmployeeFilterOpen(false);
        return;
      }
      if (!ptoHistoryEmployeeFilterRef.current?.contains(event.target as Node)) {
        setIsPtoHistoryEmployeeFilterOpen(false);
      }
    }

    document.addEventListener("pointerdown", closePtoHistoryEmployeeFilter);
    document.addEventListener("keydown", closePtoHistoryEmployeeFilter);
    return () => {
      document.removeEventListener("pointerdown", closePtoHistoryEmployeeFilter);
      document.removeEventListener("keydown", closePtoHistoryEmployeeFilter);
    };
  }, [isPtoHistoryEmployeeFilterOpen]);

  const activeEmployee = state.employees.find((employee) => employee.id === activeEmployeeId);
  const canLaunchTimeClock = Boolean(activeEmployee?.active && !activeEmployee.terminated);
  const activeUserIsAdmin = account.accessLevel === "owner" || account.accessLevel === "general_manager";
  const ownAvailabilityRequests = state.availabilityRequests.filter(request => request.employeeId === activeEmployeeId);
  const activeAvailabilityRequest = approvedAvailability(ownAvailabilityRequests, activeEmployeeId, today);
  const activeScheduleDraft = mode === "manager"
    ? state.scheduleDraftsByManager?.[activeEmployeeId]
    : undefined;
  const workingScheduleShifts = mode === "manager"
    ? applyScheduleDraft(state.shifts, activeScheduleDraft)
    : state.shifts;
  const savedEditingShift = editingShift
    ? workingScheduleShifts.find((shift) => shift.id === editingShift.id) ?? editingShift
    : null;
  const editingShiftHasStarted = Boolean(
    savedEditingShift && currentTime >= shiftStartDateTime(savedEditingShift).getTime(),
  );
  const editingShiftHasEnded = Boolean(
    savedEditingShift && currentTime >= shiftEndDateTime(savedEditingShift).getTime(),
  );
  const editingShiftClockEvents = savedEditingShift
    ? state.clockEvents.filter((event) => (
        (event.type === "in" || event.type === "out")
        && shiftForClockEvent(event, workingScheduleShifts)?.id === savedEditingShift.id
      ))
    : [];
  const editingShiftClockIn = editingShiftClockEvents
    .filter((event) => event.type === "in")
    .sort((first, second) => first.at.localeCompare(second.at))[0];
  const editingShiftClockOut = editingShiftClockEvents
    .filter((event) => event.type === "out")
    .sort((first, second) => second.at.localeCompare(first.at))[0];
  const editingShiftIsNoShow = Boolean(
    editingShiftHasEnded
    && savedEditingShift
    && state.shifts.some((shift) => shift.id === savedEditingShift.id)
    && !hasClockInForShift(savedEditingShift, state.clockEvents, state.shifts),
  );
  const reviewingPtoRequest = (state.ptoRequests ?? []).find((request) => request.id === reviewingPtoRequestId);
  const scheduleTimeOffRequest = activeView === "schedule" && !isPublicSchedule
    ? (state.ptoRequests ?? []).find((request) => request.id === scheduleTimeOffRequestId && (mode === "manager" || request.employeeId === activeEmployeeId))
    : undefined;
  const scheduleTimeOffEmployee = scheduleTimeOffRequest ? employeeById(state.employees, scheduleTimeOffRequest.employeeId) : undefined;

  useEffect(() => {
    if (!scheduleTimeOffRequest) return;
    function dismiss(restoreFocus = false) {
      setScheduleTimeOffRequestId(null);
      if (restoreFocus) scheduleTimeOffTriggerRef.current?.focus();
    }
    function closeOutside(event: PointerEvent | FocusEvent) {
      const target = event.target as Node;
      if (!scheduleTimeOffPopoverRef.current?.contains(target) && !scheduleTimeOffTriggerRef.current?.contains(target)) dismiss();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
    }
    function closeOnLayoutChange(event: Event) {
      if (event.target instanceof Node && scheduleTimeOffPopoverRef.current?.contains(event.target)) return;
      dismiss();
    }
    const frame = window.requestAnimationFrame(() => {
      const popover = scheduleTimeOffPopoverRef.current;
      if (!popover) return;
      const bounds = popover.getBoundingClientRect();
      setScheduleTimeOffPosition((position) => ({ ...position, top: Math.max(12, Math.min(position.top, window.innerHeight - bounds.height - 12)) }));
      popover.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnLayoutChange, true);
    window.addEventListener("resize", closeOnLayoutChange);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnLayoutChange, true);
      window.removeEventListener("resize", closeOnLayoutChange);
    };
  }, [scheduleTimeOffRequest, scheduleTimeOffRequestId]);
  const reviewingOwnPtoRequest = reviewingPtoRequest?.employeeId === activeEmployeeId;
  const activeUserCanManage = shared.data.permissions["team.manage"] || shared.data.permissions["schedule.manage"] || shared.data.permissions["time_off.approve"];
  const notificationRequests = activeUserCanManage ? [...(state.ptoRequests ?? [])]
    .filter((request) => request.employeeId !== activeEmployeeId)
    .sort((first, second) => (second.requestedAt ?? "").localeCompare(first.requestedAt ?? ""))
    : [];
  const alertEligibleShifts = state.shifts.filter(isWorkShift);
  const operationalAlerts = activeUserCanManage
    ? operationalAlertsFor(
        state.employees,
        alertEligibleShifts,
        state.clockEvents,
        currentTime,
        scheduleEnforcement,
      )
    : [];
  const noShowEvents = activeUserCanManage
    ? noShowAlertsFor(state.employees, alertEligibleShifts, state.clockEvents, currentTime, Number.NEGATIVE_INFINITY, scheduleEnforcement)
    : [];
  const eventHistoryItems = [
    ...state.clockEvents.map((event) => ({ kind: "clock" as const, at: event.at, event })),
    ...noShowEvents.map((alert) => ({ kind: "no-show" as const, at: alert.at, alert })),
  ].sort((first, second) => second.at.localeCompare(first.at));
  const displayedEventHistoryItems = areEventsExpanded
    ? eventHistoryItems
    : eventHistoryItems.slice(0, 10);
  const employeeScheduleNotifications = (state.scheduleUpdates ?? [])
    .filter((notification) => notification.employeeId === activeEmployeeId)
    .sort((first, second) => second.at.localeCompare(first.at))
    .slice(0, 40);
  const teamConversations = (state.conversations ?? [])
    .filter((conversation) => conversation.participantIds.includes(activeEmployeeId))
    .sort((first, second) => {
      const pinDifference = Number(second.pinnedByEmployeeIds?.includes(activeEmployeeId))
        - Number(first.pinnedByEmployeeIds?.includes(activeEmployeeId));
      return pinDifference || conversationLastSentAt(second).localeCompare(conversationLastSentAt(first));
    });
  const unreadConversationCount = teamConversations.filter(
    (conversation) => conversationHasUnreadMessages(conversation, activeEmployeeId),
  ).length;
  const unreadMessageCount = teamConversations.reduce(
    (total, conversation) => total + conversationUnreadMessageCount(conversation, activeEmployeeId),
    0,
  );
  const visibleConversations = teamConversations.filter(
    (conversation) => messageFilter === "all" || conversationHasUnreadMessages(conversation, activeEmployeeId),
  );
  const selectedConversation = teamConversations.find((conversation) => conversation.id === selectedConversationId);
  const selectedConversationMessageCount = selectedConversation?.messages.length ?? 0;
  const latestOwnMessageId = selectedConversation?.messages.reduce<number | null>(
    (latestMessageId, message) => (
      message.senderEmployeeId === activeEmployeeId ? message.id : latestMessageId
    ),
    null,
  ) ?? null;
  const viewingConversationInfo = teamConversations.find((conversation) => conversation.id === viewingConversationInfoId);
  const conversationWithOpenMenu = teamConversations.find((conversation) => conversation.id === conversationMenuId);
  const requestNotifications: HeaderNotification[] = notificationRequests.map((request) => {
    const employee = employeeById(state.employees, request.employeeId);
    return {
      id: `request-${request.id}`,
      kind: "request",
      title: `${employee?.name ?? "Employee"} · Time off request`,
      detail: `${formatShortDate(request.startDate)} · ${capitalize(request.status)}`,
      at: request.requestedAt,
      requestId: request.id,
      requestDate: formatShortDate(request.startDate),
      requestStatus: request.status,
    };
  });
  const alertNotifications: HeaderNotification[] = operationalAlerts.map((alert) => ({
    id: `alert-${alert.id}`,
    kind: "alert",
    title: alert.title,
    detail: alert.detail,
    at: alert.at,
    eventTargetId: alert.eventTargetId,
  }));
  const scheduleNotifications: HeaderNotification[] = employeeScheduleNotifications.map((notification) => ({
    id: `schedule-${notification.id}`,
    kind: "schedule",
    title: notification.title,
    detail: notification.detail,
    at: notification.at,
  }));
  const allHeaderNotifications = [
    ...requestNotifications,
    ...alertNotifications,
    ...scheduleNotifications,
  ].sort((first, second) => second.at.localeCompare(first.at));
  const dismissedNotificationIds = dismissedNotificationIdsByEmployee[activeEmployeeId] ?? [];
  const headerNotifications = allHeaderNotifications
    .filter((notification) => !dismissedNotificationIds.includes(notification.id))
    .slice(0, 40);
  const openedNotificationIds = openedNotificationIdsByEmployee[activeEmployeeId] ?? [];
  const unreadNotificationCount = headerNotifications.filter(
    (notification) => !openedNotificationIds.includes(notification.id),
  ).length;

  useEffect(() => {
    if (!isMessagesOpen || selectedConversationId === null) return;

    const animationFrame = window.requestAnimationFrame(() => {
      const messageList = conversationMessagesRef.current;
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isMessagesOpen, ptoMessageOverlayPosition?.height, selectedConversationId, selectedConversationMessageCount]);

  useEffect(() => {
    const hasOpenComposer = selectedConversationId !== null
      || (isCreatingConversation && ptoMessageEmployeeId !== null);
    if (!isMessagesOpen || !hasOpenComposer) return;

    const animationFrame = window.requestAnimationFrame(() => messageComposerRef.current?.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isCreatingConversation, isMessagesOpen, ptoMessageEmployeeId, selectedConversationId]);

  const isBasicInfoDirty = JSON.stringify(basicInfo) !== savedBasicInfoSnapshot;
  const isScheduleEnforcementDirty = scheduleEnforcementFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const isAlertsPermissionsDirty = alertsPermissionsFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const isEventsTradesDirty = eventsTradesFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const isOvertimeDirty = overtimeFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const isBreaksComplianceDirty = breaksComplianceFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const isMessagesSettingsDirty = messagesSettingsFields.some(field => scheduleEnforcementDraft[field] !== scheduleEnforcement[field]);
  const canViewScheduleEvents = !isPublicSchedule || !scheduleEnforcement.employeesOwnScheduleOnly;
  const scheduleHourLabels = Array.from(
    { length: scheduleEnforcement.scheduleEndHour - scheduleEnforcement.scheduleStartHour },
    (_, index) => scheduleEnforcement.scheduleStartHour + index,
  );
  const activeEmployees = useMemo(
    () => state.employees.filter((employee) => employee.active),
    [state.employees],
  );
  const savedBasicInfo = JSON.parse(savedBasicInfoSnapshot) as BasicInfo;
  const sidebarLocationName = savedBasicInfo.locationName.trim() || defaultBasicInfo.locationName;
  const accountOwnerEmployeeId = shared.data.primaryOwnerEmployeeId;
  const availableLocations = Array.from(new Set([
    ...locationNamesFromBasicInfo(savedBasicInfo),
    ...companyLocations.map((location) => location.name.trim()).filter(Boolean),
  ]));
  const canAddNewLocations = newLocationDrafts.length > 0 && newLocationDrafts.every(
    (location) => location.name.trim() && /^\d{5}$/.test(location.zip),
  );
  const rosterRoles = Array.from(new Set(
    activeEmployees
      .map((employee) => employee.role.trim())
      .filter(Boolean),
  ));
  const availableRoles = Array.from(new Set(
    [...state.departments.flatMap((department) => department.roles), ...rosterRoles],
  )).sort((first, second) => first.localeCompare(second));
  const departmentManagers = useDepartmentManagers(activeView === "departments_roles" && account.accessLevel === "owner");
  const rosterFilterRoles = Array.from(new Set([
    ...availableRoles,
    ...state.employees.map((employee) => employee.role.trim()).filter(Boolean),
  ])).sort((first, second) => first.localeCompare(second));
  const filteredRosterEmployees = useMemo(() => {
    const search = rosterSearch.trim().toLocaleLowerCase();
    return state.employees.filter((employee) => {
      if (!showTerminatedEmployees && employee.terminated) return false;
      if (search && !employee.name.toLocaleLowerCase().includes(search)) return false;
      if (rosterAccessFilter && employee.accessLevel !== rosterAccessFilter) return false;
      if (rosterRoleFilter && employee.role.trim() !== rosterRoleFilter && !employee.jobs?.some(job => job.name === rosterRoleFilter)) return false;
      switch (rosterMissingFilter) {
        case "wage": return !employee.wage.trim();
        case "contact": return !employee.email.trim() || !employee.phone.trim();
        case "role": return !employee.role.trim();
        case "birth": return !employee.dateOfBirth?.trim();
        default: return true;
      }
    }).sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: "base" }));
  }, [state.employees, rosterSearch, showTerminatedEmployees, rosterAccessFilter, rosterRoleFilter, rosterMissingFilter]);
  const rosterRowsForCopy = rosterCopyRows(filteredRosterEmployees);

  function downloadRoster() {
    const url = URL.createObjectURL(new Blob([rosterCsv(rosterRowsForCopy)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `team-roster-${today}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const shiftEmployees = useMemo(
    () => state.employees.filter(employee => employee.active || (employee.terminated && employee.terminationDate && scheduleDate <= retainedThrough(employee.terminationDate, scheduleEnforcement.workWeekStart, shared.data.teamPeriod?.payPeriod ?? "weekly", shared.data.teamPeriod?.anchorDate ?? "2026-11-02"))).filter(employee => canViewTeamSchedule(employee.id, activeEmployeeId, mode === "manager", isPublicSchedule, scheduleEnforcement.employeesOwnScheduleOnly)),
    [state.employees, scheduleDate, shared.data.teamPeriod, activeEmployeeId, mode, isPublicSchedule, scheduleEnforcement.workWeekStart, scheduleEnforcement.employeesOwnScheduleOnly],
  );
  const shiftEmployeeIds = useMemo(
    () => new Set(shiftEmployees.map((employee) => employee.id)),
    [shiftEmployees],
  );
  const accessibleShifts = workingScheduleShifts.filter(shift => canViewTeamSchedule(shift.employeeId, activeEmployeeId, mode === "manager", isPublicSchedule, scheduleEnforcement.employeesOwnScheduleOnly));
  const unpublishedShiftCount = activeScheduleDraft
    ? new Set([
        ...activeScheduleDraft.upsertedShifts.map((shift) => shift.id),
        ...activeScheduleDraft.deletedShiftIds,
      ]).size
    : 0;
  const draftShiftIds = new Set(activeScheduleDraft?.upsertedShifts.map((shift) => shift.id) ?? []);
  const orderedShiftEmployees = useMemo(() => {
    return [...shiftEmployees].sort((first, second) => first.name.localeCompare(second.name));
  }, [shiftEmployees]);
  function viewIsAllowed(view: ViewId) {
    const p = shared.data.permissions;
    if (["employees", "departments_roles", "team_members"].includes(view)) return p["team.read"];
    if (["schedule", "events"].includes(view)) return p["schedule.read"];
    if (["hours", "clockins"].includes(view)) return p["timesheets.read"];
    if (view === "time_off") return p["time_off.read"];
    if (["my_availability", "team_availability"].includes(view)) return p["availability.read"];
    if (view === "settings") return p["settings.manage"];
    return true;
  }
  const visibleNavItems = isPublicSchedule
    ? navItems.filter((item) => item.id === "schedule")
    : navItems.filter((item) => (mode === "manager" || !item.managerOnly) && viewIsAllowed(item.id));
  const todaysShifts = accessibleShifts.filter(isWorkShift)
    .filter((shift) => shift.date === today && shiftEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  const calendarShifts = useMemo(
    () =>
      shiftsForCalendarRange(accessibleShifts.filter(isWorkShift), shiftEmployeeIds, today, activeCalendarTab, scheduleEnforcement.workWeekStart).sort(
        (a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
      ),
    [accessibleShifts, activeCalendarTab, shiftEmployeeIds, today, scheduleEnforcement.workWeekStart],
  );
  const scheduleDayShifts = accessibleShifts
    .filter(shift => shift.date === scheduleDate && shiftEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  const scheduleWeekDays = useMemo(
    () =>
      workWeekCalendarDays(scheduleDate, scheduleEnforcement.workWeekStart).map((day) => ({
        ...day,
        shifts: accessibleShifts
          .filter((shift) => (
            shift.date === day.date
            && shiftEmployeeIds.has(shift.employeeId)
            ))
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds, scheduleEnforcement.workWeekStart],
  );
  const scheduleMonthDays = useMemo(
    () => scheduleMonthCalendarDays(scheduleDate, scheduleEnforcement.workWeekStart).map((day) => ({
      ...day,
      shifts: accessibleShifts
        .filter((shift) => (
          shift.date === day.date
          && shiftEmployeeIds.has(shift.employeeId)
        ))
        .sort((a, b) => a.start.localeCompare(b.start)),
    })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds, scheduleEnforcement.workWeekStart],
  );
  const visibleScheduleEmployees = orderedShiftEmployees.filter((employee) => visibleEmployeeIds === null || visibleEmployeeIds.includes(employee.id));
  const scheduleEstimates = estimateSchedule(accessibleShifts, state.employees, scheduleEnforcement, {
    start: shared.data.period?.start ?? "", end: shared.data.period?.end ?? "", allDepartments: shared.data.scheduleEstimateScopeComplete === true,
  });
  const scheduleMinutes = new Map(scheduleEstimates.map(row => [row.shiftId, row]));
  function formatScheduledHours(shift: Shift) { return ((scheduleMinutes.get(shift.id)?.paidMinutes ?? 0) / 60).toFixed(2); }
  const summaryShiftIds = new Set((employeeScheduleTab === "day" ? scheduleDayShifts : employeeScheduleTab === "week" ? scheduleWeekDays.flatMap(day => day.shifts) : scheduleMonthDays.flatMap(day => day.shifts)).map(shift => shift.id));
  const summaryEmployeeIds = new Set(visibleScheduleEmployees.map(employee => employee.id));
  const summaryRows = scheduleEstimates.filter(row => summaryShiftIds.has(row.shiftId) && summaryEmployeeIds.has(row.employeeId));
  const warningShift = (shift: Shift): PlannedShift => ({ id: shift.id, employeeId: shift.employeeId, date: shift.date, start: shift.start, end: shift.end, role: shift.role, shiftType: shift.shiftType ?? "work" });
  const draftWarningShifts = (activeScheduleDraft?.upsertedShifts ?? []).map(warningShift);
  const warningPeriod = shared.data.period;
  const warningsEnabled = activeView === "schedule" && mode === "manager" && warningPeriod && Date.parse(warningPeriod.end) - Date.parse(warningPeriod.start) <= 61 * 86400000;
  const scheduleWarnings = useScheduleWarnings(warningsEnabled ? { period: warningPeriod, revision: shared.data.revision, upserts: draftWarningShifts, deletedShiftIds: activeScheduleDraft?.deletedShiftIds ?? [] } : null);
  const warningsByShift = new Map(scheduleWarnings.data?.warnings.map(warning => [warning.shiftId, warning.codes]) ?? []);
  const previewShift = editingShift ?? (isAddingShift ? shiftForm : null);
  const previewWeekdays = editingShift ? editingShiftWeekdays : createShiftWeekdays;
  const previewStart = previewShift && (isWorkShift(previewShift) ? parseTypedTime(previewShift.start) : "00:00");
  const previewEnd = previewShift && (isWorkShift(previewShift) ? parseTypedTime(previewShift.end) : "00:00");
  const previewDates = previewShift?.date && Number.isFinite(Date.parse(previewShift.date)) && previewWeekdays.length ? [...new Set([...(editingShift ? [previewShift.date] : []), ...shiftDatesForWeekdays(previewShift.date, previewWeekdays, scheduleEnforcement.workWeekStart)])] : [];
  const previewShifts: PlannedShift[] = previewShift && previewStart && previewEnd ? previewDates.map((date, index) => ({ ...warningShift(previewShift), id: -index - 1, date, start: previewStart, end: previewEnd })) : [];
  const previewValid = !!previewShift?.employeeId && !!previewShift.role && !!previewStart && !!previewEnd && (!isWorkShift(previewShift) || previewStart < previewEnd) && previewShifts.length > 0;
  const sortedPreviewDates = [...previewDates].sort();
  const previewPeriod = previewDates.length ? { start: workWeekCalendarDays(sortedPreviewDates[0], scheduleEnforcement.workWeekStart)[0].date, end: workWeekCalendarDays(sortedPreviewDates.at(-1)!, scheduleEnforcement.workWeekStart).at(-1)!.date } : null;
  const previewWarnings = useScheduleWarnings(previewValid && previewPeriod ? { period: previewPeriod, revision: shared.data.revision,
    upserts: [...draftWarningShifts.filter(shift => shift.id !== editingShift?.id), ...previewShifts], deletedShiftIds: [...new Set([...(activeScheduleDraft?.deletedShiftIds ?? []), ...(editingShift && editingShift.id > 0 ? [editingShift.id] : [])])] } : null);
  const previewWarningPlan = [...workingScheduleShifts.filter(shift => shift.id !== editingShift?.id), ...previewShifts];
  const previewWarningIds = new Set(previewWarningPlan.filter(shift => shift.employeeId === previewShift?.employeeId && previewPeriod && shift.date >= previewPeriod.start && shift.date <= previewPeriod.end).map(shift => shift.id));
  function shiftWarningPreview() { return <ScheduleWarningPanel result={previewWarnings} shifts={previewWarningPlan} employees={state.employees} visibleIds={previewWarningIds} label="Shift warning preview" placeholder={previewValid ? undefined : "Choose an employee, role, date and valid times to preview warnings."} />; }
  const myShift = todaysShifts.find(shift => shift.employeeId === activeEmployeeId && shiftEndDateTime(shift).getTime() > currentTime) ?? todaysShifts.filter(shift => shift.employeeId === activeEmployeeId).at(-1);
  const clockedInIds = useMemo(() => {
    return new Set(
      state.employees
        .filter((employee) => employee.active)
        .filter((employee) => lastWorkClockEvent(state.clockEvents, employee.id)?.type === "in")
        .map((employee) => employee.id),
    );
  }, [state.clockEvents, state.employees]);
  const activeClockEvent = lastWorkClockEvent(state.clockEvents, activeEmployeeId);
  const activeIsClockedIn = activeClockEvent?.type === "in";
  const activeBreak = activeIsClockedIn
    ? activeBreakEvent(state.clockEvents, activeEmployeeId)
    : undefined;
  const activeBreakEndTime = activeBreak ? breakEndTime(activeBreak) : undefined;
  const activeBreakRemainingMs = activeBreak && activeBreakEndTime
    ? Math.min(
        breakDurationMs(activeBreak),
        activeBreakEndTime.getTime() - currentTime,
      )
    : 0;
  const isBreakPastGrace = activeBreakEndTime
    ? currentTime >= activeBreakEndTime.getTime() + 60000
    : false;
  const timeExceptionMessage = pendingTimeException
    ? timeExceptionWarningMessage(pendingTimeException, myShift, activeBreakEndTime, currentTime)
    : "";
  const ptoRows = useMemo(() => {
    const yearToDate = yearToDateRange(new Date(currentTime));
    const ptoPolicyByEmployeeId = new Map<number, PtoPolicy>();
    (state.ptoPolicies ?? []).forEach((policy) => {
      policy.employeeIds.forEach((employeeId) => ptoPolicyByEmployeeId.set(employeeId, policy));
    });

    return state.employees.map((employee) => {
      const hoursWorked = adjustedWorkedHoursForRange(
        state.clockEvents,
        state.hoursAdjustments ?? [],
        employee.id,
        yearToDate,
        currentTime,
      );
      const ptoPolicy = ptoPolicyByEmployeeId.get(employee.id);
      const policyStartDate = ptoPolicy?.startingBalances?.[employee.id]?.startDate;
      const policyStart = policyStartDate ? startOfDay(parseLocalDate(policyStartDate)) : yearToDate.start;
      const accrualHoursWorked = ptoPolicy && policyStart > yearToDate.start
        ? adjustedWorkedHoursForRange(
            state.clockEvents,
            state.hoursAdjustments ?? [],
            employee.id,
            { start: policyStart, end: yearToDate.end },
            currentTime,
          )
        : hoursWorked;

      return {
        employee,
        hoursWorked,
        ptoHours: ptoHoursEarnedForPolicy(accrualHoursWorked, ptoPolicy, employee.id),
        ptoUsed: ptoHoursUsedThisYear(state.ptoRequests ?? [], employee.id, new Date(currentTime).getFullYear()),
      };
    });
  }, [currentTime, state.clockEvents, state.employees, state.hoursAdjustments, state.ptoPolicies, state.ptoRequests]);
  const activeEmployeePto = ptoRows.find((row) => row.employee.id === activeEmployeeId);
  const viewingRosterEmployee = state.employees.find((employee) => employee.id === viewingRosterEmployeeId);
  const rosterActionEmployee = state.employees.find((employee) => employee.id === rosterActionEmployeeId);
  const savedPersonalPayroll = viewingRosterEmployee ? personalPayrollForm(viewingRosterEmployee) : null;
  const personalPayrollHasChanges = savedPersonalPayroll !== null && Object.entries(personalPayrollDraft)
    .some(([field, value]) => value !== savedPersonalPayroll[field as keyof typeof personalPayrollDraft]);
  const savedPersonalContact = viewingRosterEmployee ? personalContactForm(viewingRosterEmployee) : null;
  const personalContactHasChanges = savedPersonalContact !== null && Object.entries(personalContactDraft)
    .some(([field, value]) => value !== savedPersonalContact[field as keyof typeof personalContactDraft]);
  const terminatingEmployee = state.employees.find((employee) => employee.id === terminatingEmployeeId);
  const viewingRosterEmployeePto = ptoRows.find((row) => row.employee.id === viewingRosterEmployeeId);
  const viewingRosterEmployeePtoPolicy = (state.ptoPolicies ?? []).find(
    (policy) => viewingRosterEmployeeId !== null && policy.employeeIds.includes(viewingRosterEmployeeId),
  );
  const sortedPtoRequests = useMemo(
    () => (state.ptoRequests ?? [])
      .filter((request) => mode === "manager" || request.employeeId === activeEmployeeId)
      .sort((first, second) => second.requestedAt.localeCompare(first.requestedAt)),
    [activeEmployeeId, mode, state.ptoRequests],
  );
  const pendingPtoRequests = sortedPtoRequests.filter((request) => request.status === "pending");
  const nextPtoHistoryMonth = shiftDateByCalendarTab(ptoHistoryMonth, "month", 1);
  const filteredHistoricalPtoRequests = sortedPtoRequests
    .filter((request) => (
      request.status !== "pending"
      && request.startDate < nextPtoHistoryMonth
      && request.endDate >= ptoHistoryMonth
      && (ptoHistoryStatusFilter === "all" || request.status === ptoHistoryStatusFilter)
      && (mode !== "manager" || ptoHistoryEmployeeId === "all" || request.employeeId === ptoHistoryEmployeeId)
    ))
    .sort((first, second) => (
      (second.decidedAt ?? second.requestedAt).localeCompare(first.decidedAt ?? first.requestedAt)
    ));
  const displayedPtoRequests = arePtoRequestsExpanded
    ? filteredHistoricalPtoRequests
    : filteredHistoricalPtoRequests.slice(0, 1);
  const activeEmployeePtoLeft = activeEmployeePto
    ? activeEmployeePto.ptoHours - activeEmployeePto.ptoUsed
    : 0;
  const ptoRequestPreviewHours = ptoRequestForm
    ? ptoHoursForDateRange(
        ptoRequestForm.startDate,
        ptoRequestForm.endDate,
      )
    : 0;

  useEffect(() => {
    if (shiftEmployeeIds.has(shiftForm.employeeId)) return;

    setShiftForm((form) => ({
      ...form,
      employeeId: 0,
      role: "",
    }));
  }, [shiftEmployeeIds, shiftEmployees, shiftForm.employeeId]);



  async function openConversation(conversationId: number, fromPtoRequest = false) {
    setPtoMessageEmployeeId(null);
    setIsPtoMessageContext(fromPtoRequest);
    if (!fromPtoRequest) setMessageDraft("");
    setSelectedConversationId(conversationId);
    setConversationMenuId(null);
    setViewingConversationInfoId(null);
    setEditingConversationNameId(null);
    setConversationNameDraft("");
    setIsCreatingConversation(false);
    setMessageError("");
    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) => ({
                ...message,
                readByEmployeeIds: message.readByEmployeeIds.includes(activeEmployeeId)
                  ? message.readByEmployeeIds
                  : [...message.readByEmployeeIds, activeEmployeeId],
              })),
            }
          : conversation,
      ),
    }))) return;
  }

  function markHeaderNotificationsOpened() {
    const visibleNotificationIds = headerNotifications.map((notification) => notification.id);
    if (visibleNotificationIds.length === 0) return;

    setOpenedNotificationIdsByEmployee((current) => ({
      ...current,
      [activeEmployeeId]: Array.from(new Set([
        ...(current[activeEmployeeId] ?? []),
        ...visibleNotificationIds,
      ])).slice(-200),
    }));
  }

  function dismissHeaderNotification(notificationId: string) {
    setDismissedNotificationIdsByEmployee((current) => ({
      ...current,
      [activeEmployeeId]: Array.from(new Set([
        ...(current[activeEmployeeId] ?? []),
        notificationId,
      ])).slice(-500),
    }));
  }

  function clearAllHeaderNotifications() {
    const notificationIds = allHeaderNotifications.map((notification) => notification.id);
    if (notificationIds.length === 0) return;

    setDismissedNotificationIdsByEmployee((current) => ({
      ...current,
      [activeEmployeeId]: Array.from(new Set([
        ...(current[activeEmployeeId] ?? []),
        ...notificationIds,
      ])).slice(-500),
    }));
  }

  function openTimeOffRequestFromNotification(requestId: number) {
    const request = (state.ptoRequests ?? []).find((item) => item.id === requestId);
    if (!request) return;

    setIsNotificationsOpen(false);
    navigateToView("time_off");
    setHighlightedPtoRequestId(requestId);

    if (request.status !== "pending") {
      setIsViewingPtoHistory(true);
      setPtoHistoryMonth(`${request.startDate.slice(0, 7)}-01`);
      setPtoHistoryStatusFilter("all");
      setPtoHistoryEmployeeId("all");
      setArePtoRequestsExpanded(true);
      return;
    }

    setIsViewingPtoHistory(false);
  }

  function openEventFromNotification(eventTargetId: string) {
    const eventIndex = eventHistoryItems.findIndex((item) => (
      item.kind === "clock"
        ? `clock-${item.event.id}` === eventTargetId
        : item.alert.eventTargetId === eventTargetId
    ));
    if (eventIndex < 0) return;

    setIsNotificationsOpen(false);
    navigateToView("clockins");
    if (eventIndex >= 10) setAreEventsExpanded(true);
    setHighlightedEventTargetId(eventTargetId);
  }

  function dismissModalFromBackdrop(event: ReactMouseEvent<HTMLDivElement>, dismiss: () => void) {
    if (event.target === event.currentTarget) dismiss();
  }

  function openNativeDatePicker(event: ReactMouseEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
    } catch {
      // The input remains usable for browsers that restrict programmatic pickers.
    }
  }

  function startEditingConversationName(conversation: TeamConversation) {
    if (conversation.participantIds.length <= 2 || conversation.creatorEmployeeId !== activeEmployeeId) return;
    setEditingConversationNameId(conversation.id);
    setConversationNameDraft(conversation.name ?? "");
  }

  async function saveConversationName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingConversationNameId === null) return;

    const name = conversationNameDraft.trim();
    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) => (
        conversation.id === editingConversationNameId && conversation.creatorEmployeeId === activeEmployeeId
          ? { ...conversation, name: name || undefined }
          : conversation
      )),
    }))) return;
    setEditingConversationNameId(null);
    setConversationNameDraft("");
  }

  async function toggleConversationPinned(conversationId: number) {
    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const pinnedByEmployeeIds = conversation.pinnedByEmployeeIds ?? [];
        return {
          ...conversation,
          pinnedByEmployeeIds: pinnedByEmployeeIds.includes(activeEmployeeId)
            ? pinnedByEmployeeIds.filter((employeeId) => employeeId !== activeEmployeeId)
            : [...pinnedByEmployeeIds, activeEmployeeId],
        };
      }),
    }))) return;
    setConversationMenuId(null);
  }

  async function toggleConversationMuted(conversationId: number) {
    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const mutedByEmployeeIds = conversation.mutedByEmployeeIds ?? [];
        return {
          ...conversation,
          mutedByEmployeeIds: mutedByEmployeeIds.includes(activeEmployeeId)
            ? mutedByEmployeeIds.filter((employeeId) => employeeId !== activeEmployeeId)
            : [...mutedByEmployeeIds, activeEmployeeId],
        };
      }),
    }))) return;
    setConversationMenuId(null);
  }

  async function deleteConversation(conversationId: number) {
    if (!window.confirm("Archive this conversation? Its history will be preserved on the server.")) return;

    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).filter(
        (conversation) => conversation.id !== conversationId,
      ),
    }))) return;
    setSelectedConversationId((selectedId) => (
      selectedId === conversationId ? null : selectedId
    ));
    setViewingConversationInfoId((infoId) => (infoId === conversationId ? null : infoId));
    setConversationMenuId(null);
  }

  function messagePtoRequestEmployee() {
    if (!scheduleEnforcement.enableTeamMessaging) return;
    if (!reviewingPtoRequest || mode !== "manager") return;

    const employeeId = reviewingPtoRequest.employeeId;
    const employee = employeeById(state.employees, employeeId);
    const pretypedMessage = `Hi ${employee?.name.split(" ")[0] ?? "there"}, I have a question about your time off request.`;
    const directConversation = (state.conversations ?? []).find((conversation) => (
      conversation.participantIds.length === 2
      && conversation.participantIds.includes(activeEmployeeId)
      && conversation.participantIds.includes(employeeId)
    ));
    setPtoReviewError("");
    setIsNotificationsOpen(false);
    setIsAccountMenuOpen(false);
    setIsMessagesOpen(true);
    setIsPtoMessageContext(true);

    if (directConversation) {
      setMessageDraft(pretypedMessage);
      openConversation(directConversation.id, true);
      return;
    }

    setSelectedConversationId(null);
    setIsCreatingConversation(true);
    setPtoMessageEmployeeId(employeeId);
    setNewConversationMemberIds([employeeId]);
    setNewConversationMessage(pretypedMessage);
    setMessageError("");
  }

  function toggleConversationMember(employeeId: number) {
    setNewConversationMemberIds((selected) =>
      selected.includes(employeeId)
        ? selected.filter((id) => id !== employeeId)
        : [...selected, employeeId],
    );
  }

  async function createTeamConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scheduleEnforcement.enableTeamMessaging) {
      setMessageError("Messaging is disabled in location settings.");
      return;
    }
    const body = newConversationMessage.trim();
    const recipientIds = ptoMessageEmployeeId === null
      ? newConversationMemberIds
      : [ptoMessageEmployeeId];
    if (recipientIds.length === 0) {
      setMessageError("Select at least one team member.");
      return;
    }
    if (!body) {
      setMessageError("Enter a message to start the chat.");
      return;
    }

    const existingDirectConversation = ptoMessageEmployeeId === null
      ? undefined
      : (state.conversations ?? []).find((conversation) => (
          conversation.participantIds.length === 2
          && conversation.participantIds.includes(activeEmployeeId)
          && conversation.participantIds.includes(ptoMessageEmployeeId)
        ));
    const sentAt = new Date().toISOString();

    if (existingDirectConversation) {
      if (!await setState((current) => ({
        ...current,
        conversations: (current.conversations ?? []).map((conversation) => (
          conversation.id === existingDirectConversation.id
            ? {
                ...conversation,
                messages: [...conversation.messages, {
                  id: nextId(conversation.messages),
                  senderEmployeeId: activeEmployeeId,
                  body,
                  sentAt,
                  readByEmployeeIds: [activeEmployeeId],
                }],
              }
            : conversation
        )),
      }))) return;
      setNewConversationMemberIds([]);
      setPtoMessageEmployeeId(null);
      setNewConversationMessage("");
      setMessageError("");
      setIsCreatingConversation(false);
      setSelectedConversationId(existingDirectConversation.id);
      return;
    }

    const conversationId = nextId(state.conversations ?? []);
    const conversation: TeamConversation = {
      id: conversationId,
      creatorEmployeeId: activeEmployeeId,
      participantIds: Array.from(new Set([activeEmployeeId, ...recipientIds])),
      messages: [{
        id: nextId([]),
        senderEmployeeId: activeEmployeeId,
        body,
        sentAt,
        readByEmployeeIds: [activeEmployeeId],
      }],
    };
    if (!await setState((current) => ({
      ...current,
      conversations: [...(current.conversations ?? []), conversation],
    }))) return;
    setNewConversationMemberIds([]);
    setPtoMessageEmployeeId(null);
    setNewConversationMessage("");
    setMessageError("");
    setIsCreatingConversation(false);
    setSelectedConversationId(conversationId);
  }

  async function sendTeamMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scheduleEnforcement.enableTeamMessaging) {
      setMessageError("Messaging is disabled in location settings.");
      return;
    }
    const body = messageDraft.trim();
    if (!selectedConversation || !body) return;

    if (!await setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) =>
        conversation.id === selectedConversation.id
          ? {
              ...conversation,
              messages: [...conversation.messages, {
                id: nextId(conversation.messages),
                senderEmployeeId: activeEmployeeId,
                body,
                sentAt: new Date().toISOString(),
                readByEmployeeIds: [activeEmployeeId],
              }],
            }
          : conversation,
      ),
    }))) return;
    setMessageDraft("");
    window.requestAnimationFrame(() => messageComposerRef.current?.focus());
  }

  function updateBasicInfo(field: BasicInfoField, value: string) {
    const nextValue = field === "locationPhone" || field === "companyPhone"
      ? formatPhoneNumberInput(value)
      : value;
    setBasicInfo((current) => ({ ...current, [field]: nextValue }));
  }

  async function saveScheduleEnforcement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scheduleEnforcementDraft.scheduleEndHour <= scheduleEnforcementDraft.scheduleStartHour) { setScheduleEnforcementMessage("Choose an end time after the start time."); return; }
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, scheduleEnforcementFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setScheduleEnforcementMessage(ok ? "Schedule settings saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  async function saveAlertsPermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, alertsPermissionsFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setAlertsPermissionsMessage(ok ? "Alerts and permissions saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  function canEditScheduleRole(role: string, current = state) {
    return shared.data.permissions["schedule.manage"] && current.departments.some(department => department.roles.includes(role.trim()));
  }

  async function saveEventsTrades(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, eventsTradesFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setEventsTradesMessage(ok ? "Events settings saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  async function saveOvertime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, overtimeFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setOvertimeMessage(ok ? "Overtime settings saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  async function saveBreaksCompliance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, breaksComplianceFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setBreaksComplianceMessage(ok ? "Break settings saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  async function saveMessagesSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = normalizeScheduleEnforcement(schedulingSettingsForSave(scheduleEnforcement, scheduleEnforcementDraft, messagesSettingsFields));
    const ok = await shared.save([{ entity: "settings", id: 1, before: { ...scheduleEnforcement, hoursRoundingMinutes: state.hoursRoundingMinutes }, after: { ...saved, hoursRoundingMinutes: state.hoursRoundingMinutes } }]);
    setMessagesSettingsMessage(ok ? "Messages settings saved." : "Settings were not confirmed. Check the shared-data message above.");
  }

  function openScheduleEvent(date: string, event?: ScheduleEvent) {
    if (!scheduleEnforcement.enableScheduleEvents || !canViewScheduleEvents) return;
    if (!event && mode !== "manager") return;
    setScheduleEventDraft(event ?? { id: 0, date, title: "", notes: "" });
  }

  async function saveScheduleEvent(event: ScheduleEvent) {
    if (mode !== "manager" || !scheduleEnforcement.enableScheduleEvents || !validEventDate(event.date) || !event.title.trim()) return;
    if (!await setState(current => ({ ...current, scheduleEvents: [
      ...current.scheduleEvents.filter(saved => saved.id !== event.id),
      { ...event, id: event.id || nextId(current.scheduleEvents), title: event.title.trim().slice(0, 100), notes: event.notes.trim().slice(0, 500) },
    ] }))) return;
    setScheduleEventDraft(null);
  }

  async function deleteScheduleEvent(id: number) {
    if (mode !== "manager" || !scheduleEnforcement.enableScheduleEvents) return;
    if (!await setState(current => ({ ...current, scheduleEvents: current.scheduleEvents.filter(event => event.id !== id) }))) return;
    setScheduleEventDraft(null);
  }

  function scheduleEventList(date: string) {
    return <ScheduleEventList
      events={scheduleEventsForDate(state.scheduleEvents, date, scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents)}
      date={date}
      canAdd={mode === "manager"}
      onOpen={openScheduleEvent}
    />;
  }

  async function saveBasicInfo() {
    const ok = await shared.save([{ entity: "business", id: 1, before: shared.data.basicInfo, after: basicInfo }]);
    if (ok) setEditingBasicInfoField(null);
  }

  function openAddLocationModal() {
    setNewLocationDrafts([emptyNewLocationDraft()]);
    setNewLocationError("");
    setIsAddingLocation(true);
  }

  function closeAddLocationModal() {
    setNewLocationDrafts([emptyNewLocationDraft()]);
    setNewLocationError("");
    setIsAddingLocation(false);
  }

  function updateNewLocationDraft(index: number, field: keyof NewLocationDraft, value: string) {
    setNewLocationDrafts((locations) => locations.map((location, locationIndex) => (
      locationIndex === index ? { ...location, [field]: value } : location
    )));
    setNewLocationError("");
  }

  function addAnotherLocationDraft() {
    setNewLocationDrafts((locations) => (
      locations.length < maximumNewLocations
        ? [...locations, emptyNewLocationDraft()]
        : locations
    ));
  }

  function addCompanyLocations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewLocationError("This workspace supports the agreed single location. Additional locations are a later feature.");
  }

  async function endSession(everywhere: boolean) {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setAuthMessage("");
    try {
      const response = await fetch(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error();
      setIsUnlocked(false);
      window.location.replace("/login");
    } catch { setAuthMessage("Could not sign out. Please try again."); }
    finally { setIsSigningOut(false); }
  }

  async function signOut() { await endSession(false); }
  async function signOutEverywhere() { await endSession(true); }

  function navigateToView(view: ViewId) {
    if (!viewIsAllowed(view)) return;
    setIsTimesheetSummary(false);
    setScheduleEventDraft(null);
    if (view !== activeView) {
      setRosterSearch("");
      setShowTerminatedEmployees(false);
      setIsRosterFilterOpen(false);
      setRosterAccessFilter("");
      setRosterRoleFilter("");
      setRosterMissingFilter("");
    }
    setScheduleTimeOffRequestId(null);
    setSchedulePermissionError("");
    setIsViewingPtoHistory(false);
    setIsPtoHistoryEmployeeFilterOpen(false);
    setArePtoRequestsExpanded(false);
    setIsViewingPtoPolicies(false);
    setPtoRequestForm(null);
    setPtoRequestError("");
    setReviewingPtoRequestId(null);
    setPtoReviewError("");
    setPtoPolicyForm(null);
    setPtoPolicyStep("details");
    setPtoPolicyError("");
    setEditingPtoPolicyId(null);
    setEditingHours(null);
    setShowHoursChangeWarning(false);
    setEditingShift(null);
    setEditShiftError("");
    setEditingBasicInfoField(null);
    if (view === "schedule") {
      setEmployeeScheduleTab("week");
      setScheduleDate(today);
    }
    if (view === "hours") {
      setActiveHoursTab("today");
      setHoursDate(today);
    }
    if (view === "employees") {
      setViewingRosterEmployeeId(null);
      setTeamMemberProfileTab("job");
      setEditingPayrollEmployeeId(null);
    }
    if (view === "settings") setActiveSettingsTab("Basic info");
    setIsTeamNavOpen(view === "employees" || view === "departments_roles");
    setIsScheduleNavOpen(["schedule", "time_off", "my_availability", "team_availability"].includes(view));
    setActiveView(view);
    setIsAccountMenuOpen(false);
  }



  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = [employeeForm.firstName.trim(), employeeForm.lastName.trim()].filter(Boolean).join(" ");
    const role = employeeForm.role.trim();
    if (!name || !employeeForm.email.trim() || !employeeForm.phone.trim() || !role) return;
    if (hasEmployeeWithName(state.employees, name, editingEmployeeId ?? undefined)) { setEmployeeMessage("Name already in use."); return; }
    if (!await setState(current => {
      const saved = current.employees.find(employee => employee.id === editingEmployeeId);
      const employee: Employee = { ...(saved ?? {
        id: nextId(current.employees), active: employeeForm.active, terminated: false, startDate: today,
        payrollId: "", payrollClassification: "W-2 Employee", dateOfBirth: "", socialSecurityNumber: "", homeAddress: "", homeCityStateZip: "", emergencyContact: "", emergencyContactPreference: "",
        locationSettings: defaultEmployeeLocationSettings(), employmentHistory: [], certificates: [], onboardingDocuments: {}, managerNotes: [],
      }), name, email: employeeForm.email.trim(), phone: formatPhoneNumberInput(employeeForm.phone),
        accessLevel: saved?.accessLevel ?? "Employee", location: savedBasicInfo.locationName, role,
        wage: shared.data.permissions["wages.manage"] ? formatWageInput(employeeForm.wage) : saved?.wage ?? "", pin: "" };
      return { ...current, employees: saved ? current.employees.map(row => row.id === saved.id ? employee : row) : [...current.employees, employee] };
    })) return;
    setEmployeeForm({ ...emptyEmployeeForm, location: savedBasicInfo.locationName, wage: shared.data.permissions["wages.manage"] ? emptyEmployeeForm.wage : "" }); setIsAddingEmployeeRole(false); setNewEmployeeRole(""); setEmployeeMessage(""); setIsAddingEmployee(false); setEditingEmployeeId(null);
  }

  function openAddEmployeeModal() {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeMessage("");
    setIsAddingEmployeeRole(false);
    setNewEmployeeRole("");
    setIsAddingEmployee(true);
  }

  function openEditEmployeeModal(employee: Employee) {
    const [firstName = "", ...lastNameParts] = employee.name.trim().split(/\s+/);
    setEditingEmployeeId(employee.id);
    setEmployeeForm({
      firstName,
      lastName: lastNameParts.join(" "),
      email: employee.email,
      phone: employee.phone,
      location: employee.location,
      role: employee.role,
      wage: employee.wage,
      pin: employee.pin,
      accessLevel: employee.accessLevel || "Employee",
      active: employee.active,
    });
    setEmployeeMessage("");
    setIsAddingEmployeeRole(false);
    setNewEmployeeRole("");
    setIsAddingEmployee(true);
  }

  function cancelAddingEmployee() {
    setEmployeeForm(emptyEmployeeForm);
    setIsAddingEmployeeRole(false);
    setNewEmployeeRole("");
    setEmployeeMessage("");
    setIsAddingEmployee(false);
    setEditingEmployeeId(null);
  }

  async function addRoleFromEmployeeForm() {
    const requestedRole = newEmployeeRole.trim();
    if (!requestedRole) return;

    const existingRole = availableRoles.find(
      (role) => role.toLocaleLowerCase() === requestedRole.toLocaleLowerCase(),
    );
    const role = existingRole ?? requestedRole;

    if (!existingRole) {
      if (!await setState((current) => {
        const fallbackDepartment = current.departments.find(
          (department) => department.name.trim().toLocaleLowerCase() === "department not set",
        ) ?? current.departments[0];

        if (!fallbackDepartment) {
          return {
            ...current,
            departments: [{ id: 1, name: "Department not set", roles: [role], managerIds: [] }],
          };
        }

        return {
          ...current,
          departments: current.departments.map((department) => (
            department.id === fallbackDepartment.id
              ? { ...department, roles: [...department.roles, role] }
              : department
          )),
        };
      })) return;
    }

    setEmployeeForm((form) => ({ ...form, role }));
    setNewEmployeeRole("");
    setIsAddingEmployeeRole(false);
  }

  async function addDepartment() {
    const name = newDepartmentName.trim();
    if (name) {
      if (!await setState((current) => ({
        ...current,
        departments: [
          ...current.departments,
          { id: nextId(current.departments), name, roles: [], managerIds: [] },
        ],
      }))) return;
    }
    setNewDepartmentName("");
    setIsAddingDepartment(false);
  }

  async function addDepartmentRole(departmentId: number) {
    const role = (departmentRoleDrafts[departmentId] ?? "").trim();
    if (role) {
      if (!await setState((current) => ({
        ...current,
        departments: current.departments.map((department) => (
          department.id === departmentId && !department.roles.some((savedRole) => savedRole.toLowerCase() === role.toLowerCase())
            ? { ...department, roles: [...department.roles, role] }
            : department
        )),
      }))) return;
    }
    setDepartmentRoleDrafts((current) => ({ ...current, [departmentId]: "" }));
  }

  function startEditingDepartment(department: Department) {
    setEditingDepartmentId(department.id);
    setDepartmentNameDraft(department.name === "Department not set" ? "" : department.name);
  }

  async function saveDepartmentName(departmentId: number) {
    const name = departmentNameDraft.trim() || "Department not set";
    if (!await setState((current) => ({
      ...current,
      departments: current.departments.map((department) => (
        department.id === departmentId ? { ...department, name } : department
      )),
    }))) return;
    setEditingDepartmentId(null);
    setDepartmentNameDraft("");
  }

  async function removeDepartment(departmentId: number) {
    if (!await setState((current) => ({
      ...current,
      departments: current.departments.filter((department) => department.id !== departmentId),
    }))) return;
  }

  async function removeDepartmentRole(departmentId: number, role: string) {
    if (!await setState((current) => {
      const departments = current.departments.map((department) => (
        department.id === departmentId
          ? { ...department, roles: department.roles.filter((savedRole) => savedRole !== role) }
          : department
      ));
      const roleStillExists = departments.some((department) => department.roles.includes(role));

      return {
        ...current,
        departments,
        employees: roleStillExists
          ? current.employees
          : current.employees.map((employee) => (
              employee.role === role ? { ...employee, role: "" } : employee
            )),
      };
    })) return;
  }

  async function updateEmployeeStatus(employeeId: number, active: boolean) {
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId ? { ...employee, active } : employee
      )),
    }))) return;
  }

  async function rehireRosterEmployee(employeeId: number) {
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId
          ? {
              ...employee,
              active: true,
              terminated: false,
              employmentHistory: [
                ...(employee.employmentHistory ?? []),
                { type: "rehired", date: today },
              ],
            }
          : employee
      )),
    }))) return;
  }

  function openRosterEmployeeProfile(employeeId: number) {
    setRosterActionEmployeeId(null);
    setViewingRosterEmployeeId(employeeId);
    setTeamMemberProfileTab("job");
    setEditingEmployeeId(null);
    setEditingPayrollEmployeeId(null);
    setEditingPersonalContactEmployeeId(null);
    setEditingPersonalPayrollEmployeeId(null);
  }

  function toggleRosterActions(event: ReactMouseEvent<HTMLButtonElement>, employeeId: number) {
    if (rosterActionEmployeeId === employeeId) {
      setRosterActionEmployeeId(null);
      return;
    }
    const button = event.currentTarget;
    const bounds = button.getBoundingClientRect();
    const menuHeight = 312;
    setRosterActionPosition({
      top: Math.max(8, bounds.bottom + menuHeight + 6 <= window.innerHeight ? bounds.bottom + 6 : bounds.top - menuHeight - 6),
      left: Math.max(8, Math.min(bounds.right - 280, window.innerWidth - 288)),
    });
    rosterActionButtonRef.current = button;
    setRosterActionEmployeeId(employeeId);
    window.requestAnimationFrame(() => rosterActionMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  function viewRosterEmployeeSection(employeeId: number, tab: TeamMemberProfileTab) {
    openRosterEmployeeProfile(employeeId);
    setTeamMemberProfileTab(tab);
  }

  function openScheduleEmployeeProfile(employeeId: number) {
    if (mode !== "manager") return;
    navigateToView("employees");
    viewRosterEmployeeSection(employeeId, "personal");
  }

  function closeRosterEmployeeProfile() {
    setViewingRosterEmployeeId(null);
    setTeamMemberProfileTab("job");
    setEditingPayrollEmployeeId(null);
    setEditingPersonalPayrollEmployeeId(null);
    setEditingPersonalContactEmployeeId(null);
    setManagerNoteDraft("");
  }

  function editRosterEmployeeFromProfile(employeeId: number) {
    const employee = state.employees.find((candidate) => candidate.id === employeeId);
    if (employee) openEditEmployeeModal(employee);
  }

  function messageRosterEmployee(employeeId: number) {
    if (!scheduleEnforcement.enableTeamMessaging) return;
    if (employeeId === activeEmployeeId) return;

    const directConversation = (state.conversations ?? []).find((conversation) => (
      conversation.participantIds.length === 2
      && conversation.participantIds.includes(activeEmployeeId)
      && conversation.participantIds.includes(employeeId)
    ));

    setIsNotificationsOpen(false);
    setIsAccountMenuOpen(false);
    setIsMessagesOpen(true);
    setMessageError("");

    if (directConversation) {
      setMessageDraft("");
      openConversation(directConversation.id);
      return;
    }

    setSelectedConversationId(null);
    setIsCreatingConversation(true);
    setPtoMessageEmployeeId(employeeId);
    setNewConversationMemberIds([employeeId]);
    setNewConversationMessage("");
  }

  function startEditingPayrollClassification(employee: Employee) {
    if (!shared.data.permissions["team.manage"] || !shared.data.permissions["team.private.read"]) return;
    setPayrollClassificationDraft(employee.payrollClassification ?? "W-2 Employee");
    setEditingPayrollEmployeeId(employee.id);
  }

  async function savePayrollClassification(employeeId: number) {
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId
          ? { ...employee, payrollClassification: payrollClassificationDraft }
          : employee
      )),
    }))) return;
    setEditingPayrollEmployeeId(null);
  }

  async function saveAccountProfile(values: ProfileValues): Promise<string | null> {
    if (!activeEmployee) return "This account is not linked to an employee profile.";
    const result = profileUpdate(values, today);
    if (result.error) return result.error;
    const update = { ...result.update, phone: formatPhoneNumberInput(result.update.phone), emergencyContactPhone: formatPhoneNumberInput(result.update.emergencyContactPhone) };
    if (hasEmployeeWithName(state.employees, update.name, activeEmployeeId)) return "Name already in use.";
    const saved = await setState(current => ({ ...current, employees: current.employees.map(employee => employee.id === activeEmployeeId ? { ...employee, ...update } : employee) }));
    return saved ? null : "Profile was not saved. Check the shared-data message above.";
  }

  function accountProfilePanel() {
    if (!account.employeeId) return <section className="panel"><h3>{account.displayName}</h3><p>{account.email}</p><p>This account is not linked to an employee profile yet.</p></section>;
    if (!activeEmployee) return null;
    return <AccountProfilePanel key={activeEmployee.id}
      values={profileValues(activeEmployee)} name={activeEmployee.name}
      companyName={savedBasicInfo.companyName.trim() || sidebarLocationName}
      position={activeEmployee.role} startDate={activeEmployee.startDate}
      endDate={activeEmployee.terminated ? activeEmployee.terminationDate : undefined}
      certificates={activeEmployee.certificates ?? []} certificateError={certificateDownloadError}
      addCertificateRef={addCertificateButtonRef}
      onAddCertificate={() => openCertificateModal(activeEmployee.id)} onDownloadCertificate={downloadCertificate}
      onSave={saveAccountProfile} formatPhone={formatPhoneNumberInput}
    />;
  }

  function startEditingPersonalContact(employee: Employee) {
    setPersonalContactDraft(personalContactForm(employee));
    setPersonalContactError("");
    setEditingPersonalContactEmployeeId(employee.id);
    window.requestAnimationFrame(() => personalContactFirstNameRef.current?.focus());
  }

  async function savePersonalContact(event: FormEvent<HTMLFormElement>, employeeId: number) {
    event.preventDefault();
    if (!personalContactHasChanges || !personalContactDraft.firstName.trim()) return;
    const name = [personalContactDraft.firstName.trim(), personalContactDraft.lastName.trim()].filter(Boolean).join(" ");
    if (hasEmployeeWithName(state.employees, name, employeeId)) {
      setPersonalContactError("Name already in use.");
      return;
    }
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => employee.id === employeeId ? {
        ...employee,
        name,
        email: personalContactDraft.email.trim(),
        phone: formatPhoneNumberInput(personalContactDraft.phone),
        emergencyContact: personalContactDraft.emergencyContact.trim(),
        emergencyContactRelationship: personalContactDraft.emergencyContactRelationship.trim(),
        emergencyContactPhone: formatPhoneNumberInput(personalContactDraft.emergencyContactPhone),
        emergencyContactPreference: personalContactDraft.notifyEmergencyContact === personalContactForm(employee).notifyEmergencyContact
          ? employee.emergencyContactPreference
          : personalContactDraft.notifyEmergencyContact ? emergencyContactNotificationLabel : "Do not notify my emergency contact",
      } : employee),
    }))) return;
    setEditingPersonalContactEmployeeId(null);
    setPersonalContactError("");
  }

  function startEditingPersonalPayroll(employee: Employee) {
    setPersonalPayrollDraft(personalPayrollForm(employee));
    setEditingPersonalPayrollEmployeeId(employee.id);
    window.requestAnimationFrame(() => personalPayrollFirstNameRef.current?.focus());
  }

  async function savePersonalPayroll(event: FormEvent<HTMLFormElement>, employeeId: number) {
    event.preventDefault();
    if (!personalPayrollHasChanges || !personalPayrollDraft.legalFirstName.trim() || !personalPayrollDraft.homePostalCode.trim()) return;
    const payroll = Object.fromEntries(Object.entries(personalPayrollDraft).map(([field, value]) => [field, value.trim()])) as typeof personalPayrollDraft;
    const cityState = [payroll.homeCity, payroll.homeStateProvince].filter(Boolean).join(", ");
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId
          ? { ...employee, ...payroll, homeCityStateZip: [cityState, payroll.homePostalCode].filter(Boolean).join(" ") }
          : employee
      )),
    }))) return;
    setEditingPersonalPayrollEmployeeId(null);
  }

  function openCertificateModal(employeeId: number) {
    setCertificateDraft({ name: "", expirationDate: "" });
    setCertificateFile(null);
    setCertificateError("");
    setIsDraggingCertificate(false);
    setCertificateEmployeeId(employeeId);
    window.requestAnimationFrame(() => certificateNameRef.current?.focus());
  }

  function closeCertificateModal() {
    if (isSavingCertificate) return;
    setCertificateEmployeeId(null);
    window.requestAnimationFrame(() => addCertificateButtonRef.current?.focus());
  }

  function chooseCertificateFile(file: File | undefined) {
    if (!file) return;
    setIsDraggingCertificate(false);
    if (!/\.(gif|png|pdf|jpe?g)$/i.test(file.name)) {
      setCertificateError("Choose a GIF, PNG, PDF, or JPG/JPEG file.");
      return;
    }
    setCertificateFile(file);
    setCertificateError("");
  }

  async function uploadEmployeeCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = certificateDraft.name.trim();
    if (certificateEmployeeId === null || !name || !certificateDraft.expirationDate || isSavingCertificate) return;
    setIsSavingCertificate(true); setCertificateError("");
    try {
      const saved = certificateFile
        ? await shared.uploadDocument({ employeeId: certificateEmployeeId, kind: "certificate", title: name, expirationDate: certificateDraft.expirationDate }, certificateFile)
        : await setState(current => ({ ...current, employees: current.employees.map(employee => employee.id === certificateEmployeeId
          ? { ...employee, certificates: [...(employee.certificates ?? []), { id: nextId(employee.certificates ?? []), name, expirationDate: certificateDraft.expirationDate, fileName: "" }] } : employee) }));
      if (!saved) { setCertificateError("The save could not be confirmed. Check the message above and keep this dialog open to retry."); return; }
      setCertificateEmployeeId(null); setCertificateFile(null);
      window.requestAnimationFrame(() => addCertificateButtonRef.current?.focus());
    } finally { setIsSavingCertificate(false); }
  }

  async function downloadPrivateFile(fileId: string, fileName: string) {
    setCertificateDownloadError("");
    try {
      const response = await fetch(`/api/documents/${fileId}/download`, { cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Could not download this document."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setCertificateDownloadError(error instanceof Error ? error.message : "Could not download this document."); }
  }

  async function downloadCertificate(certificate: EmployeeCertificate) {
    if (certificate.fileId) await downloadPrivateFile(certificate.fileId, certificate.fileName);
  }

  async function uploadOnboardingDocument(employeeId: number, documentName: string, file: File | undefined) {
    if (file) await shared.uploadDocument({ employeeId, kind: "onboarding", title: documentName }, file);
  }

  async function addManagerNote(employeeId: number) {
    const text = managerNoteDraft.trim();
    if (!text) return;
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId
          ? {
              ...employee,
              managerNotes: [
                ...(employee.managerNotes ?? []),
                { id: nextId(employee.managerNotes ?? []), text, createdAt: new Date(currentTime).toISOString() },
              ],
            }
          : employee
      )),
    }))) return;
    setManagerNoteDraft("");
  }

  async function updateEmployeeLocationSetting(
    employeeId: number,
    setting: keyof EmployeeLocationSettings,
    checked: boolean,
  ) {
    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId
          ? {
              ...employee,
              locationSettings: { ...employee.locationSettings, [setting]: checked },
            }
          : employee
      )),
    }))) return;
  }

  function openTerminationFlow(employeeId: number) {
    setTerminatingEmployeeId(employeeId);
    setTerminationStep("notice");
    setTerminationReason("");
    setTerminationDate(today);
    setEligibleForRehire(true);
    setTerminationNote("");
  }

  function closeTerminationFlow() {
    setTerminatingEmployeeId(null);
    setTerminationStep("notice");
    setTerminationReason("");
    setTerminationDate(today);
    setEligibleForRehire(true);
    setTerminationNote("");
  }

  async function terminateRosterEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (terminatingEmployeeId === null || !terminationReason || !terminationDate) return;

    if (!await setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === terminatingEmployeeId
          ? {
              ...employee,
              active: false,
              terminated: true,
              terminationReason,
              terminationDate,
              eligibleForRehire,
              terminationNote: terminationNote.trim(),
              employmentHistory: [
                ...(employee.employmentHistory ?? []),
                { type: "terminated", date: terminationDate, reason: terminationReason },
              ],
            }
          : employee
      )),
    }))) return;
    setTerminationStep("success");
  }

  async function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditScheduleRole(shiftForm.role)) {
      setCreateShiftError("You can only create shifts for roles in your assigned departments.");
      return;
    }
    if (!shiftEmployeeIds.has(shiftForm.employeeId) || !shiftForm.date || !shiftForm.role.trim()) {
      setCreateShiftError("Date, clock-in time, clock-out time, and role are required.");
      return;
    }
    if (createShiftWeekdays.length === 0) {
      setCreateShiftError("Choose at least one day to apply this shift to.");
      return;
    }

    const start = shiftForm.shiftType === "day_off" ? "00:00" : parseTypedTime(shiftForm.start);
    const end = shiftForm.shiftType === "day_off" ? "00:00" : parseTypedTime(shiftForm.end);
    if (!start || !end) {
      setCreateShiftError("Enter a valid start and end time.");
      return;
    }
    const startMinutes = timeToMinutes(start); const endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null || (isWorkShift(shiftForm) && startMinutes >= endMinutes)) {
      setCreateShiftError("Start time must be earlier than end time.");
      return;
    }

    const shiftDates = shiftDatesForWeekdays(shiftForm.date, createShiftWeekdays, scheduleEnforcement.workWeekStart);
    const layoutError = shiftLayoutError([
      ...workingScheduleShifts.filter(shift => shift.id !== shiftForm.id),
      ...shiftDates.map((date, index) => ({ ...shiftForm, id: -index - 1, date, start, end })),
    ]);
    if (layoutError) { setCreateShiftError(layoutError); return; }
    const firstCreatedShiftId = nextScheduleShiftId(state);
    const createdShiftIds = shiftForm.id
      ? []
      : shiftDates.map((_, index) => firstCreatedShiftId + index);

    if (!await setState((current) => {
      const currentDraft = current.scheduleDraftsByManager?.[activeEmployeeId];
      const currentWorkingShifts = applyScheduleDraft(current.shifts, currentDraft);
      const previousEmployeeId = shiftForm.id
        ? currentWorkingShifts.find((shift) => shift.id === shiftForm.id)?.employeeId
        : undefined;
      const savedShifts = shiftDates.map((date, index) => ({
        ...shiftForm,
        date,
        start,
        end,
        role: shiftForm.role.trim(),
        notes: shiftForm.notes.trim(),
        id: shiftForm.id || firstCreatedShiftId + index,
      }));
      const affectedEmployeeIds = [previousEmployeeId, shiftForm.employeeId]
        .filter((employeeId): employeeId is number => typeof employeeId === "number");
      const scheduleDraft = mergeScheduleDraft(
        current.shifts,
        currentDraft,
        shiftForm.id ? [savedShifts[0]] : savedShifts,
        [],
        affectedEmployeeIds,
      );

      return {
        ...current,
        scheduleDraftsByManager: {
          ...(current.scheduleDraftsByManager ?? {}),
          [activeEmployeeId]: scheduleDraft,
        },
      };
    })) return;
    if (createdShiftIds.length > 0) {
      const createdAt = Date.now();
      setCreatedShiftTimes((current) => ({
        ...current,
        ...Object.fromEntries(createdShiftIds.map((id) => [id, createdAt])),
      }));
    }
    setCreateShiftError("");
    setIsAddingShift(false);
    setShiftForm({
      id: 0,
      employeeId: 0,
      date: scheduleDate,
      start: "",
      end: "",
      role: "",
      station: "Floor",
      notes: "",
    });
    setCreateShiftWeekdays([]);
  }

  function openShiftCreator(employee: Employee, date: string) {
    if (mode !== "manager") return;
    setCreateShiftError("");
    setShiftForm({
      id: 0,
      employeeId: employee.id,
      date,
      start: "",
      end: "",
      role: employee.role || "",
      station: "Floor",
      notes: "",
      ...(copiedShift ? { start: copiedShift.start, end: copiedShift.end, role: copiedShift.role, shiftType: copiedShift.shiftType, color: copiedShift.color, notes: shared.data.permissions["schedule.notes.manage"] ? copiedShift.notes ?? "" : "" } : {}),
    });
    setCreateShiftWeekdays([weekdayForDate(date)]);
    setIsAddingShift(true);
  }

  function openMonthShiftCreator(date: string) {
    if (mode !== "manager") return;
    setCreateShiftError("");
    setShiftForm({
      id: 0,
      employeeId: copiedShift?.employeeId ?? 0,
      date,
      start: "",
      end: "",
      role: "",
      station: "Floor",
      notes: "",
      ...(copiedShift ? { start: copiedShift.start, end: copiedShift.end, role: copiedShift.role, shiftType: copiedShift.shiftType, color: copiedShift.color, notes: shared.data.permissions["schedule.notes.manage"] ? copiedShift.notes ?? "" : "" } : {}),
    });
    setCreateShiftWeekdays([weekdayForDate(date)]);
    setIsAddingShift(true);
  }

  function toggleCreateShiftWeekday(weekday: number) {
    setCreateShiftWeekdays((weekdays) => (
      weekdays.includes(weekday)
        ? (weekdays.length > 1 ? weekdays.filter((day) => day !== weekday) : weekdays)
        : [...weekdays, weekday]
    ));
  }

  function toggleEditingShiftWeekday(weekday: number) {
    if (!editingShift || weekday === weekdayForDate(editingShift.date)) return;
    setEditingShiftWeekdays((weekdays) => (
      weekdays.includes(weekday)
        ? weekdays.filter((day) => day !== weekday)
        : [...weekdays, weekday]
    ));
  }

  function moveScheduleDate(direction: -1 | 1) {
    const nextDate = parseLocalDate(scheduleDate);
    if (employeeScheduleTab === "month") nextDate.setMonth(nextDate.getMonth() + direction);
    else nextDate.setDate(nextDate.getDate() + direction * (employeeScheduleTab === "week" ? 7 : 1));
    setScheduleDate(toDateInputValue(nextDate));
  }

  async function setHoursRoundingPolicy() {
    if (!activeUserIsAdmin || hoursRounding === "actual") return;

    if (!await setState((current) => ({
      ...current,
      hoursRoundingMinutes: hoursRounding,
    }))) return;
  }

  async function saveTimeCard(draft: TimeCardDraft) {
    if (mode !== "manager") return false;
    return await setState((current) => {
      if (!current.employees.some((employee) => employee.id === draft.employeeId)) return current;
      if (validateTimeCard(draft, current.clockEvents, Date.now())) return current;
      const originalEvents = current.clockEvents.filter((event) => draft.eventIds.includes(event.id));
      const description = (events: ClockEvent[]) => events.map((event) => `${event.type}: ${formatDateTime(event.at)}${event.explanation ? ` (${event.explanation})` : ""}`).join("; ");
      const updatedEvents = timeCardEvents({ ...draft, note: draft.note || originalEvents.find((event) => event.explanation)?.explanation || "" }, nextId(current.clockEvents));
      return {
        ...current,
        clockEvents: [...current.clockEvents.filter((event) => !draft.eventIds.includes(event.id)), ...updatedEvents],
        timeCardEdits: [...(current.timeCardEdits ?? []), {
          id: nextId(current.timeCardEdits ?? []), employeeId: draft.employeeId, date: draft.date,
          at: new Date().toISOString(), actor: account.displayName, cardId: updatedEvents[0].cardId,
          before: description(originalEvents), after: description(updatedEvents),
        }],
      };
    });
  }

  function editWorkedHours(employee: Employee, displayedHours: number) {
    const totalMinutes = Math.round(displayedHours * 60);
    setEditingHours({
      employee,
      hours: String(Math.floor(totalMinutes / 60)),
      minutes: String(totalMinutes % 60),
    });
    setShowHoursChangeWarning(false);
  }

  function openPtoPolicy() {
    setEditingPtoPolicyId(null);
    setPtoPolicyForm({
      name: "",
      method: "rate",
      fixedHours: "120",
      earnedHours: "1",
      workedHours: "30",
      employeeIds: [],
      startingBalances: {},
    });
    setPtoPolicyStep("details");
    setPtoPolicyError("");
  }

  function editPtoPolicy(policy: PtoPolicy) {
    setEditingPtoPolicyId(policy.id);
    setPtoPolicyForm({
      name: policy.name,
      method: policy.method,
      fixedHours: String(policy.fixedHours || 120),
      earnedHours: String(policy.earnedHours || 1),
      workedHours: String(policy.workedHours || 30),
      employeeIds: [...policy.employeeIds],
      startingBalances: Object.fromEntries(policy.employeeIds.map((employeeId) => [
        employeeId,
        {
          startDate: policy.startingBalances?.[employeeId]?.startDate ?? today,
          balance: String(policy.startingBalances?.[employeeId]?.balance ?? 0),
        },
      ])),
    });
    setPtoPolicyStep("details");
    setPtoPolicyError("");
    setIsViewingPtoPolicies(false);
  }

  function closePtoPolicyEditor() {
    setPtoPolicyForm(null);
    setEditingPtoPolicyId(null);
    setPtoPolicyStep("details");
    setPtoPolicyError("");
  }

  function cancelPtoPolicyEditor() {
    const wasEditingSavedPolicy = editingPtoPolicyId !== null;
    closePtoPolicyEditor();
    if (wasEditingSavedPolicy) setIsViewingPtoPolicies(true);
  }

  async function deletePtoPolicy(policy: PtoPolicy) {
    if (!window.confirm(`Delete ${policy.name}? Employees assigned to it will no longer earn PTO through this policy.`)) return;

    if (!await setState((current) => ({
      ...current,
      ptoPolicies: (current.ptoPolicies ?? []).filter((item) => item.id !== policy.id),
    }))) return;
  }

  function continuePtoPolicy() {
    if (!ptoPolicyForm) return;
    if (!ptoPolicyForm.name.trim()) {
      setPtoPolicyError("Enter a name for this policy.");
      return;
    }

    const fixedHours = Number(ptoPolicyForm.fixedHours);
    const earnedHours = Number(ptoPolicyForm.earnedHours);
    const workedHours = Number(ptoPolicyForm.workedHours);
    if (ptoPolicyForm.method === "fixed" && (!Number.isFinite(fixedHours) || fixedHours <= 0)) {
      setPtoPolicyError("Enter a fixed number of PTO hours greater than zero.");
      return;
    }
    if (ptoPolicyForm.method === "rate" && (
      !Number.isFinite(earnedHours) || earnedHours <= 0 || !Number.isFinite(workedHours) || workedHours <= 0
    )) {
      setPtoPolicyError("Enter valid earned and worked hour amounts greater than zero.");
      return;
    }

    setPtoPolicyError("");
    setPtoPolicyStep("employees");
  }

  function togglePtoPolicyEmployee(employeeId: number) {
    setPtoPolicyForm((form) => form ? {
      ...form,
      employeeIds: form.employeeIds.includes(employeeId)
        ? form.employeeIds.filter((id) => id !== employeeId)
        : [...form.employeeIds, employeeId],
    } : form);
  }

  function continuePtoPolicyEmployees() {
    if (!ptoPolicyForm) return;
    if (ptoPolicyForm.employeeIds.length === 0) {
      setPtoPolicyError("Select at least one employee for this policy.");
      return;
    }

    setPtoPolicyForm((form) => form ? {
      ...form,
      startingBalances: Object.fromEntries(form.employeeIds.map((employeeId) => [
        employeeId,
        form.startingBalances[employeeId] ?? { startDate: today, balance: "0" },
      ])),
    } : form);
    setPtoPolicyError("");
    setPtoPolicyStep("balances");
  }

  async function savePtoPolicy() {
    if (!ptoPolicyForm) return;
    if (ptoPolicyForm.employeeIds.length === 0) {
      setPtoPolicyError("Select at least one employee for this policy.");
      return;
    }
    const hasInvalidStartingBalance = ptoPolicyForm.employeeIds.some((employeeId) => {
      const startingBalance = ptoPolicyForm.startingBalances[employeeId];
      return !startingBalance?.startDate || !Number.isFinite(Number(startingBalance.balance));
    });
    if (hasInvalidStartingBalance) {
      setPtoPolicyError("Enter a start date and valid starting balance for every selected employee.");
      return;
    }

    const editedPolicyId = editingPtoPolicyId;
    if (!await setState((current) => {
      const selectedIds = new Set(ptoPolicyForm.employeeIds);
      const existingPolicies = (current.ptoPolicies ?? [])
        .filter((policy) => policy.id !== editedPolicyId)
        .map((policy) => {
          const employeeIds = policy.employeeIds.filter((employeeId) => !selectedIds.has(employeeId));
          return {
            ...policy,
            employeeIds,
            startingBalances: Object.fromEntries(employeeIds.map((employeeId) => [
              employeeId,
              policy.startingBalances?.[employeeId] ?? { startDate: today, balance: 0 },
            ])),
          };
        })
        .filter((policy) => policy.employeeIds.length > 0);
      const newPolicy: PtoPolicy = {
        id: editedPolicyId ?? nextId(current.ptoPolicies ?? []),
        name: ptoPolicyForm.name.trim(),
        method: ptoPolicyForm.method,
        fixedHours: ptoPolicyForm.method === "fixed" ? Number(ptoPolicyForm.fixedHours) : 0,
        earnedHours: ptoPolicyForm.method === "rate" ? Number(ptoPolicyForm.earnedHours) : 0,
        workedHours: ptoPolicyForm.method === "rate" ? Number(ptoPolicyForm.workedHours) : 0,
        employeeIds: ptoPolicyForm.employeeIds,
        startingBalances: Object.fromEntries(ptoPolicyForm.employeeIds.map((employeeId) => [
          employeeId,
          {
            startDate: ptoPolicyForm.startingBalances[employeeId].startDate,
            balance: Number(ptoPolicyForm.startingBalances[employeeId].balance),
          },
        ])),
      };

      return { ...current, ptoPolicies: [...existingPolicies, newPolicy] };
    })) return;
    closePtoPolicyEditor();
    if (editedPolicyId !== null) setIsViewingPtoPolicies(true);
  }

  function openPtoRequest() {
    setPtoRequestForm({
      compensation: "paid",
      startDate: today,
      endDate: today,
      reason: "",
      explanation: "",
    });
    setPtoRequestError("");
  }

  async function submitPtoRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ptoRequestForm || !activeEmployee) return;

    if (!ptoRequestForm.reason) {
      setPtoRequestError("Choose Sick/Emergency or Vacation.");
      return;
    }
    if (ptoRequestForm.endDate < ptoRequestForm.startDate) {
      setPtoRequestError("The end date cannot be before the start date.");
      return;
    }
    const requestedPtoHours = ptoHoursForDateRange(
      ptoRequestForm.startDate,
      ptoRequestForm.endDate,
    );
    if (requestedPtoHours <= 0) {
      setPtoRequestError("Choose at least one valid day for time off.");
      return;
    }
    const employeePto = ptoRows.find((row) => row.employee.id === activeEmployee.id);
    const ptoHoursLeft = employeePto ? employeePto.ptoHours - employeePto.ptoUsed : 0;
    if (ptoRequestForm.compensation === "paid" && ptoHoursLeft < requestedPtoHours) {
      setPtoRequestError("You do not have enough PTO hours. You cannot submit this request.");
      return;
    }
    const explanation = ptoRequestForm.explanation.trim();
    const requestedAt = new Date().toISOString();
    const autoApproved = activeEmployee.accessLevel === "Admin";
    const initialStatus: PtoRequest["status"] = autoApproved ? "approved" : "pending";

    if (!await setState((current) => ({
      ...current,
      ptoRequests: [
        ...(current.ptoRequests ?? []),
        {
          id: nextId(current.ptoRequests ?? []),
          employeeId: activeEmployee.id,
          compensation: ptoRequestForm.compensation,
          startDate: ptoRequestForm.startDate,
          endDate: ptoRequestForm.endDate,
          reason: ptoRequestForm.reason as PtoRequest["reason"],
          explanation,
          status: initialStatus,
          requestedAt,
          decidedAt: autoApproved ? requestedAt : undefined,
          decidedByEmployeeId: autoApproved ? activeEmployee.id : undefined,
        },
      ],
    }))) return;
    setPtoRequestForm(null);
    setPtoRequestError("");
  }

  async function decidePtoRequest(status: "approved" | "denied") {
    if (reviewingPtoRequestId === null || mode !== "manager") return;

    const request = (state.ptoRequests ?? []).find((entry) => entry.id === reviewingPtoRequestId);
    if (!request || request.status === "cancelled") return;
    if (request.employeeId === activeEmployeeId) {
      setPtoReviewError("You cannot approve or deny your own time off request.");
      return;
    }
    if (status === "approved" && request.status !== "approved" && request.compensation !== "unpaid") {
      const employeePto = ptoRows.find((row) => row.employee.id === request.employeeId);
      const ptoHoursLeft = employeePto ? employeePto.ptoHours - employeePto.ptoUsed : 0;
      const requestedHours = ptoHoursForDateRange(
        request.startDate,
        request.endDate,
      );
      if (ptoHoursLeft < requestedHours) {
        setPtoReviewError(
          `This employee does not have enough PTO hours. They have ${formatPtoHours(ptoHoursLeft)} left, but this request uses ${formatPtoHours(requestedHours)}.`,
        );
        return;
      }
    }

    if (!await setState((current) => ({
      ...current,
      ptoRequests: (current.ptoRequests ?? []).map((request) =>
        request.id === reviewingPtoRequestId
          ? {
              ...request,
              status,
              decidedAt: new Date().toISOString(),
              decidedByEmployeeId: activeEmployeeId,
            }
          : request,
      ),
    }))) return;
    setReviewingPtoRequestId(null);
    setPtoReviewError("");
  }

  async function cancelPtoRequest(requestId: number) {
    const cancelledAt = new Date().toISOString();
    if (!await setState((current) => ({
      ...current,
      ptoRequests: (current.ptoRequests ?? []).map((request) =>
        request.id === requestId
        && request.employeeId === activeEmployeeId
        && request.status === "pending"
          ? {
              ...request,
              status: "cancelled",
              decidedAt: cancelledAt,
              decidedByEmployeeId: activeEmployeeId,
            }
          : request,
      ),
    }))) return;
  }

  async function deletePtoRequest(requestId: number) {
    if (mode !== "manager") return;
    if (!window.confirm("Delete this time off request? This cannot be undone.")) return;

    if (!await setState((current) => ({
      ...current,
      ptoRequests: (current.ptoRequests ?? []).filter((request) => request.id !== requestId),
    }))) return;
    if (reviewingPtoRequestId === requestId) setReviewingPtoRequestId(null);
    if (scheduleTimeOffRequestId === requestId) setScheduleTimeOffRequestId(null);
  }

  function openScheduleTimeOff(event: ReactMouseEvent<HTMLButtonElement>, request: PtoRequest) {
    if (isPublicSchedule || (mode !== "manager" && request.employeeId !== activeEmployeeId)) return;
    if (scheduleTimeOffRequestId === request.id) { setScheduleTimeOffRequestId(null); return; }
    const button = event.currentTarget;
    const bounds = button.getBoundingClientRect();
    const width = Math.min(500, window.innerWidth - 24);
    const left = bounds.left >= width + 24 ? bounds.left - width - 12 : bounds.right + width + 24 <= window.innerWidth ? bounds.right + 12 : Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    scheduleTimeOffTriggerRef.current = button;
    setScheduleTimeOffPosition({ left, top: Math.max(12, bounds.top - 100) });
    setScheduleTimeOffRequestId(request.id);
  }

  function closeScheduleTimeOff() {
    setScheduleTimeOffRequestId(null);
    scheduleTimeOffTriggerRef.current?.focus({ preventScroll: true });
  }

  async function saveWorkedHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingHours) return;

    const enteredHours = Number(editingHours.hours);
    const enteredMinutes = Number(editingHours.minutes);
    if (
      !Number.isInteger(enteredHours)
      || enteredHours < 0
      || !Number.isInteger(enteredMinutes)
      || enteredMinutes < 0
      || enteredMinutes > 59
    ) return;

    if (!showHoursChangeWarning) {
      setShowHoursChangeWarning(true);
      return;
    }

    const requestedHours = enteredHours + enteredMinutes / 60;

    const range = hoursDateRange(hoursDate, activeHoursTab, scheduleEnforcement.workWeekStart);
    const currentHours = adjustedWorkedHoursForRange(
      state.clockEvents,
      state.hoursAdjustments ?? [],
      editingHours.employee.id,
      range,
      currentTime,
    );
    const difference = requestedHours - currentHours;
    if (Math.abs(difference) < 1 / 3600) {
      setEditingHours(null);
      return;
    }

    if (!await setState((current) => ({
      ...current,
      timeCardEdits: [...(current.timeCardEdits ?? []), {
        id: nextId(current.timeCardEdits ?? []), employeeId: editingHours.employee.id,
        date: adjustmentDateForRange(hoursDate, range), at: new Date().toISOString(),
        actor: account.displayName,
        before: `Worked hours: ${currentHours.toFixed(2)}`, after: `Worked hours: ${requestedHours.toFixed(2)}`,
      }],
      hoursAdjustments: [
        ...(current.hoursAdjustments ?? []),
        {
          id: nextId(current.hoursAdjustments ?? []),
          employeeId: editingHours.employee.id,
          date: adjustmentDateForRange(hoursDate, range),
          hours: difference,
        },
      ],
    }))) return;
    setEditingHours(null);
    setShowHoursChangeWarning(false);
  }

  function openShiftEditor(shift: Shift) {
    if (mode !== "manager") return;
    if (!canEditScheduleRole(shift.role)) {
      setSchedulePermissionError("You can only edit shifts for roles in your assigned departments.");
      return;
    }
    setSchedulePermissionError("");
    setEditShiftError("");
    setEditingShift({ ...shift, notes: shift.notes ?? "" });
    setEditingShiftWeekdays([weekdayForDate(shift.date)]);
  }

  async function saveEditedShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShift) return;

    const savedShift = workingScheduleShifts.find((shift) => shift.id === editingShift.id);
    if (!canEditScheduleRole(editingShift.role) || (savedShift && !canEditScheduleRole(savedShift.role))) {
      setEditShiftError("You can only edit shifts for roles in your assigned departments.");
      return;
    }
    const start = editingShift.shiftType === "day_off" ? "00:00" : parseTypedTime(editingShift.start);
    const end = editingShift.shiftType === "day_off" ? "00:00" : parseTypedTime(editingShift.end);
    const role = editingShift.role.trim();
    const notes = editingShift.notes?.trim() ?? "";
    if (!start || !end) {
      setEditShiftError("Enter a valid start and end time.");
      return;
    }
    const startMinutes = timeToMinutes(start); const endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null || (isWorkShift(editingShift) && startMinutes >= endMinutes)) {
      setEditShiftError("Start time must be earlier than end time.");
      return;
    }
    if (!role || !shiftEmployeeIds.has(editingShift.employeeId)) return;

    if (editingShiftWeekdays.length === 0) {
      setEditShiftError("Choose at least one day to apply this shift to.");
      return;
    }
    const targetDates = Array.from(new Set([
      editingShift.date,
      ...shiftDatesForWeekdays(editingShift.date, editingShiftWeekdays, scheduleEnforcement.workWeekStart),
    ]));
    const layoutError = shiftLayoutError([
      ...workingScheduleShifts.filter(shift => shift.id !== editingShift.id),
      ...targetDates.map((date, index) => ({ ...editingShift, id: -index - 1, date, start, end })),
    ]);
    if (layoutError) { setEditShiftError(layoutError); return; }
    const additionalDates = targetDates.filter((date) => date !== editingShift.date);
    const firstAdditionalShiftId = nextScheduleShiftId(state);
    const additionalShifts = additionalDates.map((date, index) => ({
      ...editingShift,
      id: firstAdditionalShiftId + index,
      date,
      start,
      end,
      role,
      notes,
    }));

    if (!await setState((current) => {
      const currentDraft = current.scheduleDraftsByManager?.[activeEmployeeId];
      const currentWorkingShifts = applyScheduleDraft(current.shifts, currentDraft);
      const editedSavedShift = { ...editingShift, start, end, role, notes };
      const affectedEmployeeIds = [
        currentWorkingShifts.find((shift) => shift.id === editingShift.id)?.employeeId ?? editingShift.employeeId,
        editingShift.employeeId,
      ];
      const scheduleDraft = mergeScheduleDraft(
        current.shifts,
        currentDraft,
        [editedSavedShift, ...additionalShifts],
        [],
        affectedEmployeeIds,
      );

      return {
        ...current,
        scheduleDraftsByManager: {
          ...(current.scheduleDraftsByManager ?? {}),
          [activeEmployeeId]: scheduleDraft,
        },
      };
    })) return;
    setEditedShiftTimes((current) => ({ ...current, [editingShift.id]: Date.now() }));
    if (additionalShifts.length > 0) {
      const createdAt = Date.now();
      setCreatedShiftTimes((current) => ({
        ...current,
        ...Object.fromEntries(additionalShifts.map((shift) => [shift.id, createdAt])),
      }));
    }
    setLastEditedShiftId(editingShift.id);
    setEditShiftError("");
    setEditingShift(null);
  }

  async function deleteEditingShift() {
    if (!editingShift || !activeUserIsAdmin) return;
    if (!window.confirm("Are you sure you want to delete this shift?")) return;

    if (!await setState((current) => {
      const currentDraft = current.scheduleDraftsByManager?.[activeEmployeeId];
      const scheduleDraft = mergeScheduleDraft(
        current.shifts,
        currentDraft,
        [],
        [editingShift.id],
        [editingShift.employeeId],
      );

      return {
        ...current,
        scheduleDraftsByManager: {
          ...(current.scheduleDraftsByManager ?? {}),
          [activeEmployeeId]: scheduleDraft,
        },
      };
    })) return;
    setEditingShift(null);
  }

  async function dropScheduleShift(event: DragEvent, employeeId: number, date: string) {
    event.preventDefault();
    const source = draggedShift.current; draggedShift.current = null;
    if (!source || mode !== "manager" || !canEditScheduleRole(source.role)) return;
    if (source.employeeId === employeeId && source.date === date) return;
    const moved = { ...source, employeeId, date };
    const layoutError = shiftLayoutError([...workingScheduleShifts.filter(shift => shift.id !== source.id), moved]);
    if (layoutError) { setSchedulePermissionError(layoutError); return; }
    const saved = await setState(current => ({ ...current, scheduleDraftsByManager: {
      ...current.scheduleDraftsByManager,
      [activeEmployeeId]: mergeScheduleDraft(current.shifts, current.scheduleDraftsByManager?.[activeEmployeeId], [moved], [], [source.employeeId, employeeId]),
    } }));
    if (saved) setSchedulePermissionError("Shift moved in your draft. Publish when ready.");
  }

  async function publishSchedule() {
    if (mode !== "manager") return;
    if (activeScheduleDraft && !scheduleDraftIsAllowed(activeScheduleDraft, state.shifts, role => canEditScheduleRole(role))) {
      setSchedulePermissionError("This draft contains shifts outside your assigned departments. Ask an admin to publish it.");
      return;
    }
    setSchedulePermissionError("");
    const publishedAt = new Date().toISOString();
    const publishId = Date.now();
    if (!await setState((current) => {
      const scheduleDraft = current.scheduleDraftsByManager?.[activeEmployeeId];
      if (!scheduleDraft) return current;
      if (!scheduleDraftIsAllowed(scheduleDraft, current.shifts, role => canEditScheduleRole(role, current))) return current;
      const publishedShifts = applyScheduleDraft(current.shifts, scheduleDraft);
      const publisherName = current.employees.find((employee) => employee.id === activeEmployeeId)?.name ?? "A manager";
      const scheduleUpdates = [
        ...(current.scheduleUpdates ?? []).slice(-200),
        ...current.employees
          .filter(employee => scheduleEnforcement.notifyScheduleChanges && employee.active && employee.locationSettings.sendLocationAlerts)
          .map((employee) => ({
            id: `${publishId}-${employee.id}`,
            employeeId: employee.id,
            title: "New schedule published",
            detail: `${publisherName} published a new schedule for the team.`,
            at: publishedAt,
          })),
      ];
      const remainingScheduleDrafts = { ...(current.scheduleDraftsByManager ?? {}) };
      delete remainingScheduleDrafts[activeEmployeeId];

      return {
        ...current,
        shifts: publishedShifts,
        scheduleUpdates,
        scheduleHasBeenPublished: true,
        pendingScheduleUpdateEmployeeIds: [],
        scheduleDraftsByManager: remainingScheduleDrafts,
      };
    })) return;
    setCreatedShiftTimes({});
    setEditedShiftTimes({});
    setLastEditedShiftId(null);
  }

  function requestTimeException(action: TimeExceptionAction) {
    if (!canLaunchTimeClock) return;
    if (!needsTimeException(action, myShift, activeBreakEndTime, currentTime, scheduleEnforcement)) {
      if (action === "break_end") finishBreak();
      else clock(action);
      return;
    }

    setPendingTimeException(action);
    setTimeExceptionExplanation("");
    setShowBreakOptions(false);
  }

  function submitTimeException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingTimeException) return;

    const explanation = timeExceptionExplanation.trim();
    if (!explanation) return;

    if (pendingTimeException === "break_end") finishBreak(explanation);
    else clock(pendingTimeException, explanation);

    setPendingTimeException(null);
    setTimeExceptionExplanation("");
  }

  function clock(_type: "in" | "out", _explanation = "") { window.location.assign("/kiosk"); }

  function takeBreak(_duration: { minutes: 30 | 45 } | { seconds: 5 }) { window.location.assign("/kiosk"); }

  function finishBreak(_explanation = "") { window.location.assign("/kiosk"); }

  async function submitAvailabilityRequest(
    effectiveDate: string,
    slots: AvailabilityRequestSlot[],
    note: string,
  ) {
    return await setState((current) => ({
      ...current,
      availabilityRequests: [
        ...(current.availabilityRequests ?? []),
        {
          id: nextId(current.availabilityRequests ?? []),
          employeeId: activeEmployeeId,
          effectiveDate,
          status: scheduleEnforcement.requireAvailabilityApproval ? "pending" : "approved",
          slots,
          submittedAt: new Date().toISOString(),
          decidedAt: scheduleEnforcement.requireAvailabilityApproval ? undefined : new Date().toISOString(),
          requestNote: note.trim() || undefined,
        },
      ],
    }));
  }

  async function decideAvailabilityRequest(
    requestId: number,
    decision: "approved" | "rejected",
    rejectionNote = "",
  ) {
    return await setState((current) => ({
      ...current,
      availabilityRequests: (current.availabilityRequests ?? []).map((request) => (
        request.id === requestId
          ? {
              ...request,
              status: decision,
              decidedAt: new Date().toISOString(),
              decidedByEmployeeId: activeEmployeeId,
              rejectionNote: decision === "rejected" ? rejectionNote.trim() || undefined : undefined,
            }
          : request
      )),
    }));
  }

  useEffect(() => {
    shared.setEditing(Boolean(isSharedTimeCardEditing || ptoRequestForm || editingPayrollEmployeeId !== null || activeView === "profile" || isAddingEmployee || editingEmployeeId !== null || isAddingDepartment || editingDepartmentId !== null || isAddingShift || editingShift || scheduleEventDraft || editingHours || editingPtoPolicyId !== null || ptoPolicyForm || reviewingPtoRequestId !== null || certificateEmployeeId !== null || terminatingEmployeeId !== null || editingPersonalContactEmployeeId !== null || editingPersonalPayrollEmployeeId !== null || editingBasicInfoField !== null || activeView === "settings" || activeView === "my_availability" || activeView === "team_availability" || isCreatingConversation || editingConversationNameId !== null));
  });

  if (!isUnlocked) return <main className="login-screen"><p role="status">Returning to sign in…</p></main>;

  return (
    <main className="min-h-screen bg-[#f2f7fc] text-[#12213a]" aria-busy={shared.pending} inert={shared.pending}
      onClickCapture={event => { if (shared.pending) { event.preventDefault(); event.stopPropagation(); } }}
      onKeyDownCapture={event => { if (shared.pending) { event.preventDefault(); event.stopPropagation(); } }}
      onSubmitCapture={event => { if (shared.pending) { event.preventDefault(); event.stopPropagation(); } }}>
      <div className={isSidebarCollapsed ? "app-frame sidebar-collapsed" : "app-frame"}>
        <aside className="sidebar" aria-label="DomBase staff sections">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => {
              setIsSidebarCollapsed((collapsed) => !collapsed);
              setIsTeamNavOpen(false);
              setIsScheduleNavOpen(false);
            }}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarCollapsed}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <div className="brand-lockup" aria-label={`${sidebarLocationName} location`}>
            <span className="brand-mark">D</span>
            <div>
              <h1>{sidebarLocationName}</h1>
            </div>
          </div>

          <nav className="nav-list">
            {visibleNavItems.map((item) => item.id === "employees" ? (
              <div className="sidebar-nav-group" key={item.id}>
                <button
                  type="button"
                  className={activeView === "employees" || activeView === "departments_roles" ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    const shouldOpen = !isTeamNavOpen;
                    navigateToView("employees");
                    setIsTeamNavOpen(shouldOpen);
                  }}
                  aria-expanded={isTeamNavOpen}
                  aria-controls="team-sidebar-menu"
                  title="Team"
                >
                  <SidebarNavIcon icon={item.icon} />
                  <span>Team</span>
                  <span className={isTeamNavOpen ? "sidebar-chevron open" : "sidebar-chevron"} aria-hidden="true">⌄</span>
                </button>
                {isTeamNavOpen || isSidebarCollapsed ? (
                  <div className={isSidebarCollapsed ? "sidebar-submenu sidebar-submenu-flyout" : "sidebar-submenu"} id="team-sidebar-menu">
                    <button
                      type="button"
                      className={activeView === "employees" ? "active" : ""}
                      onClick={() => navigateToView("employees")}
                    >
                      Roster
                    </button>
                    <button
                      type="button"
                      className={activeView === "departments_roles" ? "active" : ""}
                      onClick={() => navigateToView("departments_roles")}
                    >
                      Department / Roles
                    </button>
                  </div>
                ) : null}
              </div>
            ) : item.id === "schedule" ? (
              <div className="sidebar-nav-group" key={item.id}>
                <button
                  type="button"
                  className={["schedule", "time_off", "my_availability", "team_availability"].includes(activeView) ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    const shouldOpen = !isScheduleNavOpen;
                    navigateToView("schedule");
                    setIsScheduleNavOpen(shouldOpen);
                  }}
                  aria-expanded={isScheduleNavOpen}
                  aria-controls="schedule-sidebar-menu"
                  title="Schedule"
                >
                  <SidebarNavIcon icon={item.icon} />
                  <span>Schedule</span>
                  <span className={isScheduleNavOpen ? "sidebar-chevron open" : "sidebar-chevron"} aria-hidden="true">⌄</span>
                </button>
                {isScheduleNavOpen || isSidebarCollapsed ? (
                  <div className={isSidebarCollapsed ? "sidebar-submenu sidebar-submenu-flyout" : "sidebar-submenu"} id="schedule-sidebar-menu">
                    <button type="button" className={activeView === "schedule" ? "active" : ""} onClick={() => navigateToView("schedule")}>Shifts</button>
                    <button type="button" className={activeView === "time_off" ? "active" : ""} onClick={() => navigateToView("time_off")}>Time off</button>
                    <button type="button" className={activeView === "my_availability" ? "active" : ""} onClick={() => navigateToView("my_availability")}>My availability</button>
                    <button type="button" className={activeView === "team_availability" ? "active" : ""} onClick={() => navigateToView("team_availability")}>Team availability</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                key={item.id}
                className={activeView === item.id ? "nav-button active" : "nav-button"}
                onClick={() => navigateToView(item.id)}
                aria-pressed={activeView === item.id}
                title={item.label}
              >
                <SidebarNavIcon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="workspace" aria-live="polite">
          <header className="topbar">
            <div>
              <p className="eyebrow">{formatLongDate(today)}</p>
              <h2>{activeView === "hours" && isTimesheetSummary ? "Timesheet summary" : activeViewLabel(activeView, mode)}</h2>
            </div>
            {!isPublicSchedule ? (
              <div className="header-actions">
                <button
                  type="button"
                  className="header-icon-button"
                  aria-label="Stopwatch"
                  title="Stopwatch"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="13" r="8" />
                    <path d="M12 9v4l3 2M9 2h6M12 2v3M18 7l2-2" />
                  </svg>
                </button>
                <div
                  className={reviewingPtoRequest && isMessagesOpen ? "message-menu pto-review-message-overlay" : "message-menu"}
                  ref={messageMenuRef}
                >
                  <button
                    type="button"
                    className="header-icon-button"
                    onClick={() => {
                      if (!isMessagesOpen) {
                        setSelectedConversationId(null);
                        setConversationMenuId(null);
                        setViewingConversationInfoId(null);
                        setIsCreatingConversation(false);
                        setPtoMessageEmployeeId(null);
                        setIsPtoMessageContext(false);
                        setMessageError("");
                      }
                      setIsMessagesOpen((open) => !open);
                      setIsNotificationsOpen(false);
                      setIsAccountMenuOpen(false);
                    }}
                    aria-expanded={isMessagesOpen}
                    aria-haspopup="dialog"
                    aria-label={unreadConversationCount > 0
                      ? `${unreadConversationCount} unread conversations`
                      : "Messages"}
                    title="Messages"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                    </svg>
                    {unreadConversationCount > 0 ? (
                      <span className="notification-badge" aria-hidden="true">{unreadConversationCount}</span>
                    ) : null}
                  </button>
                  {isMessagesOpen ? (
                    <div
                      className="message-dropdown"
                      role="dialog"
                      aria-label="Messages"
                      style={reviewingPtoRequest && ptoMessageOverlayPosition
                        ? {
                            top: ptoMessageOverlayPosition.top,
                            left: ptoMessageOverlayPosition.left,
                            right: "auto",
                            height: ptoMessageOverlayPosition.height,
                            visibility: "visible",
                          }
                        : undefined}
                    >
                      <button
                        type="button"
                        className="message-dropdown-close"
                        onClick={() => {
                          setIsMessagesOpen(false);
                          setPtoMessageEmployeeId(null);
                          setIsPtoMessageContext(false);
                        }}
                        aria-label="Dismiss messages"
                        title="Close"
                      >
                        <span aria-hidden="true">&times;</span>
                      </button>
                      {isCreatingConversation && ptoMessageEmployeeId !== null ? (
                        <div className="conversation-view pto-draft-conversation">
                          <div className="message-popout-heading">
                            <strong>{employeeById(state.employees, ptoMessageEmployeeId)?.name ?? "Employee"}</strong>
                          </div>
                          <div className="conversation-messages" ref={conversationMessagesRef} />
                          <form className="message-reply-form" onSubmit={createTeamConversation}>
                            <textarea
                              ref={messageComposerRef}
                              value={newConversationMessage}
                              onChange={(event) => setNewConversationMessage(event.target.value)}
                              placeholder="Write a message"
                              aria-label="New message text"
                              rows={2}
                              disabled={!scheduleEnforcement.enableTeamMessaging}
                              required
                            />
                            <button type="submit" disabled={!scheduleEnforcement.enableTeamMessaging || !newConversationMessage.trim()}>Send</button>
                            {messageError ? <p className="message-error">{messageError}</p> : null}
                          </form>
                        </div>
                      ) : isCreatingConversation ? (
                        <form className="new-conversation-form" onSubmit={createTeamConversation}>
                          <div className="message-popout-heading">
                            <button
                              type="button"
                              className="message-back-button"
                              onClick={() => {
                                setIsCreatingConversation(false);
                                setMessageError("");
                              }}
                              aria-label="Back to messages"
                            >
                              ←
                            </button>
                            <strong>New message</strong>
                          </div>
                          <fieldset className="message-member-picker">
                            <legend>Add team members</legend>
                            {activeEmployees
                              .filter((employee) => employee.id !== activeEmployeeId)
                              .sort((firstEmployee, secondEmployee) => firstEmployee.name.localeCompare(secondEmployee.name))
                              .map((employee) => (
                                <label key={employee.id}>
                                  <input
                                    type="checkbox"
                                    checked={newConversationMemberIds.includes(employee.id)}
                                    onChange={() => toggleConversationMember(employee.id)}
                                  />
                                  <span className="message-member-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                                  <span>{employee.name}</span>
                                </label>
                              ))}
                          </fieldset>
                          <textarea
                            value={newConversationMessage}
                            onChange={(event) => setNewConversationMessage(event.target.value)}
                            placeholder="Write a message"
                            aria-label="New message text"
                            rows={3}
                            disabled={!scheduleEnforcement.enableTeamMessaging}
                            required
                          />
                          {messageError ? <p className="message-error">{messageError}</p> : null}
                          <button type="submit" className="start-chat-button" disabled={!scheduleEnforcement.enableTeamMessaging}>Start chat</button>
                        </form>
                      ) : viewingConversationInfo ? (
                        <div className="conversation-info-view">
                          <div className="message-popout-heading">
                            <button
                              type="button"
                              className="message-back-button"
                              onClick={() => setViewingConversationInfoId(null)}
                              aria-label="Back to messages"
                            >
                              ←
                            </button>
                            <strong>View info</strong>
                          </div>
                          <div className="conversation-info-summary">
                            <span className="message-member-avatar" aria-hidden="true">
                              {conversationInitials(viewingConversationInfo, state.employees, activeEmployeeId)}
                            </span>
                            <strong>{conversationTitle(viewingConversationInfo, state.employees, activeEmployeeId)}</strong>
                            <small>{viewingConversationInfo.participantIds.length} participants</small>
                          </div>
                          <div className="conversation-participant-list">
                            {viewingConversationInfo.participantIds.map((employeeId) => {
                              const employee = employeeById(state.employees, employeeId);
                              return employee ? (
                                <div className="conversation-participant" key={employee.id}>
                                  <span className="message-member-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                                  <span>
                                    <strong>{employee.name}</strong>
                                    <small>{employee.role}</small>
                                  </span>
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      ) : selectedConversation ? (
                        <div className="conversation-view">
                          <div className="message-popout-heading">
                            {!isPtoMessageContext ? (
                              <button
                                type="button"
                                className="message-back-button"
                                onClick={() => setSelectedConversationId(null)}
                                aria-label="Back to messages"
                              >
                                ←
                              </button>
                            ) : null}
                            {editingConversationNameId === selectedConversation.id ? (
                              <form className="conversation-name-form" onSubmit={saveConversationName}>
                                <input
                                  value={conversationNameDraft}
                                  onChange={(event) => setConversationNameDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      setEditingConversationNameId(null);
                                      setConversationNameDraft("");
                                    }
                                  }}
                                  placeholder="Group name"
                                  aria-label="Group conversation name"
                                  maxLength={60}
                                  autoFocus
                                />
                                <button type="submit">Save</button>
                              </form>
                            ) : (
                              <>
                                <strong>{conversationTitle(selectedConversation, state.employees, activeEmployeeId)}</strong>
                                {selectedConversation.participantIds.length > 2
                                  && selectedConversation.creatorEmployeeId === activeEmployeeId ? (
                                  <button
                                    type="button"
                                    className="edit-conversation-name-button"
                                    onClick={() => startEditingConversationName(selectedConversation)}
                                  >
                                    Edit name
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                          <div className="conversation-messages" ref={conversationMessagesRef}>
                            {selectedConversation.messages.map((message, messageIndex) => {
                              const previousMessage = selectedConversation.messages[messageIndex - 1];
                              const startsNewDay = !previousMessage || !messagesShareCalendarDay(previousMessage.sentAt, message.sentAt);

                              return (
                                <div className="message-entry" key={message.id}>
                                  {startsNewDay ? (
                                    <time className="message-day-divider" dateTime={message.sentAt}>
                                      {formatMessageDate(message.sentAt)}
                                    </time>
                                  ) : null}
                                  <div className={message.senderEmployeeId === activeEmployeeId ? "team-message own" : "team-message"}>
                                    <p>{message.body}</p>
                                    <div className="team-message-meta">
                                      <time dateTime={message.sentAt}>{formatMessageTime(message.sentAt)}</time>
                                      {message.senderEmployeeId === activeEmployeeId && message.id === latestOwnMessageId ? (
                                        <span className="message-delivery-status">
                                          {messageDeliveryStatus(message, selectedConversation)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <form className="message-reply-form" onSubmit={sendTeamMessage}>
                            <textarea
                              ref={messageComposerRef}
                              value={messageDraft}
                              onChange={(event) => setMessageDraft(event.target.value)}
                              placeholder="Write a message"
                              aria-label="Reply message"
                              rows={2}
                              disabled={!scheduleEnforcement.enableTeamMessaging}
                              title={!scheduleEnforcement.enableTeamMessaging ? "Messaging is disabled in location settings" : undefined}
                            />
                            <button type="submit" disabled={!scheduleEnforcement.enableTeamMessaging || !messageDraft.trim()}>Send</button>
                          </form>
                        </div>
                      ) : (
                        <>
                          <div className="message-list-heading">
                            <strong className="notification-title">Messages</strong>
                          </div>
                          <div className="notification-tabs" role="tablist" aria-label="Message filters">
                            <button
                              type="button"
                              className={messageFilter === "all" ? "active" : ""}
                              onClick={() => setMessageFilter("all")}
                              role="tab"
                              aria-selected={messageFilter === "all"}
                            >
                              All
                            </button>
                            <button
                              type="button"
                              className={messageFilter === "unread" ? "active" : ""}
                              onClick={() => setMessageFilter("unread")}
                              role="tab"
                              aria-selected={messageFilter === "unread"}
                            >
                              Unread ({unreadMessageCount})
                            </button>
                          </div>
                          <div className="message-conversation-list" onScroll={() => setConversationMenuId(null)}>
                            {visibleConversations.length > 0 ? visibleConversations.map((conversation) => {
                              const lastMessage = conversation.messages.at(-1);
                              const isPinned = conversation.pinnedByEmployeeIds?.includes(activeEmployeeId) ?? false;
                              const isMuted = conversation.mutedByEmployeeIds?.includes(activeEmployeeId) ?? false;
                              const conversationUnreadCount = conversationUnreadMessageCount(conversation, activeEmployeeId);
                              return (
                                <div className="message-conversation-row" key={conversation.id}>
                                  <span className="message-member-avatar" aria-hidden="true">
                                    {conversationInitials(conversation, state.employees, activeEmployeeId)}
                                  </span>
                                  <button type="button" className="conversation-open-button" onClick={() => openConversation(conversation.id)}>
                                    <span className="conversation-preview">
                                      <strong>
                                        {conversationTitle(conversation, state.employees, activeEmployeeId)}
                                        {isPinned ? <span className="conversation-state-label">Pinned</span> : null}
                                        {isMuted ? <span className="conversation-state-label">Muted</span> : null}
                                      </strong>
                                      <small>{lastMessage?.body ?? "No messages yet"}</small>
                                    </span>
                                    {conversationUnreadCount > 0 ? (
                                      <span
                                        className="conversation-unread-count"
                                        aria-label={`${conversationUnreadCount} unread ${conversationUnreadCount === 1 ? "message" : "messages"}`}
                                      >
                                        {conversationUnreadCount}
                                      </span>
                                    ) : null}
                                  </button>
                                  <button
                                    type="button"
                                    className="conversation-options-button"
                                    onClick={(event) => {
                                      if (conversationMenuId === conversation.id) {
                                        setConversationMenuId(null);
                                        return;
                                      }
                                      const dropdown = event.currentTarget.closest(".message-dropdown");
                                      const buttonBounds = event.currentTarget.getBoundingClientRect();
                                      const dropdownBounds = dropdown?.getBoundingClientRect();
                                      setConversationMenuTop(dropdownBounds ? buttonBounds.bottom - dropdownBounds.top + 4 : 54);
                                      setConversationMenuId(conversation.id);
                                    }}
                                    aria-label={`Conversation options for ${conversationTitle(conversation, state.employees, activeEmployeeId)}`}
                                    aria-expanded={conversationMenuId === conversation.id}
                                    aria-haspopup="menu"
                                  >
                                    <span aria-hidden="true">⋮</span>
                                  </button>
                                </div>
                              );
                            }) : <p className="notification-empty">No {messageFilter === "unread" ? "unread " : ""}messages.</p>}
                          </div>
                          {conversationWithOpenMenu ? (
                            <div
                              className="conversation-options-popout"
                              role="menu"
                              style={{ top: conversationMenuTop }}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setViewingConversationInfoId(conversationWithOpenMenu.id);
                                  setConversationMenuId(null);
                                }}
                              >
                                View info
                              </button>
                              <button type="button" role="menuitem" onClick={() => toggleConversationPinned(conversationWithOpenMenu.id)}>
                                {conversationWithOpenMenu.pinnedByEmployeeIds?.includes(activeEmployeeId) ? "Unpin Conversation" : "Pin Conversation"}
                              </button>
                              <button type="button" role="menuitem" onClick={() => toggleConversationMuted(conversationWithOpenMenu.id)}>
                                {conversationWithOpenMenu.mutedByEmployeeIds?.includes(activeEmployeeId) ? "Unmute Conversation" : "Mute Conversation"}
                              </button>
                              <button type="button" role="menuitem" className="danger" onClick={() => deleteConversation(conversationWithOpenMenu.id)}>
                                Delete Conversation
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="new-message-button"
                            disabled={!scheduleEnforcement.enableTeamMessaging}
                            title={!scheduleEnforcement.enableTeamMessaging ? "Messaging is disabled in location settings" : undefined}
                            onClick={() => {
                              setIsCreatingConversation(true);
                              setPtoMessageEmployeeId(null);
                              setIsPtoMessageContext(false);
                              setSelectedConversationId(null);
                              setNewConversationMemberIds([]);
                              setNewConversationMessage("");
                              setMessageError("");
                            }}
                          >
                            <span aria-hidden="true">+</span> New message
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="notification-menu" ref={notificationMenuRef}>
                  <button
                    type="button"
                    className="notification-button"
                    onClick={() => {
                      const nextOpen = !isNotificationsOpen;
                      setIsNotificationsOpen(nextOpen);
                      setIsAccountMenuOpen(false);
                      setIsMessagesOpen(false);
                      if (nextOpen) markHeaderNotificationsOpened();
                    }}
                    aria-expanded={isNotificationsOpen}
                    aria-haspopup="dialog"
                    aria-label="Notifications"
                    title="Notifications"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                    </svg>
                    {unreadNotificationCount > 0 ? (
                      <span className="notification-badge" aria-label={`${unreadNotificationCount} unread notifications`}>
                        {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                      </span>
                    ) : null}
                  </button>
                  {isNotificationsOpen ? (
                    <div className="notification-dropdown" role="dialog" aria-label="Notifications">
                      <div className="notification-header">
                        <strong className="notification-title">Notifications</strong>
                        {headerNotifications.length > 0 ? (
                          <button type="button" className="notification-clear" onClick={clearAllHeaderNotifications}>
                            Clear all
                          </button>
                        ) : null}
                      </div>
                      <div className="notification-list">
                        {headerNotifications.length > 0 ? headerNotifications.map((notification) => (
                          <div className="notification-item" key={notification.id}>
                            {notification.kind === "request" && notification.requestId ? (
                              <button
                                type="button"
                                className="notification-message-item notification-request-item"
                                onClick={() => openTimeOffRequestFromNotification(notification.requestId!)}
                              >
                                <strong>{notification.title}</strong>
                                <span>
                                  {notification.requestDate && notification.requestStatus ? (
                                    <>
                                      {notification.requestDate} · <span className={`notification-request-status ${notification.requestStatus}`}>{capitalize(notification.requestStatus)}</span>
                                    </>
                                  ) : notification.detail}
                                </span>
                                <small>{formatOperationalAlertTime(notification.at)}</small>
                              </button>
                            ) : notification.kind === "alert" && notification.eventTargetId ? (
                              <button
                                type="button"
                                className="notification-message-item notification-alert-item"
                                onClick={() => openEventFromNotification(notification.eventTargetId!)}
                              >
                                <strong>{notification.title}</strong>
                                <span>{notification.detail}</span>
                                <small>{formatOperationalAlertTime(notification.at)}</small>
                              </button>
                            ) : (
                              <div className="notification-copy">
                                <strong>{notification.title}</strong>
                                <span>{notification.detail}</span>
                                <small>{formatOperationalAlertTime(notification.at)}</small>
                              </div>
                            )}
                            <button
                              type="button"
                              className="notification-dismiss"
                              onClick={() => dismissHeaderNotification(notification.id)}
                              aria-label={`Delete ${notification.title} notification`}
                              title="Delete notification"
                            >
                              ×
                            </button>
                          </div>
                        )) : <p className="notification-empty">No new notifications.</p>}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="account-menu" ref={accountMenuRef}>
                  <button
                    type="button"
                    className="account-avatar"
                    onClick={() => {
                      setIsAccountMenuOpen((open) => !open);
                      setIsNotificationsOpen(false);
                      setIsMessagesOpen(false);
                    }}
                    aria-expanded={isAccountMenuOpen}
                    aria-haspopup="menu"
                    aria-label="Open account menu"
                  >
                    {account.displayName.trim().charAt(0).toUpperCase() || "A"}
                  </button>
                  {isAccountMenuOpen ? (
                    <div className="account-dropdown" role="menu">
                      <div className="account-dropdown-user">
                        <strong>{account.displayName}</strong>
                        <span>{capitalize(account.accessLevel.replace(/_/g, " "))}</span>
                      </div>
                      <button type="button" role="menuitem" onClick={() => navigateToView("profile")}>Profile</button>
                      <button type="button" role="menuitem" onClick={() => window.location.assign("/access")}>Your access</button>
                      <button type="button" role="menuitem" onClick={() => navigateToView("team_members")}>Team members</button>
                      {account.accessLevel === "owner" && <button type="button" role="menuitem" onClick={() => window.location.assign("/backups")}>Backups</button>}
                      <button type="button" role="menuitem" className="account-sign-out" disabled={isSigningOut} onClick={signOut}>Sign out</button>
                      <button type="button" role="menuitem" disabled={isSigningOut} onClick={signOutEverywhere}>Sign out everywhere</button>
                      {authMessage ? <p role="alert">{authMessage}</p> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <button type="button" className="public-back-button" onClick={signOut}>Back</button>
            )}
          </header>

          {account.accessLevel === "owner" ? <BackupMonitor /> : null}

          {activeView === "profile" && !isPublicSchedule ? (
            accountProfilePanel()
          ) : null}

          {activeView === "team_members" && !isPublicSchedule ? (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="People" title="Team members" />
              <div className="account-team-list">
                {activeEmployees.map((employee) => (
                  <article key={employee.id}>
                    <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                    <div>
                      <strong>{employee.name}</strong>
                      <span>{employee.role}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeView === "settings" && mode === "manager" ? (
            <div className="settings-layout">
              <nav className="settings-navigation" aria-label="Settings sections">
                {settingsGroups.map((group) => (
                  <section key={group.label}>
                    <p>{group.label}</p>
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={activeSettingsTab === item ? "active" : ""}
                        onClick={() => setActiveSettingsTab(item)}
                        aria-current={activeSettingsTab === item ? "page" : undefined}
                      >
                        {item}
                      </button>
                    ))}
                  </section>
                ))}
              </nav>

              {activeSettingsTab === "Basic info" ? (
                <section className="panel settings-basic-panel">
                  <div className="settings-panel-heading">
                    <h3>Basic info</h3>
                    <button type="button" onClick={saveBasicInfo} disabled={!isBasicInfoDirty}>Save</button>
                  </div>
                  <SettingsInfoSection
                    title="Location details"
                    info={basicInfo}
                    editingField={editingBasicInfoField}
                    onEdit={setEditingBasicInfoField}
                    onChange={updateBasicInfo}
                    rows={[
                      { field: "locationName", label: "Location name" },
                      { field: "locationPhone", label: "Location phone number", inputType: "tel" },
                      { field: "address1", label: "Address 1" },
                      { field: "address2", label: "Address 2" },
                      { field: "city", label: "City" },
                      { field: "stateProvince", label: "State/Province" },
                      { field: "postalCode", label: "Zip/Postal code" },
                      { field: "country", label: "Country" },
                      { field: "timeZone", label: "Time zone" },
                      { field: "businessType", label: "Business type" },
                      { field: "businessCategory", label: "Business category" },
                      { field: "website", label: "Website", inputType: "url" },
                    ]}
                  />
                  <SettingsInfoSection
                    title="Company info"
                    info={basicInfo}
                    editingField={editingBasicInfoField}
                    onEdit={setEditingBasicInfoField}
                    onChange={updateBasicInfo}
                    rows={[
                      { field: "companyName", label: "Company name" },
                      { field: "accountOwner", label: "Account owner" },
                      { field: "companyPhone", label: "Phone number", inputType: "tel" },
                    ]}
                  />
                  <section className="settings-info-section company-locations-section">
                    <h4>Company locations</h4>
                    <div>
                      <p className="company-location-summary">
                        <strong>{basicInfo.companyName.toUpperCase() || "DOMBASE"}</strong>
                        <span aria-hidden="true">|</span>
                        <span>{formatCompanyLocation(basicInfo)}</span>
                      </p>
                      {companyLocations.map((location) => (
                        <p className="company-location-summary" key={`${location.name}-${location.zip}`}>
                          <strong>{location.name.toUpperCase()}</strong>
                          <span aria-hidden="true">|</span>
                          <span>{location.zip}</span>
                        </p>
                      ))}
                    </div>
                    <button type="button" onClick={openAddLocationModal} disabled title="This workspace supports one location">Add a new location</button>
                  </section>
                </section>
              ) : activeSettingsTab === "Schedule enforcement" ? (
                <ScheduleEnforcementPanel
                  settings={scheduleEnforcementDraft}
                  dirty={isScheduleEnforcementDirty}
                  message={scheduleEnforcementMessage}
                  onChange={(changes) => {
                    setScheduleEnforcementDraft((current) => ({ ...current, ...changes }));
                    setScheduleEnforcementMessage("");
                    setAlertsPermissionsMessage("");
                    setOvertimeMessage("");
                  }}
                  onSave={saveScheduleEnforcement}
                />
              ) : activeSettingsTab === "Alerts & permissions" ? (
                <AlertsPermissionsPanel
                  settings={scheduleEnforcementDraft}
                  dirty={isAlertsPermissionsDirty}
                  message={alertsPermissionsMessage}
                  onChange={(changes) => {
                    setScheduleEnforcementDraft(current => ({ ...current, ...changes }));
                    setAlertsPermissionsMessage("");
                    setScheduleEnforcementMessage("");
                  }}
                  onSave={saveAlertsPermissions}
                />
              ) : activeSettingsTab === "Events & trades" ? (
                <EventsTradesPanel
                  settings={scheduleEnforcementDraft}
                  dirty={isEventsTradesDirty}
                  message={eventsTradesMessage}
                  onChange={changes => {
                    setScheduleEnforcementDraft(current => ({ ...current, ...changes }));
                    setEventsTradesMessage("");
                  }}
                  onSave={saveEventsTrades}
                />
              ) : activeSettingsTab === "Time clock options" ? (
                <TimeClockOptionsPanel roundingMinutes={state.hoursRoundingMinutes} onLaunch={() => window.location.assign("/kiosk")} />
              ) : activeSettingsTab === "Overtime" ? (
                <OvertimeOptionsPanel
                  weekStart={scheduleEnforcementDraft.workWeekStart}
                  dirty={isOvertimeDirty}
                  message={overtimeMessage}
                  onWeekStartChange={day => {
                    setScheduleEnforcementDraft(current => ({ ...current, workWeekStart: day }));
                    setOvertimeMessage("");
                    setScheduleEnforcementMessage("");
                  }}
                  onSave={saveOvertime}
                />
              ) : activeSettingsTab === "Breaks & compliance" ? (
                <BreaksCompliancePanel
                  afterHours={scheduleEnforcementDraft.mealBreakAfterHours}
                  minutes={scheduleEnforcementDraft.mealBreakMinutes}
                  mandatory={scheduleEnforcementDraft.mandatoryMealBreak}
                  dirty={isBreaksComplianceDirty}
                  message={breaksComplianceMessage}
                  onChange={changes => {
                    setScheduleEnforcementDraft(current => ({ ...current, ...changes }));
                    setBreaksComplianceMessage("");
                  }}
                  onSave={saveBreaksCompliance}
                />
              ) : activeSettingsTab === "Tip settings" ? (
                <section className="panel settings-enforcement-panel settings-tips-panel">
                  <div className="settings-panel-heading">
                    <h3>Tip settings</h3>
                    <button type="button" disabled>Save</button>
                  </div>
                  <div className="enforcement-rules">
                    <div className="enforcement-rule">
                      <label className="enforcement-rule-line" title="Not available yet">
                        <input type="checkbox" disabled />
                        <span>Import tips from timesheets when running payroll through DomBase</span>
                      </label>
                      <p>You&apos;ll still be able to review and edit tips before running payroll.</p>
                    </div>
                  </div>
                </section>
              ) : activeSettingsTab === "Payroll settings" ? (
                <section className="panel settings-enforcement-panel settings-payroll-panel">
                  <div className="settings-panel-heading">
                    <h3>Payroll settings</h3>
                    <button type="button" disabled>Save</button>
                  </div>
                  <div className="payroll-schedule-settings">
                    <h4>Pay schedule</h4>
                    <p>Get all your systems working together to save money and time.</p>
                    <button type="button" className="payroll-settings-link" disabled title="Not available yet">Learn more</button>
                    <div className="payroll-schedule-fields">
                      <label title="Not available yet">
                        <span>Our team gets paid</span>
                        <select disabled defaultValue="monthly">
                          <option value="monthly">once a month</option>
                        </select>
                      </label>
                      <label title="Not available yet">
                        <span>Our payroll periods begin on the</span>
                        <select disabled defaultValue="1">
                          <option value="1">1st</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="payroll-running-settings">
                    <h4>Running payroll</h4>
                    <div className="enforcement-rule">
                      <label className="enforcement-rule-line" title="Not available yet">
                        <input type="checkbox" disabled />
                        <span>Lock timesheets after approval</span>
                      </label>
                      <p>With this enabled, timesheets cannot be edited after approval</p>
                    </div>
                  </div>
                </section>
              ) : activeSettingsTab === "Time off" ? (
                <section className="panel settings-enforcement-panel settings-time-off-panel">
                  <div className="settings-panel-heading">
                    <h3>Time off</h3>
                    <button type="button" disabled>Save</button>
                  </div>
                  <h4>Time off policy</h4>
                  <div className="enforcement-rules">
                    <div className="enforcement-rule-line" title="Not available yet">
                      <label>
                        <input type="checkbox" checked disabled />
                        <span>Limit time off requests to no more than</span>
                      </label>
                      <input type="number" className="time-off-policy-number" defaultValue={2} disabled aria-label="Maximum people requesting time off per day" />
                      <span>people per day</span>
                    </div>
                    <div className="enforcement-rule-line" title="Not available yet">
                      <label>
                        <input type="checkbox" disabled />
                        <span>Do not allow time off requests less than</span>
                      </label>
                      <input type="number" className="time-off-policy-number" defaultValue={7} disabled aria-label="Minimum days in advance for time off requests" />
                      <span>days in advance</span>
                    </div>
                  </div>
                  <button type="button" className="time-off-manage-policies" onClick={() => {
                    navigateToView("time_off");
                    setIsViewingPtoPolicies(true);
                  }}>Manage PTO policies in the Time off dashboard</button>
                </section>
              ) : activeSettingsTab === "Messages" ? (
                <MessagesSettingsPanel
                  enabled={scheduleEnforcementDraft.enableTeamMessaging}
                  dirty={isMessagesSettingsDirty}
                  message={messagesSettingsMessage}
                  today={today}
                  onChange={enabled => {
                    setScheduleEnforcementDraft(current => ({ ...current, enableTeamMessaging: enabled }));
                    setMessagesSettingsMessage("");
                  }}
                  onSave={saveMessagesSettings}
                />
              ) : activeSettingsTab === "Team permissions" ? (
                <TeamPermissionsPanel />
              ) : activeSettingsTab === "Manager Log" ? (
                <section className="panel settings-enforcement-panel settings-manager-log-panel">
                  <div className="settings-panel-heading">
                    <h3>Manager Log</h3>
                    <button type="button" disabled>Save</button>
                  </div>
                  <p className="manager-log-intro">
                    Capture photos, track events and manage tasks in one place. Save hours on write ups, paperwork, maintenance orders and customer incidents.{" "}
                    <button type="button" className="manager-log-link" disabled title="Not available yet">Learn more</button>
                  </p>
                  <div className="manager-log-option-card enforcement-rule">
                    <label className="enforcement-rule-line" title="Not available yet">
                      <input type="checkbox" checked disabled />
                      <span>Manager Log</span>
                    </label>
                    <p>Share information from shift to shift by writing notes that are stored in DomBase. Keep sales, weather, and staff attendance information together.</p>
                  </div>
                  <button type="button" className="manager-log-link manager-log-dashboard-link" disabled title="Not available yet">Go to your Manager Log</button>
                </section>
              ) : activeSettingsTab === "Profile" ? (
                accountProfilePanel()
              ) : activeSettingsTab === "Locations & PINs" ? (
                !isPublicSchedule && activeEmployee ? <LocationsPinsPanel
                  key={`${activeEmployee.id}-${activeEmployee.pin}-${activeEmployee.location}`}
                  locationName={activeEmployee.location.trim() || sidebarLocationName}
                  pin={activeEmployee.pin}
                /> : null
              ) : activeSettingsTab === "Notifications" ? (
                <NotificationsSettingsPanel locationName={activeEmployee?.location.trim() || sidebarLocationName} />
              ) : activeSettingsTab === "Password & security" ? (
                <section className="panel settings-enforcement-panel settings-security-panel">
                  <div className="settings-panel-heading"><h3>Password &amp; security</h3></div>
                  <section className="account-security-section" aria-labelledby="account-password-heading">
                    <div className="account-security-section-heading">
                      <h4 id="account-password-heading">Password</h4>
                      <button type="button" disabled title="Password sign-in is not available yet">Change password</button>
                    </div>
                    <div className="account-security-status">
                      <h5>Status</h5>
                      <p>Your account uses a PIN to sign in.</p>
                    </div>
                  </section>
                  <section className="account-security-section" aria-labelledby="account-security-heading">
                    <h4 id="account-security-heading">Security</h4>
                    <div className="account-security-section-heading">
                      <p>2-Step Verification enhances your account security.</p>
                      <button type="button" disabled title="Not available yet">Turn on 2-Step Verification</button>
                    </div>
                    <div className="account-security-status">
                      <h5>Status</h5>
                      <p className="account-verification-status"><span aria-hidden="true">−</span><strong>2-Step Verification is off</strong></p>
                    </div>
                  </section>
                </section>
              ) : (
                <section className="panel settings-placeholder-panel">
                  <p className="eyebrow">Settings</p>
                  <h3>{activeSettingsTab}</h3>
                  <p>This section is ready for the options you choose to add later.</p>
                </section>
              )}
            </div>
          ) : null}

          {activeView === "dashboard" && !isPublicSchedule && (
            <div className="content-grid dashboard-content">
                <section className="panel main-panel">
                  <PanelHeading eyebrow="Clock" title="Time clock" />
                  <div className="clock-card">
                    <div>
                      <p className="eyebrow">{activeEmployee?.role ?? "Employee"}</p>
                      <h3>{activeEmployee?.name ?? "No employee linked"}</h3>
                      <p>
                        {!canLaunchTimeClock
                          ? "A linked, active employee is required. Use the registered tablet to record time."
                          : activeIsClockedIn
                          ? `Clocked in since ${formatDateTime(activeClockEvent?.at)}`
                          : "Currently clocked out"}
                      </p>
                      {activeBreak && activeBreakEndTime ? (
                        <div className={isBreakPastGrace ? "break-status overdue" : "break-status"} role="timer" aria-live="polite">
                          <strong>{formatCountdown(activeBreakRemainingMs)}</strong>
                          <span>
                            Break {formatClockTime(activeBreak.at)} - {formatClockTime(activeBreakEndTime.toISOString())}
                          </span>
                        </div>
                      ) : null}
                      {activeIsClockedIn && myShift?.notes ? (
                        <p className="active-shift-note"><strong>Shift note:</strong> {myShift.notes}</p>
                      ) : null}
                    </div>
                    <div className="clock-actions">
                      {activeIsClockedIn ? (
                        <div className="break-action-group">
                          <button
                            type="button"
                            className="break-action"
                            onClick={() => activeBreak ? requestTimeException("break_end") : setShowBreakOptions((current) => !current)}
                            aria-expanded={activeBreak ? undefined : showBreakOptions}
                          >
                            {activeBreak ? "Finish Break" : "Take Break"}
                          </button>
                          {!activeBreak && showBreakOptions ? (
                            <div className="break-options" role="menu" aria-label="Break duration">
                              <button type="button" onClick={() => takeBreak({ seconds: 5 })} role="menuitem">5 sec</button>
                              <button type="button" onClick={() => takeBreak({ minutes: 30 })} role="menuitem">30 min</button>
                              <button type="button" onClick={() => takeBreak({ minutes: 45 })} role="menuitem">45 min</button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {!activeBreak ? (
                        <button
                          type="button"
                          className={activeIsClockedIn ? "danger-action" : "primary-action"}
                          disabled={!canLaunchTimeClock}
                          onClick={() => requestTimeException(activeIsClockedIn ? "out" : "in")}
                        >
                          {activeIsClockedIn ? "Clock out" : "Clock in"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <PanelHeading eyebrow="Own shift" title="My shift today" />
                  {myShift ? <ShiftRow shift={myShift} paidHours={formatScheduledHours(myShift)} employee={activeEmployee} /> : <EmptyState text="No shift assigned today." />}
                </section>
              {mode === "manager" ? (
                <section className="panel">
                  <PanelHeading eyebrow="Manager" title="Manager overview" />
                  <div className="manager-summary">
                    <Metric label="Scheduled today" value={todaysShifts.length.toString()} />
                    <Metric label="Clocked in" value={clockedInIds.size.toString()} />
                  </div>
                  <div className="control-grid">
                    <button type="button" onClick={() => navigateToView("employees")}>Manage employees</button>
                    <button type="button" onClick={() => navigateToView("schedule")}>Manage schedule</button>
                    <button type="button" onClick={() => navigateToView("clockins")}>View clock-ins</button>
                    <button type="button" onClick={() => navigateToView("time_off")}>View PTO</button>
                  </div>
                </section>
              ) : null}

              <section className="panel">
                <div className="panel-heading calendar-heading">
                  <div>
                    <p className="eyebrow">Upcoming shifts</p>
                    <h2>{calendarTabTitle(activeCalendarTab)}</h2>
                  </div>
                  <div className="tab-list" role="tablist" aria-label="Calendar range">
                    {(["today", "week", "month"] as CalendarTab[]).map((tab) => (
                      <button
                        type="button"
                        key={tab}
                        className={activeCalendarTab === tab ? "tab-button active" : "tab-button"}
                        onClick={() => setActiveCalendarTab(tab)}
                        role="tab"
                        aria-selected={activeCalendarTab === tab}
                      >
                        {capitalize(tab)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="shift-stack">
                  {calendarShifts.length > 0 ? (
                    calendarShifts.map((shift) => (
                      <ShiftRow
                        key={shift.id}
                        shift={shift}
                        paidHours={formatScheduledHours(shift)}
                        employee={employeeById(state.employees, shift.employeeId)}
                        compact
                        showDate={activeCalendarTab !== "today"}
                      />
                    ))
                  ) : (
                    <EmptyState text={`No shifts scheduled for ${calendarTabEmptyLabel(activeCalendarTab)}.`} />
                  )}
                </div>
              </section>

            </div>
          )}

          {activeView === "departments_roles" && mode === "manager" && (
            <section className="department-roles-view">
              <div className="department-roles-heading">
                <h3>Departments and Roles</h3>
                {isAddingDepartment ? (
                  <input
                    value={newDepartmentName}
                    onChange={(event) => setNewDepartmentName(event.target.value)}
                    onBlur={addDepartment}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setNewDepartmentName("");
                        setIsAddingDepartment(false);
                      }
                    }}
                    placeholder="Add department name"
                    aria-label="Add department name"
                    autoFocus
                  />
                ) : (
                  <button type="button" onClick={() => setIsAddingDepartment(true)}>Add new department</button>
                )}
              </div>
              <DepartmentManagerFeedback control={departmentManagers} />
              <div className="panel department-roles-panel">
                <div className="department-roles-table" role="table" aria-label="Departments and roles">
                  <div className="department-roles-header" role="row">
                    <span role="columnheader">Department</span>
                    <span role="columnheader">Type to create a new role or search existing roles</span>
                    <span role="columnheader">Add Managers to Departments</span>
                  </div>
                  {state.departments.map((department, departmentIndex) => {
                    const displayedRoles = rolesForDepartment(department, state.departments, rosterRoles);
                    return (
                      <div className="department-roles-row" role="row" key={department.id}>
                      <div className="department-name-cell" role="cell">
                        {editingDepartmentId === department.id ? (
                          <input
                            value={departmentNameDraft}
                            onChange={(event) => setDepartmentNameDraft(event.target.value)}
                            onBlur={() => saveDepartmentName(department.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              if (event.key === "Escape") {
                                setEditingDepartmentId(null);
                                setDepartmentNameDraft("");
                              }
                            }}
                            placeholder="Department not set"
                            aria-label={`Department name for ${department.name}`}
                            autoFocus
                          />
                        ) : (
                          <>
                            <span>{department.name || "Department not set"}</span>
                            <button
                              type="button"
                              className="department-edit-button"
                              onClick={() => startEditingDepartment(department)}
                              aria-label={`Edit ${department.name || "department"} name`}
                              title="Edit department name"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                      <div
                        className="department-role-tags"
                        role="cell"
                        onClick={(event) => event.currentTarget.querySelector("input")?.focus()}
                      >
                        <small className="department-cell-label">Job roles</small>
                        {displayedRoles.map((role) => (
                          <span key={role}>
                            {role}
                            <button
                              type="button"
                              onClick={() => removeDepartmentRole(department.id, role)}
                              aria-label={`Remove ${role} role from ${department.name}`}
                            >×</button>
                          </span>
                        ))}
                        <input
                          value={departmentRoleDrafts[department.id] ?? ""}
                          onChange={(event) => setDepartmentRoleDrafts((current) => ({
                            ...current,
                            [department.id]: event.target.value,
                          }))}
                          onBlur={() => addDepartmentRole(department.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          placeholder="Add role"
                          aria-label={`Add role to ${department.name}`}
                        />
                      </div>
                      <DepartmentManagerCell departmentId={department.id} name={department.name} control={departmentManagers} saved={shared.data.departmentManagers} />
                      {departmentIndex > 0 ? (
                        <button
                          type="button"
                          className="department-row-remove"
                          onClick={() => removeDepartment(department.id)}
                          aria-label={`Delete ${department.name} department`}
                          title="Delete department"
                        >×</button>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {mode === "manager" && (
            <section className={activeView === "employees"
              ? viewingRosterEmployee ? "team-member-profile-view" : "panel feature-panel"
              : "employee-modal-host"}
            >
              <div className="roster-heading" hidden={activeView !== "employees" || Boolean(viewingRosterEmployee)}>
                <PanelHeading eyebrow="Team" title="Roster" /><a href="/team">Team details, jobs, wages &amp; invitations</a>
                <div className="roster-add-toolbar">
                  <button type="button" className="roster-copy-button" onClick={() => window.print()} aria-label="Print team roster" title="Print team roster">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z" /><path d="M17 11h.01" /></svg>
                  </button>
                  <button type="button" className="roster-copy-button" onClick={downloadRoster} aria-label="Download team roster" title="Download team roster (CSV)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => window.location.assign("/team")}
                    aria-expanded={isAddingEmployee}
                    aria-controls="add-team-member-form"
                    hidden={isAddingEmployee}
                  >
                    Add team member
                  </button>
                </div>
              </div>
              {activeView === "employees" && viewingRosterEmployee ? (
                <div className="team-member-profile">
                  <button type="button" className="team-member-profile-back" onClick={closeRosterEmployeeProfile}>
                    <span aria-hidden="true">←</span><span className="team-member-profile-back-label">Back</span>
                  </button>

                  <section className="team-member-profile-summary">
                    <span className="team-member-profile-avatar" aria-hidden="true">
                      {employeeInitials(viewingRosterEmployee.name)}
                    </span>
                    <div className="team-member-profile-summary-copy">
                      <h2>{viewingRosterEmployee.name}</h2><a href="/team">Edit job assignments, dated wages, hire date and photo</a>
                      {viewingRosterEmployee.id === accountOwnerEmployeeId ? <strong>Account Owner</strong> : null}
                      <p>
                        {viewingRosterEmployee.accessLevel || "Employee"} at {viewingRosterEmployee.location || sidebarLocationName}
                      </p>
                      <p>
                        {[viewingRosterEmployee.phone, viewingRosterEmployee.email].filter(Boolean).join(" · ") || "No contact information added"}
                      </p>
                    </div>
                    <div className="team-member-profile-summary-actions">
                      {viewingRosterEmployee.id !== activeEmployeeId ? (
                        <button
                          type="button"
                          className={viewingRosterEmployee.terminated ? "team-member-rehire" : "team-member-terminate"}
                          onClick={() => viewingRosterEmployee.terminated
                            ? rehireRosterEmployee(viewingRosterEmployee.id)
                            : openTerminationFlow(viewingRosterEmployee.id)}
                        >
                          {viewingRosterEmployee.terminated ? "Rehire" : "Terminate"}
                        </button>
                      ) : null}
                      {viewingRosterEmployee.id !== activeEmployeeId && !viewingRosterEmployee.terminated ? (
                        <button
                          type="button"
                          className="team-member-message"
                          onClick={() => messageRosterEmployee(viewingRosterEmployee.id)}
                          disabled={!scheduleEnforcement.enableTeamMessaging}
                        >
                          Message
                        </button>
                      ) : null}
                    </div>
                  </section>

                  <div className="team-member-profile-layout">
                    <nav className="team-member-profile-tabs" aria-label="Team member profile sections">
                      {([
                        ["job", "▣", "Job details"],
                        ["personal", "♙", "Personal information"],
                        ["documents", "▤", "Documents"],
                        ["performance", "⌁", "Performance"],
                      ] as [TeamMemberProfileTab, string, string][]).map(([tab, icon, label]) => (
                        <button
                          type="button"
                          key={tab}
                          className={teamMemberProfileTab === tab ? "active" : ""}
                          onClick={() => setTeamMemberProfileTab(tab)}
                          aria-current={teamMemberProfileTab === tab ? "page" : undefined}
                        >
                          <span aria-hidden="true">{icon}</span>{label}
                        </button>
                      ))}
                    </nav>

                    <div className="team-member-profile-content">
                      {teamMemberProfileTab === "job" ? (
                        <>
                          <section className="team-member-profile-card team-member-job-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Access, roles &amp; wages</h3>
                              <button type="button" onClick={() => editRosterEmployeeFromProfile(viewingRosterEmployee.id)}>✎ Edit</button>
                            </div>
                            <div className="team-member-location-heading">
                              <label className="team-member-location-toggle">
                                <input
                                  type="checkbox"
                                  role="switch"
                                  checked={viewingRosterEmployee.active}
                                  disabled={Boolean(viewingRosterEmployee.terminated)}
                                  onChange={(event) => updateEmployeeStatus(viewingRosterEmployee.id, event.target.checked)}
                                  aria-label={`Active at ${viewingRosterEmployee.location || sidebarLocationName}`}
                                />
                                <span aria-hidden="true" />
                                <strong>{viewingRosterEmployee.location || sidebarLocationName}</strong>
                              </label>
                              <span className={viewingRosterEmployee.active ? "active" : "inactive"}>
                                {viewingRosterEmployee.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            <div className={viewingRosterEmployee.active ? "team-member-job-details" : "team-member-job-details inactive"}>
                              <dl className="team-member-job-facts">
                                <div><dt>Access:</dt><dd>{viewingRosterEmployee.accessLevel || "Employee"}</dd></div>
                                <div><dt>PIN:</dt><dd>****</dd></div>
                                <div><dt>Start date:</dt><dd>{formatShortDate(viewingRosterEmployee.startDate)}</dd></div>
                                <div><dt>Payroll ID:</dt><dd>{viewingRosterEmployee.payrollId || "--"}</dd></div>
                                <div><dt>Role(s) &amp; wage(s):</dt><dd>{viewingRosterEmployee.role || "--"}{viewingRosterEmployee.wage ? `, ${viewingRosterEmployee.wage}` : ""}</dd></div>
                              </dl>
                              <details className="team-member-location-settings" open>
                                <summary>Location settings</summary>
                                <label><input type="checkbox" disabled={!viewingRosterEmployee.active} checked={viewingRosterEmployee.locationSettings.showInSchedule} onChange={(event) => updateEmployeeLocationSetting(viewingRosterEmployee.id, "showInSchedule", event.target.checked)} /> Show in schedule</label>
                                <label><input type="checkbox" disabled={!viewingRosterEmployee.active} checked={viewingRosterEmployee.locationSettings.sendLocationAlerts} onChange={(event) => updateEmployeeLocationSetting(viewingRosterEmployee.id, "sendLocationAlerts", event.target.checked)} /> Send location alerts</label>
                                <label><input type="checkbox" disabled={!viewingRosterEmployee.active} checked={viewingRosterEmployee.locationSettings.includeInTimeClockErrors} onChange={(event) => updateEmployeeLocationSetting(viewingRosterEmployee.id, "includeInTimeClockErrors", event.target.checked)} /> Include in time clock errors</label>
                                <label><input type="checkbox" disabled={!viewingRosterEmployee.active} checked={viewingRosterEmployee.locationSettings.eligibleForOpenShifts} onChange={(event) => updateEmployeeLocationSetting(viewingRosterEmployee.id, "eligibleForOpenShifts", event.target.checked)} /> Eligible for open shifts</label>
                                <label><input type="checkbox" disabled={!viewingRosterEmployee.active} checked={viewingRosterEmployee.locationSettings.canWaiveMissedBreaks} onChange={(event) => updateEmployeeLocationSetting(viewingRosterEmployee.id, "canWaiveMissedBreaks", event.target.checked)} /> {viewingRosterEmployee.name.split(" ")[0]} can waive missed breaks</label>
                              </details>
                            </div>
                          </section>

                          <section className="team-member-profile-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Payroll information</h3>
                              {editingPayrollEmployeeId !== viewingRosterEmployee.id ? (
                                <button type="button" disabled={!shared.data.permissions["team.manage"] || !shared.data.permissions["team.private.read"]} onClick={() => startEditingPayrollClassification(viewingRosterEmployee)}>✎ Edit</button>
                              ) : null}
                            </div>
                            {editingPayrollEmployeeId === viewingRosterEmployee.id ? (
                              <div className="team-member-payroll-editor">
                                <label>
                                  <span>Payroll classification:</span>
                                  <select
                                    value={payrollClassificationDraft}
                                    onChange={(event) => setPayrollClassificationDraft(event.target.value as PayrollClassification)}
                                    aria-label="Payroll classification"
                                  >
                                    <option value="W-2 Employee">W-2 Employee</option>
                                    <option value="1099 Contractor">1099 Contractor</option>
                                  </select>
                                </label>
                                <div>
                                  <button type="button" onClick={() => setEditingPayrollEmployeeId(null)}>Cancel</button>
                                  <button type="button" className="primary-action" onClick={() => savePayrollClassification(viewingRosterEmployee.id)}>Save</button>
                                </div>
                              </div>
                            ) : (
                              <p><strong>Payroll classification:</strong> {viewingRosterEmployee.payrollClassification ?? "Restricted"}</p>
                            )}
                          </section>

                          <section className="team-member-profile-card">
                            <div className="team-member-profile-card-heading"><h3>Recent job history</h3></div>
                            <div className="team-member-job-history">
                              {[...(viewingRosterEmployee.employmentHistory ?? [])].reverse().map((historyEvent, index) => (
                                <p key={`${historyEvent.type}-${historyEvent.date}-${index}`}>
                                  <span aria-hidden="true">●</span>
                                  <strong>
                                    {historyEvent.type === "terminated"
                                      ? `Terminated from ${viewingRosterEmployee.location || sidebarLocationName}${historyEvent.reason ? ` — ${historyEvent.reason}` : ""}`
                                      : `Rehired at ${viewingRosterEmployee.location || sidebarLocationName}`}
                                  </strong>
                                  <time>{formatShortDate(historyEvent.date)}</time>
                                </p>
                              ))}
                              <p><span aria-hidden="true">●</span><strong>Started as {viewingRosterEmployee.role || "a team member"} at {viewingRosterEmployee.location || sidebarLocationName}{viewingRosterEmployee.wage ? ` (${viewingRosterEmployee.wage})` : ""}</strong><time>{formatShortDate(viewingRosterEmployee.startDate)}</time></p>
                              <p><span aria-hidden="true">●</span><strong>Hired at {viewingRosterEmployee.location || sidebarLocationName}</strong><time>{formatShortDate(viewingRosterEmployee.startDate)}</time></p>
                            </div>
                          </section>

                          <section className="team-member-profile-card">
                            <div className="team-member-profile-card-heading"><h3>Time off balances</h3></div>
                            <div className="team-member-time-off-table" role="table" aria-label={`${viewingRosterEmployee.name} time off balances`}>
                              <div role="row"><span role="columnheader">Time Off Category</span><span role="columnheader">Policy Name</span><span role="columnheader">Balance</span></div>
                              <div role="row"><span role="cell">Paid Time Off</span><span role="cell">{viewingRosterEmployeePtoPolicy?.name ?? "No policy"}</span><span role="cell">{formatPtoHours((viewingRosterEmployeePto?.ptoHours ?? 0) - (viewingRosterEmployeePto?.ptoUsed ?? 0))}</span></div>
                            </div>
                          </section>
                        </>
                      ) : teamMemberProfileTab === "personal" ? (
                        <div className="team-member-personal-content">
                          <section className="team-member-profile-card team-member-personal-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Contact information</h3>
                              {editingPersonalContactEmployeeId !== viewingRosterEmployee.id ? (
                                <button type="button" onClick={() => startEditingPersonalContact(viewingRosterEmployee)}>✎ Edit</button>
                              ) : null}
                            </div>
                            {editingPersonalContactEmployeeId === viewingRosterEmployee.id ? (
                              <form className="team-member-contact-editor" onSubmit={(event) => savePersonalContact(event, viewingRosterEmployee.id)}>
                                <div className="contact-editor-row">
                                  <label htmlFor="contact-first-name">Preferred name</label>
                                  <div className="contact-name-fields">
                                    <input id="contact-first-name" aria-label="Preferred first name" autoComplete="given-name" ref={personalContactFirstNameRef} required value={personalContactDraft.firstName} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, firstName: event.target.value }))} />
                                    <input aria-label="Preferred last name" autoComplete="family-name" value={personalContactDraft.lastName} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, lastName: event.target.value }))} />
                                  </div>
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="contact-email">Personal email</label>
                                  <input id="contact-email" className="contact-email-field" type="email" autoComplete="email" value={personalContactDraft.email} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, email: event.target.value }))} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="contact-mobile">Mobile number</label>
                                  <input id="contact-mobile" className="contact-mobile-field" type="tel" autoComplete="tel" value={personalContactDraft.phone} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, phone: formatPhoneNumberInput(event.target.value) }))} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="contact-emergency-name">Emergency contact</label>
                                  <div className="contact-emergency-fields">
                                    <input id="contact-emergency-name" aria-label="Emergency contact name" placeholder="Name" value={personalContactDraft.emergencyContact} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, emergencyContact: event.target.value }))} />
                                    <input aria-label="Emergency contact relationship" placeholder="Relationship" value={personalContactDraft.emergencyContactRelationship} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, emergencyContactRelationship: event.target.value }))} />
                                    <input aria-label="Emergency contact phone number" type="tel" placeholder="Phone number" value={personalContactDraft.emergencyContactPhone} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, emergencyContactPhone: formatPhoneNumberInput(event.target.value) }))} />
                                  </div>
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="contact-emergency-notification">Emergency contact notification preference</label>
                                  <label className="contact-notification-option">
                                    <input id="contact-emergency-notification" type="checkbox" checked={personalContactDraft.notifyEmergencyContact} onChange={(event) => setPersonalContactDraft((draft) => ({ ...draft, notifyEmergencyContact: event.target.checked }))} />
                                    <span>{emergencyContactNotificationLabel}</span>
                                  </label>
                                </div>
                                {personalContactError ? <p className="form-message" role="alert">{personalContactError}</p> : null}
                                <div className="contact-editor-actions">
                                  <button type="button" onClick={() => setEditingPersonalContactEmployeeId(null)}>Cancel</button>
                                  <button type="submit" className="primary-action" disabled={!personalContactHasChanges || !personalContactDraft.firstName.trim()}>Save</button>
                                </div>
                              </form>
                            ) : (
                            <dl className="team-member-personal-details">
                              <div><dt>Preferred name</dt><dd>{viewingRosterEmployee.name}</dd></div>
                              <div>
                                <dt>Personal email</dt>
                                <dd>
                                  <span>{viewingRosterEmployee.email || "Not added"}</span>
                                </dd>
                              </div>
                              <div><dt>Mobile number</dt><dd>{viewingRosterEmployee.phone || "Not added"}</dd></div>
                              <div><dt>Emergency contact</dt><dd>{[viewingRosterEmployee.emergencyContact, viewingRosterEmployee.emergencyContactRelationship, viewingRosterEmployee.emergencyContactPhone].filter(Boolean).join(", ") || "Not added"}</dd></div>
                              <div><dt>Emergency contact notification preference</dt><dd>{viewingRosterEmployee.emergencyContactPreference || "Not added"}</dd></div>
                            </dl>
                            )}
                          </section>

                          <section className="team-member-profile-card team-member-personal-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Payroll information</h3>
                              {editingPersonalPayrollEmployeeId !== viewingRosterEmployee.id ? (
                                <button type="button" onClick={() => startEditingPersonalPayroll(viewingRosterEmployee)}>✎ Edit</button>
                              ) : null}
                            </div>
                            {editingPersonalPayrollEmployeeId === viewingRosterEmployee.id ? (
                              <form className="team-member-personal-payroll-editor" onSubmit={(event) => savePersonalPayroll(event, viewingRosterEmployee.id)}>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-first-name">Legal name</label>
                                  <div className="payroll-name-fields">
                                    <input id="payroll-first-name" aria-label="Legal first name" placeholder="First name" ref={personalPayrollFirstNameRef} required autoComplete="given-name" value={personalPayrollDraft.legalFirstName} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, legalFirstName: event.target.value }))} />
                                    <input aria-label="Legal middle name" placeholder="Middle name" autoComplete="additional-name" value={personalPayrollDraft.legalMiddleName} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, legalMiddleName: event.target.value }))} />
                                    <input aria-label="Legal last name" placeholder="Last name" autoComplete="family-name" value={personalPayrollDraft.legalLastName} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, legalLastName: event.target.value }))} />
                                  </div>
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-date-of-birth">Date of birth</label>
                                  <input id="payroll-date-of-birth" className="payroll-short-field" type="date" autoComplete="bday" value={personalPayrollDraft.dateOfBirth} onInput={(event) => { const dateOfBirth = event.currentTarget.value; setPersonalPayrollDraft((draft) => ({ ...draft, dateOfBirth })); }} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-social-security-number">Social Security number</label>
                                  <input id="payroll-social-security-number" className="payroll-short-field" placeholder="xxx-xx-xxxx" inputMode="numeric" maxLength={11} pattern="([0-9]{3}-[0-9]{2}|•••-••)-[0-9]{4}" title="Only the last four digits are displayed. Enter all nine digits to replace the stored number." value={personalPayrollDraft.socialSecurityNumber} onChange={(event) => {
                                  const digits = event.target.value.replace(/\D/g, "").slice(0, 9);
                                  setPersonalPayrollDraft((draft) => ({ ...draft, socialSecurityNumber: [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5)].filter(Boolean).join("-") }));
                                }} autoComplete="off" />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-address-line1">Address line 1</label>
                                  <input id="payroll-address-line1" placeholder="Address line 1" autoComplete="address-line1" value={personalPayrollDraft.homeAddress} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, homeAddress: event.target.value }))} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-address-line2">Address line 2</label>
                                  <input id="payroll-address-line2" placeholder="Address line 2" autoComplete="address-line2" value={personalPayrollDraft.homeAddressLine2} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, homeAddressLine2: event.target.value }))} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-city">City</label>
                                  <input id="payroll-city" className="payroll-short-field" placeholder="City" autoComplete="address-level2" value={personalPayrollDraft.homeCity} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, homeCity: event.target.value }))} />
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-state">State/Province</label>
                                  <select id="payroll-state" className="payroll-short-field" autoComplete="address-level1" value={personalPayrollDraft.homeStateProvince} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, homeStateProvince: event.target.value }))}>
                                    <option value="">Select state</option>
                                    {personalPayrollDraft.homeStateProvince && !payrollStates.some(([, name]) => name === personalPayrollDraft.homeStateProvince) ? <option value={personalPayrollDraft.homeStateProvince}>{personalPayrollDraft.homeStateProvince}</option> : null}
                                    {payrollStates.map(([abbreviation, name]) => <option key={abbreviation} value={name}>{name}</option>)}
                                  </select>
                                </div>
                                <div className="contact-editor-row">
                                  <label htmlFor="payroll-zip">ZIP code <span className="payroll-required" aria-hidden="true">*</span></label>
                                  <input id="payroll-zip" className="payroll-zip-field" placeholder="ZIP code" required autoComplete="postal-code" inputMode="numeric" maxLength={10} pattern="[0-9]{5}(-[0-9]{4})?" title="Enter a five-digit ZIP code or ZIP+4" value={personalPayrollDraft.homePostalCode} onChange={(event) => setPersonalPayrollDraft((draft) => ({ ...draft, homePostalCode: event.target.value }))} />
                                </div>
                                <div className="payroll-editor-actions contact-editor-actions">
                                  <button type="button" onClick={() => setEditingPersonalPayrollEmployeeId(null)}>Cancel</button>
                                  <button type="submit" className="primary-action" disabled={!personalPayrollHasChanges || !personalPayrollDraft.legalFirstName.trim() || !personalPayrollDraft.homePostalCode.trim()}>Save</button>
                                </div>
                              </form>
                            ) : (
                              <dl className="team-member-personal-details payroll-details">
                                <div><dt>Legal name</dt><dd>{employeeLegalName(viewingRosterEmployee)}</dd></div>
                                <div><dt>Date of birth</dt><dd>{viewingRosterEmployee.dateOfBirth ? formatNumericDate(`${viewingRosterEmployee.dateOfBirth}T12:00:00`) : "Not added"}</dd></div>
                                <div><dt>Social Security number</dt><dd>{viewingRosterEmployee.socialSecurityNumber || "Not added"}</dd></div>
                                <div className="personal-address-row"><dt>Home address</dt><dd><span>{viewingRosterEmployee.homeAddress || "Not added"}</span>{viewingRosterEmployee.homeAddressLine2 ? <span>{viewingRosterEmployee.homeAddressLine2}</span> : null}{viewingRosterEmployee.homeCityStateZip ? <span>{viewingRosterEmployee.homeCityStateZip}</span> : null}</dd></div>
                              </dl>
                            )}
                          </section>
                        </div>
                      ) : teamMemberProfileTab === "documents" ? (
                        <div className="team-member-documents-content">
                          <section className="team-member-profile-card certificate-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Certificates ({viewingRosterEmployee.certificates?.length ?? 0})</h3>
                              <button type="button" className="document-upload-button" ref={addCertificateButtonRef} onClick={() => openCertificateModal(viewingRosterEmployee.id)}>
                                Add a certificate
                              </button>
                            </div>
                            {(viewingRosterEmployee.certificates?.length ?? 0) === 0 ? (
                              <p className="documents-empty-message">No certificates added for {viewingRosterEmployee.name.split(" ")[0]} yet.</p>
                            ) : (
                              <div className="certificate-list">
                                {viewingRosterEmployee.certificates?.map((certificate) => (
                                  <div key={certificate.id}>
                                    <div className="certificate-details"><strong>{certificate.name}</strong>{certificate.expirationDate ? <span>Expires {formatNumericDate(`${certificate.expirationDate}T12:00:00`)}</span> : null}</div>
                                    {certificate.fileId ? <button type="button" className="certificate-download" disabled={!shared.data.permissions["documents.download"]} onClick={() => downloadCertificate(certificate)} aria-label={`Download ${certificate.fileName}`}>{certificate.fileName}</button> : <span>{certificate.fileName || "No attachment"}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {certificateDownloadError ? <p className="form-message" role="alert">{certificateDownloadError}</p> : null}
                          </section>

                          <section className="team-member-profile-card onboarding-card">
                            <div className="team-member-profile-card-heading">
                              <h3>Onboarding ({Object.keys(viewingRosterEmployee.onboardingDocuments ?? {}).length})</h3>
                              <button type="button" disabled title="All onboarding document types are already listed">Add a document</button>
                            </div>
                            <div className="onboarding-documents-table" role="table" aria-label={`${viewingRosterEmployee.name} onboarding documents`}>
                              <div className="onboarding-document-header" role="row">
                                <span role="columnheader">Name</span>
                                <span role="columnheader">Versions</span>
                                <span role="columnheader">File</span>
                              </div>
                              {onboardingDocumentNames.map((documentName) => {
                                const uploadedFileName = viewingRosterEmployee.onboardingDocuments?.[documentName];
                                return (
                                  <div className="onboarding-document-row" role="row" key={documentName}>
                                    <span role="cell">{documentName}</span>
                                    <span role="cell">{uploadedFileName ? 1 : 0}</span>
                                    <span role="cell" className="onboarding-document-files">
                                      {viewingRosterEmployee.onboardingFileIds?.[documentName] ? <button type="button" className="onboarding-download-button" disabled={!shared.data.permissions["documents.download"]} onClick={() => void downloadPrivateFile(viewingRosterEmployee.onboardingFileIds![documentName], uploadedFileName ?? documentName)} aria-label={`Download ${documentName} for ${viewingRosterEmployee.name}`}>Download</button> : null}
                                      <label className={uploadedFileName ? "onboarding-file-action sent" : "onboarding-file-action"}>
                                        <strong aria-hidden="true">+</strong>
                                        <span>{uploadedFileName || "Not sent"}</span>
                                        <input
                                          type="file"
                                          aria-label={`Upload ${documentName} for ${viewingRosterEmployee.name}`}
                                          accept=".pdf,.png,.jpg,.jpeg,.gif"
                                          disabled={!shared.data.permissions["documents.manage"] || !shared.data.permissions["team.private.read"]}
                                          onChange={(event) => {
                                            uploadOnboardingDocument(viewingRosterEmployee.id, documentName, event.target.files?.[0]);
                                            event.target.value = "";
                                          }}
                                        />
                                      </label>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        </div>
                      ) : (
                        <div className="team-member-performance-content">
                          <EmployeeReliabilityPanel key={viewingRosterEmployee.id} employeeId={viewingRosterEmployee.id} />

                          <section className="team-member-profile-card performance-manager-notes-card">
                            <h3>Manager notes</h3>
                            <label>
                              <span>Add new note</span>
                              <textarea
                                value={managerNoteDraft}
                                onChange={(event) => setManagerNoteDraft(event.target.value)}
                                placeholder="Add a note to this employee. Only managers can see this."
                              />
                            </label>
                            <button type="button" onClick={() => addManagerNote(viewingRosterEmployee.id)} disabled={!managerNoteDraft.trim()}>Add note</button>
                            {(viewingRosterEmployee.managerNotes?.length ?? 0) > 0 ? (
                              <div className="manager-note-list">
                                {[...(viewingRosterEmployee.managerNotes ?? [])].reverse().map((note) => (
                                  <div key={note.id}><p>{note.text}</p><time>{formatShortDate(note.createdAt.slice(0, 10))}</time></div>
                                ))}
                              </div>
                            ) : null}
                          </section>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {isAddingEmployee ? (
                <div className="modal-backdrop" role="presentation">
                  <form
                    id="add-team-member-form"
                    className="team-member-modal"
                    onSubmit={saveEmployee}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="add-team-member-title"
                  >
                    <div className="team-member-modal-heading">
                      <h2 id="add-team-member-title">{editingEmployeeId === null ? "Add team member" : "Edit team member"}</h2>
                      <button type="button" onClick={cancelAddingEmployee} aria-label="Close add team member">×</button>
                    </div>
                    <div className="team-member-modal-body">
                      <section className="team-member-form-section">
                        <h3>Contact information</h3>
                        <div className="team-member-field-grid">
                          <label>
                            <span>First name <b aria-hidden="true">*</b></span>
                            <input
                              value={employeeForm.firstName}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, firstName: event.target.value }))}
                              autoComplete="given-name"
                              autoFocus
                              required
                            />
                          </label>
                          <label>
                            <span>Last name <b aria-hidden="true">*</b></span>
                            <input
                              value={employeeForm.lastName}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, lastName: event.target.value }))}
                              autoComplete="family-name"
                              required={editingEmployeeId === null}
                            />
                          </label>
                          <label>
                            <span>Email <b aria-hidden="true">*</b></span>
                            <input
                              type="email"
                              value={employeeForm.email}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, email: event.target.value }))}
                              autoComplete="email"
                              required
                            />
                          </label>
                          <label>
                            <span>Mobile phone number <b aria-hidden="true">*</b></span>
                            <input
                              type="tel"
                              value={employeeForm.phone}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, phone: formatPhoneNumberInput(event.target.value) }))}
                              placeholder="(___) ___-____"
                              autoComplete="tel"
                              maxLength={14}
                              required
                            />
                          </label>
                        </div>
                      </section>

                      <section className="team-member-form-section">
                        <h3>Job details</h3>
                        <div className="team-member-field-grid job-details-grid">
                          <label>
                            <span>Location</span>
                            <select
                              value={employeeForm.location}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, location: event.target.value }))}
                            >
                              <option value="">Select</option>
                              {availableLocations.map((location) => (
                                <option value={location} key={location}>{location}</option>
                              ))}
                            </select>
                          </label>
                          <div className="team-member-field team-member-role-field">
                            <div className="team-member-field-heading">
                              <label htmlFor="new-team-member-role">Role <b aria-hidden="true">*</b></label>
                              <button
                                type="button"
                                className="team-member-add-role-button"
                                onClick={() => {
                                  setIsAddingEmployeeRole(true);
                                  window.requestAnimationFrame(() => employeeRoleInputRef.current?.focus());
                                }}
                                aria-label="Add a new role"
                                aria-expanded={isAddingEmployeeRole}
                                aria-controls="new-team-member-role"
                                title="Add role"
                              >+</button>
                            </div>
                            {isAddingEmployeeRole ? (
                              <input
                                id="new-team-member-role"
                                ref={employeeRoleInputRef}
                                value={newEmployeeRole}
                                onChange={(event) => setNewEmployeeRole(event.target.value)}
                                onBlur={() => {
                                  setNewEmployeeRole("");
                                  setIsAddingEmployeeRole(false);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addRoleFromEmployeeForm();
                                  } else if (event.key === "Escape") {
                                    setNewEmployeeRole("");
                                    setIsAddingEmployeeRole(false);
                                  }
                                }}
                                placeholder="Enter role name"
                                aria-label="New role name"
                              />
                            ) : (
                              <select
                                id="new-team-member-role"
                                value={employeeForm.role}
                                onChange={(event) => setEmployeeForm((form) => ({ ...form, role: event.target.value }))}
                                required
                              >
                                <option value="">Select</option>
                                {availableRoles.map((role) => (
                                  <option value={role} key={role}>{role}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <label>
                            <span>Wage</span>
                            <input
                              value={employeeForm.wage}
                              disabled={!shared.data.permissions["wages.manage"]}
                              onChange={(event) => setEmployeeForm((form) => ({
                                ...form,
                                wage: sanitizeWageInput(event.target.value),
                              }))}
                              onBlur={() => setEmployeeForm((form) => ({ ...form, wage: formatWageInput(form.wage) }))}
                              inputMode="decimal"
                              placeholder="$0.00/hr"
                            />
                          </label>
                          <p className="auth-hint">Set employee PINs separately in <a href="/kiosk-admin">Tablet &amp; PIN access</a>. Dashboard account rights are managed separately.</p>
                        </div>
                        <div className="team-member-setting-fields">
                          <fieldset disabled className="team-member-option-group team-member-access-level">
                            <legend>Access level</legend>
                            <div className="team-member-pill-options team-member-access-options">
                              {(["Admin", "Manager", "Employee"] as const).map((accessLevel) => (
                                <label className={`access-${accessLevel.toLocaleLowerCase()}`} key={accessLevel}>
                                  <input
                                    type="radio"
                                    name="new-team-member-access-level"
                                    value={accessLevel}
                                    checked={employeeForm.accessLevel === accessLevel}
                                    onChange={() => setEmployeeForm((form) => ({ ...form, accessLevel }))}
                                  />
                                  <span>{accessLevel}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          {editingEmployeeId === null ? (
                            <fieldset className="team-member-option-group team-member-status">
                              <legend>Status</legend>
                              <div className="team-member-pill-options team-member-status-options">
                                {([true, false] as const).map((isActive) => (
                                  <label className={isActive ? "active" : "inactive"} key={String(isActive)}>
                                    <input
                                      type="radio"
                                      name="new-team-member-status"
                                      value={isActive ? "active" : "inactive"}
                                      checked={employeeForm.active === isActive}
                                      onChange={() => setEmployeeForm((form) => ({ ...form, active: isActive }))}
                                    />
                                    <span>{isActive ? "Active" : "Inactive"}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ) : null}
                        </div>
                      </section>
                    </div>
                    {employeeMessage ? <p className="form-message" role="alert">{employeeMessage}</p> : null}
                    <div className="team-member-modal-actions">
                      <button type="button" className="secondary-action" onClick={cancelAddingEmployee}>Cancel</button>
                      <button type="submit">{editingEmployeeId === null ? "Add team member" : "Save changes"}</button>
                    </div>
                  </form>
                </div>
              ) : null}
              <div className="roster-list" hidden={activeView !== "employees" || Boolean(viewingRosterEmployee)}>
                <div className="roster-toolbar">
                  <label className="roster-search">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
                    <input
                      type="search"
                      aria-label="Search team members by name"
                      placeholder="Search team members…"
                      value={rosterSearch}
                      onChange={(event) => { setRosterSearch(event.target.value); setRosterActionEmployeeId(null); }}
                    />
                  </label>
                  <span className="roster-member-count" role="status">{filteredRosterEmployees.length} team {filteredRosterEmployees.length === 1 ? "member" : "members"}</span>
                  <div className="roster-toolbar-actions">
                    <label className="roster-terminated-toggle">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={showTerminatedEmployees}
                        onChange={(event) => { setShowTerminatedEmployees(event.target.checked); setRosterActionEmployeeId(null); }}
                      />
                      <span className="roster-switch-track" aria-hidden="true" />
                      <span>Show terminated</span>
                    </label>
                    <button
                      type="button"
                      className="roster-filter-button"
                      aria-expanded={isRosterFilterOpen}
                      aria-controls="roster-filters"
                      onClick={() => { setIsRosterFilterOpen((open) => !open); setRosterActionEmployeeId(null); }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8v7l-4 2V12z" /></svg>
                      Filter
                    </button>
                  </div>
                </div>
                <div className="roster-filters" id="roster-filters" hidden={!isRosterFilterOpen}>
                  <label>
                    <span>Access</span>
                    <select value={rosterAccessFilter} onChange={(event) => { setRosterAccessFilter(event.target.value); setRosterActionEmployeeId(null); }}>
                      <option value="">All access</option>
                      <option value="Admin">Admin</option>
                      <option value="Manager">Manager</option>
                      <option value="Employee">Employee</option>
                    </select>
                  </label>
                  <label>
                    <span>Role</span>
                    <select value={rosterRoleFilter} onChange={(event) => { setRosterRoleFilter(event.target.value); setRosterActionEmployeeId(null); }}>
                      <option value="">All roles</option>
                      {rosterFilterRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Missing information</span>
                    <select value={rosterMissingFilter} onChange={(event) => { setRosterMissingFilter(event.target.value); setRosterActionEmployeeId(null); }}>
                      <option value="">--</option>
                      {shared.data.permissions["wages.read"] ? <option value="wage">Wage rates</option> : null}
                      <option value="contact">Contact information</option>
                      <option value="role">Role</option>
                      <option value="birth">Date of birth</option>
                    </select>
                  </label>
                </div>
              <div className="roster-table-wrap">
                <div className={`roster-table${shared.data.permissions["wages.read"] ? "" : " without-wages"}`} role="table" aria-label="Team roster">
                  <div className="roster-header" role="row">
                    <span role="columnheader">Team member</span>
                    <span role="columnheader">Contact information</span>
                    <span role="columnheader">Access level</span>
                    <span role="columnheader">Location</span>
                    <span role="columnheader">Role</span>
                    {shared.data.permissions["wages.read"] ? <span role="columnheader">Wage</span> : null}
                    <span role="columnheader">Status</span>
                    <span role="columnheader" aria-label="Actions" />
                  </div>
                  {filteredRosterEmployees.map((employee) => (
                      <article
                        className="roster-row"
                        role="row"
                        key={employee.id}
                      >
                        <div className="roster-member" role="cell">
                          <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                          <div>
                            <button type="button" className="roster-name-link" onClick={() => openRosterEmployeeProfile(employee.id)}>
                              {employee.name}
                            </button>
                            {employee.id === accountOwnerEmployeeId ? <span className="roster-account-owner">Account Owner</span> : null}
                            <small>PIN managed separately</small>
                          </div>
                        </div>
                        <div className="roster-contact" role="cell">
                          <span>{employee.email}</span><span>{employee.phone}</span>
                        </div>
                        <div role="cell">
                          {employee.accessLevel}
                        </div>
                        <div role="cell">{employee.location}</div>
                        <div role="cell">{employee.role}</div>
                        {shared.data.permissions["wages.read"] ? <div role="cell">{employee.wage}</div> : null}
                        <div
                          role="cell"
                          className={employee.active ? "roster-status active" : "roster-status"}
                        >
                          {employee.terminated ? "Terminated" : employee.active ? "Active" : "Inactive"}
                        </div>
                        <div className="roster-actions" role="cell">
                          <button
                            type="button"
                            className="roster-action-button"
                            onClick={(event) => toggleRosterActions(event, employee.id)}
                            aria-label={`Actions for ${employee.name}`}
                            aria-haspopup="menu"
                            aria-expanded={rosterActionEmployeeId === employee.id}
                            aria-controls={rosterActionEmployeeId === employee.id ? "roster-action-menu" : undefined}
                            title="Team member actions"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
                            </svg>
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              </div>
                {filteredRosterEmployees.length === 0 ? <p className="roster-empty" role="status">No team members match your search or filters.</p> : null}
              </div>
            </section>
          )}

          {activeView === "schedule" && (
            <div className="shift-planner-layout">
              <section className="panel feature-panel shift-planner-panel">
              <div className="shift-planner-topbar">
                <button type="button" className="shift-today-button" onClick={() => setScheduleDate(today)}>Today</button>
                <div className="shift-date-navigation">
                  <button type="button" className="shift-arrow-button" onClick={() => moveScheduleDate(-1)} aria-label={`Previous ${employeeScheduleTab}`}>
                    <span aria-hidden="true">‹</span>
                  </button>
                  <label className="shift-date-control">
                    <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} aria-label="Schedule date" />
                    <strong>{employeeScheduleTab === "day" ? formatLongDate(scheduleDate) : employeeScheduleTab === "month" ? formatMonthYear(scheduleDate) : `${formatShortDate(scheduleWeekDays[0].date)} – ${formatShortDate(scheduleWeekDays[6].date)}`}</strong>
                  </label>
                  <button type="button" className="shift-arrow-button" onClick={() => moveScheduleDate(1)} aria-label={`Next ${employeeScheduleTab}`}>
                    <span aria-hidden="true">›</span>
                  </button>
                </div>
                <div className="shift-planner-actions">
                  <div className="shift-view-control">
                    <select className="shift-view-select" value={employeeScheduleTab} onChange={(event) => setEmployeeScheduleTab(event.target.value as EmployeeScheduleTab)} aria-label="Schedule view">
                      <option value="week">Week</option>
                      <option value="month">Month</option>
                      <option value="day">Day</option>
                    </select>
                    <span aria-hidden="true">▾</span>
                  </div>
                  <div className="shift-employee-filter" ref={employeeFilterRef}>
                    <button
                      type="button"
                      className="shift-filter-button"
                      aria-expanded={isEmployeeFilterOpen}
                      aria-controls="employee-filter-popover"
                      onClick={() => setIsEmployeeFilterOpen((open) => !open)}
                    >
                      Filter ({visibleEmployeeIds?.length ?? shiftEmployees.length}) <span className={isEmployeeFilterOpen ? "open" : ""} aria-hidden="true">▾</span>
                    </button>
                    {isEmployeeFilterOpen ? (
                      <div className="shift-employee-filter-popover" id="employee-filter-popover">
                        <div className="shift-employee-filter-list">
                          <label className="view-all">
                            <input
                              type="checkbox"
                              checked={visibleEmployeeIds === null || shiftEmployees.every((employee) => visibleEmployeeIds.includes(employee.id))}
                              onChange={() => setVisibleEmployeeIds((ids) => {
                                const allVisible = ids === null || shiftEmployees.every((employee) => ids.includes(employee.id));
                                return allVisible ? [] : null;
                              })}
                            />
                            <span>View all</span>
                          </label>
                          {shiftEmployees.map((employee) => (
                            <label key={employee.id}>
                              <input
                                type="checkbox"
                                checked={visibleEmployeeIds === null || visibleEmployeeIds.includes(employee.id)}
                                onChange={() => setVisibleEmployeeIds((ids) => {
                                  const currentIds = ids ?? shiftEmployees.map((entry) => entry.id);
                                  return currentIds.includes(employee.id)
                                    ? currentIds.filter((id) => id !== employee.id)
                                    : [...currentIds, employee.id];
                                })}
                              />
                              <span>{employee.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {mode === "manager" ? (
                    <button
                      type="button"
                      className={`shift-publish-button${unpublishedShiftCount > 0 ? " pending" : ""}`}
                      onClick={publishSchedule}
                      disabled={unpublishedShiftCount === 0}
                    >
                      {unpublishedShiftCount > 0 ? `↑ Publish (${unpublishedShiftCount})` : "↑ Publish"}
                    </button>
                  ) : null}
                </div>
              </div>
              {copiedShift ? <div className="schedule-copy-notice" role="status">Copied {formatTimeRange(copiedShift)}. Select an add-shift cell to review and paste it. <button type="button" onClick={() => setCopiedShift(null)}>Finish pasting</button></div> : null}
              <ScheduleEstimateSummary rows={summaryRows} canReadWages={mode === "manager" && shared.data.permissions["wages.read"]} />
              {mode === "manager" ? <ScheduleWarningPanel result={scheduleWarnings} shifts={workingScheduleShifts} employees={state.employees} visibleIds={summaryShiftIds.size ? new Set([...summaryShiftIds].filter(id => summaryEmployeeIds.has(workingScheduleShifts.find(shift => shift.id === id)?.employeeId ?? -1))) : new Set()} /> : null}
              {(mode === "employee" || mode === "manager") && (
                <div className="employee-schedule">
                  {schedulePermissionError ? <p className="schedule-permission-message" role="alert">{schedulePermissionError}</p> : null}
                  {isPublicSchedule && scheduleEnforcement.employeesOwnScheduleOnly ? <p className="schedule-permission-message">Sign in with your PIN to view your schedule.</p> : null}
                  <div className="employee-schedule-tabs" role="tablist" aria-label="Schedule view">
                    {(["day", "week"] as EmployeeScheduleTab[]).map((tab) => (
                      <button
                        type="button"
                        key={tab}
                        className={employeeScheduleTab === tab ? "active" : ""}
                        onClick={() => setEmployeeScheduleTab(tab)}
                        role="tab"
                        aria-selected={employeeScheduleTab === tab}
                      >
                        {capitalize(tab)}
                      </button>
                    ))}
                  </div>
                  <div className="day-schedule">
                    <div className="day-schedule-toolbar">
                      <button type="button" onClick={() => moveScheduleDate(-1)} aria-label={employeeScheduleTab === "day" ? "Previous day" : "Previous week"}>
                        <span aria-hidden="true">&lt;</span>
                      </button>
                      <div>
                        <strong>{employeeScheduleTab === "day" ? formatLongDate(scheduleDate) : `Week of ${formatShortDate(scheduleWeekDays[0].date)}`}</strong>
                        <span>
                          {employeeScheduleTab === "day"
                            ? `${scheduleDayShifts.length} ${scheduleDayShifts.length === 1 ? "shift" : "shifts"}`
                            : `${weeklyShiftCount(scheduleWeekDays)} ${weeklyShiftCount(scheduleWeekDays) === 1 ? "shift" : "shifts"}`}
                        </span>
                      </div>
                      <button type="button" onClick={() => moveScheduleDate(1)} aria-label={employeeScheduleTab === "day" ? "Next day" : "Next week"}>
                        <span aria-hidden="true">&gt;</span>
                      </button>
                    </div>
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(event) => setScheduleDate(event.target.value)}
                      aria-label="Schedule date"
                    />
                    {employeeScheduleTab === "day" ? (
                      visibleScheduleEmployees.length > 0 ? (
                        <div className="schedule-chart" style={{ "--schedule-hour-width": `${100 / scheduleHourLabels.length}%` } as CSSProperties} aria-label={`Team schedule for ${formatLongDate(scheduleDate)}`}>
                          <div className="schedule-chart-header">
                            <div className="shift-day-member-heading" aria-hidden="true" />
                            <div className="schedule-time-grid" style={{ gridTemplateColumns: `repeat(${scheduleHourLabels.length}, minmax(0, 1fr))` }}>
                              {scheduleHourLabels.map((hour) => (
                                <span key={hour}>{formatHourLabel(hour)}</span>
                              ))}
                            </div>
                          </div>
                          {scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents ? (
                            <div className="schedule-events-day-row"><strong>Events</strong>{scheduleEventList(scheduleDate)}</div>
                          ) : null}
                          <div className="shift-day-section-label">Team members ({visibleScheduleEmployees.length})</div>
                          {visibleScheduleEmployees.map((employee) => {
                            const employeeShifts = scheduleDayShifts.filter((shift) => shift.employeeId === employee.id);
                            const dailyHours = employeeShifts.reduce((total, shift) => total + (scheduleMinutes.get(shift.id)?.paidMinutes ?? 0), 0) / 60;
                            const timeOff = (state.ptoRequests ?? []).find((request) => request.employeeId === employee.id && request.status === "approved" && request.startDate <= scheduleDate && request.endDate >= scheduleDate);
                            const employeeEditedTimes = employeeShifts
                              .map((shift) => editedShiftTimes[shift.id])
                              .filter((value): value is number => Boolean(value));
                            const employeeCreatedTimes = employeeShifts
                              .map((shift) => createdShiftTimes[shift.id])
                              .filter((value): value is number => Boolean(value));
                            const employeeLastEditedAt = employeeEditedTimes.length > 0
                              ? Math.max(...employeeEditedTimes)
                              : null;
                            const employeeLastCreatedAt = employeeCreatedTimes.length > 0
                              ? Math.max(...employeeCreatedTimes)
                              : null;
                            const isLastEditedEmployee = employeeShifts.some((shift) => shift.id === lastEditedShiftId);

                            return (
                              <div className="schedule-chart-row" key={employee.id}>
                                <div className={`schedule-member${isLastEditedEmployee ? " saved" : ""}`}>
                                  <div>
                                    {mode === "manager" ? (
                                      <button type="button" className="shift-member-name-link" onClick={() => openScheduleEmployeeProfile(employee.id)}>{employee.name}</button>
                                    ) : <strong>{employee.name}</strong>}
                                    <span>{dailyHours.toFixed(2)} hrs</span>
                                  </div>
                                  {employeeLastEditedAt ? (
                                    <small>Last edited at {formatSavedTime(employeeLastEditedAt)}</small>
                                  ) : employeeLastCreatedAt ? (
                                    <small className="created-timestamp">Created at {formatSavedTime(employeeLastCreatedAt)}</small>
                                  ) : null}
                                </div>
                                <div className="schedule-track" onDragOver={event => event.preventDefault()} onDrop={event => void dropScheduleShift(event, employee.id, scheduleDate)}>
                                  {employeeShifts.map((shift) => (
                                    <div
                                      className={`${shift.employeeId === activeEmployeeId ? "schedule-bar mine" : "schedule-bar"}${mode === "manager" ? " editable" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`}
                                      key={shift.id}
                                      style={scheduleBarStyle(shift, scheduleEnforcement)}
                                      data-shift-color={shift.color ?? "blue"}
                                      draggable={mode === "manager" && canEditScheduleRole(shift.role)}
                                      onDragStart={event => { draggedShift.current = shift; event.dataTransfer.setData("text/plain", String(shift.id)); }}
                                      onDragEnd={() => { draggedShift.current = null; }}
                                      title={`${employee.name}: ${formatTimeRange(shift)} ${shift.role}`}
                                      role={mode === "manager" ? "button" : undefined}
                                      tabIndex={mode === "manager" ? 0 : undefined}
                                      onClick={() => openShiftEditor(shift)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          openShiftEditor(shift);
                                        }
                                      }}
                                    >
                                      <strong>{formatCompactTimeRange(shift)}</strong>
                                      <span>{shift.role} | {formatScheduledHours(shift)} hours</span><ShiftWarningBadge codes={warningsByShift.get(shift.id)} />
                                    </div>
                                  ))}
                                  {employeeShifts.length === 0 && timeOff ? (
                                    <button type="button" className="schedule-bar time-off schedule-time-off-button" style={{ "--shift-left": "0%", "--shift-width": "100%" } as CSSProperties} onClick={(event) => openScheduleTimeOff(event, timeOff)} disabled={isPublicSchedule || (mode !== "manager" && timeOff.employeeId !== activeEmployeeId)} aria-label={`View time off for ${employee.name} on ${formatLongDate(scheduleDate)}`} aria-haspopup="dialog" aria-expanded={scheduleTimeOffRequestId === timeOff.id}>
                                      <strong>Time off</strong><span>{timeOff.startTime && timeOff.endTime ? `${formatTime12(timeOff.startTime)}–${formatTime12(timeOff.endTime)}` : "All day"}</span>
                                    </button>
                                  ) : null}
                                  {mode === "manager" ? (
                                    <button
                                      type="button"
                                      className="shift-cell-add schedule-track-add"
                                      onClick={() => openShiftCreator(employee, scheduleDate)}
                                      aria-label={`Add shift for ${employee.name} on ${formatLongDate(scheduleDate)}`}
                                      title={copiedShift ? "Paste copied shift" : "Add shift"}
                                    >
                                      <span aria-hidden="true" />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          {scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents ? <div className="schedule-events-day-row"><strong>Events</strong>{scheduleEventList(scheduleDate)}</div> : null}
                          <EmptyState text="No team members match the selected filters." />
                        </>
                      )
                    ) : employeeScheduleTab === "week" ? (
                      <>
                      <p className="schedule-scroll-hint" id="week-schedule-hint">Swipe or scroll sideways to see every day.</p>
                      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scroll region must be focusable so keyboard users can reach every day. */}
                      <div className="shift-week-scroll" role="region" aria-label="Weekly schedule scroll area" aria-describedby="week-schedule-hint" tabIndex={0}>
                      <div className="shift-week-board" role="table" aria-label="Weekly team schedule">
                        <div className="shift-week-corner" role="columnheader" aria-label="Team member column" />
                        {scheduleWeekDays.map((day) => (
                          <button
                            type="button"
                            className={day.date === today ? "shift-week-day today" : "shift-week-day"}
                            key={day.date}
                            onClick={() => { setScheduleDate(day.date); setEmployeeScheduleTab("day"); }}
                            title={`View ${formatLongDate(day.date)} in Day view`}
                            role="columnheader"
                          >
                            {weekday(day.date).slice(0, 3)}, {parseLocalDate(day.date).getDate()}
                          </button>
                        ))}
                        {scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents ? (
                          <div className="shift-week-row schedule-events-week-row" role="row">
                            <div className="shift-week-member" role="rowheader"><strong>Events</strong></div>
                            {scheduleWeekDays.map(day => <div className="shift-week-cell schedule-events-cell" role="cell" key={day.date}>{scheduleEventList(day.date)}</div>)}
                          </div>
                        ) : null}
                        <div className="shift-week-section-label">Team members ({visibleScheduleEmployees.length})</div>
                        {visibleScheduleEmployees.map((employee) => {
                          const employeeWeekShifts = scheduleWeekDays.flatMap((day) => day.shifts.filter((shift) => shift.employeeId === employee.id));
                          const weeklyHours = employeeWeekShifts.reduce((total, shift) => total + (scheduleMinutes.get(shift.id)?.paidMinutes ?? 0), 0) / 60;

                          return (
                            <div className="shift-week-row" role="row" key={employee.id}>
                              <div className="shift-week-member" role="rowheader">
                                <div>
                                  {mode === "manager" ? (
                                    <button type="button" className="shift-member-name-link" onClick={() => openScheduleEmployeeProfile(employee.id)}>{employee.name}</button>
                                  ) : <strong>{employee.name}</strong>}
                                  <span>{weeklyHours.toFixed(2)} hrs</span>
                                </div>
                              </div>
                              {scheduleWeekDays.map((day) => {
                                const dayShifts = day.shifts.filter((shift) => shift.employeeId === employee.id);
                                const timeOff = (state.ptoRequests ?? []).find((request) => request.employeeId === employee.id && request.status === "approved" && request.startDate <= day.date && request.endDate >= day.date);

                                const hasCellContent = dayShifts.length > 0 || Boolean(timeOff);

                                return (
                                  <div className={`shift-week-cell${hasCellContent ? " has-content" : " empty"}`} role="cell" key={day.date} onDragOver={event => event.preventDefault()} onDrop={event => void dropScheduleShift(event, employee.id, day.date)}>
                                    {dayShifts.map((shift) => (
                                      <button
                                        type="button"
                                        data-shift-color={shift.color ?? "blue"} draggable={mode === "manager" && canEditScheduleRole(shift.role)} onDragStart={event => { draggedShift.current = shift; event.dataTransfer.setData("text/plain", String(shift.id)); }} onDragEnd={() => { draggedShift.current = null; }}
                                        className={`shift-week-card${shift.employeeId === activeEmployeeId ? " mine" : ""}${mode === "manager" ? " editable" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`}
                                        key={shift.id}
                                        onClick={() => openShiftEditor(shift)}
                                      >
                                        <strong>{formatCompactTimeRange(shift)}</strong>
                                        <span>{shift.role || "Shift"}</span><ShiftWarningBadge codes={warningsByShift.get(shift.id)} />
                                      </button>
                                    ))}
                                    {timeOff ? (
                                      <button type="button" className="shift-time-off schedule-time-off-button" onClick={(event) => openScheduleTimeOff(event, timeOff)} disabled={isPublicSchedule || (mode !== "manager" && timeOff.employeeId !== activeEmployeeId)} aria-label={`View time off for ${employee.name} on ${formatLongDate(day.date)}`} aria-haspopup="dialog" aria-expanded={scheduleTimeOffRequestId === timeOff.id}><strong>⊘ Time off</strong><span>▣ {timeOff.startTime && timeOff.endTime ? `${formatTime12(timeOff.startTime)}–${formatTime12(timeOff.endTime)}` : "All day"}</span></button>
                                    ) : null}
                                    {mode === "manager" ? (
                                      <button
                                        type="button"
                                        className="shift-cell-add"
                                        onClick={() => openShiftCreator(employee, day.date)}
                                        aria-label={`Add shift for ${employee.name} on ${formatLongDate(day.date)}`}
                                        title={copiedShift ? "Paste copied shift" : "Add shift"}
                                      >
                                        <span aria-hidden="true" />
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                      </div>
                      </>
                    ) : (
                      <div className="shift-month-board" aria-label={`Monthly schedule for ${formatMonthYear(scheduleDate)}`}>
                        {workWeekCalendarDays(scheduleDate, scheduleEnforcement.workWeekStart).map((day) => <strong className="shift-month-weekday" key={day.date}>{parseLocalDate(day.date).toLocaleDateString("en-US", { weekday: "short" })}</strong>)}
                        {scheduleMonthDays.map((day) => {
                          const visibleDayShifts = day.shifts.filter((shift) => visibleEmployeeIds === null || visibleEmployeeIds.includes(shift.employeeId));
                          const timeOffRequests = (state.ptoRequests ?? []).filter((request) => shiftEmployeeIds.has(request.employeeId) && request.status === "approved" && request.startDate <= day.date && request.endDate >= day.date && (visibleEmployeeIds === null || visibleEmployeeIds.includes(request.employeeId)));
                          const hasDayContent = visibleDayShifts.length > 0 || timeOffRequests.length > 0;

                          return (
                            <div
                              className={`${day.date === today ? "shift-month-day today" : "shift-month-day"}${day.inMonth ? "" : " outside"}${hasDayContent ? " has-content" : " empty"}${mode === "manager" ? " can-add-shift" : ""}`}
                              key={day.date}
                              onDragOver={event => event.preventDefault()}
                              onDrop={event => { if (draggedShift.current) void dropScheduleShift(event, draggedShift.current.employeeId, day.date); }}
                              onClick={(event) => {
                                if (mode === "manager" && event.target === event.currentTarget) {
                                  openMonthShiftCreator(day.date);
                                }
                              }}
                            >
                              <button type="button" className="shift-month-date" onClick={() => { setScheduleDate(day.date); setEmployeeScheduleTab("day"); }}>
                                {day.day === "1" ? `${parseLocalDate(day.date).toLocaleDateString("en-US", { month: "short" })} 1` : day.day}
                              </button>
                              {scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents ? scheduleEventList(day.date) : null}
                              {visibleDayShifts.map((shift) => {
                                const employee = employeeById(state.employees, shift.employeeId);
                                return (
                                  <button type="button" data-shift-color={shift.color ?? "blue"} draggable={mode === "manager" && canEditScheduleRole(shift.role)} onDragStart={event => { draggedShift.current = shift; event.dataTransfer.setData("text/plain", String(shift.id)); }} onDragEnd={() => { draggedShift.current = null; }} className={`shift-month-card${shift.employeeId === activeEmployeeId ? " mine" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`} key={shift.id} onClick={() => openShiftEditor(shift)}>
                                    <strong>{formatCompactTimeRange(shift)}</strong>
                                    <span>{employee?.name ?? "Open shift"} {shift.role ? `(${shift.role})` : ""}</span><ShiftWarningBadge codes={warningsByShift.get(shift.id)} />
                                  </button>
                                );
                              })}
                              {timeOffRequests.map((request) => (
                                <button type="button" className="shift-month-time-off schedule-time-off-button" key={request.id} onClick={(event) => openScheduleTimeOff(event, request)} disabled={isPublicSchedule || (mode !== "manager" && request.employeeId !== activeEmployeeId)} aria-label={`View time off for ${employeeById(state.employees, request.employeeId)?.name ?? "Team member"} on ${formatLongDate(day.date)}`} aria-haspopup="dialog" aria-expanded={scheduleTimeOffRequestId === request.id}>
                                  <strong>⊘ Time off {request.startTime && request.endTime ? `(${formatTime12(request.startTime)}–${formatTime12(request.endTime)})` : "(all day)"}</strong>
                                  <span>{employeeById(state.employees, request.employeeId)?.name ?? "Team member"}</span>
                                </button>
                              ))}
                              {mode === "manager" ? (
                                <button
                                  type="button"
                                  className="shift-cell-add shift-month-add"
                                  onClick={() => openMonthShiftCreator(day.date)}
                                  aria-label={`Add shift on ${formatLongDate(day.date)}`}
                                  title={copiedShift ? "Paste copied shift" : "Add shift"}
                                >
                                  <span aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
                </section>
                {mode === "manager" ? (
                <button
                  type="button"
                  className="shift-add-employees-button"
                  onClick={openAddEmployeeModal}
                  aria-expanded={isAddingEmployee}
                  aria-controls="add-team-member-form"
                >
                  <span aria-hidden="true">+</span>
                  Add Employees
                </button>
              ) : null}
            </div>
          )}

          {activeView === "clockins" && mode === "manager" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="History" title="Employee events" />
              <div className="clock-table" role="table" aria-label="Employee event history">
                <div role="row" className="table-head">
                  <span>Employee</span>
                  <span>Role</span>
                  <span>Event</span>
                  <span>Time</span>
                  <span>Explanation</span>
                </div>
                {displayedEventHistoryItems.map((item) => {
                  if (item.kind === "no-show") {
                    const employee = employeeById(state.employees, item.alert.employeeId);
                    return (
                      <div
                        role="row"
                        className={`no-show-event-row${highlightedEventTargetId === item.alert.eventTargetId ? " notification-target-highlight" : ""}`}
                        data-event-target-id={item.alert.eventTargetId}
                        key={`no-show-${item.alert.id}`}
                      >
                        <span>{employee?.name ?? "Unknown"}</span>
                        <span>{employee?.role ?? "Unassigned"}</span>
                        <span>No-show</span>
                        <span>{formatDateTime(item.alert.at)}</span>
                        <span className="event-explanation"><span>No-show</span></span>
                      </div>
                    );
                  }

                  const employee = employeeById(state.employees, item.event.employeeId);
                  const explanation = item.event.explanation?.trim() || "n/a";
                  return (
                    <div
                      role="row"
                      className={highlightedEventTargetId === `clock-${item.event.id}` ? "notification-target-highlight" : undefined}
                      data-event-target-id={`clock-${item.event.id}`}
                      key={`clock-${item.event.id}`}
                    >
                      <span>{employee?.name ?? "Unknown"}</span>
                      <span>{employee?.role ?? "Unassigned"}</span>
                      <span>{clockEventLabel(item.event, state.shifts, scheduleEnforcement)}</span>
                      <span>{formatDateTime(item.event.at)}</span>
                      <span className="event-explanation"><span>{explanation}</span></span>
                    </div>
                  );
                })}
                {eventHistoryItems.length > 10 ? (
                  <button
                    type="button"
                    className="pto-requests-expand-button events-expand-button"
                    onClick={() => setAreEventsExpanded((current) => !current)}
                    aria-expanded={areEventsExpanded}
                    aria-label={areEventsExpanded ? "Show fewer employee events" : "Show more employee events"}
                  >
                    <span>{areEventsExpanded ? "Less" : "More"}</span>
                  </button>
                ) : null}
              </div>
            </section>
          )}

          {activeView === "hours" && !isPublicSchedule && (
            <TimesheetsPanel
              onPeriodChange={setWorkspacePeriod}
              payPeriod={shared.data.teamPeriod?.payPeriod}
              payPeriodAnchor={shared.data.teamPeriod?.anchorDate}
              canEdit={shared.data.permissions["timesheets.manage"]}
              canExport={shared.data.permissions["exports.timesheets"]}
              canManagePayrollIds={shared.data.permissions["team.manage"] && shared.data.permissions["team.private.read"]}
              onEditingChange={setIsSharedTimeCardEditing}
              summary={isTimesheetSummary}
              onSummaryChange={setIsTimesheetSummary}
              onPayrollId={async (employeeId, payrollId) => {
                if (mode !== "manager" || !shared.data.permissions["team.manage"] || !shared.data.permissions["team.private.read"]) return false;
                return await setState(current => ({ ...current, employees: current.employees.map(employee => employee.id === employeeId ? { ...employee, payrollId } : employee) }));
              }}
              employees={state.employees}
              events={state.clockEvents}
              shifts={state.shifts.filter(isWorkShift)}
              adjustments={state.hoursAdjustments ?? []}
              pto={state.ptoRequests ?? []}
              departments={state.departments}
              history={state.timeCardEdits ?? []}
              today={today}
              now={currentTime}
              manager={mode === "manager"}
              activeEmployeeId={activeEmployeeId}
              weekStart={scheduleEnforcement.workWeekStart}
              mandatoryMealBreak={scheduleEnforcement.mandatoryMealBreak}
              mealBreakAfterHours={scheduleEnforcement.mealBreakAfterHours}
              mealBreakMinutes={scheduleEnforcement.mealBreakMinutes}
              rounding={activeUserIsAdmin && mode === "manager" ? hoursRounding : hoursDisplay === "rounded" ? state.hoursRoundingMinutes : "actual"}
              roundingControl={activeUserIsAdmin && mode === "manager" ? (
                <div className="hours-rounding-actions">
                  <label className="hours-rounding-control">
                    <span>Round</span>
                    <select value={hoursRounding} aria-label="Preview rounded time worked" onChange={(event) => {
                      const value = event.target.value;
                      setHoursRounding(value === "actual" ? "actual" : Number(value) as HoursRounding);
                    }}>
                      <option value="actual">Actual</option>
                      <option value={5}>5 min</option>
                      <option value={10}>10 min</option>
                      <option value={15}>15 min</option>
                    </select>
                  </label>
                  <button type="button" className="hours-rounding-set-button" onClick={setHoursRoundingPolicy} disabled={hoursRounding === "actual" || hoursRounding === state.hoursRoundingMinutes}>Set</button>
                </div>
              ) : (
                <label className="hours-rounding-control">
                  <span>Hours</span>
                  <select value={hoursDisplay} onChange={(event) => setHoursDisplay(event.target.value as HoursDisplay)} aria-label="View actual or rounded time worked">
                    <option value="actual">Actual</option>
                    <option value="rounded">Rounded ({state.hoursRoundingMinutes} min)</option>
                  </select>
                </label>
              )}
              onAddTeamMember={() => { navigateToView("employees"); openAddEmployeeModal(); }}
              onSaveCard={saveTimeCard}
              onAdjust={(employeeId, date, hours) => {
                const employee = state.employees.find((member) => member.id === employeeId);
                if (!employee || mode !== "manager") return;
                setHoursDate(date);
                setActiveHoursTab("today");
                editWorkedHours(employee, hours);
              }}
              locationName={sidebarLocationName}
              onBreakSettings={() => { navigateToView("settings"); setActiveSettingsTab("Breaks & compliance"); }}
              onSettings={() => { navigateToView("settings"); setActiveSettingsTab("Time clock options"); }}
            />
          )}

          {activeView === "time_off" && !isPublicSchedule && (
            <section className="panel feature-panel pto-timeoff-panel">
              {!isViewingPtoHistory ? (
                <>
                  <div className="pto-request-section pto-current-requests-heading">
                    <h3>Requests ({pendingPtoRequests.length})</h3>
                    <div className="pto-request-heading-actions">
                      <button type="button" className="pto-new-request-button" onClick={openPtoRequest}>Request time off</button>
                      <button type="button" className="pto-history-link" onClick={() => setIsViewingPtoHistory(true)}>View history</button>
                    </div>
                  </div>
                  <div className="pto-current-request-table" role="table" aria-label="Current time off requests">
                    <div className="pto-current-request-head" role="row">
                      <span role="columnheader">Name</span>
                      <span role="columnheader">Category</span>
                      <span role="columnheader">Dates</span>
                      <span role="columnheader">Status</span>
                      <span role="columnheader">Total hours</span>
                      <span role="columnheader" aria-label="Request actions" />
                    </div>
                    {pendingPtoRequests.map((request) => {
                      const employee = employeeById(state.employees, request.employeeId);
                      const totalHours = ptoHoursForDateRange(request.startDate, request.endDate);
                      return (
                        <article
                          className={`pto-current-request-row${highlightedPtoRequestId === request.id ? " notification-target-highlight" : ""}`}
                          data-pto-request-id={request.id}
                          role="row"
                          key={request.id}
                        >
                          <span role="cell">{employee?.name ?? "Employee"}</span>
                          <span role="cell">{request.compensation === "unpaid" ? "Unpaid Time Off" : "Paid Time Off"}</span>
                          <span role="cell">{formatTimeOffRequestDate(request.startDate)}{request.endDate !== request.startDate ? ` – ${formatTimeOffRequestDate(request.endDate)}` : ""}</span>
                          <strong className="pto-current-request-status" role="cell">Pending</strong>
                          <div className="pto-current-request-hours" role="cell">
                            <span>{formatPtoHours(totalHours)}</span>
                          </div>
                          <div className="pto-current-request-actions" role="cell">
                            {request.employeeId === activeEmployeeId ? (
                              <button type="button" onClick={() => cancelPtoRequest(request.id)}>Cancel</button>
                            ) : null}
                          </div>
                          {mode === "manager" && request.employeeId !== activeEmployeeId ? (
                            <button
                              type="button"
                              className="pto-current-request-review"
                              onClick={() => {
                                setPtoReviewError("");
                                setReviewingPtoRequestId(request.id);
                              }}
                              aria-label={`Review ${employee?.name ?? "employee"} time off request`}
                            />
                          ) : null}
                        </article>
                      );
                    })}
                    {pendingPtoRequests.length === 0 ? <p className="pto-no-current-requests">No requests</p> : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="pto-request-section pto-history-heading">
                    <h3>Request history</h3>
                    <button type="button" className="pto-history-link" onClick={() => setIsViewingPtoHistory(false)}>Back to requests</button>
                  </div>
                  <div className="pto-history-toolbar">
                    <strong>{ptoHistoryStatusLabel(ptoHistoryStatusFilter)} ({filteredHistoricalPtoRequests.length})</strong>
                    <div className="pto-history-controls">
                      <div className="pto-history-month-control">
                        <button
                          type="button"
                          onClick={() => {
                            setPtoHistoryMonth(shiftDateByCalendarTab(ptoHistoryMonth, "month", -1));
                            setArePtoRequestsExpanded(false);
                          }}
                          aria-label="Previous request-history month"
                        >
                          <span aria-hidden="true">‹</span>
                        </button>
                        <strong>{formatPtoHistoryMonth(ptoHistoryMonth)}</strong>
                        <button
                          type="button"
                          onClick={() => {
                            setPtoHistoryMonth(nextPtoHistoryMonth);
                            setArePtoRequestsExpanded(false);
                          }}
                          aria-label="Next request-history month"
                        >
                          <span aria-hidden="true">›</span>
                        </button>
                      </div>
                      <div className="pto-history-select-control">
                        <select
                          value={ptoHistoryStatusFilter}
                          onChange={(event) => {
                            setPtoHistoryStatusFilter(event.target.value as PtoHistoryStatusFilter);
                            setArePtoRequestsExpanded(false);
                          }}
                          aria-label="Filter request history by status"
                        >
                          <option value="all">All</option>
                          <option value="approved">Approved</option>
                          <option value="denied">Denied</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                      {mode === "manager" ? (
                        <div className="pto-history-employee-filter" ref={ptoHistoryEmployeeFilterRef}>
                          <button
                            type="button"
                            className="pto-history-employee-trigger"
                            onClick={() => setIsPtoHistoryEmployeeFilterOpen((open) => !open)}
                            aria-label="Filter request history by employee"
                            aria-haspopup="listbox"
                            aria-expanded={isPtoHistoryEmployeeFilterOpen}
                          >
                            <span>{ptoHistoryEmployeeId === "all" ? "All Employees" : employeeById(state.employees, ptoHistoryEmployeeId)?.name ?? "All Employees"}</span>
                            <span className="pto-history-employee-chevron" aria-hidden="true" />
                          </button>
                          {isPtoHistoryEmployeeFilterOpen ? (
                            <div className="pto-history-employee-menu" role="listbox" aria-label="Employees">
                              <button
                                type="button"
                                className={ptoHistoryEmployeeId === "all" ? "selected" : ""}
                                onClick={() => {
                                  setPtoHistoryEmployeeId("all");
                                  setArePtoRequestsExpanded(false);
                                  setIsPtoHistoryEmployeeFilterOpen(false);
                                }}
                                role="option"
                                aria-selected={ptoHistoryEmployeeId === "all"}
                              >
                                All Employees
                              </button>
                              <div className="pto-history-employee-divider" aria-hidden="true" />
                              {activeEmployees.map((employee) => (
                                <button
                                  type="button"
                                  className={ptoHistoryEmployeeId === employee.id ? "selected" : ""}
                                  onClick={() => {
                                    setPtoHistoryEmployeeId(employee.id);
                                    setArePtoRequestsExpanded(false);
                                    setIsPtoHistoryEmployeeFilterOpen(false);
                                  }}
                                  role="option"
                                  aria-selected={ptoHistoryEmployeeId === employee.id}
                                  key={employee.id}
                                >
                                  {employee.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="pto-request-list">
                    {displayedPtoRequests.length > 0 ? (
                      <div className="pto-request-list-header" aria-hidden="true">
                        <span>Employee</span>
                        <span>Request</span>
                        <span />
                        <span />
                      </div>
                    ) : null}
                    {displayedPtoRequests.map((request) => {
                      const employee = employeeById(state.employees, request.employeeId);
                      const decidedBy = request.decidedByEmployeeId
                        ? employeeById(state.employees, request.decidedByEmployeeId)
                        : null;
                      return (
                        <article
                          className={`pto-request-card${highlightedPtoRequestId === request.id ? " notification-target-highlight" : ""}`}
                          data-pto-request-id={request.id}
                          key={request.id}
                        >
                          <div className="pto-request-employee">
                            <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee?.name ?? "Employee")}</span>
                            <strong>{employee?.name ?? "Employee"}</strong>
                          </div>
                          <div className="pto-request-summary">
                            <span className="pto-request-timestamp">Requested {formatRequestTimestamp(request.requestedAt)}</span>
                            <strong>{formatTimeOffRequestDate(request.startDate)}{request.endDate !== request.startDate ? ` – ${formatTimeOffRequestDate(request.endDate)}` : ""}</strong>
                            <span className="pto-request-type">{request.compensation === "unpaid" ? "Unpaid Time Off" : "Paid Time Off"}</span>
                          </div>
                          <div className="pto-request-decision">
                            <strong className={`pto-request-status ${request.status}`}>{capitalize(request.status)}</strong>
                            {request.decidedAt ? (
                              <span>by {decidedBy?.name ?? "Manager"} on<br />{formatNumericDate(request.decidedAt)} at {formatClockTime(request.decidedAt)}</span>
                            ) : null}
                          </div>
                          {mode === "manager" ? (
                            <button
                              type="button"
                              className="pto-request-card-open"
                              onClick={() => {
                                setPtoReviewError("");
                                setReviewingPtoRequestId(request.id);
                              }}
                              aria-label={`View ${employee?.name ?? "employee"} time off request details`}
                            />
                          ) : null}
                          <div className="pto-request-card-actions">
                            {mode === "manager" ? (
                              <>
                                {request.status !== "cancelled" ? (
                                  <button
                                    type="button"
                                    className="pto-request-icon-action"
                                    onClick={() => {
                                      setPtoReviewError("");
                                      setReviewingPtoRequestId(request.id);
                                    }}
                                    aria-label={`Review ${employee?.name ?? "employee"} time off request`}
                                    title="Review request"
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                                      <path d="m13.8 6.2 4 4" />
                                    </svg>
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="pto-request-icon-action delete"
                                  onClick={() => deletePtoRequest(request.id)}
                                  aria-label={`Delete ${employee?.name ?? "employee"} time off request`}
                                  title="Delete request"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 7h16" />
                                    <path d="M9 7V4h6v3" />
                                    <path d="m7 7 1 13h8l1-13" />
                                    <path d="M10 11v5M14 11v5" />
                                  </svg>
                                </button>
                              </>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                    {filteredHistoricalPtoRequests.length === 0 ? <EmptyState text="No request history for these filters." /> : null}
                    {filteredHistoricalPtoRequests.length > 1 ? (
                      <button
                        type="button"
                        className="pto-requests-expand-button"
                        onClick={() => setArePtoRequestsExpanded((current) => !current)}
                      aria-expanded={arePtoRequestsExpanded}
                      aria-label={arePtoRequestsExpanded ? "Hide older time off requests" : "Show older time off requests"}
                    >
                        <span>{arePtoRequestsExpanded ? "Less" : "More"}</span>
                    </button>
                    ) : null}
                  </div>
                </>
              )}
              <div className="pto-balance-section">
                <div className="panel-heading pto-heading">
                  <p className="eyebrow">Paid time off</p>
                  {mode === "manager" ? (
                    <button
                      type="button"
                      className="pto-policies-button"
                      onClick={() => setIsViewingPtoPolicies(true)}
                    >
                      Policies
                    </button>
                  ) : null}
                </div>
                <div className="pto-list" role="table" aria-label="Employee year-to-date PTO">
                  <div className="pto-row pto-table-head" role="row">
                    <span role="columnheader">Employee</span>
                    <span role="columnheader">Hours worked YTD</span>
                    <span role="columnheader">PTO earned</span>
                    <span role="columnheader">PTO used</span>
                    <span role="columnheader">PTO left</span>
                  </div>
                  {ptoRows
                    .filter(({ employee }) => mode === "manager" || employee.id === activeEmployeeId)
                    .map(({ employee, hoursWorked, ptoHours, ptoUsed }) => (
                    <div className="pto-row" role="row" key={employee.id}>
                      <div role="cell" className="pto-employee">
                        <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                        <div>
                          <strong>{employee.name}</strong>
                          <span>{employee.role}</span>
                        </div>
                      </div>
                      <strong role="cell">{formatPtoChartHours(hoursWorked)}</strong>
                      <strong role="cell" className="pto-earned">{formatPtoChartHours(ptoHours)}</strong>
                      <strong role="cell">{formatPtoChartHours(ptoUsed)}</strong>
                      <strong role="cell" className="pto-left">{formatPtoChartHours(ptoHours - ptoUsed)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeView === "my_availability" && !isPublicSchedule ? (
            <section className="availability-section" aria-label="My availability">
              {activeEmployee ? <><AvailabilityEditor key={activeEmployeeId} today={today} approvalRequired={scheduleEnforcement.requireAvailabilityApproval} initialSlots={activeAvailabilityRequest?.slots} onSave={submitAvailabilityRequest} /><AvailabilityHistory requests={ownAvailabilityRequests} /></> : <p>No employee is linked to this account. Use Team availability to review employee requests.</p>}
            </section>
          ) : null}

          {activeView === "team_availability" && !isPublicSchedule ? (
            <TeamAvailabilityBoard
              employees={state.employees.filter(employee => employee.active || state.availabilityRequests.some(request => request.employeeId === employee.id))}
              initialDate={today}
              workWeekStart={scheduleEnforcement.workWeekStart}
              requests={state.availabilityRequests ?? []}
              reviewerId={activeEmployeeId}
              canApprove={shared.data.permissions["availability.approve"]}
              onApprove={(requestId) => decideAvailabilityRequest(requestId, "approved")}
              onReject={(requestId, note) => decideAvailabilityRequest(requestId, "rejected", note)}
            />
          ) : null}
        </section>
      </div>

      <MobileNavigation items={visibleNavItems} activeView={activeView} onNavigate={navigateToView} />

      {mode === "manager" && activeView === "employees" && !viewingRosterEmployee && typeof document !== "undefined" ? createPortal(
        <section className="roster-print-sheet" aria-hidden="true">
          <h1>Team roster</h1>
          <p>{sidebarLocationName} · {filteredRosterEmployees.length} team {filteredRosterEmployees.length === 1 ? "member" : "members"} · {formatNumericDate(`${today}T12:00:00`)}</p>
          <PrintTable
            header={<tr>{rosterCopyHeaders.map((header) => <th key={header} scope="col">{header}</th>)}</tr>}
            rows={rosterRowsForCopy.map((row, index) => <tr key={filteredRosterEmployees[index].id}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}
          />
          {filteredRosterEmployees.length === 0 ? <p>No team members match your search or filters.</p> : null}
        </section>, document.body,
      ) : null}

      {scheduleTimeOffRequest ? createPortal(
        <div className="schedule-time-off-popover" ref={scheduleTimeOffPopoverRef} role="dialog" aria-labelledby="schedule-time-off-title" style={scheduleTimeOffPosition}>
          <div className="schedule-time-off-heading">
            <span className="schedule-avatar" aria-hidden="true">{employeeInitials(scheduleTimeOffEmployee?.name ?? "Employee")}</span>
            <div>
              <h2 id="schedule-time-off-title">{scheduleTimeOffEmployee?.name ?? "Employee"}</h2>
              <p>{scheduleTimeOffRequest.compensation === "unpaid" ? "Unpaid time off" : "Paid time off"} | {scheduleTimeOffRequest.reason === "vacation" ? "Vacation" : scheduleTimeOffRequest.reason === "sick_emergency" ? "Sick / Emergency" : "Other"}</p>
              <span className={`pto-request-status ${scheduleTimeOffRequest.status}`}>{scheduleTimeOffRequest.status}</span>
            </div>
            <button type="button" className="schedule-time-off-close" onClick={closeScheduleTimeOff} aria-label="Close time off details">×</button>
          </div>
          <div className="schedule-time-off-body">
            <div className="schedule-time-off-dates">
              {[scheduleTimeOffRequest.startDate, scheduleTimeOffRequest.endDate].map((date, index) => (
                <div key={index}>
                  <span>{parseLocalDate(date).toLocaleDateString("en-US", { weekday: "long" })}</span>
                  <time dateTime={date} title={formatLongDate(date)}>{parseLocalDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(scheduleTimeOffRequest.startDate.slice(0, 4) !== scheduleTimeOffRequest.endDate.slice(0, 4) ? { year: "numeric" } : {}) })}</time>
                </div>
              ))}
            </div>
            <dl className="schedule-time-off-hours"><dt>Hours Requested</dt><dd>{scheduleTimeOffRequest.startTime && scheduleTimeOffRequest.endTime ? `${formatTime12(scheduleTimeOffRequest.startTime)} – ${formatTime12(scheduleTimeOffRequest.endTime)}` : "All day"}</dd></dl>
            <p className="schedule-time-off-note">{scheduleTimeOffRequest.explanation ? `“${scheduleTimeOffRequest.explanation}”` : "No explanation provided."}</p>
            <p className="schedule-time-off-requested">Requested {new Date(scheduleTimeOffRequest.requestedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
          </div>
          {mode === "manager" ? <div className="schedule-time-off-actions"><button type="button" onClick={() => deletePtoRequest(scheduleTimeOffRequest.id)}>Delete</button></div> : null}
        </div>, document.body,
      ) : null}

      {rosterActionEmployee ? createPortal(
        <div className="roster-action-menu" id="roster-action-menu" ref={rosterActionMenuRef} role="menu" tabIndex={-1} aria-label={`Actions for ${rosterActionEmployee.name}`} style={rosterActionPosition} onKeyDown={(event) => {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[nextIndex]?.focus();
          }
          if (event.key === "Tab") {
            event.preventDefault();
            setRosterActionEmployeeId(null);
            rosterActionButtonRef.current?.focus();
          }
        }}>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => { setRosterActionEmployeeId(null); openEditEmployeeModal(rosterActionEmployee); }}>Edit</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => viewRosterEmployeeSection(rosterActionEmployee.id, "performance")}>View performance</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => viewRosterEmployeeSection(rosterActionEmployee.id, "job")}>View job details</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => viewRosterEmployeeSection(rosterActionEmployee.id, "documents")}>View documents</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => viewRosterEmployeeSection(rosterActionEmployee.id, "personal")}>View personal information</button>
          <button type="button" role="menuitem" tabIndex={-1} className="roster-action-terminate" disabled={rosterActionEmployee.id === activeEmployeeId} onClick={() => {
            setRosterActionEmployeeId(null);
            if (rosterActionEmployee.terminated) rehireRosterEmployee(rosterActionEmployee.id);
            else openTerminationFlow(rosterActionEmployee.id);
          }}>{rosterActionEmployee.terminated ? "Rehire team member" : "Terminate team member"}</button>
        </div>, document.body,
      ) : null}

      {certificateEmployeeId !== null ? (
        <div className="modal-backdrop certificate-modal-backdrop" role="presentation" onClick={(event) => dismissModalFromBackdrop(event, closeCertificateModal)} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); closeCertificateModal(); }
            if (event.key === "Tab") {
              const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
          <form className="certificate-modal" onSubmit={uploadEmployeeCertificate} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="certificate-modal-title" aria-busy={isSavingCertificate}>
            <button type="button" className="certificate-modal-close" aria-label="Close certificate dialog" disabled={isSavingCertificate} onClick={closeCertificateModal}>×</button>
            <h2 id="certificate-modal-title">Add a certificate</h2>
            <div className="certificate-modal-fields">
              <label><span>Name:</span><input ref={certificateNameRef} required value={certificateDraft.name} disabled={isSavingCertificate} onChange={(event) => setCertificateDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
              <label><span>Expiration date:</span><span className="certificate-date-field">
                <input type="date" required className={certificateDraft.expirationDate ? "" : "empty"} aria-label="Expiration date" value={certificateDraft.expirationDate} disabled={isSavingCertificate} onClick={openNativeDatePicker} onInput={(event) => { const expirationDate = event.currentTarget.value; setCertificateDraft((draft) => ({ ...draft, expirationDate })); }} />
                {!certificateDraft.expirationDate ? <span className="certificate-date-placeholder" aria-hidden="true">▦ Choose a date</span> : null}
              </span></label>
            </div>
            <label className={`certificate-upload-zone${isDraggingCertificate ? " dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!isSavingCertificate) setIsDraggingCertificate(true); }} onDragLeave={() => setIsDraggingCertificate(false)} onDrop={(event) => { event.preventDefault(); if (!isSavingCertificate) chooseCertificateFile(event.dataTransfer.files[0]); }}>
              <input type="file" aria-label="Certificate attachment" accept=".gif,.png,.pdf,.jpg,.jpeg,image/gif,image/png,application/pdf,image/jpeg" disabled={isSavingCertificate} onChange={(event) => { chooseCertificateFile(event.target.files?.[0]); event.target.value = ""; }} />
              <strong>{certificateFile ? certificateFile.name : "Click or drop an image here to upload (OPTIONAL)"}</strong>
              <span>{certificateFile ? "Click or drop a file to replace this attachment" : "GIF, PNG, PDF, and JPG/JPEG supported · Up to 10 MB"}</span>
            </label>
            {certificateFile ? <button type="button" className="certificate-remove-file" disabled={isSavingCertificate} onClick={() => { setCertificateFile(null); setCertificateError(""); }}>Remove attachment</button> : null}
            {certificateError ? <p className="form-message" role="alert">{certificateError}</p> : null}
            <div className="certificate-modal-actions">
              <button type="button" disabled={isSavingCertificate} onClick={closeCertificateModal}>Cancel</button>
              <button type="submit" className="primary-action" disabled={isSavingCertificate || !certificateDraft.name.trim() || !certificateDraft.expirationDate}>{isSavingCertificate ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "manager" && isAddingLocation ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, closeAddLocationModal)}
        >
          <form
            className="add-location-modal"
            onSubmit={addCompanyLocations}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-location-title"
          >
            <div className="add-location-modal-heading">
              <h2 id="add-location-title">We&apos;re glad you&apos;re adding a new location!</h2>
              <button type="button" onClick={closeAddLocationModal} aria-label="Close add location">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="add-location-fields">
              {newLocationDrafts.map((location, index) => (
                <div className="add-location-row" key={index}>
                  <label>
                    <span>New Location Name</span>
                    <input
                      value={location.name}
                      onChange={(event) => updateNewLocationDraft(index, "name", event.target.value)}
                      aria-label={`New Location Name ${index + 1}`}
                      required
                    />
                  </label>
                  <label>
                    <span>New Location Zip</span>
                    <input
                      value={location.zip}
                      onChange={(event) => updateNewLocationDraft(
                        index,
                        "zip",
                        event.target.value.replace(/\D/g, "").slice(0, 5),
                      )}
                      aria-label={`New Location Zip ${index + 1}`}
                      inputMode="numeric"
                      autoComplete="postal-code"
                      pattern="[0-9]{5}"
                      minLength={5}
                      maxLength={5}
                      required
                    />
                  </label>
                </div>
              ))}
            </div>
            {newLocationDrafts.length < maximumNewLocations ? (
              <button type="button" className="add-another-location-button" onClick={addAnotherLocationDraft}>
                <span aria-hidden="true">+</span> Add Another Location
              </button>
            ) : null}
            {newLocationError ? <p className="add-location-error" role="alert">{newLocationError}</p> : null}
            <button type="submit" className="add-location-submit" disabled={!canAddNewLocations}>Add Location</button>
          </form>
        </div>
      ) : null}

      {mode === "manager" && terminatingEmployee && terminationStep === "notice" ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, closeTerminationFlow)}
        >
          <section
            className="termination-modal termination-notice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="termination-notice-title"
          >
            <div className="termination-modal-heading">
              <h2 id="termination-notice-title">Terminate {terminatingEmployee.name}</h2>
              <button type="button" onClick={closeTerminationFlow} aria-label="Close termination confirmation">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <p>Before terminating {terminatingEmployee.name} please note that:</p>
            <ul>
              <li>They&apos;ll lose access to all activity, such as schedules and messages</li>
              <li>All scheduled shifts assigned to them will become open shifts</li>
              <li>They&apos;ll still be able to access their time cards and time-off history</li>
            </ul>
            <div className="termination-modal-actions">
              <button type="button" onClick={closeTerminationFlow}>Cancel</button>
              <button type="button" className="primary-action" onClick={() => setTerminationStep("details")}>Next</button>
            </div>
          </section>
        </div>
      ) : null}

      {mode === "manager" && terminatingEmployee && terminationStep === "details" ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, closeTerminationFlow)}
        >
          <form
            className="termination-modal termination-details-modal"
            onSubmit={terminateRosterEmployee}
            role="dialog"
            aria-modal="true"
            aria-labelledby="termination-details-title"
          >
            <div className="termination-modal-heading">
              <h2 id="termination-details-title">Terminate {terminatingEmployee.name}</h2>
              <button type="button" onClick={closeTerminationFlow} aria-label="Close termination details">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="termination-fields">
              <label>
                <span>Reason for termination: <b aria-hidden="true">*</b></span>
                <select
                  value={terminationReason}
                  onChange={(event) => setTerminationReason(event.target.value)}
                  aria-label="Reason for termination"
                  required
                >
                  <option value="">Select a reason</option>
                  <option value="Absenteeism / Late">Absenteeism / Late</option>
                  <option value="Admin Error / Accidental Account">Admin Error / Accidental Account</option>
                  <option value="Availability Change">Availability Change</option>
                  <option value="Business Conditions">Business Conditions</option>
                  <option value="Contractor">Contractor</option>
                  <option value="Inadequate Job Performance">Inadequate Job Performance</option>
                  <option value="Poor Fit - Culture">Poor Fit - Culture</option>
                  <option value="Poor Fit - Experience">Poor Fit - Experience</option>
                  <option value="Project Completed">Project Completed</option>
                  <option value="Requested via Clover">Requested via Clover</option>
                  <option value="Seasonal">Seasonal</option>
                  <option value="Unacceptable Behavior">Unacceptable Behavior</option>
                  <option value="Voluntary Resignation">Voluntary Resignation</option>
                </select>
              </label>
              <label>
                <span>Termination date: <b aria-hidden="true">*</b></span>
                <input
                  type="date"
                  value={terminationDate}
                  onChange={(event) => setTerminationDate(event.target.value)}
                  aria-label="Termination date"
                  required
                />
              </label>
            </div>
            <label className="termination-rehire">
              <input
                type="checkbox"
                checked={eligibleForRehire}
                onChange={(event) => setEligibleForRehire(event.target.checked)}
              />
              <span>Eligible for re-hire</span>
            </label>
            <label className="termination-note">
              <span>Note</span>
              <textarea
                value={terminationNote}
                onChange={(event) => setTerminationNote(event.target.value)}
                placeholder="Add an optional note..."
              />
            </label>
            <p className="termination-summary">
              {terminatingEmployee.name} will be removed from {terminatingEmployee.location || sidebarLocationName}.
              {eligibleForRehire ? " If they are eligible for rehire, you can rehire them from this profile." : ""}
            </p>
            <div className="termination-modal-actions">
              <button type="button" onClick={closeTerminationFlow}>Cancel</button>
              <button
                type="submit"
                className="termination-submit"
                disabled={!terminationReason || !terminationDate}
              >
                Terminate
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "manager" && terminatingEmployee && terminationStep === "success" ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, closeTerminationFlow)}
        >
          <section
            className="termination-modal termination-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="termination-success-title"
          >
            <button type="button" className="termination-success-close" onClick={closeTerminationFlow} aria-label="Close termination confirmation">
              <span aria-hidden="true">&times;</span>
            </button>
            <span className="termination-success-check" aria-hidden="true">✓</span>
            <h2 id="termination-success-title">
              {terminatingEmployee.name.split(" ")[0]} was successfully terminated.
            </h2>
            <p>{terminatingEmployee.name} is now inactive and their job information has been disabled.</p>
            <button type="button" className="primary-action termination-success-done" onClick={closeTerminationFlow}>Done</button>
          </section>
        </div>
      ) : null}

      {mode === "manager" && ptoPolicyForm ? (
        <div className="modal-backdrop" role="presentation">
          <div className="pto-policy-modal" role="dialog" aria-modal="true" aria-labelledby="pto-policy-title">
            <div className="modal-heading">
              <div>
                <h2 id="pto-policy-title">
                  {ptoPolicyStep === "details"
                    ? editingPtoPolicyId === null ? "Add PTO policy" : "Edit PTO policy"
                    : ptoPolicyStep === "employees" ? "Choose employees" : "Starting balances"}
                </h2>
              </div>
              <button type="button" onClick={closePtoPolicyEditor} aria-label="Close PTO policy editor">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            {ptoPolicyStep === "details" ? (
              <div className="pto-policy-details">
                <div className="pto-policy-primary-fields">
                  <div className="pto-policy-name-field">
                    <div className="pto-policy-name-heading">
                      <label htmlFor="pto-policy-name">Name</label>
                    </div>
                    <input
                      id="pto-policy-name"
                      value={ptoPolicyForm.name}
                      onChange={(event) => setPtoPolicyForm((form) => form ? { ...form, name: event.target.value } : form)}
                      autoFocus
                    />
                  </div>

                  <fieldset className="pto-policy-methods">
                    <legend>Accrual method</legend>
                    <label>
                      <input
                        type="radio"
                        name="pto-policy-method"
                        checked={ptoPolicyForm.method === "fixed"}
                        onChange={() => setPtoPolicyForm((form) => form ? { ...form, method: "fixed" } : form)}
                      />
                      <span>Fixed <small>(example: 120 hours per year)</small></span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="pto-policy-method"
                        checked={ptoPolicyForm.method === "rate"}
                        onChange={() => setPtoPolicyForm((form) => form ? { ...form, method: "rate" } : form)}
                      />
                      <span>Rate <small>(example: 1 hour per 30 hours worked)</small></span>
                    </label>
                  </fieldset>
                </div>

                {ptoPolicyForm.method === "fixed" ? (
                  <label className="pto-policy-fixed-rate">
                    <span>Annual allowance</span>
                    <span className="pto-policy-number-field">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={ptoPolicyForm.fixedHours}
                        onChange={(event) => setPtoPolicyForm((form) => form ? { ...form, fixedHours: event.target.value } : form)}
                      />
                      <b>hours per year</b>
                    </span>
                  </label>
                ) : (
                  <div className="pto-policy-rate">
                    <strong>Rate</strong>
                    <div>
                      <span className="pto-policy-number-field">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={ptoPolicyForm.earnedHours}
                          onChange={(event) => setPtoPolicyForm((form) => form ? { ...form, earnedHours: event.target.value } : form)}
                          aria-label="PTO hours earned"
                        />
                        <b>hours</b>
                      </span>
                      <span>earned per</span>
                      <span className="pto-policy-number-field">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={ptoPolicyForm.workedHours}
                          onChange={(event) => setPtoPolicyForm((form) => form ? { ...form, workedHours: event.target.value } : form)}
                          aria-label="Hours worked for PTO accrual"
                        />
                        <b>hours</b>
                      </span>
                      <span>worked</span>
                    </div>
                  </div>
                )}
              </div>
            ) : ptoPolicyStep === "employees" ? (
              <div className="pto-policy-employee-step">
                <p>Select everyone who should earn PTO through this policy. Managers can be included.</p>
                <div className="pto-policy-employee-list">
                  {activeEmployees.map((employee) => (
                    <label key={employee.id}>
                      <input
                        type="checkbox"
                        checked={ptoPolicyForm.employeeIds.includes(employee.id)}
                        onChange={() => togglePtoPolicyEmployee(employee.id)}
                      />
                      <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                      <span>
                        <strong>{employee.name}</strong>
                        <small>{isManagerEmployee(employee) ? employee.accessLevel : employee.role || "Employee"}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pto-policy-balance-step">
                <p>If your team members have an existing balance, enter those hours here. Their PTO begins accruing from the selected start date.</p>
                <div className="pto-policy-balance-table">
                  <div className="pto-policy-balance-header" aria-hidden="true">
                    <span>Employee</span>
                    <span>Employee start date</span>
                    <span>PTO start balance</span>
                  </div>
                  {ptoPolicyForm.employeeIds.map((employeeId) => {
                    const employee = employeeById(activeEmployees, employeeId);
                    const startingBalance = ptoPolicyForm.startingBalances[employeeId];
                    if (!employee || !startingBalance) return null;

                    return (
                      <div className="pto-policy-balance-row" key={employeeId}>
                        <div className="pto-policy-balance-employee">
                          <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                          <span>
                            <strong>{employee.name}</strong>
                            <small>{isManagerEmployee(employee) ? employee.accessLevel : employee.role || "Employee"}</small>
                          </span>
                        </div>
                        <label>
                          <span>Employee start date</span>
                          <input
                            type="date"
                            value={startingBalance.startDate}
                            onChange={(event) => setPtoPolicyForm((form) => form ? {
                              ...form,
                              startingBalances: {
                                ...form.startingBalances,
                                [employeeId]: { ...form.startingBalances[employeeId], startDate: event.target.value },
                              },
                            } : form)}
                          />
                        </label>
                        <label>
                          <span>PTO start balance</span>
                          <span className="pto-policy-balance-input">
                            <input
                              type="number"
                              step="0.01"
                              value={startingBalance.balance}
                              onChange={(event) => setPtoPolicyForm((form) => form ? {
                                ...form,
                                startingBalances: {
                                  ...form.startingBalances,
                                  [employeeId]: { ...form.startingBalances[employeeId], balance: event.target.value },
                                },
                              } : form)}
                            />
                            <b>hrs</b>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {ptoPolicyError ? <p className="shift-error-message" role="alert">{ptoPolicyError}</p> : null}
            <div className="pto-policy-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  if (ptoPolicyStep === "balances") {
                    setPtoPolicyStep("employees");
                    setPtoPolicyError("");
                  } else if (ptoPolicyStep === "employees") {
                    setPtoPolicyStep("details");
                    setPtoPolicyError("");
                  } else {
                    cancelPtoPolicyEditor();
                  }
                }}
              >
                {ptoPolicyStep === "details" ? "Cancel" : "Back"}
              </button>
              <button
                type="button"
                onClick={ptoPolicyStep === "details" ? continuePtoPolicy : ptoPolicyStep === "employees" ? continuePtoPolicyEmployees : savePtoPolicy}
              >
                {ptoPolicyStep === "balances" ? "Save policy" : "Next"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mode === "manager" && isViewingPtoPolicies ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, () => setIsViewingPtoPolicies(false))}
        >
          <div className="pto-policy-modal pto-saved-policies-modal" role="dialog" aria-modal="true" aria-labelledby="saved-pto-policies-title">
            <div className="modal-heading">
              <div className="pto-policies-heading-content">
                <h2 id="saved-pto-policies-title">Policies</h2>
                <button
                  type="button"
                  className="pto-policy-add-link"
                  onClick={() => {
                    setIsViewingPtoPolicies(false);
                    openPtoPolicy();
                  }}
                >
                  + Add Policy
                </button>
              </div>
              <button type="button" onClick={() => setIsViewingPtoPolicies(false)} aria-label="Close PTO policies">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className={(state.ptoPolicies ?? []).length > 2 ? "pto-saved-policy-list is-scrollable" : "pto-saved-policy-list"}>
              {(state.ptoPolicies ?? []).length === 0 ? (
                <p className="pto-saved-policy-empty">No saved policies.</p>
              ) : null}
              {(state.ptoPolicies ?? []).map((policy) => {
                const assignedEmployees = policy.employeeIds
                  .map((employeeId) => employeeById(state.employees, employeeId)?.name)
                  .filter((name): name is string => Boolean(name));
                return (
                  <article className="pto-saved-policy-card" key={policy.id}>
                    <div className="pto-policy-card-actions">
                      <button
                        type="button"
                        className="pto-policy-edit-button"
                        onClick={() => editPtoPolicy(policy)}
                        aria-label={`Edit ${policy.name} policy`}
                        title="Edit policy"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                          <path d="m13.8 6.2 4 4" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="pto-policy-delete-button"
                        onClick={() => deletePtoPolicy(policy)}
                        aria-label={`Delete ${policy.name} policy`}
                        title="Delete policy"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 7h16" />
                          <path d="M9 7V4h6v3" />
                          <path d="m7 7 1 13h8l1-13" />
                          <path d="M10 11v5M14 11v5" />
                        </svg>
                      </button>
                    </div>
                    <div>
                      <h3>{policy.name}</h3>
                      <p>
                        {policy.method === "fixed"
                          ? `${policy.fixedHours} hours per year`
                          : `${policy.earnedHours} hours earned per ${policy.workedHours} hours worked`}
                      </p>
                    </div>
                    <div>
                      <span>Employees</span>
                      <p>{assignedEmployees.length > 0 ? assignedEmployees.join(", ") : "No employees assigned"}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {scheduleEventDraft && scheduleEnforcement.enableScheduleEvents && canViewScheduleEvents ? (
        <ScheduleEventDialog
          event={scheduleEventDraft}
          editable={mode === "manager"}
          onSave={saveScheduleEvent}
          onDelete={deleteScheduleEvent}
          onClose={() => setScheduleEventDraft(null)}
        />
      ) : null}

      {mode === "manager" && reviewingPtoRequest ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, () => setReviewingPtoRequestId(null))}
        >
          <div
            className="pto-review-modal"
            ref={ptoReviewModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pto-review-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Time off request</p>
                <h2 id="pto-review-title">{employeeById(state.employees, reviewingPtoRequest.employeeId)?.name ?? "Employee"}</h2>
              </div>
              <button type="button" onClick={() => setReviewingPtoRequestId(null)} aria-label="Close PTO review">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <dl className="pto-review-details">
              <div>
                <dt>Date requested off:</dt>
                <dd>{formatShortDate(reviewingPtoRequest.startDate)}{reviewingPtoRequest.endDate !== reviewingPtoRequest.startDate ? ` - ${formatShortDate(reviewingPtoRequest.endDate)}` : ""}</dd>
              </div>
              <div>
                <dt>Time off type:</dt>
                <dd>{reviewingPtoRequest.compensation === "unpaid" ? "Unpaid time off" : "Paid time off"}</dd>
              </div>
              <div>
                <dt>Reason:</dt>
                <dd>{reviewingPtoRequest.reason === "vacation" ? "Vacation" : "Sick / Emergency"}</dd>
              </div>
            </dl>
            <div className="pto-review-explanation">
              <strong>Explanation</strong>
              <p>{reviewingPtoRequest.explanation || "No explanation provided."}</p>
            </div>
            {reviewingOwnPtoRequest ? (
              <p className="pto-review-prompt">
                {reviewingPtoRequest.status === "pending"
                  ? "Your request is pending approval."
                  : `This request is ${reviewingPtoRequest.status}.`}
              </p>
            ) : (
              <>
                <button type="button" className="pto-message-employee-action" onClick={messagePtoRequestEmployee} disabled={!scheduleEnforcement.enableTeamMessaging}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                  Message employee
                </button>
                <p className="pto-review-prompt">Approve or deny this time off request?</p>
                {ptoReviewError ? <p className="shift-error-message" role="alert">{ptoReviewError}</p> : null}
                <div className="pto-review-actions">
                  <button type="button" className="approve-action" onClick={() => decidePtoRequest("approved")}>Approve</button>
                  <button type="button" className="deny-action" onClick={() => decidePtoRequest("denied")}>Deny</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {ptoRequestForm ? (
        <div className="modal-backdrop" role="presentation">
          <form className="pto-request-modal" onSubmit={submitPtoRequest} role="dialog" aria-modal="true" aria-labelledby="pto-request-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Time off</p>
                <h2 id="pto-request-title">Request time off</h2>
              </div>
              <button type="button" onClick={() => setPtoRequestForm(null)} aria-label="Close time off request">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <fieldset className="pto-compensation-options">
              <legend>Time off type</legend>
              <label>
                <input
                  type="radio"
                  name="time-off-compensation"
                  checked={ptoRequestForm.compensation === "paid"}
                  onChange={() => setPtoRequestForm((form) => form ? { ...form, compensation: "paid" } : form)}
                />
                <span>Paid time off</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="time-off-compensation"
                  checked={ptoRequestForm.compensation === "unpaid"}
                  onChange={() => setPtoRequestForm((form) => form ? { ...form, compensation: "unpaid" } : form)}
                />
                <span>Unpaid time off</span>
              </label>
            </fieldset>
            <div className="pto-request-dates">
              <label>
                <span>First day off</span>
                <input
                  type="date"
                  min={today}
                  value={ptoRequestForm.startDate}
                  onChange={(event) => setPtoRequestForm((form) => form ? { ...form, startDate: event.target.value } : form)}
                  required
                />
              </label>
              <label>
                <span>Last day off</span>
                <input
                  type="date"
                  min={ptoRequestForm.startDate || today}
                  value={ptoRequestForm.endDate}
                  onChange={(event) => setPtoRequestForm((form) => form ? { ...form, endDate: event.target.value } : form)}
                  required
                />
              </label>
            </div>
            <p className="pto-full-shift-note">Each selected day, including weekends, counts as one full 8-hour day.</p>
            {activeEmployee?.accessLevel === "Admin" ? (
              <p className="pto-admin-auto-approval-note">Admin time off is approved automatically.</p>
            ) : null}
            <fieldset className="pto-reason-options">
              <legend>Reason</legend>
              <label>
                <input
                  type="checkbox"
                  checked={ptoRequestForm.reason === "sick_emergency"}
                  onChange={() => setPtoRequestForm((form) => form ? { ...form, reason: form.reason === "sick_emergency" ? "" : "sick_emergency" } : form)}
                />
                <span>Sick / Emergency</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ptoRequestForm.reason === "vacation"}
                  onChange={() => setPtoRequestForm((form) => form ? { ...form, reason: form.reason === "vacation" ? "" : "vacation" } : form)}
                />
                <span>Vacation</span>
              </label>
            </fieldset>
            <label className="pto-explanation-field">
              <span>Explanation (optional)</span>
              <textarea
                value={ptoRequestForm.explanation}
                onChange={(event) => setPtoRequestForm((form) => form ? { ...form, explanation: event.target.value } : form)}
                placeholder="Explain your time off request"
                maxLength={timeExceptionExplanationLimit}
              />
              <small>{ptoRequestForm.explanation.length}/{timeExceptionExplanationLimit}</small>
            </label>
            {ptoRequestForm.compensation === "paid" ? (
              <dl className="pto-request-preview" aria-live="polite">
                <div>
                  <dt>PTO available:</dt>
                  <dd>{formatPtoHours(activeEmployeePtoLeft)}</dd>
                </div>
                <div>
                  <dt>PTO used:</dt>
                  <dd>{formatPtoHours(ptoRequestPreviewHours)}</dd>
                </div>
                <div className={ptoRequestPreviewHours > activeEmployeePtoLeft ? "insufficient" : ""}>
                  <dt>PTO left:</dt>
                  <dd>{formatPtoHours(activeEmployeePtoLeft - ptoRequestPreviewHours)}</dd>
                </div>
              </dl>
            ) : (
              <p className="pto-unpaid-note" aria-live="polite">Unpaid time off will not use your PTO balance.</p>
            )}
            {ptoRequestError ? <p className="shift-error-message" role="alert">{ptoRequestError}</p> : null}
            <div className="hours-edit-actions">
              <button type="button" onClick={() => setPtoRequestForm(null)}>Cancel</button>
              <button type="submit">{activeEmployee?.accessLevel === "Admin" ? "Add time off" : "Submit request"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "manager" && editingHours ? (
        <div className="modal-backdrop" role="presentation">
          <form className="hours-edit-modal" onSubmit={saveWorkedHours} role="dialog" aria-modal="true" aria-labelledby="hours-edit-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Edit worked time</p>
                <h2 id="hours-edit-title">{editingHours.employee.name}</h2>
                <p>{hoursDateLabel(activeHoursTab, hoursDate, scheduleEnforcement.workWeekStart)}</p>
              </div>
              <button type="button" onClick={() => setEditingHours(null)} aria-label="Close hours editor">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="hours-edit-fields">
              <label>
                <span>Hours</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editingHours.hours}
                  onChange={(event) => {
                    setEditingHours((current) => current ? { ...current, hours: event.target.value } : current);
                    setShowHoursChangeWarning(false);
                  }}
                  aria-label="Worked hours"
                  required
                />
              </label>
              <label>
                <span>Minutes</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  value={editingHours.minutes}
                  onChange={(event) => {
                    setEditingHours((current) => current ? { ...current, minutes: event.target.value } : current);
                    setShowHoursChangeWarning(false);
                  }}
                  aria-label="Worked minutes"
                  required
                />
              </label>
            </div>
            {showHoursChangeWarning ? (
              <p className="hours-edit-warning" role="alert">
                Are you sure you want to change {editingHours.employee.name}&apos;s worked time? This will update their hours and PTO totals.
              </p>
            ) : null}
            <div className="hours-edit-actions">
              <button type="button" onClick={() => setEditingHours(null)}>Cancel</button>
              <button type="submit" className={showHoursChangeWarning ? "danger-confirm" : ""}>
                {showHoursChangeWarning ? "Confirm change" : "Change time"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "manager" && isAddingShift ? (
        <div className="modal-backdrop" role="presentation">
          <form className="shift-create-modal" onSubmit={saveShift} role="dialog" aria-modal="true" aria-labelledby="shift-create-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Add shift</p>
                <h2 id="shift-create-title">{employeeById(state.employees, shiftForm.employeeId)?.name ?? "New shift"}</h2>
              </div>
              <button type="button" onClick={() => setIsAddingShift(false)} aria-label="Close add shift">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            {employeeScheduleTab === "month" ? (
              <label className="shift-edit-field">
                <span>Employee</span>
                <select
                  value={shiftForm.employeeId || ""}
                  onChange={(event) => {
                    const employeeId = Number(event.target.value);
                    const employee = employeeById(shiftEmployees, employeeId);
                    setShiftForm((form) => ({
                      ...form,
                      employeeId,
                      role: employee?.role ?? "",
                    }));
                  }}
                  aria-label="Shift employee"
                  required
                >
                  <option value="" disabled>Select employee</option>
                  {orderedShiftEmployees.map((employee) => (
                    <option value={employee.id} key={employee.id}>{employee.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="shift-edit-field">
              <span>Date</span>
              <input
                type="date"
                value={shiftForm.date}
                onClick={openNativeDatePicker}
                onChange={(event) => {
                  const date = event.target.value;
                  setShiftForm((form) => ({ ...form, date }));
                  if (date) setCreateShiftWeekdays([weekdayForDate(date)]);
                }}
                aria-label="Shift date"
                required
              />
            </label>
            {shiftWarningPreview()}
            <ShiftAvailability key={`availability:${shiftForm.employeeId}`} requests={state.availabilityRequests} employeeId={shiftForm.employeeId} date={shiftForm.date} permitted={shared.data.permissions["availability.read"]} />
            <ShiftBuilderOptions key={`${shiftForm.employeeId}:${shiftForm.date}`} value={shiftForm} employeeId={shiftForm.employeeId} date={shiftForm.date} suggest onChange={patch => setShiftForm(form => ({ ...form, ...patch }))} />
            {isWorkShift(shiftForm) ? <>
            <label className="shift-edit-field">
              <span>Clock-in time</span>
              <TimeInput
                value={shiftForm.start}
                onChange={(start) => setShiftForm((form) => ({ ...form, start }))}
                ariaLabel="Shift start"
                placeholder="Start time"
                suggestBefore={shiftForm.end}
                required
              />
            </label>
            <label className="shift-edit-field">
              <span>Clock-out time</span>
              <TimeInput
                value={shiftForm.end}
                onChange={(end) => setShiftForm((form) => ({ ...form, end }))}
                ariaLabel="Shift end"
                placeholder="End time"
                suggestAfter={shiftForm.start}
                required
              />
            </label>
            </> : null}
            <label className="shift-edit-field">
              <span>Role</span>
              <select
                value={shiftForm.role}
                onChange={(event) => setShiftForm((form) => ({ ...form, role: event.target.value }))}
                aria-label="Shift role"
                required
              >
                <option value="">Select role</option>
                {availableRoles.filter(role => canEditScheduleRole(role)).map((role) => (
                  <option value={role} key={role}>{role}</option>
                ))}
              </select>
            </label>
            <fieldset className="shift-apply-days">
              <legend>Apply to:</legend>
              <div>
                {shiftWeekdayOptions.map((option) => (
                  <span className="shift-apply-day-option" key={option.value}>
                    <span className="shift-apply-day-date">{formatShiftApplyDate(shiftForm.date, option.value, scheduleEnforcement.workWeekStart)}</span>
                    <button
                      type="button"
                      className={createShiftWeekdays.includes(option.value) ? "active" : ""}
                      onClick={() => toggleCreateShiftWeekday(option.value)}
                      aria-label={`${option.label}, ${formatShiftApplyDate(shiftForm.date, option.value, scheduleEnforcement.workWeekStart)}`}
                      aria-pressed={createShiftWeekdays.includes(option.value)}
                    >
                      {option.label}
                    </button>
                  </span>
                ))}
              </div>
            </fieldset>
            <label className="shift-notes-field">
              <span>Shift notes:</span>
              <textarea
                value={shiftForm.notes}
                onChange={(event) => setShiftForm((form) => ({ ...form, notes: event.target.value }))}
                placeholder="Leave a note for your employee, and they’ll see it when they clock in."
                maxLength={500}
              />
            </label>
            {createShiftError ? <p className="shift-error-message" role="alert">{createShiftError}</p> : null}
            <div className="hours-edit-actions">
              <button type="button" onClick={() => setIsAddingShift(false)}>Cancel</button>
              <button type="submit">Add shift</button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "manager" && editingShift ? (
        <div className="modal-backdrop" role="presentation">
          <form className="shift-edit-modal" onSubmit={saveEditedShift} role="dialog" aria-modal="true" aria-labelledby="shift-edit-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Edit shift</p>
                <h2 id="shift-edit-title">{employeeById(state.employees, editingShift.employeeId)?.name ?? "Employee shift"}</h2>
              </div>
              <button type="button" onClick={() => setEditingShift(null)} aria-label="Close shift editor">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <button type="button" className="shift-copy-button" onClick={() => { setCopiedShift({ ...editingShift }); setEditingShift(null); }} aria-label="Copy shift" title="Copy shift">⧉ Copy shift</button>
            <label className="shift-edit-field"><span>Employee</span><select aria-label="Edit shift employee" value={editingShift.employeeId} onChange={event => setEditingShift(shift => shift ? { ...shift, employeeId: Number(event.target.value) } : shift)}>{orderedShiftEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
            {shiftWarningPreview()}
            <ShiftAvailability key={`availability:${editingShift.employeeId}`} requests={state.availabilityRequests} employeeId={editingShift.employeeId} date={editingShift.date} permitted={shared.data.permissions["availability.read"]} />
            <ShiftBuilderOptions value={editingShift} employeeId={editingShift.employeeId} date={editingShift.date} onChange={patch => setEditingShift(shift => shift ? { ...shift, ...patch } : shift)} />
            <label className="shift-edit-field">
              <span>Date</span>
              <input
                type="date"
                value={editingShift.date}
                onClick={openNativeDatePicker}
                onChange={(event) => {
                  const date = event.target.value;
                  setEditingShift((shift) => shift ? { ...shift, date } : shift);
                  if (date) setEditingShiftWeekdays([weekdayForDate(date)]);
                }}
                aria-label="Edit shift date"
              />
            </label>
            {isWorkShift(editingShift) ? <>
            <label className="shift-edit-field">
              <span className="shift-edit-label-row">
                <span>Clock-in time</span>
                {editingShiftClockIn || editingShiftHasStarted ? (
                  <span className="shift-edit-actual-time">
                    {editingShiftIsNoShow ? "No-show" : `Clocked in: ${editingShiftClockIn ? formatClockTime(editingShiftClockIn.at) : "Not recorded"}`}
                  </span>
                ) : null}
              </span>
              <TimeInput
                value={editingShift.start}
                onChange={(start) => setEditingShift((shift) => shift ? { ...shift, start } : shift)}
                ariaLabel="Edit shift start"
                placeholder="Start time"
                selectOnFocus
                suggestBefore={editingShift.end}
              />
            </label>
            <label className="shift-edit-field">
              <span className="shift-edit-label-row">
                <span>Clock-out time</span>
                {(editingShiftClockOut || editingShiftHasEnded) && !editingShiftIsNoShow ? (
                  <span className="shift-edit-actual-time">Clocked out: {editingShiftClockOut ? formatClockTime(editingShiftClockOut.at) : "Not recorded"}</span>
                ) : null}
              </span>
              <TimeInput
                value={editingShift.end}
                onChange={(end) => setEditingShift((shift) => shift ? { ...shift, end } : shift)}
                ariaLabel="Edit shift end"
                placeholder="End time"
                selectOnFocus
                suggestAfter={editingShift.start}
              />
            </label>
            </> : null}
            <label className="shift-edit-field">
              <span>Role</span>
              <select
                value={editingShift.role}
                onChange={(event) => setEditingShift((shift) => shift ? { ...shift, role: event.target.value } : shift)}
                aria-label="Edit shift role"
              >
                <option value="">Select role</option>
                {availableRoles.filter(role => canEditScheduleRole(role)).map((role) => (
                  <option value={role} key={role}>{role}</option>
                ))}
              </select>
            </label>
            <fieldset className="shift-apply-days">
              <legend>Apply to:</legend>
              <div>
                {shiftWeekdayOptions.map((option) => {
                  const isAnchorDay = option.value === weekdayForDate(editingShift.date);
                  return (
                    <span className="shift-apply-day-option" key={option.value}>
                      <span className="shift-apply-day-date">{formatShiftApplyDate(editingShift.date, option.value, scheduleEnforcement.workWeekStart)}</span>
                      <button
                        type="button"
                        className={editingShiftWeekdays.includes(option.value) ? "active" : ""}
                        onClick={() => toggleEditingShiftWeekday(option.value)}
                        aria-label={`${option.label}, ${formatShiftApplyDate(editingShift.date, option.value, scheduleEnforcement.workWeekStart)}`}
                        aria-pressed={editingShiftWeekdays.includes(option.value)}
                        disabled={isAnchorDay}
                      >
                        {option.label}
                      </button>
                    </span>
                  );
                })}
              </div>
            </fieldset>
            <label className="shift-notes-field">
              <span>Shift notes:</span>
              <textarea
                value={editingShift.notes ?? ""}
                onChange={(event) => setEditingShift((shift) => shift ? { ...shift, notes: event.target.value } : shift)}
                placeholder="Leave a note for your employee, and they’ll see it when they clock in."
                maxLength={500}
              />
            </label>
            <p className="shift-time-lock-note">Edits change the planned schedule only. Recorded punches stay unchanged.</p>
            {editShiftError ? <p className="shift-error-message" role="alert">{editShiftError}</p> : null}
            <div className="modal-actions">
              {activeUserIsAdmin ? (
                <button type="button" className="delete-action" onClick={deleteEditingShift}>Delete</button>
              ) : null}
              <button
                type="button"
                className={`secondary-action${editingShiftHasEnded ? " align-right" : ""}`}
                onClick={() => setEditingShift(null)}
              >
                Cancel
              </button>
              <button type="submit" className="primary-action">Save changes</button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingTimeException ? (
        <TimeExceptionDialog message={timeExceptionMessage} explanation={timeExceptionExplanation}
          limit={timeExceptionExplanationLimit} onExplanation={setTimeExceptionExplanation}
          onCancel={() => { setPendingTimeException(null); setTimeExceptionExplanation(""); }}
          onSubmit={submitTimeException} />
      ) : null}
    </main>
  );
}

function activeViewLabel(activeView: ViewId, mode: Mode) {
  if (activeView === "dashboard") return mode === "manager" ? "Manager mode" : "Employee mode";
  if (activeView === "employees") return "Roster";
  if (activeView === "departments_roles") return "Department / Roles";
  if (activeView === "schedule") return "Shifts";
  if (activeView === "time_off") return "Time off";
  if (activeView === "my_availability") return "My availability";
  if (activeView === "team_availability") return "Team availability";
  if (activeView === "profile") return "Profile";
  if (activeView === "team_members") return "Team members";
  return navItems.find((item) => item.id === activeView)?.label ?? "Home";
}

function employeeById(employees: Employee[], id: number) {
  return employees.find((employee) => employee.id === id);
}

function findEmployeeWithPin(employees: Employee[], pin: string, excludedEmployeeId?: number) {
  const normalizedPin = pin.trim();

  return employees.find(
    (employee) => employee.id !== excludedEmployeeId && employee.pin.trim() === normalizedPin,
  );
}

function hasEmployeeWithName(employees: Employee[], name: string, excludedEmployeeId?: number) {
  const normalizedName = normalizeEmployeeName(name);
  if (!normalizedName) return false;

  return employees.some(
    (employee) => employee.id !== excludedEmployeeId && normalizeEmployeeName(employee.name) === normalizedName,
  );
}

function normalizeEmployeeName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function isManagerEmployee(employee: Employee) {
  return employee.accessLevel === "Admin" || employee.accessLevel === "Manager";
}

function applyAutomaticClockOuts(state: StaffState, currentTime: number, settings: ScheduleEnforcement = defaultScheduleEnforcement): StaffState {
  let clockEventId = nextId(state.clockEvents);
  const automaticClockOuts = state.employees.flatMap((employee) => {
    const latestWorkEvent = lastWorkClockEvent(state.clockEvents, employee.id);
    if (!latestWorkEvent || latestWorkEvent.type !== "in") return [];

    const shift = shiftForClockEvent(latestWorkEvent, state.shifts);
    if (!shift) return [];

    const automaticClockOutTime = automaticClockOutAt(shiftEndDateTime(shift).getTime(), settings);
    if (automaticClockOutTime === null || currentTime < automaticClockOutTime) return [];

    return [{
      id: clockEventId++,
      employeeId: employee.id,
      type: "out" as const,
      at: new Date(automaticClockOutTime).toISOString(),
      explanation: settings.automaticClockOutMinutes === 120 ? automaticClockOutExplanation : `Automatically clocked out ${settings.automaticClockOutMinutes} minutes after the scheduled shift ended.`,
      automatic: true,
    }];
  });

  if (automaticClockOuts.length === 0) return state;

  return {
    ...state,
    clockEvents: [...automaticClockOuts, ...state.clockEvents],
  };
}

function isAutomaticClockOut(event: ClockEvent) {
  return event.type === "out" && (event.automatic === true || event.explanation === automaticClockOutExplanation);
}

function hasClockInForShift(shift: Shift, events: ClockEvent[], shifts: Shift[]) {
  return events.some((event) => (
    event.type === "in" && shiftForClockEvent(event, shifts)?.id === shift.id
  ));
}

function noShowAlertsFor(
  employees: Employee[],
  shifts: Shift[],
  events: ClockEvent[],
  currentTime: number,
  lookbackStart = Number.NEGATIVE_INFINITY,
  settings: ScheduleEnforcement = defaultScheduleEnforcement,
): OperationalAlert[] {
  if (!settings.noShowAlerts) return [];
  return shifts.flatMap((shift) => {
    const employee = employees.find((entry) => entry.id === shift.employeeId);
    if (shift.shiftType === "day_off" || !employee?.active) return [];

    const scheduledStart = shiftStartDateTime(shift);
    const alertTime = scheduledStart.getTime() + settings.noShowMinutes * 60000;
    if (alertTime > currentTime || alertTime < lookbackStart) return [];
    if (hasClockInForShift(shift, events, shifts)) return [];

    return [{
      id: `no-show-${shift.id}`,
      employeeId: shift.employeeId,
      title: "No-show",
      detail: `${employee.name} did not clock in for the scheduled ${formatClockTime(scheduledStart.toISOString())} shift.`,
      at: new Date(alertTime).toISOString(),
      severity: "danger" as const,
      eventTargetId: `no-show-${shift.id}`,
    }];
  }).sort((first, second) => second.at.localeCompare(first.at));
}

function operationalAlertsFor(
  employees: Employee[],
  shifts: Shift[],
  events: ClockEvent[],
  currentTime: number,
  settings: ScheduleEnforcement = defaultScheduleEnforcement,
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const missedBreakThresholdMs = settings.mealBreakAfterHours * 60 * 60 * 1000;
  const lookbackStart = currentTime - operationalAlertLookbackMs;
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const eventsAscending = [...events].sort((first, second) => first.at.localeCompare(second.at));

  eventsAscending.forEach((event) => {
    const eventTime = new Date(event.at).getTime();
    if (eventTime < lookbackStart || eventTime > currentTime) return;

    const employeeName = employeeNames.get(event.employeeId) ?? "Employee";
    if (event.type === "in" || event.type === "out") {
      const shift = shiftForClockEvent(event, shifts);
      const action = event.type === "in" ? "clock-in" : "clock-out";
      const actionPastTense = event.type === "in" ? "clocked in" : "clocked out";

      if (!shift) {
        alerts.push({
          id: `unscheduled-${event.id}`,
          employeeId: event.employeeId,
          title: `Unscheduled ${action}`,
          detail: `${employeeName} ${actionPastTense} at ${formatClockTime(event.at)} without a scheduled shift.`,
          at: event.at,
          severity: "danger",
          eventTargetId: `clock-${event.id}`,
        });
        return;
      }

      const scheduledTime = event.type === "in" ? shiftStartDateTime(shift) : shiftEndDateTime(shift);
      if (event.type === "out" && isAutomaticClockOut(event)) {
        alerts.push({
          id: `automatic-clock-out-${event.id}`,
          employeeId: event.employeeId,
          title: "Automatic clock-out",
          detail: `${employeeName} was automatically clocked out at ${formatClockTime(event.at)} after missing the scheduled ${formatClockTime(scheduledTime.toISOString())} clock-out.`,
          at: event.at,
          severity: "danger",
          eventTargetId: `clock-${event.id}`,
        });
        return;
      }

      const isWithinAllowedWindow = event.type === "in"
        ? isWithinClockInGrace(eventTime, scheduledTime.getTime(), settings)
        : isWithinScheduledMinute(eventTime, scheduledTime.getTime());
      if (isWithinAllowedWindow) return;

      const timing = eventTime < scheduledTime.getTime() ? "Early" : "Late";
      alerts.push({
        id: `${timing.toLocaleLowerCase()}-${action}-${event.id}`,
        employeeId: event.employeeId,
        title: `${timing} ${action}`,
        detail: `${employeeName} ${actionPastTense} ${timing.toLocaleLowerCase()} at ${formatClockTime(event.at)}; scheduled for ${formatClockTime(scheduledTime.toISOString())}.`,
        at: event.at,
        severity: timing === "Late" ? "danger" : "warning",
        eventTargetId: `clock-${event.id}`,
      });
      return;
    }

    if (event.type === "break_end") {
      const breakStart = matchingBreakStartEvent(event, eventsAscending);
      const scheduledEnd = breakStart ? breakEndTime(breakStart) : undefined;
      if (!scheduledEnd || eventTime < scheduledEnd.getTime() + 60000) return;

      alerts.push({
        id: `late-break-return-${event.id}`,
        employeeId: event.employeeId,
        title: "Late return from break",
        detail: `${employeeName} returned at ${formatClockTime(event.at)}; expected by ${formatClockTime(scheduledEnd.toISOString())}.`,
        at: event.at,
        severity: "danger",
        eventTargetId: `clock-${event.id}`,
      });
    }
  });

  const openWorkSessions = new Map<number, { clockIn: ClockEvent; tookBreak: boolean }>();
  eventsAscending.forEach((event) => {
    if (event.type === "in") {
      openWorkSessions.set(event.employeeId, { clockIn: event, tookBreak: false });
      return;
    }

    const session = openWorkSessions.get(event.employeeId);
    if (!session) return;
    if (event.type === "break") {
      session.tookBreak = true;
      return;
    }
    if (event.type !== "out") return;

    const clockOutTime = new Date(event.at).getTime();
    const clockInTime = new Date(session.clockIn.at).getTime();
    if (settings.mandatoryMealBreak && !session.tookBreak && clockOutTime - clockInTime >= missedBreakThresholdMs && clockOutTime >= lookbackStart) {
      const employeeName = employeeNames.get(event.employeeId) ?? "Employee";
      alerts.push({
        id: `missed-break-${session.clockIn.id}-${event.id}`,
        employeeId: event.employeeId,
        title: "Missed break",
        detail: `${employeeName} worked at least ${settings.mealBreakAfterHours} continuous ${settings.mealBreakAfterHours === 1 ? "hour" : "hours"} without recording a break.`,
        at: event.at,
        severity: "danger",
        eventTargetId: `clock-${event.id}`,
      });
    }
    openWorkSessions.delete(event.employeeId);
  });

  openWorkSessions.forEach((session, employeeId) => {
    const clockInTime = new Date(session.clockIn.at).getTime();
    const alertTime = clockInTime + missedBreakThresholdMs;
    if (!settings.mandatoryMealBreak || session.tookBreak || alertTime > currentTime || alertTime < lookbackStart) return;

    alerts.push({
      id: `missed-break-open-${session.clockIn.id}`,
      employeeId,
      title: "Missed break",
      detail: `${employeeNames.get(employeeId) ?? "Employee"} has worked at least ${settings.mealBreakAfterHours} continuous ${settings.mealBreakAfterHours === 1 ? "hour" : "hours"} without recording a break.`,
      at: new Date(alertTime).toISOString(),
      severity: "danger",
      eventTargetId: `clock-${session.clockIn.id}`,
    });
  });

  alerts.push(...noShowAlertsFor(employees, shifts, eventsAscending, currentTime, lookbackStart, settings));

  return alerts
    .filter((alert, index, allAlerts) => allAlerts.findIndex((entry) => entry.id === alert.id) === index)
    .sort((first, second) => second.at.localeCompare(first.at))
    .slice(0, 25);
}

function formatOperationalAlertTime(at: string) {
  const date = new Date(at);
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${formatClockTime(at)}`;
}

function lastWorkClockEvent(events: ClockEvent[], employeeId: number) {
  return events
    .filter((event) => event.employeeId === employeeId && (event.type === "in" || event.type === "out"))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

function activeBreakEvent(events: ClockEvent[], employeeId: number) {
  const lastClockIn = events
    .filter((event) => event.employeeId === employeeId && event.type === "in")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!lastClockIn) return undefined;

  return events
    .filter((event) => event.employeeId === employeeId && event.type === "break" && event.at >= lastClockIn.at)
    .filter((event) =>
      !events.some((entry) =>
        entry.employeeId === employeeId
        && entry.type === "break_end"
        && entry.at >= event.at,
      ),
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

function breakEndTime(event: ClockEvent) {
  const durationMs = breakDurationMs(event);
  if (event.type !== "break" || durationMs === 0) return undefined;

  return new Date(new Date(event.at).getTime() + durationMs);
}

function clockEventLabel(event: ClockEvent, shifts: Shift[], settings: ScheduleEnforcement = defaultScheduleEnforcement) {
  if (event.type === "in" || event.type === "out") {
    if (event.type === "out" && isAutomaticClockOut(event)) {
      return "Automatic clock-out";
    }

    const action = event.type === "in" ? "Clock in" : "Clock out";
    const pastAction = event.type === "in" ? "Clocked in" : "Clocked out";
    const shift = shiftForClockEvent(event, shifts);
    if (!shift) return `Unscheduled ${action.toLocaleLowerCase()}`;

    const scheduledTime = event.type === "in"
      ? shiftStartDateTime(shift).getTime()
      : shiftEndDateTime(shift).getTime();
    const eventTime = new Date(event.at).getTime();
    const isWithinAllowedWindow = event.type === "in"
      ? isWithinClockInGrace(eventTime, scheduledTime, settings)
      : isWithinScheduledMinute(eventTime, scheduledTime);
    if (isWithinAllowedWindow) return action;

    return `${pastAction} ${eventTime < scheduledTime ? "early" : "late"}`;
  }
  if (event.type === "break_end") return `${breakDurationLabel(event)} break ended`;
  return `${breakDurationLabel(event)} break started`;
}

function shiftForClockEvent(event: ClockEvent, shifts: Shift[]) {
  const eventTime = new Date(event.at).getTime();

  return shifts.filter((shift) => {
    if (event.role && shift.role !== event.role) return false;
    if (shift.shiftType === "day_off" || shift.employeeId !== event.employeeId) return false;
    const start = shiftStartDateTime(shift).getTime();
    const end = shiftEndDateTime(shift).getTime();
    const windowStart = start - 12 * 60 * 60 * 1000;
    const windowEnd = end + 12 * 60 * 60 * 1000;
    return eventTime >= windowStart && eventTime <= windowEnd;
  }).sort((a, b) => Math.abs(eventTime - (event.type === "out" ? shiftEndDateTime(a) : shiftStartDateTime(a)).getTime()) - Math.abs(eventTime - (event.type === "out" ? shiftEndDateTime(b) : shiftStartDateTime(b)).getTime()))[0];
}

function matchingBreakStartEvent(event: ClockEvent, events: ClockEvent[]) {
  return events
    .filter((candidate) =>
      candidate.employeeId === event.employeeId &&
      candidate.type === "break" &&
      candidate.at <= event.at
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

function timeExceptionWarningMessage(
  action: TimeExceptionAction,
  shift: Shift | undefined,
  breakEnd: Date | undefined,
  currentTime: number,
) {
  if (action === "break_end") {
    if (!breakEnd) return "You are ending your break without a scheduled break end time. Please explain why.";

    return `You are ending your break late at ${formatClockTime(new Date(currentTime).toISOString())}. Please explain why.`;
  }

  if (!shift) {
    return `You are clocking ${action === "in" ? "in" : "out"} without a scheduled shift today. Please explain why.`;
  }

  const scheduledTime = action === "in" ? shiftStartDateTime(shift) : shiftEndDateTime(shift);
  const timing = timingStatus(currentTime, scheduledTime.getTime());

  return `You are clocking ${action === "in" ? "in" : "out"} ${timing} for your scheduled ${formatClockTime(scheduledTime.toISOString())} ${action === "in" ? "start" : "end"} time. Please explain why.`;
}

function needsTimeException(
  action: TimeExceptionAction,
  shift: Shift | undefined,
  breakEnd: Date | undefined,
  currentTime: number,
  settings: ScheduleEnforcement = defaultScheduleEnforcement,
) {
  if (action === "break_end") {
    return breakEnd ? currentTime >= breakEnd.getTime() + 60000 : true;
  }

  if (!shift) return settings.requireUnscheduledExplanation;

  const scheduledTime = action === "in" ? shiftStartDateTime(shift) : shiftEndDateTime(shift);
  if (action === "out") return settings.requireClockOutExplanation && !isWithinScheduledMinute(currentTime, scheduledTime.getTime());
  const timing = clockInTiming(currentTime, scheduledTime.getTime(), settings);
  return timing === "early" ? settings.requireEarlyClockInExplanation
    : timing === "late" && settings.requireLateClockInExplanation;
}

function isWithinClockInGrace(currentTime: number, scheduledTime: number, settings: ScheduleEnforcement = defaultScheduleEnforcement) {
  return clockInTiming(currentTime, scheduledTime, settings) === "on-time";
}

function isWithinScheduledMinute(currentTime: number, scheduledTime: number) {
  const scheduledMinuteStart = Math.floor(scheduledTime / 60000) * 60000;
  return currentTime >= scheduledMinuteStart && currentTime < scheduledMinuteStart + 60000;
}

function timingStatus(currentTime: number, scheduledTime: number) {
  if (currentTime < scheduledTime) return "early";
  if (currentTime > scheduledTime) return "late";
  return "at the scheduled time";
}

function shiftStartDateTime(shift: Shift) {
  return new Date(`${shift.date}T${shift.start}:00`);
}

function shiftEndDateTime(shift: Shift) {
  const start = shiftStartDateTime(shift);
  const end = new Date(`${shift.date}T${shift.end}:00`);
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

function breakDurationMs(event: ClockEvent) {
  if (event.durationSeconds) return event.durationSeconds * 1000;
  if (event.durationMinutes) return event.durationMinutes * 60 * 1000;
  return 0;
}

function breakDurationLabel(event: ClockEvent) {
  if (event.durationSeconds) return `${event.durationSeconds} sec`;
  return `${event.durationMinutes ?? 0} min`;
}

function nextId(items: { id: number }[]) {
  let id = newRecordId();
  while (items.some(item => item.id === id)) id = newRecordId();
  return id;
}

function applyScheduleDraft(publishedShifts: Shift[], draft?: ScheduleDraft) {
  if (!draft) return publishedShifts;

  const deletedShiftIds = new Set(draft.deletedShiftIds);
  const upsertedShifts = new Map(draft.upsertedShifts.map((shift) => [shift.id, shift]));
  const publishedShiftIds = new Set(publishedShifts.map((shift) => shift.id));

  return [
    ...publishedShifts
      .filter((shift) => !deletedShiftIds.has(shift.id))
      .map((shift) => upsertedShifts.get(shift.id) ?? shift),
    ...draft.upsertedShifts.filter((shift) => !publishedShiftIds.has(shift.id)),
  ];
}

function mergeScheduleDraft(
  publishedShifts: Shift[],
  draft: ScheduleDraft | undefined,
  upsertedShifts: Shift[],
  deletedShiftIds: number[],
  affectedEmployeeIds: number[],
): ScheduleDraft {
  const nextUpsertedShifts = new Map((draft?.upsertedShifts ?? []).map((shift) => [shift.id, shift]));
  const nextDeletedShiftIds = new Set(draft?.deletedShiftIds ?? []);
  const publishedShiftIds = new Set(publishedShifts.map((shift) => shift.id));

  deletedShiftIds.forEach((shiftId) => {
    nextUpsertedShifts.delete(shiftId);
    if (publishedShiftIds.has(shiftId)) nextDeletedShiftIds.add(shiftId);
    else nextDeletedShiftIds.delete(shiftId);
  });
  upsertedShifts.forEach((shift) => {
    nextUpsertedShifts.set(shift.id, shift);
    nextDeletedShiftIds.delete(shift.id);
  });

  return {
    upsertedShifts: Array.from(nextUpsertedShifts.values()),
    deletedShiftIds: Array.from(nextDeletedShiftIds),
    affectedEmployeeIds: Array.from(new Set([
      ...(draft?.affectedEmployeeIds ?? []),
      ...affectedEmployeeIds,
    ])),
  };
}

function nextScheduleShiftId(state: StaffState) {
  return nextId([
    ...state.shifts,
    ...Object.values(state.scheduleDraftsByManager ?? {}).flatMap((draft) => draft.upsertedShifts),
  ]);
}











function formatPhoneNumberInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatWageInput(value: string) {
  const numericValue = value.replace(/[^\d.]/g, "");
  if (!numericValue) return "";

  const amount = Number(numericValue);
  if (!Number.isFinite(amount)) return "";
  return `$${amount.toFixed(2)}/hr`;
}

function sanitizeWageInput(value: string) {
  const numericValue = value.replace(/[^\d.]/g, "");
  const [wholeNumber = "", ...decimalParts] = numericValue.split(".");
  if (decimalParts.length === 0) return wholeNumber;

  return `${wholeNumber || "0"}.${decimalParts.join("").slice(0, 2)}`;
}



function formatCompanyLocation(info: BasicInfo) {
  const location = [info.city, info.stateProvince, info.postalCode].filter(Boolean).join(", ");
  return location || "Add city, state, and ZIP code";
}

function locationNamesFromBasicInfo(info: BasicInfo) {
  return Array.from(new Set([info.locationName.trim()].filter(Boolean)));
}

function rolesForDepartment(
  department: Department,
  departments: Department[],
  rosterRoles: string[],
) {
  const fallbackDepartment = departments.find(
    (savedDepartment) => savedDepartment.name.trim().toLowerCase() === "department not set",
  ) ?? departments[0];
  if (department.id !== fallbackDepartment?.id) return department.roles;

  const rolesAssignedToDepartments = new Set(
    departments
      .filter((savedDepartment) => savedDepartment.id !== department.id)
      .flatMap((savedDepartment) => savedDepartment.roles),
  );
  const unassignedRosterRoles = rosterRoles.filter((role) => !rolesAssignedToDepartments.has(role));
  return Array.from(new Set([...department.roles, ...unassignedRosterRoles]));
}







function formatDateTime(value?: string) {
  if (!value) return "not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}



function formatSavedTime(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatTimeOffRequestDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`)).replace(",", "");
}

function formatRequestTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value)).replace(/\s([AP]M)$/i, (suffix) => suffix.trim().toLowerCase());
}

function formatNumericDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatClockTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCountdown(milliseconds: number) {
  const isOvertime = milliseconds < 0;
  const totalSeconds = isOvertime
    ? Math.floor(Math.abs(milliseconds) / 1000)
    : Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${isOvertime && totalSeconds > 0 ? "-" : ""}${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getLocalDateValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function weekday(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function formatShortDate(date: string) {
  if (!date || !Number.isFinite(new Date(`${date}T12:00:00`).getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatMonthYear(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function shiftsForCalendarRange(
  shifts: Shift[],
  employeeIds: Set<number>,
  today: string,
  tab: CalendarTab,
  weekStart = 1,
) {
  const currentDate = parseLocalDate(today);
  const { start, end } = dateRangeForCalendarTab(currentDate, tab, weekStart);

  return shifts.filter((shift) => {
    if (!employeeIds.has(shift.employeeId)) return false;

    const shiftDate = startOfDay(parseLocalDate(shift.date));
    return shiftDate >= start && shiftDate <= end;
  });
}

function dateRangeForCalendarTab(date: Date, tab: CalendarTab, weekStart = 1) {
  if (tab === "today") {
    return { start: startOfDay(date), end: startOfDay(date) };
  }

  if (tab === "week") {
    const start = startOfDay(date);
    start.setDate(start.getDate() - workWeekOffset(start.getDay(), weekStart));
    const end = startOfDay(start);
    end.setDate(start.getDate() + 6);

    return { start, end };
  }

  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  return { start, end };
}

function formatPtoHistoryMonth(date: string) {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${date}T12:00:00`));
  return `${month}, ${date.slice(0, 4)}`;
}

function ptoHistoryStatusLabel(status: PtoHistoryStatusFilter) {
  if (status === "all") return "All";
  return capitalize(status);
}

function shiftDateByCalendarTab(date: string, tab: CalendarTab, direction: -1 | 1) {
  const selectedDate = parseLocalDate(date);

  if (tab === "today") selectedDate.setDate(selectedDate.getDate() + direction);
  else if (tab === "week") selectedDate.setDate(selectedDate.getDate() + direction * 7);
  else selectedDate.setMonth(selectedDate.getMonth() + direction);

  return toDateInputValue(selectedDate);
}

function hoursDateRange(date: string, tab: CalendarTab, weekStart = 1) {
  if (tab === "week") {
    const days = workWeekCalendarDays(date, weekStart);
    return { start: parseLocalDate(days[0].date), end: parseLocalDate(days[6].date) };
  }
  return dateRangeForCalendarTab(parseLocalDate(date), tab);
}

function hoursDateLabel(tab: CalendarTab, date: string, weekStart = 1) {
  if (tab === "today") return formatLongDate(date);
  if (tab === "week") {
    const days = workWeekCalendarDays(date, weekStart);
    return `${formatShortDate(days[0].date)} – ${formatShortDate(days[6].date)}`;
  }
  return formatMonthYear(date);
}


function weekCalendarDays(date: string) {
  const selectedDate = parseLocalDate(date);
  const weekStart = startOfDay(selectedDate);
  weekStart.setDate(selectedDate.getDate() - selectedDate.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const calendarDate = startOfDay(weekStart);
    calendarDate.setDate(weekStart.getDate() + index);
    return { date: toDateInputValue(calendarDate), day: calendarDate.getDate().toString() };
  });
}

function workWeekCalendarDays(date: string, weekStartDay = 1) {
  const selectedDate = parseLocalDate(date);
  const weekStart = startOfDay(selectedDate);
  weekStart.setDate(selectedDate.getDate() - workWeekOffset(selectedDate.getDay(), weekStartDay));

  return Array.from({ length: 7 }, (_, index) => {
    const calendarDate = startOfDay(weekStart);
    calendarDate.setDate(weekStart.getDate() + index);
    return { date: toDateInputValue(calendarDate), day: calendarDate.getDate().toString() };
  });
}

function scheduleMonthCalendarDays(date: string, weekStartDay = 1) {
  const selectedDate = parseLocalDate(date);
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const gridStart = startOfDay(monthStart);
  const mondayOffset = workWeekOffset(monthStart.getDay(), weekStartDay);
  gridStart.setDate(gridStart.getDate() - mondayOffset);
  const gridEnd = startOfDay(monthEnd);
  const daysUntilSunday = 6 - workWeekOffset(monthEnd.getDay(), weekStartDay);
  gridEnd.setDate(gridEnd.getDate() + daysUntilSunday);
  const calendarDayCount = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1;

  return Array.from({ length: calendarDayCount }, (_, index) => {
    const calendarDate = startOfDay(gridStart);
    calendarDate.setDate(gridStart.getDate() + index);
    return {
      date: toDateInputValue(calendarDate),
      day: calendarDate.getDate().toString(),
      inMonth: calendarDate.getMonth() === selectedDate.getMonth(),
    };
  });
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(date: string) {
  return new Date(`${date}T12:00:00`);
}

function weekdayForDate(date: string) {
  return parseLocalDate(date).getDay();
}

function shiftDateForWeekday(anchorDate: string, weekday: number, weekStartDay = 1) {
  const anchor = parseLocalDate(anchorDate);
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - workWeekOffset(anchor.getDay(), weekStartDay));
  const date = new Date(monday);
  date.setDate(monday.getDate() + workWeekOffset(weekday, weekStartDay));
  return toDateInputValue(date);
}

function formatShiftApplyDate(anchorDate: string, weekday: number, weekStartDay = 1) {
  const date = parseLocalDate(shiftDateForWeekday(anchorDate, weekday, weekStartDay));
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function shiftDatesForWeekdays(anchorDate: string, weekdays: number[], weekStartDay = 1) {
  return shiftWeekdayOptions
    .filter((option) => weekdays.includes(option.value))
    .map((option) => shiftDateForWeekday(anchorDate, option.value, weekStartDay));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calendarTabTitle(tab: CalendarTab) {
  if (tab === "today") return "Today";
  if (tab === "week") return "This Week";
  return "This Month";
}

function hoursTabTitle(tab: CalendarTab) {
  if (tab === "today") return "Today";
  if (tab === "week") return "This Week";
  return "This Month";
}

function calendarTabEmptyLabel(tab: CalendarTab) {
  if (tab === "today") return "today";
  if (tab === "week") return "this week";
  return "this month";
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatTimeRange(shift: Shift) {
  if (shift.shiftType === "day_off") return "Day off";
  return `${formatTime12(shift.start)} - ${formatTime12(shift.end)}`;
}

function formatCompactTimeRange(shift: Shift) {
  if (shift.shiftType === "day_off") return "Day off";
  return `${formatTimeCompact(shift.start)}-${formatTimeCompact(shift.end)}`;
}

function formatTime12(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;

  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

function formatTimeCompact(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;

  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;

  return minute === 0
    ? `${displayHour}${period}`
    : `${displayHour}:${minute.toString().padStart(2, "0")}${period}`;
}

function formatHourLabel(hour: number) {
  const normalizedHour = hour % 24;
  const period = normalizedHour >= 12 ? "pm" : "am";
  const displayHour = normalizedHour % 12 || 12;

  return `${displayHour}${period}`;
}

function parseTypedTime(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;

  const period = normalized.endsWith("am") ? "am" : normalized.endsWith("pm") ? "pm" : "";
  const timeText = period ? normalized.slice(0, -2) : normalized;
  let hour = 0;
  let minute = 0;

  if (timeText.includes(":")) {
    const [hourText, minuteText = "0"] = timeText.split(":");
    hour = Number(hourText);
    minute = Number(minuteText);
  } else if (/^\d{3,4}$/.test(timeText)) {
    hour = Number(timeText.slice(0, -2));
    minute = Number(timeText.slice(-2));
  } else if (/^\d{1,2}$/.test(timeText)) {
    hour = Number(timeText);
    minute = 0;
  } else {
    return null;
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === "am") hour = hour === 12 ? 0 : hour;
    if (period === "pm") hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function timeDraftHourLength(digits: string) {
  if (digits.length < 2) return 1;
  const possibleTwoDigitHour = Number(digits.slice(0, 2));
  return possibleTwoDigitHour >= 10 && possibleTwoDigitHour <= 12 ? 2 : 1;
}

function formatTimeDraftInput(value: string, previousValue = "") {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  // Preserve complete typed/pasted clock times instead of reinterpreting their digits.
  if (/^(?:[01]?\d|2[0-3]):[0-5]\d(?:am|pm)?$/.test(normalized)) return normalized;
  const periodMatch = normalized.match(/([ap](?:m)?)$/);
  const period = periodMatch?.[1] ?? "";
  const timeText = period ? normalized.slice(0, -period.length) : normalized;
  const digits = timeText.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";

  const hourLength = timeDraftHourLength(digits);
  const hour = digits.slice(0, hourLength);
  const minuteDigits = digits.slice(hourLength, hourLength + 2);
  if (minuteDigits.length > 0 && Number(minuteDigits[0]) > 5) return previousValue;
  if (minuteDigits.length === 2 && Number(minuteDigits) > 59) return previousValue;
  if (period) return `${hour}:${minuteDigits.padEnd(2, "0")}${period}`;
  return minuteDigits ? `${hour}:${minuteDigits}` : hour;
}

function suggestedTimeForDraft(value: string, suggestAfter?: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^(\d{1,2})(?::(\d{0,2}))?([ap](?:m)?)?$/);
  if (!match) return null;

  const typedHour = Number(match[1]);
  const minuteText = match[2] ?? "";
  const minute = Number(minuteText.padEnd(2, "0"));
  const explicitPeriod = match[3]?.startsWith("a") ? "am" : match[3]?.startsWith("p") ? "pm" : "";
  if (!Number.isInteger(typedHour) || typedHour < 0 || typedHour > 23 || minute > 59) return null;
  if (explicitPeriod && (typedHour < 1 || typedHour > 12)) return null;

  let hour = typedHour;
  if (explicitPeriod) {
    if (explicitPeriod === "am") hour = typedHour === 12 ? 0 : typedHour;
    if (explicitPeriod === "pm") hour = typedHour === 12 ? 12 : typedHour + 12;
  } else if (typedHour >= 1 && typedHour <= 12) {
    const morningHour = typedHour === 12 ? 0 : typedHour;
    const afternoonHour = typedHour === 12 ? 12 : typedHour + 12;
    const startMinutes = suggestAfter ? timeToMinutes(suggestAfter) : null;

    if (startMinutes !== null) {
      hour = [morningHour, afternoonHour]
        .filter((candidate) => candidate * 60 + minute > startMinutes)
        .sort((first, second) => first - second)[0]
        ?? afternoonHour;
    } else {
      hour = typedHour >= 1 && typedHour <= 4 ? afternoonHour : morningHour;
    }
  }

  const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  const displayHour = hour % 12 || 12;
  const period = hour >= 12 ? "pm" : "am";
  return { time, label: `${displayHour}:${minute.toString().padStart(2, "0")}${period}` };
}

function isTimeDraftBefore(value: string, before?: string) {
  if (!value.trim() || !before) return true;

  const candidate = suggestedTimeForDraft(value)?.time ?? parseTypedTime(value);
  const candidateMinutes = candidate ? timeToMinutes(candidate) : null;
  const beforeMinutes = timeToMinutes(before);

  return candidateMinutes === null || beforeMinutes === null || candidateMinutes < beforeMinutes;
}

function isTimeDraftAfter(value: string, after?: string) {
  if (!value.trim() || !after) return true;

  const candidate = suggestedTimeForDraft(value, after)?.time ?? parseTypedTime(value);
  const candidateMinutes = candidate ? timeToMinutes(candidate) : null;
  const afterMinutes = timeToMinutes(after);

  return candidateMinutes === null || afterMinutes === null || candidateMinutes > afterMinutes;
}

function isTimeWithinBounds(value: string, after?: string, before?: string) {
  const candidateMinutes = timeToMinutes(value);
  const afterMinutes = after ? timeToMinutes(after) : null;
  const beforeMinutes = before ? timeToMinutes(before) : null;

  if (candidateMinutes === null) return false;
  if (afterMinutes !== null && candidateMinutes <= afterMinutes) return false;
  if (beforeMinutes !== null && candidateMinutes >= beforeMinutes) return false;
  return true;
}

function timeToMinutes(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return hour * 60 + minute;
}

function scheduleBarStyle(shift: Shift, settings: ScheduleEnforcement = defaultScheduleEnforcement) {
  if (shift.shiftType === "day_off") return { "--shift-left": "0%", "--shift-width": "100%" } as CSSProperties;
  const startMinutes = timeToMinutes(shift.start);
  const endMinutes = timeToMinutes(shift.end);
  const scheduleStartMinutes = settings.scheduleStartHour * 60;
  const scheduleEndMinutes = settings.scheduleEndHour * 60;
  const totalMinutes = scheduleEndMinutes - scheduleStartMinutes;

  if (startMinutes === null || endMinutes === null) return {};

  const adjustedEndMinutes = endMinutes >= startMinutes ? endMinutes : endMinutes + 24 * 60;
  const visibleStart = Math.max(startMinutes, scheduleStartMinutes);
  const visibleEnd = Math.min(adjustedEndMinutes, scheduleEndMinutes);
  if (visibleEnd <= visibleStart) return { display: "none" };
  const left = ((visibleStart - scheduleStartMinutes) / totalMinutes) * 100;
  const width = Math.max(((visibleEnd - visibleStart) / totalMinutes) * 100, 2);

  return {
    "--shift-left": `${left}%`,
    "--shift-width": `${width}%`,
  } as CSSProperties;
}

function employeeInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function weeklyShiftCount(days: { shifts: Shift[] }[]) {
  return days.reduce((count, day) => count + day.shifts.length, 0);
}

function workedHoursForRange(
  events: ClockEvent[],
  employeeId: number,
  range: { start: Date; end: Date },
  currentTime: number,
) {
  const rangeStart = range.start.getTime();
  const rangeEnd = startOfNextDay(range.end).getTime();
  const employeeEvents = events
    .filter((event) => employeeId === event.employeeId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const workIntervals = clockIntervals(employeeEvents, currentTime);
  const breakIntervals = breakIntervalsForEvents(employeeEvents, currentTime);
  const workedMs = workIntervals.reduce((total, interval) => {
    const clippedWork = clippedDuration(interval.start, interval.end, rangeStart, rangeEnd);
    const clippedBreaks = breakIntervals.reduce(
      (breakTotal, breakInterval) =>
        breakTotal + overlapDuration(interval, breakInterval, rangeStart, rangeEnd),
      0,
    );

    return total + Math.max(0, clippedWork - clippedBreaks);
  }, 0);

  return workedMs / (60 * 60 * 1000);
}

function employeeLastName(name: string) {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

function employeeDepartmentName(employee: Employee, departments: Department[]) {
  return departments.find((department) => department.roles.includes(employee.role))?.name ?? "Unassigned";
}

function conversationLastSentAt(conversation: TeamConversation) {
  return conversation.messages[conversation.messages.length - 1]?.sentAt ?? "";
}

function conversationHasUnreadMessages(conversation: TeamConversation, employeeId: number) {
  return conversationUnreadMessageCount(conversation, employeeId) > 0;
}

function conversationUnreadMessageCount(conversation: TeamConversation, employeeId: number) {
  return conversation.messages.filter(
    (message) => message.senderEmployeeId !== employeeId && !message.readByEmployeeIds.includes(employeeId),
  ).length;
}

function messageDeliveryStatus(message: TeamMessage, conversation: TeamConversation) {
  const recipientIds = conversation.participantIds.filter(
    (employeeId) => employeeId !== message.senderEmployeeId,
  );
  const allRecipientsHaveRead = recipientIds.length > 0 && recipientIds.every(
    (employeeId) => message.readByEmployeeIds.includes(employeeId),
  );

  return allRecipientsHaveRead ? "Read" : "Delivered";
}

function conversationTitle(conversation: TeamConversation, employees: Employee[], activeEmployeeId: number) {
  if (conversation.participantIds.length > 2 && conversation.name?.trim()) {
    return conversation.name.trim();
  }

  const names = conversation.participantIds
    .filter((employeeId) => employeeId !== activeEmployeeId)
    .map((employeeId) => employeeById(employees, employeeId)?.name)
    .filter((name): name is string => Boolean(name));

  return names.length > 0 ? names.join(", ") : "Just you";
}

function conversationInitials(conversation: TeamConversation, employees: Employee[], activeEmployeeId: number) {
  const members = conversation.participantIds
    .filter((employeeId) => employeeId !== activeEmployeeId)
    .map((employeeId) => employeeById(employees, employeeId))
    .filter((employee): employee is Employee => Boolean(employee));

  if (members.length === 0) return "ME";
  if (members.length === 1) return employeeInitials(members[0].name);
  return `${members[0].name.charAt(0)}${members[1].name.charAt(0)}`.toUpperCase();
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function messagesShareCalendarDay(firstValue: string, secondValue: string) {
  const firstDate = new Date(firstValue);
  const secondDate = new Date(secondValue);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) return false;
  return firstDate.getFullYear() === secondDate.getFullYear()
    && firstDate.getMonth() === secondDate.getMonth()
    && firstDate.getDate() === secondDate.getDate();
}

function adjustedWorkedHoursForRange(
  events: ClockEvent[],
  adjustments: HoursAdjustment[],
  employeeId: number,
  range: { start: Date; end: Date },
  currentTime: number,
) {
  const adjustmentHours = adjustments
    .filter((adjustment) => {
      if (adjustment.employeeId !== employeeId) return false;
      const date = startOfDay(parseLocalDate(adjustment.date));
      return date >= range.start && date <= range.end;
    })
    .reduce((total, adjustment) => total + adjustment.hours, 0);

  return Math.max(0, workedHoursForRange(events, employeeId, range, currentTime) + adjustmentHours);
}

function adjustmentDateForRange(selectedDate: string, range: { start: Date; end: Date }) {
  const date = startOfDay(parseLocalDate(selectedDate));
  if (date < range.start) return toDateInputValue(range.start);
  if (date > range.end) return toDateInputValue(range.end);
  return selectedDate;
}

function clockIntervals(events: ClockEvent[], currentTime: number) {
  const intervals: { start: number; end: number }[] = [];
  let clockInAt: number | null = null;

  events.forEach((event) => {
    if (event.type === "in") {
      clockInAt = new Date(event.at).getTime();
      return;
    }

    if (event.type === "out" && clockInAt !== null) {
      intervals.push({ start: clockInAt, end: new Date(event.at).getTime() });
      clockInAt = null;
    }
  });

  if (clockInAt !== null) {
    intervals.push({ start: clockInAt, end: currentTime });
  }

  return intervals;
}

function breakIntervalsForEvents(events: ClockEvent[], currentTime: number) {
  return events
    .filter((event) => event.type === "break")
    .map((event) => {
      const start = new Date(event.at).getTime();
      const finished = events.find(
        (entry) => entry.type === "break_end" && entry.at >= event.at,
      );
      const scheduledEnd = breakEndTime(event)?.getTime() ?? start;

      return {
        start,
        end: finished ? new Date(finished.at).getTime() : Math.max(currentTime, scheduledEnd),
      };
    });
}

function clippedDuration(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

function overlapDuration(
  first: { start: number; end: number },
  second: { start: number; end: number },
  rangeStart: number,
  rangeEnd: number,
) {
  return Math.max(
    0,
    Math.min(first.end, second.end, rangeEnd) - Math.max(first.start, second.start, rangeStart),
  );
}

function startOfNextDay(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function yearToDateRange(date: Date) {
  return {
    start: new Date(date.getFullYear(), 0, 1),
    end: startOfDay(date),
  };
}

function ptoHoursEarnedForPolicy(hoursWorked: number, policy: PtoPolicy | undefined, employeeId: number) {
  if (!policy) return 0;
  const startingBalance = policy.startingBalances?.[employeeId]?.balance ?? 0;
  if (policy.method === "fixed") return startingBalance + policy.fixedHours;
  if (policy.earnedHours <= 0 || policy.workedHours <= 0) return startingBalance;

  const accruedHours = (Math.max(0, hoursWorked) / policy.workedHours) * policy.earnedHours;
  return Math.round((startingBalance + accruedHours) * 100) / 100;
}

function ptoHoursUsedThisYear(requests: PtoRequest[], employeeId: number, year: number) {
  return requests
    .filter((request) => (
      request.employeeId === employeeId
      && request.status === "approved"
      && request.compensation !== "unpaid"
    ))
    .reduce((total, request) => {
      const start = parseLocalDate(request.startDate);
      const end = parseLocalDate(request.endDate);
      const yearStart = new Date(year, 0, 1, 12);
      const yearEnd = new Date(year, 11, 31, 12);
      const current = new Date(Math.max(start.getTime(), yearStart.getTime()));
      const finalDay = new Date(Math.min(end.getTime(), yearEnd.getTime()));
      if (current > finalDay) return total;

      return total + ptoHoursForDateRange(
        toDateInputValue(current),
        toDateInputValue(finalDay),
      );
    }, 0);
}

function ptoHoursForDateRange(startDate: string, endDate: string) {
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  let calendarDays = 0;

  while (current <= end) {
    calendarDays += 1;
    current.setDate(current.getDate() + 1);
  }

  return calendarDays * 8;
}

function formatWorkedHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const displayHours = Math.floor(totalMinutes / 60);
  const displayMinutes = totalMinutes % 60;

  return `${displayHours} hrs ${displayMinutes} mins`;
}

function formatPtoHours(hours: number) {
  const sign = hours < 0 ? "-" : "";
  const absoluteHours = Math.abs(hours);
  return Number.isInteger(absoluteHours)
    ? `${sign}${absoluteHours} hrs`
    : `${sign}${formatWorkedHours(absoluteHours)}`;
}

function formatPtoChartHours(hours: number) {
  return `${Math.trunc(hours)} hrs`;
}



function EventsTradesPanel({ settings, dirty, message, onChange, onSave }: {
  settings: ScheduleEnforcement;
  dirty: boolean;
  message: string;
  onChange: (changes: Partial<ScheduleEnforcement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel settings-enforcement-panel" onSubmit={onSave}>
      <div className="settings-panel-heading">
        <h3>Events &amp; trades</h3>
        <button type="submit" disabled={!dirty}>Save</button>
      </div>
      <p className="enforcement-intro">Display special events and days on the schedule.</p>
      <div className="enforcement-rules">
        <div className="enforcement-rule">
          <label className="enforcement-rule-line">
            <input type="checkbox" checked={settings.enableScheduleEvents} onChange={event => onChange({ enableScheduleEvents: event.target.checked })} />
            <span>Enable events on the schedule</span>
          </label>
          <p>Managers can add special events in day, week, and month views. Turning this off hides events without deleting them.</p>
        </div>
      </div>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}

function ScheduleEventList({ events, date, canAdd, onOpen }: {
  events: ScheduleEvent[];
  date: string;
  canAdd: boolean;
  onOpen: (date: string, event?: ScheduleEvent) => void;
}) {
  return (
    <div className="schedule-event-list">
      {events.map(event => <button className="schedule-event-chip" type="button" key={event.id} onClick={() => onOpen(date, event)} aria-haspopup="dialog" title={event.notes || event.title}>{event.title}</button>)}
      {canAdd ? <button className="schedule-event-add" type="button" onClick={() => onOpen(date)} aria-label={`Add event on ${formatLongDate(date)}`}>+ Add event</button> : null}
    </div>
  );
}

function ScheduleEventDialog({ event, editable, onSave, onDelete, onClose }: {
  event: ScheduleEvent;
  editable: boolean;
  onSave: (event: ScheduleEvent) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(event);
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    (editable ? dialog?.querySelector<HTMLInputElement>("input") : closeRef.current)?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, textarea")).filter(control => !control.hasAttribute("disabled"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [editable]);
  return (
    <div className="modal-backdrop" onClick={click => { if (click.target === click.currentTarget) onClose(); }}>
      <form className="schedule-event-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-event-title" onSubmit={submit => { submit.preventDefault(); if (editable) onSave(draft); }}>
        <div className="modal-heading">
          <h2 id="schedule-event-title">{editable ? event.id ? "Edit event" : "Add event" : event.title}</h2>
          <button type="button" ref={closeRef} aria-label="Close event" onClick={onClose}>×</button>
        </div>
        {editable ? <>
          <label><span>Name</span><input required maxLength={100} value={draft.title} onChange={change => setDraft(current => ({ ...current, title: change.target.value }))} /></label>
          <label><span>Date</span><input type="date" required value={draft.date} onClick={click => { try { click.currentTarget.showPicker?.(); } catch { click.currentTarget.focus(); } }} onChange={change => setDraft(current => ({ ...current, date: change.target.value }))} /></label>
          <label><span>Notes (optional)</span><textarea maxLength={500} value={draft.notes} onChange={change => setDraft(current => ({ ...current, notes: change.target.value }))} /></label>
          <p className="schedule-event-help">Saved events appear immediately for everyone who can view the schedule.</p>
          <div className="schedule-event-actions">
            {event.id ? <button type="button" className="danger-action" onClick={() => onDelete(event.id)}>Delete event</button> : null}
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-action" disabled={!draft.title.trim() || !validEventDate(draft.date)}>Save event</button>
          </div>
        </> : <><p>{formatLongDate(event.date)}</p>{event.notes ? <p className="schedule-event-notes">{event.notes}</p> : null}</>}
      </form>
    </div>
  );
}

function AlertsPermissionsPanel({ settings, dirty, message, onChange, onSave }: {
  settings: ScheduleEnforcement;
  dirty: boolean;
  message: string;
  onChange: (changes: Partial<ScheduleEnforcement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel settings-enforcement-panel settings-alerts-panel" onSubmit={onSave}>
      <div className="settings-panel-heading">
        <h3>Alerts &amp; permissions</h3>
        <button type="submit" disabled={!dirty}>Save</button>
      </div>
      <p className="enforcement-intro">Stay on top of your team&apos;s activity with in-app alerts and customized permissions.</p>
      <section className="alerts-permissions-group" aria-labelledby="employee-alert-settings">
        <h4 id="employee-alert-settings">Employee</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule">
            <label className="enforcement-rule-line">
              <input type="checkbox" checked={settings.notifyScheduleChanges} onChange={event => onChange({ notifyScheduleChanges: event.target.checked })} />
              <span>Notify team members when a schedule is published</span>
            </label>
            <p>Send an in-app notification to active team members who have location alerts enabled.</p>
          </div>
          <div className="enforcement-rule">
            <label className="enforcement-rule-line">
              <input type="checkbox" checked={settings.employeesOwnScheduleOnly} onChange={event => onChange({ employeesOwnScheduleOnly: event.target.checked })} />
              <span>Employees can only view their own schedule</span>
            </label>
            <p>Managers and admins see the whole team&apos;s schedule. Public schedule access requires sign-in when this is enabled.</p>
          </div>
        </div>
      </section>
      <section className="alerts-permissions-group" aria-labelledby="manager-alert-settings">
        <h4 id="manager-alert-settings">Manager</h4>
        <div className="enforcement-rules">
          <div className="enforcement-rule">
            <div className="enforcement-rule-line">
              <label>
                <input type="checkbox" checked={settings.noShowAlerts} onChange={event => onChange({ noShowAlerts: event.target.checked })} />
                <span>Notify managers when an employee hasn&apos;t clocked in after</span>
              </label>
              <input type="number" className="enforcement-minutes" aria-label="Missed clock-in alert delay in minutes" value={settings.noShowMinutes} min={0} max={120} step={1} required disabled={!settings.noShowAlerts} onChange={event => onChange({ noShowMinutes: Number(event.target.value) })} />
              <span>minutes</span>
            </div>
            <p>Show an in-app no-show alert and an Events entry for the missed clock-in.</p>
          </div>
          <div className="enforcement-rule">
            <label className="enforcement-rule-line">
              <input type="checkbox" checked={settings.requireAvailabilityApproval} onChange={event => onChange({ requireAvailabilityApproval: event.target.checked })} />
              <span>Managers must approve your team&apos;s availability requests</span>
            </label>
            <p>When turned off, submitted availability is approved immediately.</p>
          </div>
          <div className="enforcement-rule">
            <label className="enforcement-rule-line">
              <input type="checkbox" checked={settings.restrictManagerDepartments} onChange={event => onChange({ restrictManagerDepartments: event.target.checked })} />
              <span>Managers can only build and publish schedules for their departments</span>
            </label>
            <p>Uses manager and role assignments in Departments and Roles. Admins can schedule across all departments.</p>
          </div>
        </div>
      </section>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}

function ScheduleEnforcementPanel({ settings, dirty, message, onChange, onSave }: {
  settings: ScheduleEnforcement;
  dirty: boolean;
  message: string;
  onChange: (changes: Partial<ScheduleEnforcement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const minuteInput = (field: "lateMinutes" | "earlyClockInMinutes" | "noShowMinutes" | "automaticClockOutMinutes", label: string, disabled = false) => (
    <input
      type="number"
      aria-label={label}
      className="enforcement-minutes"
      value={settings[field]}
      min={field === "automaticClockOutMinutes" || field === "lateMinutes" ? 1 : 0}
      max={field === "automaticClockOutMinutes" ? 1440 : 120}
      step={1}
      required
      disabled={disabled}
      onChange={(event) => onChange({ [field]: Number(event.target.value) })}
    />
  );
  const checkbox = (field: "requireEarlyClockInExplanation" | "requireLateClockInExplanation" | "requireClockOutExplanation" | "requireUnscheduledExplanation" | "noShowAlerts" | "automaticClockOut", label: string) => (
    <input type="checkbox" aria-label={label} checked={settings[field]} onChange={(event) => onChange({ [field]: event.target.checked })} />
  );
  return (
    <form className="panel settings-enforcement-panel" onSubmit={onSave}>
      <div className="settings-panel-heading">
        <h3>Schedule enforcement</h3>
        <button type="submit" disabled={!dirty}>Save</button>
      </div>
      <p className="enforcement-intro">Manage scheduling hours and how your team records time around their shifts.</p>
      <div className="enforcement-basics">
        <label className="enforcement-field-row">
          <span>Start of work week</span>
          <select value={settings.workWeekStart} onChange={(event) => onChange({ workWeekStart: Number(event.target.value) })}>
            {Array.from({ length: 7 }, (_, index) => (index + 1) % 7).map((day) => (
              <option value={day} key={day}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}</option>
            ))}
          </select>
        </label>
        <div className="enforcement-field-row">
          <span id="scheduling-hours-label">Scheduling hours</span>
          <div className="enforcement-time-range" role="group" aria-labelledby="scheduling-hours-label">
            <SchedulingHourSelect label="Scheduling start time" value={settings.scheduleStartHour} onChange={hour => onChange({ scheduleStartHour: hour })} />
            <span aria-hidden="true">–</span>
            <SchedulingHourSelect label="Scheduling end time" value={settings.scheduleEndHour} endOfDay onChange={hour => onChange({ scheduleEndHour: hour })} />
          </div>
        </div>
        <p className="enforcement-help">Sets the visible hours in the day schedule. Shifts outside this window remain available in week and month views.</p>
        <div className="enforcement-inline-setting">
          <span>Mark employee as late</span>
          {minuteInput("lateMinutes", "Late clock-in threshold in minutes")}
          <span>minutes after their shift is scheduled to start</span>
        </div>
      </div>
      <fieldset className="schedule-warning-settings"><legend>Schedule warning defaults</legend>
        <label>Minimum rest between workdays (hours)<input type="number" min={0} max={24} step={1} required value={settings.minRestHours} onChange={event => onChange({ minRestHours: Number(event.target.value) })} /></label>
        <label>Availability review interval (days)<input type="number" min={0} max={365} step={1} required value={settings.availabilityReviewDays} onChange={event => onChange({ availabilityReviewDays: Number(event.target.value) })} /></label>
        <p>Company planning reminders. Zero turns off that reminder. Short-rest checks compare different workdays and exclude same-day split shifts. Availability older than the review interval is flagged for the shift date; missing availability is always flagged when you can view it. Saving these values does not change shifts, availability history or pay.</p>
      </fieldset>
      <div className="enforcement-rules">
        <div className="enforcement-rule">
          <div className="enforcement-rule-line">
            <label>{checkbox("requireEarlyClockInExplanation", "Require explanations for early clock-ins")}<span>Require an explanation for clocking in more than</span></label>
            {minuteInput("earlyClockInMinutes", "Early clock-in allowance in minutes")}
            <span>minutes before the scheduled start</span>
          </div>
          <p>Team members can still clock in early after explaining why. The explanation appears in Events for manager review.</p>
        </div>
        <div className="enforcement-rule">
          <label className="enforcement-rule-line">{checkbox("requireLateClockInExplanation", "Require explanations for late clock-ins")}<span>Require an explanation for late clock-ins</span></label>
          <p>Uses the late threshold above. Late entries remain visible in Events and employee performance.</p>
        </div>
        <div className="enforcement-rule">
          <label className="enforcement-rule-line">{checkbox("requireClockOutExplanation", "Require explanations for early or late clock-outs")}<span>Require an explanation for early or late clock-outs</span></label>
          <p>Ask for an explanation when a team member clocks out outside their scheduled end minute.</p>
        </div>
        <div className="enforcement-rule">
          <label className="enforcement-rule-line">{checkbox("requireUnscheduledExplanation", "Require explanations for unscheduled clock-ins and clock-outs")}<span>Require an explanation for unscheduled clock-ins and clock-outs</span></label>
          <p>Team members without a shift can record their time after explaining why they are working.</p>
        </div>
        <div className="enforcement-rule">
          <div className="enforcement-rule-line">
            <label>{checkbox("noShowAlerts", "Show no-show alerts")}<span>Show no-show alerts</span></label>
            {minuteInput("noShowMinutes", "No-show alert delay in minutes", !settings.noShowAlerts)}
            <span>minutes after a missed clock-in</span>
          </div>
          <p>Show managers an in-app notification and an Events entry if no clock-in is recorded for the shift.</p>
        </div>
        <div className="enforcement-rule">
          <div className="enforcement-rule-line">
            <label>{checkbox("automaticClockOut", "Automatically clock out team members")}<span>Automatically clock out team members</span></label>
            {minuteInput("automaticClockOutMinutes", "Automatic clock-out delay in minutes", !settings.automaticClockOut)}
            <span>minutes after their scheduled shift ends</span>
          </div>
          <p>Records the automatic clock-out time in Timesheets and flags the entry in Events for manager review.</p>
        </div>
      </div>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}

function SettingsInfoSection({
  title,
  rows,
  info,
  editingField,
  onEdit,
  onChange,
}: {
  title: string;
  rows: { field: BasicInfoField; label: string; inputType?: "text" | "tel" | "url" }[];
  info: BasicInfo;
  editingField: BasicInfoField | null;
  onEdit: (field: BasicInfoField | null) => void;
  onChange: (field: BasicInfoField, value: string) => void;
}) {
  return (
    <section className="settings-info-section">
      <div className="settings-info-heading">
        <h4>{title}</h4>
      </div>
      <dl className="settings-info-rows">
        {rows.map(({ field, label, inputType = "text" }, index) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              {field === "accountOwner" || field === "timeZone" ? <span>{info[field] || "Not assigned"}</span> : editingField === field ? (
                <input
                  type={inputType}
                  inputMode={inputType === "tel" ? "tel" : undefined}
                  maxLength={inputType === "tel" ? 14 : undefined}
                  value={info[field]}
                  onChange={(event) => onChange(field, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") onEdit(null);
                  }}
                  placeholder={`Enter ${label.toLowerCase()}`}
                  aria-label={label}
                  autoFocus
                />
              ) : (
                <div className="settings-field-value">
                  <button
                    type="button"
                    className={info[field] ? "settings-value-button" : "settings-add-button"}
                    onClick={() => onEdit(field)}
                  >
                    {info[field] || "Add"}
                  </button>
                  {index === 0 ? (
                    <button
                      type="button"
                      className="settings-field-pencil"
                      onClick={() => onEdit(field)}
                      aria-label={`Edit ${label}`}
                      title={`Edit ${label}`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TimeInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  selectOnFocus = false,
  disabled = false,
  suggestAfter,
  suggestBefore,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  selectOnFocus?: boolean;
  disabled?: boolean;
  suggestAfter?: string;
  suggestBefore?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(() => (value ? formatTime12(value).replace(" ", "") : ""));
  const [isFocused, setIsFocused] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerPeriod, setPickerPeriod] = useState<"am" | "pm">("am");
  const [pickerScrollRevision, setPickerScrollRevision] = useState(0);
  const shellRef = useRef<HTMLSpanElement>(null);
  const suggestion = isFocused && !disabled ? suggestedTimeForDraft(draft, suggestAfter) : null;
  const timePickerHours = Array.from({ length: 12 }, (_, index) => index + 1);
  const timePickerMinutes = Array.from({ length: 60 }, (_, index) => index);
  const timePickerLoopCount = 5;
  const middleTimePickerLoop = Math.floor(timePickerLoopCount / 2);
  const loopingTimePickerHours = Array.from({ length: timePickerLoopCount }, (_, loop) => (
    timePickerHours.map((value) => ({ loop, value }))
  )).flat();
  const loopingTimePickerMinutes = Array.from({ length: timePickerLoopCount }, (_, loop) => (
    timePickerMinutes.map((value) => ({ loop, value }))
  )).flat();

  useEffect(() => {
    setDraft(value ? formatTime12(value).replace(" ", "") : "");
  }, [value]);

  useEffect(() => {
    if (!isPickerOpen) return;
    const selectedOptions = shellRef.current?.querySelectorAll<HTMLElement>('.time-input-picker-option[aria-selected="true"]');
    selectedOptions?.forEach((option) => {
      const list = option.parentElement;
      if (list) {
        const optionTopInList = option.offsetTop - list.offsetTop;
        list.scrollTop = optionTopInList - (list.clientHeight - option.offsetHeight) / 2;
      }
    });
  }, [isPickerOpen, pickerHour, pickerMinute, pickerPeriod, pickerScrollRevision]);

  useEffect(() => {
    if (!isPickerOpen) return;
    function closePicker(event: PointerEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setIsPickerOpen(false);
    }
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [isPickerOpen]);

  function pickerPartsForCurrentValue() {
    let parsed = parseTypedTime(draft) ?? value;
    if (!parsed && suggestAfter) {
      const afterMinutes = timeToMinutes(suggestAfter);
      if (afterMinutes !== null) {
        const nextMinutes = (afterMinutes + 60) % (24 * 60);
        parsed = `${Math.floor(nextMinutes / 60).toString().padStart(2, "0")}:${(nextMinutes % 60).toString().padStart(2, "0")}`;
      }
    }
    parsed ||= "08:00";
    const [hourText, minuteText] = parsed.split(":");
    const hour24 = Number(hourText);
    return {
      hour: hour24 % 12 || 12,
      minute: Number(minuteText) || 0,
      period: (hour24 >= 12 ? "pm" : "am") as "am" | "pm",
    };
  }

  function openTimePicker() {
    if (disabled) return;
    if (!isPickerOpen) {
      const parts = pickerPartsForCurrentValue();
      setPickerHour(parts.hour);
      setPickerMinute(parts.minute);
      setPickerPeriod(parts.period);
    }
    setIsPickerOpen(true);
  }

  function selectPickerTime(hour: number, minute: number, period: "am" | "pm") {
    const hour24 = period === "am"
      ? hour === 12 ? 0 : hour
      : hour === 12 ? 12 : hour + 12;
    const nextTime = `${hour24.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    if (!isTimeWithinBounds(nextTime, suggestAfter, suggestBefore)) return;
    setPickerHour(hour);
    setPickerMinute(minute);
    setPickerPeriod(period);
    setPickerScrollRevision((current) => current + 1);
    setDraft(formatTime12(nextTime).replace(" ", ""));
    onChange(nextTime);
  }

  function loopTimePickerScroll(list: HTMLSpanElement) {
    const loopHeight = list.scrollHeight / timePickerLoopCount;
    if (!Number.isFinite(loopHeight) || loopHeight <= 0) return;
    if (list.scrollTop < loopHeight * 0.5) {
      list.scrollTop += loopHeight * 2;
    } else if (list.scrollTop > loopHeight * 3.5) {
      list.scrollTop -= loopHeight * 2;
    }
  }

  function commitTime() {
    if (!draft.trim()) {
      onChange("");
      setDraft("");
      return;
    }

    const parsed = suggestion?.time ?? parseTypedTime(draft);
    if (!parsed || !isTimeWithinBounds(parsed, suggestAfter, suggestBefore)) {
      setDraft(value ? formatTime12(value).replace(" ", "") : "");
      return;
    }

    onChange(parsed);
    setDraft(formatTime12(parsed).replace(" ", ""));
  }

  return (
    <span
      className="time-input-shell"
      ref={shellRef}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        commitTime();
        setIsFocused(false);
        setIsPickerOpen(false);
      }}
    >
      {suggestion ? <span className="time-input-hint" aria-hidden="true">{suggestion.label}</span> : null}
      <input
        type="text"
        value={draft}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft((currentDraft) => {
            const formattedDraft = formatTimeDraftInput(nextValue, currentDraft);
            return isTimeDraftBefore(formattedDraft, suggestBefore) && isTimeDraftAfter(formattedDraft, suggestAfter)
              ? formattedDraft
              : currentDraft;
          });
        }}
        onFocus={(event) => {
          setIsFocused(true);
          openTimePicker();
          if (selectOnFocus) event.currentTarget.select();
        }}
        onClick={(event) => {
          openTimePicker();
          if (selectOnFocus) event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitTime();
            setIsPickerOpen(false);
          }
          if (event.key === "Escape") {
            setIsPickerOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isPickerOpen}
        inputMode="text"
        disabled={disabled}
        required={required}
      />
      {isPickerOpen && !disabled ? (
        <span className="time-input-picker" role="group" aria-label={`${ariaLabel} picker`}>
          <span className="time-input-picker-column">
            <strong>Hour</strong>
            <span className="time-input-picker-options" role="listbox" aria-label="Hour" onScroll={(event) => loopTimePickerScroll(event.currentTarget)}>
              {loopingTimePickerHours.map(({ loop, value: hour }) => (
                <button
                  type="button"
                  className="time-input-picker-option"
                  role="option"
                  aria-selected={pickerHour === hour && loop === middleTimePickerLoop}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectPickerTime(hour, pickerMinute, pickerPeriod)}
                  key={`${loop}-${hour}`}
                >
                  {hour}
                </button>
              ))}
            </span>
          </span>
          <span className="time-input-picker-column">
            <strong>Minute</strong>
            <span className="time-input-picker-options" role="listbox" aria-label="Minute" onScroll={(event) => loopTimePickerScroll(event.currentTarget)}>
              {loopingTimePickerMinutes.map(({ loop, value: minute }) => (
                <button
                  type="button"
                  className="time-input-picker-option"
                  role="option"
                  aria-selected={pickerMinute === minute && loop === middleTimePickerLoop}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectPickerTime(pickerHour, minute, pickerPeriod)}
                  key={`${loop}-${minute}`}
                >
                  {minute.toString().padStart(2, "0")}
                </button>
              ))}
            </span>
          </span>
          <span className="time-input-picker-column">
            <strong>Period</strong>
            <span className="time-input-picker-options period" role="listbox" aria-label="Period">
              {(["am", "pm"] as const).map((period) => (
                <button
                  type="button"
                  className="time-input-picker-option"
                  role="option"
                  aria-selected={pickerPeriod === period}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectPickerTime(pickerHour, pickerMinute, period)}
                  key={period}
                >
                  {period.toUpperCase()}
                </button>
              ))}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function TeamAvailabilityBoard({
  employees,
  initialDate,
  workWeekStart,
  requests,
  reviewerId,
  canApprove,
  onApprove,
  onReject,
}: {
  employees: Employee[];
  initialDate: string;
  workWeekStart: number;
  requests: AvailabilityRequest[];
  reviewerId: number;
  canApprove: boolean;
  onApprove: (requestId: number) => Promise<boolean>;
  onReject: (requestId: number, note: string) => Promise<boolean>;
}) {
  const [weekDate, setWeekDate] = useState(initialDate);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<number | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");
  const [decisionToast, setDecisionToast] = useState("");
  const [isWeekCalendarOpen, setIsWeekCalendarOpen] = useState(false);
  const [pendingWeekDate, setPendingWeekDate] = useState(initialDate);
  const [weekCalendarMonth, setWeekCalendarMonth] = useState(() => `${initialDate.slice(0, 7)}-01`);
  const weekDays = workWeekCalendarDays(weekDate, workWeekStart);
  const pendingWeekDays = workWeekCalendarDays(pendingWeekDate, workWeekStart);
  const requestCells: Record<string, AvailabilityRequestSlot[]> = {};
  for (const employee of employees) for (const day of weekDays) {
    requestCells[`${employee.id}-${day.date}`] = availabilityForDate(requests, employee.id, day.date).slots;
  }
  const orderedEmployees = employees.filter(employee => includeInactive || (employee.active && !employee.terminated)).sort((first, second) => first.name.localeCompare(second.name));
  const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const weekRangeLabel = `${dateFormatter.format(parseLocalDate(weekDays[0].date))} - ${dateFormatter.format(parseLocalDate(weekDays[6].date))}`;
  const visibleRequests = requests;
  const rejectingRequest = requests.find((request) => request.id === rejectingRequestId);
  const weekCalendarMonthDate = parseLocalDate(weekCalendarMonth);
  const weekCalendarYear = weekCalendarMonthDate.getFullYear();
  const weekCalendarMonthIndex = weekCalendarMonthDate.getMonth();
  const weekCalendarMonthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(weekCalendarMonthDate);
  const weekCalendarLeadingDays = workWeekOffset(new Date(weekCalendarYear, weekCalendarMonthIndex, 1).getDay(), workWeekStart);
  const weekCalendarDaysInMonth = new Date(weekCalendarYear, weekCalendarMonthIndex + 1, 0).getDate();
  const weekCalendarCellCount = Math.ceil((weekCalendarLeadingDays + weekCalendarDaysInMonth) / 7) * 7;
  const weekCalendarDays = Array.from({ length: weekCalendarCellCount }, (_, index) => {
    const dayNumber = index - weekCalendarLeadingDays + 1;
    if (dayNumber < 1 || dayNumber > weekCalendarDaysInMonth) return null;
    return toDateInputValue(new Date(weekCalendarYear, weekCalendarMonthIndex, dayNumber));
  });
  const pendingWeekStart = pendingWeekDays[0].date;
  const pendingWeekEnd = pendingWeekDays[6].date;

  function moveWeek(offset: number) {
    const nextDate = parseLocalDate(weekDate);
    nextDate.setDate(nextDate.getDate() + offset * 7);
    setWeekDate(toDateInputValue(nextDate));
  }

  function openWeekCalendar() {
    setPendingWeekDate(weekDate);
    setWeekCalendarMonth(`${weekDate.slice(0, 7)}-01`);
    setIsWeekCalendarOpen((current) => !current);
  }

  function moveWeekCalendarMonth(offset: number) {
    const nextMonth = parseLocalDate(weekCalendarMonth);
    nextMonth.setMonth(nextMonth.getMonth() + offset, 1);
    setWeekCalendarMonth(toDateInputValue(nextMonth));
  }

  function chooseAvailabilityWeek(date: string) {
    setPendingWeekDate(workWeekCalendarDays(date, workWeekStart)[0].date);
  }

  function cancelWeekCalendar() {
    setPendingWeekDate(weekDate);
    setIsWeekCalendarOpen(false);
  }

  function applyAvailabilityWeek() {
    setWeekDate(pendingWeekDate);
    setIsWeekCalendarOpen(false);
  }

  async function approveAvailabilityRequest(requestId: number) {
    if (!await onApprove(requestId)) return;
    setDecisionToast("Availability approved");
  }

  function beginRejectAvailabilityRequest(requestId: number) {
    setRejectingRequestId(requestId);
    setRejectionNote("");
  }

  async function rejectAvailabilityRequest() {
    if (!rejectingRequestId) return;
    if (!await onReject(rejectingRequestId, rejectionNote)) return;
    setRejectingRequestId(null);
    setRejectionNote("");
    setDecisionToast("Availability rejected");
  }

  return (
    <section className="team-availability-section" aria-label="Team availability">
      <p className="ts-form-note">This grid shows approved availability effective on each date. Expand a person’s requests to review pending changes and retained history.</p>
      <label className="availability-history-filter"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include inactive employees’ history</label>
      <div className="team-availability-toolbar">
        <div className="team-availability-week-controls">
          <button type="button" onClick={() => moveWeek(-1)} aria-label="Previous week"><span aria-hidden="true">‹</span></button>
          <div className="team-availability-date-picker">
            <button
              type="button"
              className="team-availability-date-control"
              onClick={openWeekCalendar}
              aria-label="Choose team availability week"
              aria-haspopup="dialog"
              aria-expanded={isWeekCalendarOpen}
            >
              <span>{weekRangeLabel}</span>
            </button>
            {isWeekCalendarOpen ? (
              <div className="team-availability-week-calendar" role="dialog" aria-label="Choose team availability week">
                <div className="team-availability-week-calendar-header">
                  <strong>{weekCalendarMonthLabel}</strong>
                  <div>
                    <button type="button" onClick={() => moveWeekCalendarMonth(-1)} aria-label="Previous month"><span aria-hidden="true">‹</span></button>
                    <button type="button" onClick={() => moveWeekCalendarMonth(1)} aria-label="Next month"><span aria-hidden="true">›</span></button>
                  </div>
                </div>
                <div className="team-availability-week-calendar-weekdays" aria-hidden="true">
                  {weekDays.map((day) => <span key={day.date}>{parseLocalDate(day.date).toLocaleDateString("en-US", { weekday: "short" })}</span>)}
                </div>
                <div className="team-availability-week-calendar-days">
                  {weekCalendarDays.map((date, index) => date ? (
                    <button
                      type="button"
                      className={`${date >= pendingWeekStart && date <= pendingWeekEnd ? "in-range" : ""}${date === pendingWeekStart ? " range-start" : ""}${date === pendingWeekEnd ? " range-end" : ""}`.trim()}
                      onClick={() => chooseAvailabilityWeek(date)}
                      aria-label={`Week of ${formatLongDate(workWeekCalendarDays(date, workWeekStart)[0].date)}`}
                      aria-pressed={date >= pendingWeekStart && date <= pendingWeekEnd}
                      key={date}
                    >
                      {parseLocalDate(date).getDate()}
                    </button>
                  ) : <span aria-hidden="true" key={`empty-${index}`} />)}
                </div>
                <div className="team-availability-week-calendar-actions">
                  <button type="button" onClick={cancelWeekCalendar}>Cancel</button>
                  <button type="button" className="apply" onClick={applyAvailabilityWeek} disabled={pendingWeekDate === weekDate}>Apply</button>
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => moveWeek(1)} aria-label="Next week"><span aria-hidden="true">›</span></button>
        </div>
      </div>

      <div className="team-availability-card">
        <div className="team-availability-scroller">
          <div className="team-availability-grid" role="table" aria-label={`Team availability for ${weekRangeLabel}`}>
            <div className="team-availability-corner" role="columnheader" />
            {weekDays.map(day => (
              <div className="team-availability-day-heading" role="columnheader" key={day.date}>{weekday(day.date)}</div>
            ))}

            {orderedEmployees.map((employee) => {
              const employeeRequests = visibleRequests
                .filter((request) => request.employeeId === employee.id)
                .sort(newestAvailability);
              const requestsAreExpanded = expandedEmployeeId === employee.id;

              return (
                <div className="team-availability-employee-group" key={employee.id}>
                  <div className="team-availability-row" role="row">
                    <div className="team-availability-member" role="rowheader">
                      <span className="team-availability-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                      <div>
                        <strong>{employee.name}</strong>
                        {!employee.active || employee.terminated ? <span>Inactive · retained history</span> : null}
                        {employeeRequests[0]?.status === "approved" ? (
                          <span className="team-availability-update-date">
                            Approved version effective {new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(parseLocalDate(employeeRequests[0].effectiveDate))}
                          </span>
                        ) : null}
                        {employeeRequests.length > 0 ? (
                          <button
                            type="button"
                            className="team-availability-requests"
                            onClick={() => setExpandedEmployeeId((current) => current === employee.id ? null : employee.id)}
                            aria-expanded={requestsAreExpanded}
                          >
                            <span aria-hidden="true">{requestsAreExpanded ? "▴" : "▾"}</span>
                            {requestsAreExpanded ? "Hide Requests" : "View Requests"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {weekDays.map((day) => {
                      const requestKey = `${employee.id}-${day.date}`;
                      const cellAvailability = requestCells[requestKey] ?? [];
                      const isSelected = cellAvailability.length > 0;
                      return (
                        <div className={isSelected ? "team-availability-cell selected" : "team-availability-cell"} role="cell" key={day.date}>
                          <button
                            type="button"
                            disabled title="Use an availability request to save changes"
                            aria-label={`${isSelected ? "Edit" : "Add"} availability request for ${employee.name} on ${formatLongDate(day.date)}`}
                            aria-pressed={isSelected}
                          >
                            {cellAvailability.length ? cellAvailability.map((slot, index) => (
                              <span className={`team-availability-cell-card ${slot.preference}`} key={index}>
                                <strong>{slot.preference === "preferred" ? "Preferred" : "Unavailable"}</strong>
                                <span>{availabilityTime(slot.startHour)} – {availabilityTime(slot.endHour)}</span>
                              </span>
                            )) : (
                              <span className="team-availability-cell-plus" aria-hidden="true">+</span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {requestsAreExpanded ? <div className="team-availability-history" role="row"><div role="cell">
                    <AvailabilityHistory requests={employeeRequests} />
                    {employeeRequests.filter(request => request.status === "pending").map(request => <div className="availability-review-actions" key={request.id}>
                      <span>Pending version effective {request.effectiveDate}</span>
                      {canApprove && employee.active && !employee.terminated && request.employeeId !== reviewerId ? <><button type="button" onClick={() => void approveAvailabilityRequest(request.id)}>Approve</button><button type="button" onClick={() => beginRejectAvailabilityRequest(request.id)}>Reject</button></> : <span>{!employee.active || employee.terminated ? "Inactive employee — history retained." : request.employeeId === reviewerId ? "Another manager must review your availability." : "Approval permission is required to decide this request."}</span>}
                    </div>)}
                  </div></div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rejectingRequest ? (
        <div className="availability-modal-backdrop" role="presentation">
          <section className="team-availability-reject-modal" role="dialog" aria-modal="true" aria-labelledby="reject-availability-title">
            <button
              type="button"
              className="availability-modal-close"
              onClick={() => setRejectingRequestId(null)}
              aria-label="Close reject availability dialog"
            >
              <span aria-hidden="true">×</span>
            </button>
            <h2 id="reject-availability-title">Reject Availability</h2>
            <p>Add a reason. It will be saved with the rejected request.</p>
            <label>
              <span>Rejection reason (required)</span>
              <textarea value={rejectionNote} onChange={(event) => setRejectionNote(event.target.value)} maxLength={1000} />
            </label>
            <div className="team-availability-reject-actions">
              <button type="button" onClick={() => setRejectingRequestId(null)}>Cancel</button>
              <button type="button" className="reject" disabled={!rejectionNote.trim()} onClick={rejectAvailabilityRequest}>Reject Availability</button>
            </div>
          </section>
        </div>
      ) : null}

      {decisionToast ? (
        <div className="team-availability-toast" role="status">
          <span aria-hidden="true">✓</span>
          <span>{decisionToast}</span>
          <button type="button" onClick={() => setDecisionToast("")} aria-label="Dismiss availability message">×</button>
        </div>
      ) : null}
    </section>
  );
}

function PanelHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function ShiftRow({
  shift,
  paidHours,
  employee,
  compact = false,
  showDate = false,
}: {
  shift: Shift;
  paidHours: string;
  employee?: Employee;
  compact?: boolean;
  showDate?: boolean;
}) {
  return (
    <article className={compact ? "shift-row compact" : "shift-row"}>
      <div>
        <h3>{employee?.name ?? "Open shift"}</h3>
        <p>{showDate ? `${formatShortDate(shift.date)} | ${formatTimeRange(shift)}` : formatTimeRange(shift)}</p>
      </div>
      <div className="shift-meta">
        <strong>{shift.role}</strong>
        <span>{paidHours} paid hours</span>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}
