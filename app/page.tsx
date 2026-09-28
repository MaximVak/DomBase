"use client";

import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Mode = "manager" | "employee";
type ViewId = "dashboard" | "employees" | "departments_roles" | "schedule" | "time_off" | "my_availability" | "team_availability" | "clockins" | "hours" | "settings" | "profile" | "team_members";
type CalendarTab = "today" | "week" | "month";
type HoursSectionTab = "hours" | "pto";
type SettingsTab =
  | "Basic info"
  | "POS connection"
  | "Plan & billing"
  | "Schedule enforcement"
  | "Alerts & permissions"
  | "Events & trades"
  | "Time clock options"
  | "Overtime"
  | "Breaks & compliance"
  | "Tip settings"
  | "Tip Manager"
  | "Payroll settings"
  | "Time off"
  | "Messages"
  | "Team permissions"
  | "Manager Log"
  | "Profile"
  | "Locations & PINs"
  | "Notifications"
  | "Password & security"
  | "API access (read only)";
type BasicInfo = {
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
type BasicInfoField = keyof BasicInfo;
type EmployeeScheduleTab = "day" | "week" | "month";
type HoursRounding = "actual" | 5 | 10 | 15;
type AccessLevel = "Admin" | "Manager" | "Employee" | "";
type PtoHistoryStatusFilter = "all" | Exclude<PtoRequest["status"], "pending">;
type TimeExceptionAction = "in" | "out" | "break_end";
type Employee = {
  id: number;
  name: string;
  email: string;
  phone: string;
  accessLevel: AccessLevel;
  location: string;
  role: string;
  wage: string;
  pin: string;
  active: boolean;
};

type Department = {
  id: number;
  name: string;
  roles: string[];
  managerIds: number[];
};

type Shift = {
  id: number;
  employeeId: number;
  date: string;
  start: string;
  end: string;
  role: string;
  station: string;
  notes?: string;
};

type ClockEvent = {
  id: number;
  employeeId: number;
  type: "in" | "out" | "break" | "break_end";
  at: string;
  durationMinutes?: 30 | 45;
  durationSeconds?: 5;
  explanation?: string;
};

type OperationalAlert = {
  id: string;
  employeeId: number;
  title: string;
  detail: string;
  at: string;
  severity: "warning" | "danger";
  eventTargetId: string;
};

type HeaderNotification = {
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

type ScheduleUpdateNotification = {
  id: string;
  employeeId: number;
  title: string;
  detail: string;
  at: string;
};

type HoursAdjustment = {
  id: number;
  employeeId: number;
  date: string;
  hours: number;
};

type PtoRequest = {
  id: number;
  employeeId: number;
  compensation: "paid" | "unpaid";
  startDate: string;
  endDate: string;
  reason: "sick_emergency" | "vacation";
  explanation: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  requestedAt: string;
  decidedAt?: string;
  decidedByEmployeeId?: number;
};

type PtoPolicyMethod = "fixed" | "rate";

type PtoPolicy = {
  id: number;
  name: string;
  method: PtoPolicyMethod;
  fixedHours: number;
  earnedHours: number;
  workedHours: number;
  employeeIds: number[];
  startingBalances: Record<number, { startDate: string; balance: number }>;
};

type PtoPolicyForm = {
  name: string;
  method: PtoPolicyMethod;
  fixedHours: string;
  earnedHours: string;
  workedHours: string;
  employeeIds: number[];
  startingBalances: Record<number, { startDate: string; balance: string }>;
};

type TeamMessage = {
  id: number;
  senderEmployeeId: number;
  body: string;
  sentAt: string;
  readByEmployeeIds: number[];
};

type TeamConversation = {
  id: number;
  name?: string;
  creatorEmployeeId: number;
  participantIds: number[];
  messages: TeamMessage[];
  pinnedByEmployeeIds?: number[];
  mutedByEmployeeIds?: number[];
};

type ScheduleDraft = {
  upsertedShifts: Shift[];
  deletedShiftIds: number[];
  affectedEmployeeIds: number[];
};

type StaffState = {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  clockEvents: ClockEvent[];
  hoursAdjustments: HoursAdjustment[];
  ptoRequests: PtoRequest[];
  ptoPolicies: PtoPolicy[];
  conversations: TeamConversation[];
  scheduleUpdates: ScheduleUpdateNotification[];
  scheduleHasBeenPublished: boolean;
  pendingScheduleUpdateEmployeeIds: number[];
  scheduleDraftsByManager: Record<number, ScheduleDraft>;
};

const managerPin = "0000";
const storageKey = "dombase-staff-state-v1";
const stateBackupStorageKey = "dombase-staff-state-backup-v1";
const unpublishedShiftsStorageKey = "dombase-unpublished-shifts-v1";
const basicInfoStorageKey = "dombase-basic-info-v1";
const openedNotificationsStorageKey = "dombase-opened-notifications-v1";
const dismissedNotificationsStorageKey = "dombase-dismissed-notifications-v1";
const timeExceptionExplanationLimit = 250;
const missedClockInGraceMs = 5 * 60 * 1000;
const missedBreakThresholdMs = 5 * 60 * 60 * 1000;
const operationalAlertLookbackMs = 7 * 24 * 60 * 60 * 1000;
const scheduleStartHour = 7;
const scheduleEndHour = 17;
const scheduleHourLabels = Array.from(
  { length: scheduleEndHour - scheduleStartHour },
  (_, index) => scheduleStartHour + index,
);
const shiftWeekdayOptions = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

const navItems: { id: ViewId; label: string; icon: string; managerOnly?: boolean }[] = [
  { id: "dashboard", label: "Home", icon: "home" },
  { id: "employees", label: "Team", icon: "person", managerOnly: true },
  { id: "schedule", label: "Schedule", icon: "calendar" },
  { id: "hours", label: "Hours", icon: "clock" },
  { id: "clockins", label: "Events", icon: "flag", managerOnly: true },
  { id: "settings", label: "Settings", icon: "gear", managerOnly: true },
];

const settingsGroups: { label: string; items: SettingsTab[] }[] = [
  { label: "Location", items: ["Basic info", "POS connection", "Plan & billing"] },
  { label: "Scheduling", items: ["Schedule enforcement", "Alerts & permissions", "Events & trades"] },
  { label: "Time tracking", items: ["Time clock options", "Overtime", "Breaks & compliance"] },
  { label: "Tips", items: ["Tip settings", "Tip Manager"] },
  { label: "Payroll", items: ["Payroll settings"] },
  { label: "Team management", items: ["Time off", "Messages", "Team permissions", "Manager Log"] },
  { label: "Account", items: ["Profile", "Locations & PINs", "Notifications", "Password & security", "API access (read only)"] },
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
  accountOwner: "Serge Vakulchik",
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

const starterState: StaffState = {
  employees: [
    {
      id: 1,
      name: "Serge Vakulchik",
      email: "",
      phone: "",
      accessLevel: "Admin",
      location: "",
      role: "Manager",
      wage: "",
      pin: "0000",
      active: true,
    },
  ],
  departments: [{ id: 1, name: "Department not set", roles: [], managerIds: [1] }],
  shifts: [],
  clockEvents: [],
  hoursAdjustments: [],
  ptoRequests: [],
  ptoPolicies: [{
    id: 1,
    name: "Standard PTO",
    method: "rate",
    fixedHours: 0,
    earnedHours: 1,
    workedHours: 30,
    employeeIds: [1],
    startingBalances: { 1: { startDate: getLocalDateValue(), balance: 0 } },
  }],
  conversations: [],
  scheduleUpdates: [],
  scheduleHasBeenPublished: false,
  pendingScheduleUpdateEmployeeIds: [],
  scheduleDraftsByManager: {},
};

export default function Home() {
  const today = getLocalDateValue();
  const [state, setState] = useState<StaffState>(() => readStoredState());
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isPublicSchedule, setIsPublicSchedule] = useState(false);
  const [mode, setMode] = useState<Mode>("employee");
  const [pin, setPin] = useState("");
  const [activeEmployeeId, setActiveEmployeeId] = useState<number>(1);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isTeamNavOpen, setIsTeamNavOpen] = useState(false);
  const [isScheduleNavOpen, setIsScheduleNavOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("Basic info");
  const [basicInfo, setBasicInfo] = useState<BasicInfo>(() => readStoredBasicInfo());
  const [savedBasicInfoSnapshot, setSavedBasicInfoSnapshot] = useState(() => JSON.stringify(readStoredBasicInfo()));
  const [editingBasicInfoField, setEditingBasicInfoField] = useState<BasicInfoField | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [openedNotificationIdsByEmployee, setOpenedNotificationIdsByEmployee] = useState<Record<number, string[]>>(
    () => readOpenedNotificationIds(),
  );
  const [dismissedNotificationIdsByEmployee, setDismissedNotificationIdsByEmployee] = useState<Record<number, string[]>>(
    () => readDismissedNotificationIds(),
  );
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
  const [activeHoursSectionTab, setActiveHoursSectionTab] = useState<HoursSectionTab>("hours");
  const [hoursRounding, setHoursRounding] = useState<HoursRounding>("actual");
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [isAddingEmployeeRole, setIsAddingEmployeeRole] = useState(false);
  const [newEmployeeRole, setNewEmployeeRole] = useState("");
  const employeeRoleInputRef = useRef<HTMLInputElement>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [employeePendingDeletion, setEmployeePendingDeletion] = useState<Employee | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentRoleDrafts, setDepartmentRoleDrafts] = useState<Record<number, string>>({});
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [departmentNameDraft, setDepartmentNameDraft] = useState("");
  const [scheduleDate, setScheduleDate] = useState(today);
  const [hoursDate, setHoursDate] = useState(today);
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
  const [shiftForm, setShiftForm] = useState({
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
    const serializedState = JSON.stringify(state);
    const previousState = window.localStorage.getItem(storageKey);
    if (previousState && previousState !== serializedState && isRecoverableStaffRecord(previousState)) {
      window.localStorage.setItem(stateBackupStorageKey, previousState);
    }
    window.localStorage.setItem(storageKey, serializedState);
  }, [state]);

  useEffect(() => {
    window.localStorage.setItem(openedNotificationsStorageKey, JSON.stringify(openedNotificationIdsByEmployee));
  }, [openedNotificationIdsByEmployee]);

  useEffect(() => {
    window.localStorage.setItem(dismissedNotificationsStorageKey, JSON.stringify(dismissedNotificationIdsByEmployee));
  }, [dismissedNotificationIdsByEmployee]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  useEffect(() => {
    if (editingEmployeeId === null) return;

    function finishRosterEditing(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target?.closest(`[data-editing-employee-row="${editingEmployeeId}"]`)) {
        setEditingEmployeeId(null);
      }
    }

    document.addEventListener("pointerdown", finishRosterEditing);
    return () => document.removeEventListener("pointerdown", finishRosterEditing);
  }, [editingEmployeeId]);

  const activeEmployee = state.employees.find((employee) => employee.id === activeEmployeeId);
  const activeUserIsAdmin = activeEmployee?.accessLevel === "Admin";
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
  const reviewingOwnPtoRequest = reviewingPtoRequest?.employeeId === activeEmployeeId;
  const activeUserCanManage = Boolean(activeEmployee && isManagerEmployee(activeEmployee));
  const notificationRequests = activeUserCanManage ? [...(state.ptoRequests ?? [])]
    .filter((request) => request.employeeId !== activeEmployeeId)
    .sort((first, second) => (second.requestedAt ?? "").localeCompare(first.requestedAt ?? ""))
    : [];
  const alertEligibleShifts = state.shifts;
  const operationalAlerts = activeUserCanManage
    ? operationalAlertsFor(
        state.employees,
        alertEligibleShifts,
        state.clockEvents,
        currentTime,
      )
    : [];
  const noShowEvents = activeUserCanManage
    ? noShowAlertsFor(state.employees, alertEligibleShifts, state.clockEvents, currentTime)
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
  const activeEmployees = useMemo(
    () => state.employees.filter((employee) => employee.active),
    [state.employees],
  );
  const savedBasicInfo = JSON.parse(savedBasicInfoSnapshot) as BasicInfo;
  const availableLocations = locationNamesFromBasicInfo(savedBasicInfo);
  const rosterRoles = Array.from(new Set(
    activeEmployees
      .map((employee) => employee.role.trim())
      .filter(Boolean),
  ));
  const availableRoles = Array.from(new Set(
    [...state.departments.flatMap((department) => department.roles), ...rosterRoles],
  )).sort((first, second) => first.localeCompare(second));
  const availableManagers = activeEmployees.filter((employee) => isManagerEmployee(employee));
  const shiftEmployees = useMemo(
    () => activeEmployees,
    [activeEmployees],
  );
  const hoursEmployees = useMemo(
    () => activeEmployees.filter((employee) => !isManagerEmployee(employee)),
    [activeEmployees],
  );
  const shiftEmployeeIds = useMemo(
    () => new Set(shiftEmployees.map((employee) => employee.id)),
    [shiftEmployees],
  );
  const accessibleShifts = workingScheduleShifts;
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
  const visibleNavItems = isPublicSchedule
    ? navItems.filter((item) => item.id === "schedule")
    : navItems.filter((item) => mode === "manager" || !item.managerOnly);
  const todaysShifts = accessibleShifts
    .filter((shift) => shift.date === today && shiftEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  const calendarShifts = useMemo(
    () =>
      shiftsForCalendarRange(accessibleShifts, shiftEmployeeIds, today, activeCalendarTab).sort(
        (a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
      ),
    [accessibleShifts, activeCalendarTab, shiftEmployeeIds, today],
  );
  const scheduleDayShifts = useMemo(
    () =>
      accessibleShifts
        .filter((shift) => (
          shift.date === scheduleDate
          && shiftEmployeeIds.has(shift.employeeId)
          && !employeeHasApprovedTimeOffOnDate(state.ptoRequests ?? [], shift.employeeId, shift.date)
        ))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [accessibleShifts, scheduleDate, shiftEmployeeIds, state.ptoRequests],
  );
  const scheduleWeekDays = useMemo(
    () =>
      mondayWeekCalendarDays(scheduleDate).map((day) => ({
        ...day,
        shifts: accessibleShifts
          .filter((shift) => (
            shift.date === day.date
            && shiftEmployeeIds.has(shift.employeeId)
            && !employeeHasApprovedTimeOffOnDate(state.ptoRequests ?? [], shift.employeeId, shift.date)
          ))
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds, state.ptoRequests],
  );
  const scheduleMonthDays = useMemo(
    () => scheduleMonthCalendarDays(scheduleDate).map((day) => ({
      ...day,
      shifts: accessibleShifts
        .filter((shift) => (
          shift.date === day.date
          && shiftEmployeeIds.has(shift.employeeId)
          && !employeeHasApprovedTimeOffOnDate(state.ptoRequests ?? [], shift.employeeId, shift.date)
        ))
        .sort((a, b) => a.start.localeCompare(b.start)),
    })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds, state.ptoRequests],
  );
  const visibleScheduleEmployees = orderedShiftEmployees.filter((employee) => visibleEmployeeIds === null || visibleEmployeeIds.includes(employee.id));
  const myShift = todaysShifts.find((shift) => shift.employeeId === activeEmployeeId);
  const clockedInIds = useMemo(() => {
    return new Set(
      state.employees
        .filter((employee) => employee.active && !isManagerEmployee(employee))
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
  const hoursRows = useMemo(
    () => {
      const range = dateRangeForCalendarTab(parseLocalDate(hoursDate), activeHoursTab);

      return hoursEmployees.map((employee) => ({
        employee,
        hours: roundHoursToMinutes(
          adjustedWorkedHoursForRange(
            state.clockEvents,
            state.hoursAdjustments ?? [],
            employee.id,
            range,
            currentTime,
          ),
          mode === "manager" ? hoursRounding : "actual",
        ),
      }));
    },
    [activeHoursTab, currentTime, hoursDate, hoursEmployees, hoursRounding, mode, state.clockEvents, state.hoursAdjustments],
  );
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

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const employee = state.employees.find((entry) => entry.pin === pin && entry.active);

    if (pin === managerPin || (employee && isManagerEmployee(employee))) {
      setIsPublicSchedule(false);
      setMode("manager");
      setActiveEmployeeId(employee?.id ?? 1);
      setActiveView("dashboard");
      setIsUnlocked(true);
      setAuthMessage("Manager mode active. All controls are available.");
      setCreatedShiftTimes({});
      setEditedShiftTimes({});
      setLastEditedShiftId(null);
      setPin("");
      return;
    }

    if (employee) {
      setIsPublicSchedule(false);
      setMode("employee");
      setActiveEmployeeId(employee.id);
      setActiveView("dashboard");
      setIsUnlocked(true);
      setAuthMessage(`Employee mode active for ${employee.name}. Manager controls are hidden.`);
      setPin("");
      return;
    }

    setAuthMessage("PIN not recognized.");
  }

  function openConversation(conversationId: number, fromPtoRequest = false) {
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
    setState((current) => ({
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
    }));
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

  function startEditingConversationName(conversation: TeamConversation) {
    if (conversation.participantIds.length <= 2 || conversation.creatorEmployeeId !== activeEmployeeId) return;
    setEditingConversationNameId(conversation.id);
    setConversationNameDraft(conversation.name ?? "");
  }

  function saveConversationName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingConversationNameId === null) return;

    const name = conversationNameDraft.trim();
    setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).map((conversation) => (
        conversation.id === editingConversationNameId && conversation.creatorEmployeeId === activeEmployeeId
          ? { ...conversation, name: name || undefined }
          : conversation
      )),
    }));
    setEditingConversationNameId(null);
    setConversationNameDraft("");
  }

  function toggleConversationPinned(conversationId: number) {
    setState((current) => ({
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
    }));
    setConversationMenuId(null);
  }

  function toggleConversationMuted(conversationId: number) {
    setState((current) => ({
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
    }));
    setConversationMenuId(null);
  }

  function deleteConversation(conversationId: number) {
    if (!window.confirm("Delete this conversation? This will permanently erase all message history.")) return;

    setState((current) => ({
      ...current,
      conversations: (current.conversations ?? []).filter(
        (conversation) => conversation.id !== conversationId,
      ),
    }));
    setSelectedConversationId((selectedId) => (
      selectedId === conversationId ? null : selectedId
    ));
    setViewingConversationInfoId((infoId) => (infoId === conversationId ? null : infoId));
    setConversationMenuId(null);
  }

  function messagePtoRequestEmployee() {
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

  function createTeamConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setState((current) => ({
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
      }));
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
        id: 1,
        senderEmployeeId: activeEmployeeId,
        body,
        sentAt,
        readByEmployeeIds: [activeEmployeeId],
      }],
    };
    setState((current) => ({
      ...current,
      conversations: [...(current.conversations ?? []), conversation],
    }));
    setNewConversationMemberIds([]);
    setPtoMessageEmployeeId(null);
    setNewConversationMessage("");
    setMessageError("");
    setIsCreatingConversation(false);
    setSelectedConversationId(conversationId);
  }

  function sendTeamMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageDraft.trim();
    if (!selectedConversation || !body) return;

    setState((current) => ({
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
    }));
    setMessageDraft("");
    window.requestAnimationFrame(() => messageComposerRef.current?.focus());
  }

  function updateBasicInfo(field: BasicInfoField, value: string) {
    const nextValue = field === "locationPhone" || field === "companyPhone"
      ? formatPhoneNumberInput(value)
      : value;
    setBasicInfo((current) => ({ ...current, [field]: nextValue }));
  }

  function saveBasicInfo() {
    const previousBasicInfo = JSON.parse(savedBasicInfoSnapshot) as BasicInfo;
    const previousLocationName = previousBasicInfo.locationName.trim();
    const nextLocationName = basicInfo.locationName.trim();

    window.localStorage.setItem(basicInfoStorageKey, JSON.stringify(basicInfo));
    setSavedBasicInfoSnapshot(JSON.stringify(basicInfo));
    if (previousLocationName !== nextLocationName) {
      setState((current) => ({
        ...current,
        employees: current.employees.map((employee) => (
          employee.location === previousLocationName
            ? { ...employee, location: nextLocationName }
            : employee
        )),
      }));
    }
    setEditingBasicInfoField(null);
  }

  function signOut() {
    setIsUnlocked(false);
    setIsPublicSchedule(false);
    setMode("employee");
    setActiveEmployeeId(1);
    setActiveView("dashboard");
    setPin("");
    setAuthMessage("");
    setIsAccountMenuOpen(false);
    setIsNotificationsOpen(false);
    setIsMessagesOpen(false);
    setIsTeamNavOpen(false);
    setIsScheduleNavOpen(false);
  }

  function navigateToView(view: ViewId) {
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
      setActiveHoursSectionTab("hours");
      setActiveHoursTab("today");
      setHoursDate(today);
    }
    if (view === "time_off") setActiveHoursSectionTab("pto");
    if (view === "settings") setActiveSettingsTab("Basic info");
    setIsTeamNavOpen(view === "employees" || view === "departments_roles");
    setIsScheduleNavOpen(["schedule", "time_off", "my_availability", "team_availability"].includes(view));
    setActiveView(view);
    setIsAccountMenuOpen(false);
  }

  function viewPublicSchedule() {
    setMode("employee");
    setActiveEmployeeId(0);
    setActiveView("schedule");
    setIsPublicSchedule(true);
    setIsUnlocked(true);
    setPin("");
    setAuthMessage("Public schedule view. Sign in with a PIN to access employee tools.");
  }

  function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = [employeeForm.firstName.trim(), employeeForm.lastName.trim()].filter(Boolean).join(" ");
    const role = employeeForm.role.trim();
    const pin = employeeForm.pin.trim();

    if (
      !employeeForm.firstName.trim()
      || !employeeForm.lastName.trim()
      || !employeeForm.email.trim()
      || !employeeForm.phone.trim()
      || !role
      || pin.length !== 4
    ) return;

    const employeeWithPin = findEmployeeWithPin(state.employees, pin);
    if (employeeWithPin) {
      setEmployeeMessage(`PIN already in use by ${employeeWithPin.name}.`);
      return;
    }

    if (hasEmployeeWithName(state.employees, name)) {
      setEmployeeMessage("Name already in use.");
      return;
    }

    setState((current) => ({
      ...current,
      employees: [
        ...current.employees,
        {
          id: nextId(current.employees),
          name,
          email: employeeForm.email.trim(),
          phone: formatPhoneNumberInput(employeeForm.phone),
          accessLevel: employeeForm.accessLevel,
          location: employeeForm.location,
          role,
          wage: formatWageInput(employeeForm.wage),
          pin,
          active: employeeForm.active,
        },
      ],
    }));
    setEmployeeForm(emptyEmployeeForm);
    setIsAddingEmployeeRole(false);
    setNewEmployeeRole("");
    setEmployeeMessage("");
    setIsAddingEmployee(false);
  }

  function cancelAddingEmployee() {
    setEmployeeForm(emptyEmployeeForm);
    setIsAddingEmployeeRole(false);
    setNewEmployeeRole("");
    setEmployeeMessage("");
    setIsAddingEmployee(false);
  }

  function addRoleFromEmployeeForm() {
    const requestedRole = newEmployeeRole.trim();
    if (!requestedRole) return;

    const existingRole = availableRoles.find(
      (role) => role.toLocaleLowerCase() === requestedRole.toLocaleLowerCase(),
    );
    const role = existingRole ?? requestedRole;

    if (!existingRole) {
      setState((current) => {
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
      });
    }

    setEmployeeForm((form) => ({ ...form, role }));
    setNewEmployeeRole("");
    setIsAddingEmployeeRole(false);
  }

  function addDepartment() {
    const name = newDepartmentName.trim();
    if (name) {
      setState((current) => ({
        ...current,
        departments: [
          ...current.departments,
          { id: nextId(current.departments), name, roles: [], managerIds: [] },
        ],
      }));
    }
    setNewDepartmentName("");
    setIsAddingDepartment(false);
  }

  function addDepartmentRole(departmentId: number) {
    const role = (departmentRoleDrafts[departmentId] ?? "").trim();
    if (role) {
      setState((current) => ({
        ...current,
        departments: current.departments.map((department) => (
          department.id === departmentId && !department.roles.some((savedRole) => savedRole.toLowerCase() === role.toLowerCase())
            ? { ...department, roles: [...department.roles, role] }
            : department
        )),
      }));
    }
    setDepartmentRoleDrafts((current) => ({ ...current, [departmentId]: "" }));
  }

  function startEditingDepartment(department: Department) {
    setEditingDepartmentId(department.id);
    setDepartmentNameDraft(department.name === "Department not set" ? "" : department.name);
  }

  function saveDepartmentName(departmentId: number) {
    const name = departmentNameDraft.trim() || "Department not set";
    setState((current) => ({
      ...current,
      departments: current.departments.map((department) => (
        department.id === departmentId ? { ...department, name } : department
      )),
    }));
    setEditingDepartmentId(null);
    setDepartmentNameDraft("");
  }

  function removeDepartment(departmentId: number) {
    setState((current) => ({
      ...current,
      departments: current.departments.filter((department) => department.id !== departmentId),
    }));
  }

  function removeDepartmentRole(departmentId: number, role: string) {
    setState((current) => {
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
    });
  }

  function addDepartmentManager(departmentId: number, managerId: number) {
    if (availableManagers.some((manager) => manager.id === managerId)) {
      setState((current) => ({
        ...current,
        departments: current.departments.map((department) => (
          department.id === departmentId && !department.managerIds.includes(managerId)
            ? { ...department, managerIds: [...department.managerIds, managerId] }
            : department
        )),
      }));
    }
  }

  function removeDepartmentManager(departmentId: number, managerId: number) {
    setState((current) => ({
      ...current,
      departments: current.departments.map((department) => (
        department.id === departmentId
          ? { ...department, managerIds: department.managerIds.filter((id) => id !== managerId) }
          : department
      )),
    }));
  }

  function removeEmployee(employeeId: number) {
    if (!activeUserIsAdmin || employeeId === activeEmployeeId) {
      setEmployeePendingDeletion(null);
      return;
    }

    setState((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== employeeId),
      departments: current.departments.map((department) => ({
        ...department,
        managerIds: department.managerIds.filter((managerId) => managerId !== employeeId),
      })),
      shifts: current.shifts.filter((shift) => shift.employeeId !== employeeId),
      clockEvents: current.clockEvents.filter((event) => event.employeeId !== employeeId),
      hoursAdjustments: (current.hoursAdjustments ?? []).filter((adjustment) => adjustment.employeeId !== employeeId),
      ptoRequests: (current.ptoRequests ?? []).filter((request) => request.employeeId !== employeeId),
      ptoPolicies: (current.ptoPolicies ?? []).map((policy) => ({
        ...policy,
        employeeIds: policy.employeeIds.filter((id) => id !== employeeId),
      })),
      scheduleDraftsByManager: Object.fromEntries(
        Object.entries(current.scheduleDraftsByManager ?? {})
          .filter(([managerId]) => Number(managerId) !== employeeId)
          .map(([managerId, draft]) => [managerId, {
            ...draft,
            upsertedShifts: draft.upsertedShifts.filter((shift) => shift.employeeId !== employeeId),
            affectedEmployeeIds: draft.affectedEmployeeIds.filter((id) => id !== employeeId),
          }]),
      ),
    }));
    setEmployeeMessage("");
    setEmployeePendingDeletion(null);
  }

  function updateRole(employeeId: number, role: string) {
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, role } : employee,
      ),
      shifts: current.shifts.map((shift) =>
        shift.employeeId === employeeId ? { ...shift, role } : shift,
      ),
      scheduleDraftsByManager: Object.fromEntries(
        Object.entries(current.scheduleDraftsByManager ?? {}).map(([managerId, draft]) => [managerId, {
          ...draft,
          upsertedShifts: draft.upsertedShifts.map((shift) => (
            shift.employeeId === employeeId ? { ...shift, role } : shift
          )),
        }]),
      ),
    }));
  }

  function updateEmployeeName(employeeId: number, name: string) {
    if (hasEmployeeWithName(state.employees, name, employeeId)) {
      setEmployeeMessage("Name already in use.");
      return;
    }

    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, name } : employee,
      ),
    }));
    setEmployeeMessage("");
  }

  function updateEmployeePin(employeeId: number, pin: string) {
    const numericPin = pin.replace(/\D/g, "").slice(0, 4);
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, pin: numericPin } : employee,
      ),
    }));
  }

  function updateEmployeeStatus(employeeId: number, active: boolean) {
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee.id === employeeId ? { ...employee, active } : employee
      )),
    }));
  }

  function updateEmployeeDetail(
    employeeId: number,
    field: "email" | "phone" | "accessLevel" | "location" | "wage",
    value: string,
  ) {
    const nextValue = field === "phone" ? formatPhoneNumberInput(value) : value;
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, [field]: nextValue } as Employee : employee,
      ),
    }));
  }

  function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shiftEmployeeIds.has(shiftForm.employeeId) || !shiftForm.date || !shiftForm.role.trim()) {
      setCreateShiftError("Date, clock-in time, clock-out time, and role are required.");
      return;
    }
    if (createShiftWeekdays.length === 0) {
      setCreateShiftError("Choose at least one day to apply this shift to.");
      return;
    }

    const start = parseTypedTime(shiftForm.start);
    const end = parseTypedTime(shiftForm.end);
    if (!start || !end) {
      setCreateShiftError("Enter a valid start and end time.");
      return;
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) {
      setCreateShiftError("Start time must be earlier than end time.");
      return;
    }

    const shiftDates = shiftDatesForWeekdays(shiftForm.date, createShiftWeekdays);
    const duplicateDate = shiftDates.find((date) => workingScheduleShifts.some((shift) => (
      shift.id !== shiftForm.id
      && shift.employeeId === shiftForm.employeeId
      && shift.date === date
    )));
    if (duplicateDate) {
      setCreateShiftError(`This employee already has a shift on ${formatTimeOffRequestDate(duplicateDate)}.`);
      return;
    }
    const firstCreatedShiftId = nextScheduleShiftId(state);
    const createdShiftIds = shiftForm.id
      ? []
      : shiftDates.map((_, index) => firstCreatedShiftId + index);

    setState((current) => {
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
    });
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
    });
    setCreateShiftWeekdays([weekdayForDate(date)]);
    setIsAddingShift(true);
  }

  function openMonthShiftCreator(date: string) {
    if (mode !== "manager") return;
    setCreateShiftError("");
    setShiftForm({
      id: 0,
      employeeId: 0,
      date,
      start: "",
      end: "",
      role: "",
      station: "Floor",
      notes: "",
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

  function moveHoursDate(direction: -1 | 1) {
    setHoursDate((date) => shiftDateByCalendarTab(date, activeHoursTab, direction));
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

  function deletePtoPolicy(policy: PtoPolicy) {
    if (!window.confirm(`Delete ${policy.name}? Employees assigned to it will no longer earn PTO through this policy.`)) return;

    setState((current) => ({
      ...current,
      ptoPolicies: (current.ptoPolicies ?? []).filter((item) => item.id !== policy.id),
    }));
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

  function savePtoPolicy() {
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
    setState((current) => {
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
    });
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

  function submitPtoRequest(event: FormEvent<HTMLFormElement>) {
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

    setState((current) => ({
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
    }));
    setPtoRequestForm(null);
    setPtoRequestError("");
  }

  function decidePtoRequest(status: "approved" | "denied") {
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

    setState((current) => ({
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
    }));
    setReviewingPtoRequestId(null);
    setPtoReviewError("");
  }

  function cancelPtoRequest(requestId: number) {
    const cancelledAt = new Date().toISOString();
    setState((current) => ({
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
    }));
  }

  function deletePtoRequest(requestId: number) {
    if (mode !== "manager") return;
    if (!window.confirm("Delete this time off request? This cannot be undone.")) return;

    setState((current) => ({
      ...current,
      ptoRequests: (current.ptoRequests ?? []).filter((request) => request.id !== requestId),
    }));
    if (reviewingPtoRequestId === requestId) setReviewingPtoRequestId(null);
  }

  function saveWorkedHours(event: FormEvent<HTMLFormElement>) {
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

    const range = dateRangeForCalendarTab(parseLocalDate(hoursDate), activeHoursTab);
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

    setState((current) => ({
      ...current,
      hoursAdjustments: [
        ...(current.hoursAdjustments ?? []),
        {
          id: nextId(current.hoursAdjustments ?? []),
          employeeId: editingHours.employee.id,
          date: adjustmentDateForRange(hoursDate, range),
          hours: difference,
        },
      ],
    }));
    setEditingHours(null);
    setShowHoursChangeWarning(false);
  }

  function openShiftEditor(shift: Shift) {
    if (mode !== "manager") return;
    setEditShiftError("");
    setEditingShift({ ...shift, notes: shift.notes ?? "" });
    setEditingShiftWeekdays([weekdayForDate(shift.date)]);
  }

  function saveEditedShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShift) return;

    const savedShift = workingScheduleShifts.find((shift) => shift.id === editingShift.id);
    const start = parseTypedTime(editingShift.start);
    const end = parseTypedTime(editingShift.end);
    const role = editingShift.role.trim();
    const notes = editingShift.notes?.trim() ?? "";
    if (!start || !end) {
      setEditShiftError("Enter a valid start and end time.");
      return;
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) {
      setEditShiftError("Start time must be earlier than end time.");
      return;
    }
    const shiftHasStarted = Boolean(savedShift && currentTime >= shiftStartDateTime(savedShift).getTime());
    const shiftHasEnded = Boolean(savedShift && currentTime >= shiftEndDateTime(savedShift).getTime());
    if (shiftHasEnded) {
      setEditShiftError("This shift has ended and can no longer be changed.");
      return;
    }
    if (shiftHasStarted && savedShift && (
      editingShift.employeeId !== savedShift.employeeId
      || editingShift.date !== savedShift.date
      || start !== savedShift.start
      || role !== savedShift.role.trim()
      || notes !== (savedShift.notes?.trim() ?? "")
    )) {
      setEditShiftError("Once a shift starts, only its clock-out time can be changed.");
      return;
    }
    if (shiftHasStarted && shiftEndDateTime({ ...editingShift, start, end, role }).getTime() <= currentTime) {
      setEditShiftError("Clock-out time must remain in the future while the shift is active.");
      return;
    }
    if (!role || !shiftEmployeeIds.has(editingShift.employeeId)) return;

    if (editingShiftWeekdays.length === 0) {
      setEditShiftError("Choose at least one day to apply this shift to.");
      return;
    }
    const targetDates = Array.from(new Set([
      editingShift.date,
      ...shiftDatesForWeekdays(editingShift.date, editingShiftWeekdays),
    ]));
    if (shiftHasStarted && savedShift && targetDates.some((date) => date !== savedShift.date)) {
      setEditShiftError("Days cannot be added after a shift starts.");
      return;
    }
    const duplicateDate = targetDates.find((date) => workingScheduleShifts.some((shift) => (
      shift.id !== editingShift.id
      && shift.employeeId === editingShift.employeeId
      && shift.date === date
    )));
    if (duplicateDate) {
      setEditShiftError(`This employee already has a shift on ${formatTimeOffRequestDate(duplicateDate)}.`);
      return;
    }

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

    setState((current) => {
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
    });
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

  function deleteEditingShift() {
    if (!editingShift || !activeUserIsAdmin) return;
    if (!window.confirm("Are you sure you want to delete this shift?")) return;

    setState((current) => {
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
    });
    setEditingShift(null);
  }

  function publishSchedule() {
    if (mode !== "manager") return;
    const publishedAt = new Date().toISOString();
    const publishId = Date.now();
    setState((current) => {
      const scheduleDraft = current.scheduleDraftsByManager?.[activeEmployeeId];
      if (!scheduleDraft) return current;
      const publishedShifts = applyScheduleDraft(current.shifts, scheduleDraft);
      const publisherName = current.employees.find((employee) => employee.id === activeEmployeeId)?.name ?? "A manager";
      const scheduleUpdates = [
        ...(current.scheduleUpdates ?? []).slice(-200),
        ...current.employees
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
    });
    setCreatedShiftTimes({});
    setEditedShiftTimes({});
    setLastEditedShiftId(null);
  }

  function requestTimeException(action: TimeExceptionAction) {
    if (!needsTimeException(action, myShift, activeBreakEndTime, currentTime)) {
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

  function clock(type: "in" | "out", explanation = "") {
    setState((current) => ({
      ...current,
      clockEvents: [
        {
          id: nextId(current.clockEvents),
          employeeId: activeEmployeeId,
          type,
          at: new Date().toISOString(),
          explanation,
        },
        ...current.clockEvents,
      ],
    }));
    setShowBreakOptions(false);
  }

  function takeBreak(duration: { minutes: 30 | 45 } | { seconds: 5 }) {
    if (!activeIsClockedIn || activeBreak) return;

    setState((current) => ({
      ...current,
      clockEvents: [
        {
          id: nextId(current.clockEvents),
          employeeId: activeEmployeeId,
          type: "break",
          durationMinutes: "minutes" in duration ? duration.minutes : undefined,
          durationSeconds: "seconds" in duration ? duration.seconds : undefined,
          at: new Date().toISOString(),
        },
        ...current.clockEvents,
      ],
    }));
    setShowBreakOptions(false);
  }

  function finishBreak(explanation = "") {
    if (!activeBreak) return;

    setState((current) => ({
      ...current,
      clockEvents: [
        {
          id: nextId(current.clockEvents),
          employeeId: activeEmployeeId,
          type: "break_end",
          durationMinutes: activeBreak.durationMinutes,
          durationSeconds: activeBreak.durationSeconds,
          at: new Date().toISOString(),
          explanation,
        },
        ...current.clockEvents,
      ],
    }));
    setShowBreakOptions(false);
  }

  if (!isUnlocked) {
    return (
      <main className="login-screen min-h-screen bg-[#f2f7fc] text-[#12213a]">
        <form className="login-card" onSubmit={signIn}>
          <div className="login-brand" aria-label="DomBase workforce">
            <span className="brand-mark">D</span>
            <h1>DomBase</h1>
          </div>
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="PIN"
            aria-label="Access PIN"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            required
          />
          <button type="submit">Enter</button>
          {authMessage ? <p role="alert">{authMessage}</p> : null}
        </form>
        <button type="button" className="public-schedule-button" onClick={viewPublicSchedule} aria-label="View schedule">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 2v3M17 2v3M3.5 9h17M5.5 4h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M8 13h3v3H8zM14 13h3v3h-3z" />
          </svg>
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f2f7fc] text-[#12213a]">
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
          <div className="brand-lockup" aria-label="DomBase workforce">
            <span className="brand-mark">D</span>
            <div>
              <p className="eyebrow">Workforce</p>
              <h1>DomBase</h1>
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
              <h2>{activeViewLabel(activeView, mode)}</h2>
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
                              required
                            />
                            <button type="submit" disabled={!newConversationMessage.trim()}>Send</button>
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
                            required
                          />
                          {messageError ? <p className="message-error">{messageError}</p> : null}
                          <button type="submit" className="start-chat-button">Start chat</button>
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
                            />
                            <button type="submit" disabled={!messageDraft.trim()}>Send</button>
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
                    {activeEmployee?.name.trim().charAt(0).toUpperCase() || "A"}
                  </button>
                  {isAccountMenuOpen ? (
                    <div className="account-dropdown" role="menu">
                      <div className="account-dropdown-user">
                        <strong>{activeEmployee?.name ?? "Account"}</strong>
                        <span>{activeEmployee?.role ?? capitalize(mode)}</span>
                      </div>
                      <button type="button" role="menuitem" onClick={() => navigateToView("profile")}>Profile</button>
                      <button type="button" role="menuitem" onClick={() => navigateToView("team_members")}>Team members</button>
                      <button type="button" role="menuitem" className="account-sign-out" onClick={signOut}>Sign out</button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <button type="button" className="public-back-button" onClick={signOut}>Back</button>
            )}
          </header>

          {activeView === "profile" && !isPublicSchedule ? (
            <section className="panel feature-panel account-profile-panel">
              <span className="profile-avatar" aria-hidden="true">
                {activeEmployee?.name.trim().charAt(0).toUpperCase() || "A"}
              </span>
              <div>
                <p className="eyebrow">Account profile</p>
                <h3>{activeEmployee?.name ?? "Account"}</h3>
                <p>{activeEmployee?.role ?? capitalize(mode)}</p>
              </div>
            </section>
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
                    </div>
                    <button type="button">Add a new location</button>
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

          {activeView === "dashboard" && (
            <div className="content-grid">
              {mode === "employee" ? (
                <section className="panel main-panel">
                  <PanelHeading eyebrow="Clock" title="Time clock" />
                  <div className="clock-card">
                    <div>
                      <p className="eyebrow">{activeEmployee?.role ?? "Employee"}</p>
                      <h3>{activeEmployee?.name ?? "Select employee"}</h3>
                      <p>
                        {activeIsClockedIn
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
                          onClick={() => requestTimeException(activeIsClockedIn ? "out" : "in")}
                        >
                          {activeIsClockedIn ? "Clock out" : "Clock in"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <PanelHeading eyebrow="Own shift" title="My shift today" />
                  {myShift ? <ShiftRow shift={myShift} employee={activeEmployee} /> : <EmptyState text="No shift assigned today." />}
                </section>
              ) : (
                <section className="panel main-panel">
                  <PanelHeading eyebrow="Manager" title="Manager overview" />
                  <div className="manager-summary">
                    <Metric label="Scheduled today" value={todaysShifts.length.toString()} />
                    <Metric label="Clocked in" value={clockedInIds.size.toString()} />
                  </div>
                  <div className="control-grid">
                    <button type="button" onClick={() => navigateToView("employees")}>Manage employees</button>
                    <button type="button" onClick={() => navigateToView("schedule")}>Manage schedule</button>
                    <button type="button" onClick={() => navigateToView("clockins")}>View clock-ins</button>
                    <button type="button" onClick={() => {
                      navigateToView("hours");
                      setActiveHoursSectionTab("pto");
                    }}>View PTO</button>
                  </div>
                </section>
              )}

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
              <div className="panel department-roles-panel">
                <div className="department-roles-table" role="table" aria-label="Departments and roles">
                  <div className="department-roles-header" role="row">
                    <span role="columnheader">Department</span>
                    <span role="columnheader">Type to create a new role or search existing roles</span>
                    <span role="columnheader">Add Managers to Departments</span>
                  </div>
                  {state.departments.map((department, departmentIndex) => {
                    const displayedRoles = rolesForDepartment(department, state.departments, rosterRoles);
                    const assignedManagers = department.managerIds
                      .map((managerId) => employeeById(availableManagers, managerId))
                      .filter((manager): manager is Employee => Boolean(manager));
                    const unassignedManagers = availableManagers.filter(
                      (manager) => !department.managerIds.includes(manager.id),
                    );
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
                      <div
                        className="department-manager-list"
                        role="cell"
                        onClick={(event) => {
                          if (event.target instanceof Element && event.target.closest("button, select")) return;
                          const managerSelect = event.currentTarget.querySelector("select");
                          if (!managerSelect) return;
                          managerSelect.focus();
                          try {
                            managerSelect.showPicker();
                          } catch {
                            // Focusing the native select is the fallback where showPicker is unavailable.
                          }
                        }}
                      >
                        {assignedManagers.map((manager) => (
                            <span key={manager.id}>
                              {manager.name}
                              <button
                                type="button"
                                onClick={() => removeDepartmentManager(department.id, manager.id)}
                                aria-label={`Remove ${manager.name} from ${department.name}`}
                              >×</button>
                            </span>
                        ))}
                        {unassignedManagers.length > 0 ? (
                          <select
                            value=""
                            onChange={(event) => {
                              addDepartmentManager(department.id, Number(event.target.value));
                              event.target.value = "";
                            }}
                            aria-label={`Add manager to ${department.name}`}
                          >
                            <option value="">{assignedManagers.length === 0 ? "Select manager" : ""}</option>
                            {unassignedManagers.map((manager) => (
                              <option value={manager.id} key={manager.id}>{manager.name}</option>
                            ))}
                          </select>
                        ) : null}
                      </div>
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

          {activeView === "employees" && mode === "manager" && (
            <section className="panel feature-panel">
              <div className="roster-heading">
                <PanelHeading eyebrow="Team" title="Roster" />
                <div className="roster-add-toolbar">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => setIsAddingEmployee(true)}
                    aria-expanded={isAddingEmployee}
                    aria-controls="add-team-member-form"
                    hidden={isAddingEmployee}
                  >
                    Add team member
                  </button>
                </div>
              </div>
              {isAddingEmployee ? (
                <div className="modal-backdrop" role="presentation">
                  <form
                    id="add-team-member-form"
                    className="team-member-modal"
                    onSubmit={addEmployee}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="add-team-member-title"
                  >
                    <div className="team-member-modal-heading">
                      <h2 id="add-team-member-title">Add team member</h2>
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
                              required
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
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, wage: event.target.value }))}
                              onBlur={() => setEmployeeForm((form) => ({ ...form, wage: formatWageInput(form.wage) }))}
                              inputMode="decimal"
                              placeholder="$0.00/hr"
                            />
                          </label>
                          <label>
                            <span>Employee PIN <b aria-hidden="true">*</b></span>
                            <input
                              type="password"
                              value={employeeForm.pin}
                              onChange={(event) => setEmployeeForm((form) => ({
                                ...form,
                                pin: event.target.value.replace(/\D/g, "").slice(0, 4),
                              }))}
                              inputMode="numeric"
                              pattern="[0-9]{4}"
                              minLength={4}
                              maxLength={4}
                              placeholder="****"
                              required
                            />
                          </label>
                        </div>
                        <div className="team-member-setting-fields">
                          <fieldset className="team-member-option-group team-member-access-level">
                            <legend>Access level</legend>
                            <div className="team-member-pill-options team-member-access-options">
                              {(["Admin", "Manager", "Employee"] as const).map((accessLevel) => (
                                <label key={accessLevel}>
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
                        </div>
                      </section>
                    </div>
                    {employeeMessage ? <p className="form-message" role="alert">{employeeMessage}</p> : null}
                    <div className="team-member-modal-actions">
                      <button type="button" className="secondary-action" onClick={cancelAddingEmployee}>Cancel</button>
                      <button type="submit">Add team member</button>
                    </div>
                  </form>
                </div>
              ) : null}
              <div className="roster-table-wrap">
                <div className="roster-table" role="table" aria-label="Team roster">
                  <div className="roster-header" role="row">
                    <span role="columnheader">Team member</span>
                    <span role="columnheader">Contact information</span>
                    <span role="columnheader">Access level</span>
                    <span role="columnheader">Location</span>
                    <span role="columnheader">Role</span>
                    <span role="columnheader">Wage</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader" aria-label="Actions" />
                  </div>
                  {state.employees.map((employee) => {
                    const isEditing = editingEmployeeId === employee.id;
                    return (
                      <article
                        className="roster-row"
                        role="row"
                        key={employee.id}
                        data-editing-employee-row={isEditing ? employee.id : undefined}
                      >
                        <div className="roster-member" role="cell">
                          <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                          <div>
                            {isEditing ? (
                              <input
                                value={employee.name}
                                onChange={(event) => updateEmployeeName(employee.id, event.target.value)}
                                aria-label={`Name for ${employee.name}`}
                              />
                            ) : <strong>{employee.name}</strong>}
                            {isEditing ? (
                              <input
                                type="password"
                                value={employee.pin}
                                onChange={(event) => updateEmployeePin(employee.id, event.target.value)}
                                aria-label={`PIN for ${employee.name}`}
                                inputMode="numeric"
                                pattern="[0-9]{4}"
                                minLength={4}
                                maxLength={4}
                                placeholder="****"
                              />
                            ) : <small>PIN: {employee.pin}</small>}
                          </div>
                        </div>
                        <div className="roster-contact" role="cell">
                          {isEditing ? (
                            <>
                              <input
                                type="email"
                                value={rosterInputValue(employee.email)}
                                onChange={(event) => updateEmployeeDetail(employee.id, "email", event.target.value)}
                                aria-label={`Email for ${employee.name}`}
                                placeholder="Email"
                              />
                              <input
                                type="tel"
                                inputMode="tel"
                                maxLength={14}
                                value={rosterInputValue(employee.phone)}
                                onChange={(event) => updateEmployeeDetail(employee.id, "phone", event.target.value)}
                                aria-label={`Phone number for ${employee.name}`}
                                placeholder="Phone number"
                              />
                            </>
                          ) : (
                            <><span>{employee.email}</span><span>{employee.phone}</span></>
                          )}
                        </div>
                        <div role="cell">
                          {employee.id === 1 ? (
                            <span>Admin</span>
                          ) : isEditing ? (
                            <select
                              value={employee.accessLevel}
                              onChange={(event) => updateEmployeeDetail(employee.id, "accessLevel", event.target.value)}
                              aria-label={`Access level for ${employee.name}`}
                            >
                              <option value="">Select</option>
                              <option value="Admin">Admin</option>
                              <option value="Manager">Manager</option>
                              <option value="Employee">Employee</option>
                            </select>
                          ) : employee.accessLevel}
                        </div>
                        <div role="cell">
                          {isEditing ? (
                            <select
                              value={employee.location}
                              onChange={(event) => updateEmployeeDetail(employee.id, "location", event.target.value)}
                              aria-label={`Location for ${employee.name}`}
                            >
                              <option value="">Select</option>
                              {availableLocations.map((location) => (
                                <option value={location} key={location}>{location}</option>
                              ))}
                            </select>
                          ) : employee.location}
                        </div>
                        <div role="cell">
                          {isEditing ? (
                            <select
                              value={employee.role}
                              onChange={(event) => updateRole(employee.id, event.target.value)}
                              aria-label={`Role for ${employee.name}`}
                            >
                              <option value="">Select</option>
                              {availableRoles.map((role) => (
                                <option value={role} key={role}>{role}</option>
                              ))}
                            </select>
                          ) : employee.role}
                        </div>
                        <div role="cell">
                          {isEditing ? (
                            <input
                              value={rosterInputValue(employee.wage)}
                              onFocus={() => updateEmployeeDetail(employee.id, "wage", "")}
                              onChange={(event) => updateEmployeeDetail(
                                employee.id,
                                "wage",
                                event.target.value.replace(/\D/g, ""),
                              )}
                              onBlur={(event) => updateEmployeeDetail(employee.id, "wage", formatWageInput(event.target.value))}
                              aria-label={`Wage for ${employee.name}`}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="$0.00/hr"
                            />
                          ) : employee.wage}
                        </div>
                        <div
                          role="cell"
                          className={isEditing ? "roster-status-editor" : employee.active ? "roster-status active" : "roster-status"}
                        >
                          {isEditing ? (
                            <select
                              value={employee.active ? "active" : "inactive"}
                              onChange={(event) => updateEmployeeStatus(employee.id, event.target.value === "active")}
                              aria-label={`Status for ${employee.name}`}
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          ) : employee.active ? "Active" : "Inactive"}
                        </div>
                        <div className="roster-actions" role="cell">
                          <button
                            type="button"
                            className="employee-edit-button"
                            onClick={() => setEditingEmployeeId((current) => (current === employee.id ? null : employee.id))}
                            aria-label={isEditing ? `Finish editing ${employee.name}` : `Edit ${employee.name}`}
                            title={isEditing ? "Finish editing" : "Edit employee"}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5" />
                            </svg>
                          </button>
                        </div>
                        {activeUserIsAdmin && employee.id !== activeEmployeeId ? (
                          <button
                            type="button"
                            className="roster-row-remove"
                            onClick={() => setEmployeePendingDeletion(employee)}
                            aria-label={`Delete ${employee.name}`}
                            title="Delete employee"
                          >×</button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {activeView === "schedule" && (
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
              {(mode === "employee" || mode === "manager") && (
                <div className="employee-schedule">
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
                        <div className="schedule-chart" aria-label={`Team schedule for ${formatLongDate(scheduleDate)}`}>
                          <div className="schedule-chart-header">
                            <div className="shift-day-member-heading" aria-hidden="true" />
                            <div className="schedule-time-grid">
                              {scheduleHourLabels.map((hour) => (
                                <span key={hour}>{formatHourLabel(hour)}</span>
                              ))}
                            </div>
                          </div>
                          <div className="shift-day-section-label">Team members ({visibleScheduleEmployees.length})</div>
                          {visibleScheduleEmployees.map((employee) => {
                            const employeeShifts = scheduleDayShifts.filter((shift) => shift.employeeId === employee.id);
                            const dailyHours = employeeShifts.reduce((total, shift) => total + Number(formatScheduledHours(shift)), 0);
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
                                  <div><strong>{employee.name}</strong><span>{dailyHours.toFixed(2)} hrs</span></div>
                                  {employeeLastEditedAt ? (
                                    <small>Last edited at {formatSavedTime(employeeLastEditedAt)}</small>
                                  ) : employeeLastCreatedAt ? (
                                    <small className="created-timestamp">Created at {formatSavedTime(employeeLastCreatedAt)}</small>
                                  ) : null}
                                </div>
                                <div className="schedule-track">
                                  {employeeShifts.map((shift) => (
                                    <div
                                      className={`${mode === "employee" && shift.employeeId === activeEmployeeId ? "schedule-bar mine" : "schedule-bar"}${mode === "manager" ? " editable" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`}
                                      key={shift.id}
                                      style={scheduleBarStyle(shift)}
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
                                      <span>{shift.role} | {formatScheduledHours(shift)} hours</span>
                                    </div>
                                  ))}
                                  {employeeShifts.length === 0 && timeOff ? (
                                    <div className="schedule-bar time-off" style={{ "--shift-left": "0%", "--shift-width": "100%" } as CSSProperties}>
                                      <strong>Time off</strong><span>{timeOff.startTime && timeOff.endTime ? `${formatTime12(timeOff.startTime)}–${formatTime12(timeOff.endTime)}` : "All day"}</span>
                                    </div>
                                  ) : null}
                                  {mode === "manager" && employeeShifts.length === 0 && !timeOff ? (
                                    <button
                                      type="button"
                                      className="shift-cell-add schedule-track-add"
                                      onClick={() => openShiftCreator(employee, scheduleDate)}
                                      aria-label={`Add shift for ${employee.name} on ${formatLongDate(scheduleDate)}`}
                                      title="Add shift"
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
                        <EmptyState text="No team members match the selected filters." />
                      )
                    ) : employeeScheduleTab === "week" ? (
                      <div className="shift-week-board" role="table" aria-label="Weekly team schedule">
                        <div className="shift-week-corner" role="columnheader" aria-label="Team member column" />
                        {scheduleWeekDays.map((day) => (
                          <button
                            type="button"
                            className={day.date === today ? "shift-week-day today" : "shift-week-day"}
                            key={day.date}
                            onClick={() => setScheduleDate(day.date)}
                            role="columnheader"
                          >
                            {weekday(day.date).slice(0, 3)}, {parseLocalDate(day.date).getDate()}
                          </button>
                        ))}
                        <div className="shift-week-section-label">Team members ({visibleScheduleEmployees.length})</div>
                        {visibleScheduleEmployees.map((employee) => {
                          const employeeWeekShifts = scheduleWeekDays.flatMap((day) => day.shifts.filter((shift) => shift.employeeId === employee.id));
                          const weeklyHours = employeeWeekShifts.reduce((total, shift) => total + Number(formatScheduledHours(shift)), 0);

                          return (
                            <div className="shift-week-row" role="row" key={employee.id}>
                              <div className="shift-week-member" role="rowheader">
                                <div><strong>{employee.name}</strong><span>{weeklyHours.toFixed(2)} hrs</span></div>
                              </div>
                              {scheduleWeekDays.map((day) => {
                                const dayShifts = day.shifts.filter((shift) => shift.employeeId === employee.id);
                                const timeOff = (state.ptoRequests ?? []).find((request) => request.employeeId === employee.id && request.status === "approved" && request.startDate <= day.date && request.endDate >= day.date);

                                const hasCellContent = dayShifts.length > 0 || Boolean(timeOff);

                                return (
                                  <div className={`shift-week-cell${hasCellContent ? " has-content" : " empty"}`} role="cell" key={day.date}>
                                    {dayShifts.map((shift) => (
                                      <button
                                        type="button"
                                        className={`shift-week-card${mode === "employee" && shift.employeeId === activeEmployeeId ? " mine" : ""}${mode === "manager" ? " editable" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`}
                                        key={shift.id}
                                        onClick={() => openShiftEditor(shift)}
                                      >
                                        <strong>{formatCompactTimeRange(shift)}</strong>
                                        <span>{shift.role || "Shift"}</span>
                                      </button>
                                    ))}
                                    {timeOff ? (
                                      <div className="shift-time-off"><strong>⊘ Time off</strong><span>▣ {timeOff.startTime && timeOff.endTime ? `${formatTime12(timeOff.startTime)}–${formatTime12(timeOff.endTime)}` : "All day"}</span></div>
                                    ) : null}
                                    {mode === "manager" && dayShifts.length === 0 && !timeOff ? (
                                      <button
                                        type="button"
                                        className="shift-cell-add"
                                        onClick={() => openShiftCreator(employee, day.date)}
                                        aria-label={`Add shift for ${employee.name} on ${formatLongDate(day.date)}`}
                                        title="Add shift"
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
                    ) : (
                      <div className="shift-month-board" aria-label={`Monthly schedule for ${formatMonthYear(scheduleDate)}`}>
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => <strong className="shift-month-weekday" key={label}>{label}</strong>)}
                        {scheduleMonthDays.map((day) => {
                          const visibleDayShifts = day.shifts.filter((shift) => visibleEmployeeIds === null || visibleEmployeeIds.includes(shift.employeeId));
                          const timeOffRequests = (state.ptoRequests ?? []).filter((request) => request.status === "approved" && request.startDate <= day.date && request.endDate >= day.date && (visibleEmployeeIds === null || visibleEmployeeIds.includes(request.employeeId)));
                          const hasDayContent = visibleDayShifts.length > 0 || timeOffRequests.length > 0;

                          return (
                            <div
                              className={`${day.date === today ? "shift-month-day today" : "shift-month-day"}${day.inMonth ? "" : " outside"}${hasDayContent ? " has-content" : " empty"}${mode === "manager" ? " can-add-shift" : ""}`}
                              key={day.date}
                              onClick={(event) => {
                                if (mode === "manager" && event.target === event.currentTarget) {
                                  openMonthShiftCreator(day.date);
                                }
                              }}
                            >
                              <button type="button" className="shift-month-date" onClick={() => { setScheduleDate(day.date); setEmployeeScheduleTab("day"); }}>
                                {day.day === "1" ? `${parseLocalDate(day.date).toLocaleDateString("en-US", { month: "short" })} 1` : day.day}
                              </button>
                              {visibleDayShifts.map((shift) => {
                                const employee = employeeById(state.employees, shift.employeeId);
                                return (
                                  <button type="button" className={`shift-month-card${mode === "employee" && shift.employeeId === activeEmployeeId ? " mine" : ""}${draftShiftIds.has(shift.id) ? " draft" : ""}`} key={shift.id} onClick={() => openShiftEditor(shift)}>
                                    <strong>{formatCompactTimeRange(shift)}</strong>
                                    <span>{employee?.name ?? "Open shift"} {shift.role ? `(${shift.role})` : ""}</span>
                                  </button>
                                );
                              })}
                              {timeOffRequests.map((request) => (
                                <div className="shift-month-time-off" key={request.id}>
                                  <strong>⊘ Time off {request.startTime && request.endTime ? `(${formatTime12(request.startTime)}–${formatTime12(request.endTime)})` : "(all day)"}</strong>
                                  <span>{employeeById(state.employees, request.employeeId)?.name ?? "Team member"}</span>
                                </div>
                              ))}
                              {mode === "manager" ? (
                                <button
                                  type="button"
                                  className="shift-cell-add shift-month-add"
                                  onClick={() => openMonthShiftCreator(day.date)}
                                  aria-label={`Add shift on ${formatLongDate(day.date)}`}
                                  title="Add shift"
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
                      <span>{clockEventLabel(item.event, state.shifts)}</span>
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

          {activeView === "hours" && !isPublicSchedule ? (
            <div className="hours-section-tabs" role="tablist" aria-label="Hours and PTO views">
              <button
                type="button"
                className={activeHoursSectionTab === "hours" ? "active" : ""}
                onClick={() => setActiveHoursSectionTab("hours")}
                role="tab"
                aria-selected={activeHoursSectionTab === "hours"}
              >
                View hours
              </button>
              <button
                type="button"
                className={activeHoursSectionTab === "pto" ? "active" : ""}
                onClick={() => setActiveHoursSectionTab("pto")}
                role="tab"
                aria-selected={activeHoursSectionTab === "pto"}
              >
                View PTO
              </button>
            </div>
          ) : null}

          {activeView === "hours" && activeHoursSectionTab === "hours" && !isPublicSchedule && (
            <section className="panel feature-panel">
              <div className="panel-heading calendar-heading">
                <div className="hours-date-toolbar">
                  <button type="button" onClick={() => moveHoursDate(-1)} aria-label={`Previous ${hoursTabControlLabel(activeHoursTab)}`}>
                    <span aria-hidden="true">&lt;</span>
                  </button>
                  <strong>{hoursDateLabel(activeHoursTab, hoursDate)}</strong>
                  <button type="button" onClick={() => moveHoursDate(1)} aria-label={`Next ${hoursTabControlLabel(activeHoursTab)}`}>
                    <span aria-hidden="true">&gt;</span>
                  </button>
                </div>
                <div className="hours-controls">
                  <div className="tab-list" role="tablist" aria-label="Hours range">
                    {(["today", "week", "month"] as CalendarTab[]).map((tab) => (
                      <button
                        type="button"
                        key={tab}
                        className={activeHoursTab === tab ? "tab-button active" : "tab-button"}
                        onClick={() => setActiveHoursTab(tab)}
                        role="tab"
                        aria-selected={activeHoursTab === tab}
                      >
                        {tab === "today" ? "Day" : capitalize(tab)}
                      </button>
                    ))}
                  </div>
                  {mode === "manager" ? (
                    <label className="hours-rounding-control">
                      <span>Round</span>
                      <select
                        value={hoursRounding}
                        onChange={(event) => {
                          const value = event.target.value;
                          setHoursRounding(value === "actual" ? "actual" : Number(value) as HoursRounding);
                        }}
                        aria-label="Round time worked"
                      >
                        <option value="actual">Actual</option>
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={15}>15 min</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>
              <div className="hours-list">
                {hoursRows
                  .filter(({ employee }) => mode === "manager" || employee.id === activeEmployeeId)
                  .map(({ employee, hours }) => (
                  <article className="hours-row" key={employee.id}>
                    <div>
                      <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                      <div>
                        <strong>{employee.name}</strong>
                        <span>{employee.role}</span>
                      </div>
                    </div>
                    <div className="hours-value">
                      <strong>{formatWorkedHours(hours)}</strong>
                      {mode === "manager" ? (
                        <button type="button" onClick={() => editWorkedHours(employee, hours)}>Edit</button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {(activeView === "time_off" || (activeView === "hours" && activeHoursSectionTab === "pto")) && !isPublicSchedule && (
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
            <section className="content-card">
              <PanelHeading eyebrow="Schedule" title="My availability" />
              <EmptyState text="Your availability has not been added yet." />
            </section>
          ) : null}

          {activeView === "team_availability" && !isPublicSchedule ? (
            <section className="content-card">
              <PanelHeading eyebrow="Schedule" title="Team availability" />
              <EmptyState text="No team availability has been added yet." />
            </section>
          ) : null}
        </section>
      </div>

      <nav className="bottom-nav" aria-label="Mobile DomBase staff sections">
        {visibleNavItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? "bottom-button active" : "bottom-button"}
            onClick={() => navigateToView(item.id)}
            title={item.label}
          >
            <SidebarNavIcon icon={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {mode === "manager" && activeUserIsAdmin && employeePendingDeletion && employeePendingDeletion.id !== activeEmployeeId ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => dismissModalFromBackdrop(event, () => setEmployeePendingDeletion(null))}
        >
          <div className="employee-delete-modal" role="dialog" aria-modal="true" aria-labelledby="employee-delete-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Delete team member</p>
                <h2 id="employee-delete-title">Delete {employeePendingDeletion.name}?</h2>
              </div>
              <button type="button" onClick={() => setEmployeePendingDeletion(null)} aria-label="Close delete confirmation">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <p>This will remove the employee and their saved shifts, hours, and PTO records. Are you sure you want to continue?</p>
            <div className="employee-delete-actions">
              <button type="button" onClick={() => setEmployeePendingDeletion(null)}>Cancel</button>
              <button type="button" onClick={() => removeEmployee(employeePendingDeletion.id)}>Delete employee</button>
            </div>
          </div>
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
                      <span>Rate <small>(example: 1 hour per 30 worked)</small></span>
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
                <button type="button" className="pto-message-employee-action" onClick={messagePtoRequestEmployee}>
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
                <p>{hoursDateLabel(activeHoursTab, hoursDate)}</p>
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
                onChange={(event) => {
                  const date = event.target.value;
                  setShiftForm((form) => ({ ...form, date }));
                  if (date) setCreateShiftWeekdays([weekdayForDate(date)]);
                }}
                aria-label="Shift date"
                required
              />
            </label>
            <div className="shift-edit-field">
              <span>Clock-in time</span>
              <TimeInput
                value={shiftForm.start}
                onChange={(start) => setShiftForm((form) => ({ ...form, start }))}
                ariaLabel="Shift start"
                placeholder="Start time"
                suggestBefore={shiftForm.end}
                required
              />
            </div>
            <div className="shift-edit-field">
              <span>Clock-out time</span>
              <TimeInput
                value={shiftForm.end}
                onChange={(end) => setShiftForm((form) => ({ ...form, end }))}
                ariaLabel="Shift end"
                placeholder="End time"
                suggestAfter={shiftForm.start}
                required
              />
            </div>
            <label className="shift-edit-field">
              <span>Role</span>
              <select
                value={shiftForm.role}
                onChange={(event) => setShiftForm((form) => ({ ...form, role: event.target.value }))}
                aria-label="Shift role"
                required
              >
                <option value="">Select role</option>
                {availableRoles.map((role) => (
                  <option value={role} key={role}>{role}</option>
                ))}
              </select>
            </label>
            <fieldset className="shift-apply-days">
              <legend>Apply to:</legend>
              <div>
                {shiftWeekdayOptions.map((option) => {
                  const dateLabel = applyToDateLabel(shiftForm.date, option.value);
                  return (
                    <span className="shift-apply-day-option" key={option.value}>
                      <span>{dateLabel}</span>
                      <button
                        type="button"
                        className={createShiftWeekdays.includes(option.value) ? "active" : ""}
                        onClick={() => toggleCreateShiftWeekday(option.value)}
                        aria-label={`${option.label}, ${dateLabel}`}
                        aria-pressed={createShiftWeekdays.includes(option.value)}
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
            <label className="shift-edit-field">
              <span>Date</span>
              <input
                type="date"
                value={editingShift.date}
                onChange={(event) => {
                  const date = event.target.value;
                  setEditingShift((shift) => shift ? { ...shift, date } : shift);
                  if (date) setEditingShiftWeekdays([weekdayForDate(date)]);
                }}
                aria-label="Edit shift date"
                disabled={editingShiftHasStarted}
              />
            </label>
            <div className="shift-edit-field">
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
                disabled={editingShiftHasStarted}
                suggestBefore={editingShift.end}
              />
            </div>
            <div className="shift-edit-field">
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
                disabled={editingShiftHasEnded}
                suggestAfter={editingShift.start}
              />
            </div>
            <label className="shift-edit-field">
              <span>Role</span>
              <select
                value={editingShift.role}
                onChange={(event) => setEditingShift((shift) => shift ? { ...shift, role: event.target.value } : shift)}
                aria-label="Edit shift role"
                disabled={editingShiftHasStarted}
              >
                <option value="">Select role</option>
                {availableRoles.map((role) => (
                  <option value={role} key={role}>{role}</option>
                ))}
              </select>
            </label>
            <fieldset className="shift-apply-days" disabled={editingShiftHasStarted}>
              <legend>Apply to:</legend>
              <div>
                {shiftWeekdayOptions.map((option) => {
                  const isAnchorDay = option.value === weekdayForDate(editingShift.date);
                  const dateLabel = applyToDateLabel(editingShift.date, option.value);
                  return (
                    <span className="shift-apply-day-option" key={option.value}>
                      <span>{dateLabel}</span>
                      <button
                        type="button"
                        className={editingShiftWeekdays.includes(option.value) ? "active" : ""}
                        onClick={() => toggleEditingShiftWeekday(option.value)}
                        aria-label={`${option.label}, ${dateLabel}`}
                        aria-pressed={editingShiftWeekdays.includes(option.value)}
                        disabled={editingShiftHasStarted || isAnchorDay}
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
                disabled={editingShiftHasStarted}
              />
            </label>
            {editingShiftHasEnded ? (
              <p className="shift-time-lock-note">This shift has ended. Its scheduled times are locked.</p>
            ) : editingShiftHasStarted ? (
              <p className="shift-time-lock-note">This shift is in progress. Only its clock-out time can be changed.</p>
            ) : null}
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
              {!editingShiftHasEnded ? (
                <button type="submit" className="primary-action">Save changes</button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {pendingTimeException ? (
        <div className="modal-backdrop" role="presentation">
          <form className="time-exception-modal" onSubmit={submitTimeException} role="dialog" aria-modal="true" aria-labelledby="time-exception-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Warning</p>
                <h2 id="time-exception-title">Supervisor Approval Required</h2>
              </div>
            </div>
            <p className="time-exception-warning">
              {timeExceptionMessage} This is a warning and is subject for approval with the supervisor.
            </p>
            <textarea
              value={timeExceptionExplanation}
              onChange={(event) => setTimeExceptionExplanation(event.target.value)}
              placeholder="Enter explanation"
              aria-label="Time exception explanation"
              maxLength={timeExceptionExplanationLimit}
              required
              autoFocus
            />
            <p className="character-count" aria-live="polite">
              {timeExceptionExplanationLimit - timeExceptionExplanation.length} characters remaining
            </p>
            <button type="submit" disabled={!timeExceptionExplanation.trim()}>Submit explanation</button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function activeViewLabel(activeView: ViewId, mode: Mode) {
  if (activeView === "dashboard") return mode === "manager" ? "Manager mode" : "Employee mode";
  if (activeView === "employees") return "Roster";
  if (activeView === "departments_roles") return "Department / Roles";
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
): OperationalAlert[] {
  return shifts.flatMap((shift) => {
    const employee = employees.find((entry) => entry.id === shift.employeeId);
    if (!employee?.active) return [];

    const scheduledStart = shiftStartDateTime(shift);
    const alertTime = scheduledStart.getTime() + missedClockInGraceMs;
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
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
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
      if (isWithinScheduledMinute(eventTime, scheduledTime.getTime())) return;

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
    if (!session.tookBreak && clockOutTime - clockInTime >= missedBreakThresholdMs && clockOutTime >= lookbackStart) {
      const employeeName = employeeNames.get(event.employeeId) ?? "Employee";
      alerts.push({
        id: `missed-break-${session.clockIn.id}-${event.id}`,
        employeeId: event.employeeId,
        title: "Missed break",
        detail: `${employeeName} worked at least five continuous hours without recording a break.`,
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
    if (session.tookBreak || alertTime > currentTime || alertTime < lookbackStart) return;

    alerts.push({
      id: `missed-break-open-${session.clockIn.id}`,
      employeeId,
      title: "Missed break",
      detail: `${employeeNames.get(employeeId) ?? "Employee"} has worked at least five continuous hours without recording a break.`,
      at: new Date(alertTime).toISOString(),
      severity: "danger",
      eventTargetId: `clock-${session.clockIn.id}`,
    });
  });

  alerts.push(...noShowAlertsFor(employees, shifts, eventsAscending, currentTime, lookbackStart));

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

function clockEventLabel(event: ClockEvent, shifts: Shift[]) {
  if (event.type === "in" || event.type === "out") {
    const action = event.type === "in" ? "Clock in" : "Clock out";
    const pastAction = event.type === "in" ? "Clocked in" : "Clocked out";
    const shift = shiftForClockEvent(event, shifts);
    if (!shift) return `Unscheduled ${action.toLocaleLowerCase()}`;

    const scheduledTime = event.type === "in"
      ? shiftStartDateTime(shift).getTime()
      : shiftEndDateTime(shift).getTime();
    const eventTime = new Date(event.at).getTime();
    if (isWithinScheduledMinute(eventTime, scheduledTime)) return action;

    return `${pastAction} ${eventTime < scheduledTime ? "early" : "late"}`;
  }
  if (event.type === "break_end") return `${breakDurationLabel(event)} break ended`;
  return `${breakDurationLabel(event)} break started`;
}

function shiftForClockEvent(event: ClockEvent, shifts: Shift[]) {
  const eventTime = new Date(event.at).getTime();

  return shifts.find((shift) => {
    if (shift.employeeId !== event.employeeId) return false;
    const start = shiftStartDateTime(shift).getTime();
    const end = shiftEndDateTime(shift).getTime();
    const windowStart = start - 12 * 60 * 60 * 1000;
    const windowEnd = end + 12 * 60 * 60 * 1000;
    return eventTime >= windowStart && eventTime <= windowEnd;
  });
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
) {
  if (action === "break_end") {
    return breakEnd ? currentTime >= breakEnd.getTime() + 60000 : true;
  }

  if (!shift) return true;

  const scheduledTime = action === "in" ? shiftStartDateTime(shift) : shiftEndDateTime(shift);
  return !isWithinScheduledMinute(currentTime, scheduledTime.getTime());
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
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
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

function readOpenedNotificationIds(): Record<number, string[]> {
  if (typeof window === "undefined") return {};

  const stored = window.localStorage.getItem(openedNotificationsStorageKey);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([employeeId, notificationIds]) => [
        Number(employeeId),
        Array.isArray(notificationIds)
          ? notificationIds.filter((notificationId): notificationId is string => typeof notificationId === "string")
          : [],
      ]),
    );
  } catch {
    window.localStorage.removeItem(openedNotificationsStorageKey);
    return {};
  }
}

function readDismissedNotificationIds(): Record<number, string[]> {
  if (typeof window === "undefined") return {};

  const stored = window.localStorage.getItem(dismissedNotificationsStorageKey);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([employeeId, notificationIds]) => [
        Number(employeeId),
        Array.isArray(notificationIds)
          ? notificationIds.filter((notificationId): notificationId is string => typeof notificationId === "string")
          : [],
      ]),
    );
  } catch {
    window.localStorage.removeItem(dismissedNotificationsStorageKey);
    return {};
  }
}

function readStoredBasicInfo(): BasicInfo {
  if (typeof window === "undefined") return defaultBasicInfo;

  const stored = window.localStorage.getItem(basicInfoStorageKey);
  if (!stored) return defaultBasicInfo;

  try {
    const parsed = { ...defaultBasicInfo, ...(JSON.parse(stored) as Partial<BasicInfo>) };
    return {
      ...parsed,
      locationPhone: formatPhoneNumberInput(parsed.locationPhone),
      companyPhone: formatPhoneNumberInput(parsed.companyPhone),
    };
  } catch {
    window.localStorage.removeItem(basicInfoStorageKey);
    return defaultBasicInfo;
  }
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

function rosterInputValue(value: string) {
  return value === "To be added" ? "" : value;
}

function clearRosterPlaceholder(value?: string) {
  return value?.trim() === "To be added" ? "" : value?.trim() ?? "";
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

function readStoredState() {
  if (typeof window === "undefined") return starterState;

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return starterState;

  function normalizeStoredState(rawState: string) {
    const parsed = JSON.parse(rawState) as StaffState;
    const employees = (Array.isArray(parsed.employees) ? parsed.employees : [])
      .map((employee) => {
        const normalizedEmployee = employee.id === 1 && employee.pin === managerPin
          ? { ...employee, name: "Serge Vakulchik" }
          : employee;
        const savedPhone = clearRosterPlaceholder(normalizedEmployee.phone);
        return {
          ...normalizedEmployee,
          email: clearRosterPlaceholder(normalizedEmployee.email),
          phone: savedPhone ? formatPhoneNumberInput(savedPhone) : "",
          accessLevel: normalizedEmployee.id === 1
            ? "Admin"
            : (["Admin", "Manager", "Employee"] as AccessLevel[]).includes(normalizedEmployee.accessLevel)
              ? normalizedEmployee.accessLevel
              : "",
          location: clearRosterPlaceholder(normalizedEmployee.location),
          role: clearRosterPlaceholder(normalizedEmployee.role),
          wage: formatWageInput(clearRosterPlaceholder(normalizedEmployee.wage)),
        };
      })
      .filter((employee) => !isStarterPlaceholderEmployee(employee));
    const employeeIds = new Set(employees.map((employee) => employee.id));
    const savedDepartments = Array.isArray(parsed.departments)
      ? parsed.departments.map((department) => ({
          ...department,
          roles: Array.from(new Set((department.roles ?? []).map((role) => role.trim()).filter(Boolean))),
          managerIds: (department.managerIds ?? []).filter((managerId) => employeeIds.has(managerId)),
        }))
      : [];
    const unassignedDepartment = savedDepartments.find(
      (department) => department.name.trim().toLowerCase() === "department not set",
    );
    const fallbackDepartment: Department = {
      id: nextId(savedDepartments),
      name: "Department not set",
      roles: Array.from(new Set(
        employees
          .filter((employee) => !isManagerEmployee(employee))
          .map((employee) => employee.role.trim())
          .filter(Boolean),
      )),
      managerIds: employees.filter((employee) => isManagerEmployee(employee)).map((employee) => employee.id),
    };
    const departments = [
      unassignedDepartment ?? fallbackDepartment,
      ...savedDepartments.filter((department) => department !== unassignedDepartment),
    ];
    const currentYearStart = `${new Date().getFullYear()}-01-01`;
    const ptoPolicies: PtoPolicy[] = Array.isArray(parsed.ptoPolicies)
      ? parsed.ptoPolicies.map((policy) => {
          const policyEmployeeIds = (policy.employeeIds ?? []).filter((employeeId) => employeeIds.has(employeeId));
          return {
            ...policy,
            fixedHours: Number(policy.fixedHours) || 0,
            earnedHours: Number(policy.earnedHours) || 0,
            workedHours: Number(policy.workedHours) || 0,
            employeeIds: policyEmployeeIds,
            startingBalances: Object.fromEntries(policyEmployeeIds.map((employeeId) => [
              employeeId,
              policy.startingBalances?.[employeeId] ?? { startDate: currentYearStart, balance: 0 },
            ])),
          };
        })
      : [{
          id: 1,
          name: "Standard PTO",
          method: "rate",
          fixedHours: 0,
          earnedHours: 1,
          workedHours: 30,
          employeeIds: Array.from(employeeIds),
          startingBalances: Object.fromEntries(Array.from(employeeIds).map((employeeId) => [
            employeeId,
            { startDate: currentYearStart, balance: 0 },
          ])),
        }];
    const hasStoredDraftModel = parsed.scheduleDraftsByManager !== undefined;
    const storedUnpublishedShiftIds = new Set(hasStoredDraftModel ? [] : readStoredUnpublishedShiftIds());
    const savedShifts = Array.isArray(parsed.shifts) ? parsed.shifts : [];
    const publishedShifts = savedShifts
      .filter((shift) => employeeIds.has(shift.employeeId))
      .filter((shift) => !storedUnpublishedShiftIds.has(shift.id));
    const draftEntries = parsed.scheduleDraftsByManager && typeof parsed.scheduleDraftsByManager === "object"
      ? Object.entries(parsed.scheduleDraftsByManager)
      : [];
    const savedScheduleDrafts = Object.fromEntries(
      draftEntries
        .filter(([managerId]) => {
          const manager = employees.find((employee) => employee.id === Number(managerId));
          return Boolean(manager && isManagerEmployee(manager));
        })
        .map(([managerId, savedDraft]) => {
          const draft = savedDraft && typeof savedDraft === "object" ? savedDraft : {} as Partial<ScheduleDraft>;
          return [managerId, {
            upsertedShifts: (Array.isArray(draft.upsertedShifts) ? draft.upsertedShifts : [])
              .filter((shift) => employeeIds.has(shift.employeeId)),
            deletedShiftIds: (Array.isArray(draft.deletedShiftIds) ? draft.deletedShiftIds : [])
              .filter((shiftId) => Number.isInteger(shiftId)),
            affectedEmployeeIds: (Array.isArray(draft.affectedEmployeeIds) ? draft.affectedEmployeeIds : [])
              .filter((employeeId) => employeeIds.has(employeeId)),
          }];
        }),
    );
    const scheduleDraftsByManager: Record<number, ScheduleDraft> = hasStoredDraftModel
      ? savedScheduleDrafts
      : storedUnpublishedShiftIds.size > 0
        ? {
            1: {
              upsertedShifts: savedShifts.filter((shift) => storedUnpublishedShiftIds.has(shift.id) && employeeIds.has(shift.employeeId)),
              deletedShiftIds: [],
              affectedEmployeeIds: (parsed.pendingScheduleUpdateEmployeeIds ?? []).filter((employeeId) => employeeIds.has(employeeId)),
            },
          }
        : {};
    const scheduleHasBeenPublished = parsed.scheduleHasBeenPublished
      ?? publishedShifts.length > 0;

    return {
      ...parsed,
      employees,
      departments,
      shifts: publishedShifts,
      clockEvents: (Array.isArray(parsed.clockEvents) ? parsed.clockEvents : [])
        .filter((event) => employeeIds.has(event.employeeId)),
      hoursAdjustments: (parsed.hoursAdjustments ?? []).filter((adjustment) => employeeIds.has(adjustment.employeeId)),
      ptoRequests: (parsed.ptoRequests ?? [])
        .filter((request) => employeeIds.has(request.employeeId))
        .map((request) => ({
          ...request,
          compensation: request.compensation === "unpaid" ? "unpaid" : "paid",
        })),
      ptoPolicies,
      scheduleUpdates: (parsed.scheduleUpdates ?? []).filter((notification) => employeeIds.has(notification.employeeId)),
      scheduleHasBeenPublished,
      pendingScheduleUpdateEmployeeIds: (parsed.pendingScheduleUpdateEmployeeIds ?? [])
        .filter((employeeId) => employeeIds.has(employeeId)),
      scheduleDraftsByManager,
      conversations: (parsed.conversations ?? [])
        .map((conversation) => {
          const participantIds = conversation.participantIds.filter((employeeId) => employeeIds.has(employeeId));
          const creatorEmployeeId = participantIds.includes(conversation.creatorEmployeeId)
            ? conversation.creatorEmployeeId
            : participantIds[0] ?? 0;
          return {
            ...conversation,
            creatorEmployeeId,
            participantIds,
            messages: (conversation.messages ?? []).map((message) => ({
              ...message,
              readByEmployeeIds: message.readByEmployeeIds ?? [],
            })),
          };
        })
        .filter((conversation) => conversation.participantIds.length > 0),
    };
  }

  try {
    return normalizeStoredState(stored);
  } catch {
    const backupState = window.localStorage.getItem(stateBackupStorageKey);
    if (backupState && backupState !== stored) {
      try {
        return normalizeStoredState(backupState);
      } catch {
        // Keep both raw records intact so they can still be recovered manually.
      }
    }
    return starterState;
  }
}

function isRecoverableStaffRecord(rawState: string) {
  try {
    const parsed = JSON.parse(rawState) as Partial<StaffState>;
    return (
      Array.isArray(parsed.employees)
      && parsed.employees.length > 0
      && Array.isArray(parsed.shifts)
      && Array.isArray(parsed.clockEvents)
    );
  } catch {
    return false;
  }
}

function isStarterPlaceholderEmployee(employee: Employee) {
  return (
    (employee.name === "Andre Taylor" && employee.pin === "2468") ||
    (employee.name === "Nora Patel" && employee.pin === "1357") ||
    (employee.name === "Leo Brooks" && employee.pin === "8642")
  );
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

function readStoredUnpublishedShiftIds() {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(unpublishedShiftsStorageKey);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    window.localStorage.removeItem(unpublishedShiftsStorageKey);
    return [];
  }
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
) {
  const currentDate = parseLocalDate(today);
  const { start, end } = dateRangeForCalendarTab(currentDate, tab);

  return shifts.filter((shift) => {
    if (!employeeIds.has(shift.employeeId)) return false;

    const shiftDate = parseLocalDate(shift.date);
    return shiftDate >= start && shiftDate <= end;
  });
}

function dateRangeForCalendarTab(date: Date, tab: CalendarTab) {
  if (tab === "today") {
    return { start: startOfDay(date), end: startOfDay(date) };
  }

  if (tab === "week") {
    const start = startOfDay(date);
    start.setDate(start.getDate() - start.getDay());
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

function hoursDateLabel(tab: CalendarTab, date: string) {
  if (tab === "today") return formatShortDate(date);
  if (tab === "week") return `Week of ${formatShortDate(weekCalendarDays(date)[0].date)}`;
  return formatMonthYear(date);
}

function hoursTabControlLabel(tab: CalendarTab) {
  if (tab === "today") return "day";
  return tab;
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

function mondayWeekCalendarDays(date: string) {
  const selectedDate = parseLocalDate(date);
  const weekStart = startOfDay(selectedDate);
  weekStart.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7));

  return Array.from({ length: 7 }, (_, index) => {
    const calendarDate = startOfDay(weekStart);
    calendarDate.setDate(weekStart.getDate() + index);
    return { date: toDateInputValue(calendarDate), day: calendarDate.getDate().toString() };
  });
}

function scheduleMonthCalendarDays(date: string) {
  const selectedDate = parseLocalDate(date);
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const gridStart = startOfDay(monthStart);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  gridStart.setDate(gridStart.getDate() - mondayOffset);
  const gridEnd = startOfDay(monthEnd);
  const daysUntilSunday = (7 - monthEnd.getDay()) % 7;
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

function applyToDateLabel(anchorDate: string, weekday: number) {
  const date = shiftDatesForWeekdays(anchorDate, [weekday])[0];
  if (!date) return "";
  const localDate = parseLocalDate(date);
  return `${localDate.getMonth() + 1}/${localDate.getDate()}`;
}

function shiftDatesForWeekdays(anchorDate: string, weekdays: number[]) {
  const anchor = parseLocalDate(anchorDate);
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));

  return shiftWeekdayOptions
    .filter((option) => weekdays.includes(option.value))
    .map((option) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + ((option.value + 6) % 7));
      return toDateInputValue(date);
    });
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
  return `${formatTime12(shift.start)} - ${formatTime12(shift.end)}`;
}

function formatCompactTimeRange(shift: Shift) {
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

function formatScheduledHours(shift: Shift) {
  const startMinutes = timeToMinutes(shift.start);
  const endMinutes = timeToMinutes(shift.end);

  if (startMinutes === null || endMinutes === null) return "0.0";

  const durationMinutes = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : endMinutes + 24 * 60 - startMinutes;

  return (durationMinutes / 60).toFixed(1);
}

function timeToMinutes(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return hour * 60 + minute;
}

function scheduleBarStyle(shift: Shift) {
  const startMinutes = timeToMinutes(shift.start);
  const endMinutes = timeToMinutes(shift.end);
  const scheduleStartMinutes = scheduleStartHour * 60;
  const scheduleEndMinutes = scheduleEndHour * 60;
  const totalMinutes = scheduleEndMinutes - scheduleStartMinutes;

  if (startMinutes === null || endMinutes === null) return {};

  const adjustedEndMinutes = endMinutes >= startMinutes ? endMinutes : endMinutes + 24 * 60;
  const visibleStart = Math.max(startMinutes, scheduleStartMinutes);
  const visibleEnd = Math.min(adjustedEndMinutes, scheduleEndMinutes);
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

function employeeHasApprovedTimeOffOnDate(requests: PtoRequest[], employeeId: number, date: string) {
  return requests.some((request) => (
    request.employeeId === employeeId
    && request.status === "approved"
    && request.startDate <= date
    && request.endDate >= date
  ));
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

function roundHoursToMinutes(hours: number, minutes: HoursRounding) {
  if (minutes === "actual") return hours;

  const totalMinutes = hours * 60;
  const lowerMinutes = Math.floor(totalMinutes / minutes) * minutes;
  const shouldRoundUp = totalMinutes - lowerMinutes >= minutes / 2;
  const roundedMinutes = shouldRoundUp ? lowerMinutes + minutes : lowerMinutes;

  return roundedMinutes / 60;
}

function SidebarNavIcon({ icon }: { icon: string }) {
  let paths;

  if (icon === "home") {
    paths = <><path d="m3.5 10.5 8.5-7 8.5 7" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" /></>;
  } else if (icon === "person") {
    paths = <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.7-4.3 3.2-6.5 7.5-6.5s6.8 2.2 7.5 6.5" /></>;
  } else if (icon === "calendar") {
    paths = <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M14 14h2M8 18h2M14 18h2" /></>;
  } else if (icon === "clock") {
    paths = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>;
  } else if (icon === "flag") {
    paths = <><path d="M5 22V3" /><path d="M5 4h11.5l-1.8 3 1.8 3H5" /></>;
  } else {
    paths = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>;
  }

  return (
    <span className="nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{paths}</svg>
    </span>
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
              {editingField === field ? (
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

const timeWheelHours = Array.from({ length: 12 }, (_, index) => `${index + 1}`);
const timeWheelMinutes = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, "0"));
const timeWheelPeriods = ["AM", "PM"];

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
  const shellRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestion = isFocused && !disabled ? suggestedTimeForDraft(draft, suggestAfter) : null;
  const afterMinutes = suggestAfter ? timeToMinutes(suggestAfter) : null;
  const beforeMinutes = suggestBefore ? timeToMinutes(suggestBefore) : null;
  const selectedTime = suggestion?.time ?? parseTypedTime(draft) ?? value;
  const defaultPickerMinutes = selectedTime
    ? timeToMinutes(selectedTime)
    : afterMinutes !== null
      ? Math.min(afterMinutes + 8 * 60, 24 * 60 - 1)
      : beforeMinutes !== null
        ? Math.max(beforeMinutes - 8 * 60, 0)
        : 8 * 60;
  const wheelTotalMinutes = defaultPickerMinutes ?? 8 * 60;
  const wheelHour24 = Math.floor(wheelTotalMinutes / 60) % 24;
  const wheelHour = `${wheelHour24 % 12 || 12}`;
  const wheelMinute = (wheelTotalMinutes % 60).toString().padStart(2, "0");
  const wheelPeriod = wheelHour24 >= 12 ? "PM" : "AM";

  useEffect(() => {
    setDraft(value ? formatTime12(value).replace(" ", "") : "");
  }, [value]);

  function commitTime() {
    if (!draft.trim()) {
      onChange("");
      setDraft("");
      return;
    }

    const parsed = suggestion?.time ?? parseTypedTime(draft);
    if (!parsed || !isTimeDraftBefore(draft, suggestBefore)) {
      setDraft(value ? formatTime12(value).replace(" ", "") : "");
      return;
    }

    onChange(parsed);
    setDraft(formatTime12(parsed).replace(" ", ""));
  }

  function applyWheelTime(hour = wheelHour, minute = wheelMinute, period = wheelPeriod) {
    const hour12 = Number(hour);
    let hour24 = hour12 % 12;
    if (period === "PM") hour24 += 12;
    const time = `${hour24.toString().padStart(2, "0")}:${minute}`;
    onChange(time);
    setDraft(formatTime12(time).replace(" ", ""));
  }

  return (
    <span className="time-input-shell" ref={shellRef}>
      {suggestion ? <span className="time-input-hint" aria-hidden="true">{suggestion.label}</span> : null}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft((currentDraft) => {
            const formattedDraft = formatTimeDraftInput(nextValue, currentDraft);
            return isTimeDraftBefore(formattedDraft, suggestBefore) ? formattedDraft : currentDraft;
          });
        }}
        onFocus={(event) => {
          setIsFocused(true);
          setIsPickerOpen(true);
          if (selectOnFocus) event.currentTarget.select();
        }}
        onClick={(event) => {
          setIsPickerOpen(true);
          if (selectOnFocus) event.currentTarget.select();
        }}
        onBlur={(event) => {
          commitTime();
          setIsFocused(false);
          if (!shellRef.current?.contains(event.relatedTarget as Node | null)) {
            setIsPickerOpen(false);
          }
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
        inputMode="text"
        disabled={disabled}
        required={required}
      />
      {isPickerOpen && !disabled ? (
        <span
          className="time-wheel-picker"
          role="group"
          aria-label={`${ariaLabel} time picker`}
        >
          <TimeWheelColumn
            label="Hour"
            values={timeWheelHours}
            value={wheelHour}
            onChange={(hour) => applyWheelTime(hour)}
          />
          <TimeWheelColumn
            label="Minute"
            values={timeWheelMinutes}
            value={wheelMinute}
            onChange={(minute) => applyWheelTime(wheelHour, minute)}
          />
          <TimeWheelColumn
            label="Period"
            values={timeWheelPeriods}
            value={wheelPeriod}
            onChange={(period) => applyWheelTime(wheelHour, wheelMinute, period)}
            loop={false}
          />
        </span>
      ) : null}
    </span>
  );
}

function TimeWheelColumn({
  label,
  values,
  value,
  onChange,
  loop = true,
}: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
  loop?: boolean;
}) {
  const currentIndex = Math.max(values.indexOf(value), 0);
  const wheelDeltaRef = useRef(0);
  const wheelDirectionRef = useRef(0);
  const lastWheelStepRef = useRef(0);

  function valueAtOffset(offset: number) {
    const nextIndex = loop
      ? (currentIndex + offset + values.length) % values.length
      : Math.max(0, Math.min(currentIndex + offset, values.length - 1));
    return values[nextIndex];
  }

  function move(offset: number) {
    const nextValue = valueAtOffset(offset);
    if (nextValue !== value) onChange(nextValue);
  }

  const visibleValues = loop
    ? [-1, 0, 1].map((offset) => ({ offset, value: valueAtOffset(offset) }))
    : values.map((option, index) => ({ offset: index - currentIndex, value: option }));

  return (
    <span
      className={`time-wheel-column${loop ? "" : " bounded"}`}
      role="spinbutton"
      aria-label={label}
      aria-valuetext={value}
      tabIndex={0}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const direction = Math.sign(event.deltaY);
        if (direction === 0) return;
        if (direction !== wheelDirectionRef.current) wheelDeltaRef.current = 0;
        wheelDirectionRef.current = direction;
        wheelDeltaRef.current += event.deltaY;

        const now = Date.now();
        if (Math.abs(wheelDeltaRef.current) < 60 || now - lastWheelStepRef.current < 140) return;
        move(wheelDeltaRef.current > 0 ? 1 : -1);
        wheelDeltaRef.current = 0;
        lastWheelStepRef.current = now;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      <span className="time-wheel-label">{label}</span>
      {visibleValues.map((option) => (
        <button
          type="button"
          className={option.value === value ? "current" : ""}
          aria-label={`${label} ${option.value}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.value)}
          key={`${option.value}-${option.offset}`}
        >
          {option.value}
        </button>
      ))}
    </span>
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
  employee,
  compact = false,
  showDate = false,
}: {
  shift: Shift;
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
        <span>{formatScheduledHours(shift)} hours</span>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}
