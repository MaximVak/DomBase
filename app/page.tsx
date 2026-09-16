"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Mode = "manager" | "employee";
type ViewId = "dashboard" | "employees" | "departments_roles" | "schedule" | "time_off" | "my_availability" | "team_availability" | "clockins" | "hours" | "settings" | "profile" | "team_members";
type CalendarTab = "today" | "week" | "month";
type HoursSectionTab = "hours" | "pto";
type NotificationTab = "team_requests" | "alerts";
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
type CopyRange = "week" | "month";
type EmployeeScheduleTab = "day" | "week" | "month";
type HoursRounding = "actual" | 5 | 10 | 15;
type TimeExceptionAction = "in" | "out" | "break_end";
type Permission =
  | "manage_employees"
  | "manage_roles"
  | "manage_shifts"
  | "view_clockins"
  | "view_hours"
  | "clock_self"
  | "view_schedule";

type Employee = {
  id: number;
  name: string;
  email: string;
  phone: string;
  accessLevel: "Manager" | "Employee" | "";
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

type HoursAdjustment = {
  id: number;
  employeeId: number;
  date: string;
  hours: number;
};

type PtoRequest = {
  id: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  reason: "sick_emergency" | "vacation";
  explanation: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  requestedAt: string;
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
  participantIds: number[];
  messages: TeamMessage[];
};

type StaffState = {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  clockEvents: ClockEvent[];
  hoursAdjustments: HoursAdjustment[];
  ptoRequests: PtoRequest[];
  conversations: TeamConversation[];
};

const managerPin = "0000";
const storageKey = "dombase-staff-state-v1";
const unpublishedShiftsStorageKey = "dombase-unpublished-shifts-v1";
const basicInfoStorageKey = "dombase-basic-info-v1";
const timeExceptionExplanationLimit = 250;
const calendarWeekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const scheduleStartHour = 7;
const scheduleEndHour = 17;
const scheduleHourLabels = Array.from(
  { length: scheduleEndHour - scheduleStartHour },
  (_, index) => scheduleStartHour + index,
);

const permissionsByMode: Record<Mode, Permission[]> = {
  manager: [
    "manage_employees",
    "manage_roles",
    "manage_shifts",
    "view_clockins",
    "view_hours",
    "view_schedule",
  ],
  employee: ["clock_self", "view_schedule", "view_hours"],
};

const navItems: { id: ViewId; label: string; icon: string; managerOnly?: boolean }[] = [
  { id: "dashboard", label: "Home", icon: "H" },
  { id: "employees", label: "Team", icon: "T", managerOnly: true },
  { id: "schedule", label: "Schedule", icon: "S" },
  { id: "hours", label: "Hours", icon: "H" },
  { id: "clockins", label: "Events", icon: "E", managerOnly: true },
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
};

const starterState: StaffState = {
  employees: [
    {
      id: 1,
      name: "Serge Vakulchik",
      email: "",
      phone: "",
      accessLevel: "Manager",
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
  conversations: [],
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
  const [activeNotificationTab, setActiveNotificationTab] = useState<NotificationTab>("team_requests");
  const [messageFilter, setMessageFilter] = useState<"all" | "unread">("all");
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [newConversationMemberIds, setNewConversationMemberIds] = useState<number[]>([]);
  const [newConversationMessage, setNewConversationMessage] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageError, setMessageError] = useState("");
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const employeeFilterRef = useRef<HTMLDivElement>(null);
  const [activeCalendarTab, setActiveCalendarTab] = useState<CalendarTab>("today");
  const [activeHoursTab, setActiveHoursTab] = useState<CalendarTab>("today");
  const [activeHoursSectionTab, setActiveHoursSectionTab] = useState<HoursSectionTab>("hours");
  const [hoursRounding, setHoursRounding] = useState<HoursRounding>("actual");
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [employeePendingDeletion, setEmployeePendingDeletion] = useState<Employee | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentRoleDrafts, setDepartmentRoleDrafts] = useState<Record<number, string>>({});
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [departmentNameDraft, setDepartmentNameDraft] = useState("");
  const [copyRange, setCopyRange] = useState<CopyRange>("week");
  const [scheduleDate, setScheduleDate] = useState(today);
  const [hoursDate, setHoursDate] = useState(today);
  const [editingHours, setEditingHours] = useState<{
    employee: Employee;
    hours: string;
    minutes: string;
  } | null>(null);
  const [showHoursChangeWarning, setShowHoursChangeWarning] = useState(false);
  const [ptoRequestForm, setPtoRequestForm] = useState<{
    startDate: string;
    endDate: string;
    reason: PtoRequest["reason"] | "";
    explanation: string;
    useCustomTime: boolean;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [ptoRequestError, setPtoRequestError] = useState("");
  const [reviewingPtoRequestId, setReviewingPtoRequestId] = useState<number | null>(null);
  const [ptoReviewError, setPtoReviewError] = useState("");
  const [arePtoRequestsExpanded, setArePtoRequestsExpanded] = useState(false);
  const [employeeScheduleTab, setEmployeeScheduleTab] = useState<EmployeeScheduleTab>("week");
  const [isEmployeeFilterOpen, setIsEmployeeFilterOpen] = useState(false);
  const [visibleEmployeeIds, setVisibleEmployeeIds] = useState<number[] | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [createShiftError, setCreateShiftError] = useState("");
  const [editShiftError, setEditShiftError] = useState("");
  const [createdShiftTimes, setCreatedShiftTimes] = useState<Record<number, number>>({});
  const [editedShiftTimes, setEditedShiftTimes] = useState<Record<number, number>>({});
  const [unpublishedShiftIds, setUnpublishedShiftIds] = useState<number[]>(() => readStoredUnpublishedShiftIds());
  const [lastEditedShiftId, setLastEditedShiftId] = useState<number | null>(null);
  const [showBreakOptions, setShowBreakOptions] = useState(false);
  const [pendingTimeException, setPendingTimeException] = useState<TimeExceptionAction | null>(null);
  const [timeExceptionExplanation, setTimeExceptionExplanation] = useState("");
  const [selectedEventExplanation, setSelectedEventExplanation] = useState<{
    actualTime: string;
    keyword: string;
    scheduledTime: string;
    text: string;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [repeatDates, setRepeatDates] = useState<string[]>([]);
  const [shiftForm, setShiftForm] = useState({
    id: 0,
    employeeId: 0,
    date: today,
    start: "",
    end: "",
    role: "",
    station: "Floor",
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    window.localStorage.setItem(unpublishedShiftsStorageKey, JSON.stringify(unpublishedShiftIds));
  }, [unpublishedShiftIds]);

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
  const reviewingPtoRequest = (state.ptoRequests ?? []).find((request) => request.id === reviewingPtoRequestId);
  const notificationRequests = (state.ptoRequests ?? [])
    .filter((request) => mode === "manager" || request.employeeId === activeEmployeeId)
    .sort((first, second) => (second.requestedAt ?? "").localeCompare(first.requestedAt ?? ""));
  const pendingNotificationCount = notificationRequests.filter((request) => request.status === "pending").length;
  const teamConversations = (state.conversations ?? [])
    .filter((conversation) => conversation.participantIds.includes(activeEmployeeId))
    .sort((first, second) => conversationLastSentAt(second).localeCompare(conversationLastSentAt(first)));
  const visibleConversations = teamConversations.filter(
    (conversation) => messageFilter === "all" || conversationHasUnreadMessages(conversation, activeEmployeeId),
  );
  const selectedConversation = teamConversations.find((conversation) => conversation.id === selectedConversationId);
  const unreadConversationCount = teamConversations.filter(
    (conversation) => conversationHasUnreadMessages(conversation, activeEmployeeId),
  ).length;
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
  const availableManagers = activeEmployees.filter((employee) => employee.accessLevel === "Manager");
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
  const accessibleShifts = useMemo(
    () => mode === "manager" ? state.shifts : state.shifts.filter((shift) => !unpublishedShiftIds.includes(shift.id)),
    [mode, state.shifts, unpublishedShiftIds],
  );
  const unpublishedShiftCount = state.shifts.filter((shift) => unpublishedShiftIds.includes(shift.id)).length;
  const orderedShiftEmployees = useMemo(() => {
    return [...shiftEmployees].sort((first, second) => first.name.localeCompare(second.name));
  }, [shiftEmployees]);
  const activePermissions = isPublicSchedule ? ["view_schedule" as Permission] : permissionsByMode[mode];
  const visibleNavItems = isPublicSchedule
    ? navItems.filter((item) => item.id === "schedule")
    : navItems.filter((item) => mode === "manager" || !item.managerOnly);
  const copyCalendarDays = useMemo(
    () => copyRange === "week" ? mondayWeekCalendarDays(shiftForm.date) : mondayMonthCalendarDays(shiftForm.date),
    [copyRange, shiftForm.date],
  );
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
        .filter((shift) => shift.date === scheduleDate && shiftEmployeeIds.has(shift.employeeId))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [accessibleShifts, scheduleDate, shiftEmployeeIds],
  );
  const scheduleWeekDays = useMemo(
    () =>
      mondayWeekCalendarDays(scheduleDate).map((day) => ({
        ...day,
        shifts: accessibleShifts
          .filter((shift) => shift.date === day.date && shiftEmployeeIds.has(shift.employeeId))
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds],
  );
  const scheduleMonthDays = useMemo(
    () => scheduleMonthCalendarDays(scheduleDate).map((day) => ({
      ...day,
      shifts: accessibleShifts
        .filter((shift) => shift.date === day.date && shiftEmployeeIds.has(shift.employeeId))
        .sort((a, b) => a.start.localeCompare(b.start)),
    })),
    [accessibleShifts, scheduleDate, shiftEmployeeIds],
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

    return state.employees.map((employee) => {
      const hoursWorked = adjustedWorkedHoursForRange(
        state.clockEvents,
        state.hoursAdjustments ?? [],
        employee.id,
        yearToDate,
        currentTime,
      );

      return {
        employee,
        hoursWorked,
        ptoHours: Math.floor(hoursWorked / 30),
        ptoUsed: ptoHoursUsedThisYear(state.ptoRequests ?? [], employee.id, new Date(currentTime).getFullYear()),
      };
    });
  }, [currentTime, state.clockEvents, state.employees, state.hoursAdjustments, state.ptoRequests]);
  const activeEmployeePto = ptoRows.find((row) => row.employee.id === activeEmployeeId);
  const sortedPtoRequests = useMemo(
    () => (state.ptoRequests ?? [])
      .filter((request) => mode === "manager" || request.employeeId === activeEmployeeId)
      .sort((first, second) => second.requestedAt.localeCompare(first.requestedAt)),
    [activeEmployeeId, mode, state.ptoRequests],
  );
  const displayedPtoRequests = arePtoRequestsExpanded ? sortedPtoRequests : sortedPtoRequests.slice(0, 3);
  const activeEmployeePtoLeft = activeEmployeePto
    ? activeEmployeePto.ptoHours - activeEmployeePto.ptoUsed
    : 0;
  const ptoRequestPreviewHours = ptoRequestForm
    ? ptoHoursForDateRange(
        ptoRequestForm.startDate,
        ptoRequestForm.endDate,
        ptoRequestForm.useCustomTime ? ptoRequestForm.startTime : undefined,
        ptoRequestForm.useCustomTime ? ptoRequestForm.endTime : undefined,
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

    if (pin === managerPin) {
      setIsPublicSchedule(false);
      setMode("manager");
      setActiveEmployeeId(employee?.id ?? 1);
      setActiveView("dashboard");
      setIsUnlocked(true);
      setAuthMessage("Manager mode active. All controls are available.");
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

  function openConversation(conversationId: number) {
    setSelectedConversationId(conversationId);
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
    if (newConversationMemberIds.length === 0) {
      setMessageError("Select at least one team member.");
      return;
    }
    if (!body) {
      setMessageError("Enter a message to start the chat.");
      return;
    }

    const conversationId = nextId(state.conversations ?? []);
    const conversation: TeamConversation = {
      id: conversationId,
      participantIds: Array.from(new Set([activeEmployeeId, ...newConversationMemberIds])),
      messages: [{
        id: 1,
        senderEmployeeId: activeEmployeeId,
        body,
        sentAt: new Date().toISOString(),
        readByEmployeeIds: [activeEmployeeId],
      }],
    };
    setState((current) => ({
      ...current,
      conversations: [...(current.conversations ?? []), conversation],
    }));
    setNewConversationMemberIds([]);
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
    if (view === "hours") setActiveHoursSectionTab("hours");
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

    if (!name || !role || !pin) return;

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
          accessLevel: "Employee",
          location: employeeForm.location,
          role,
          wage: formatWageInput(employeeForm.wage),
          pin,
          active: true,
        },
      ],
    }));
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeMessage("");
    setIsAddingEmployee(false);
  }

  function cancelAddingEmployee() {
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeMessage("");
    setIsAddingEmployee(false);
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
    if (activeEmployeeId === employeeId) {
      setActiveEmployeeId(1);
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
    const numericPin = pin.replace(/\D/g, "");
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, pin: numericPin } : employee,
      ),
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
    if (!shiftEmployeeIds.has(shiftForm.employeeId)) return;

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

    const shiftDates = shiftForm.id
      ? [shiftForm.date]
      : repeatDatesForRange(shiftForm.date, repeatDates, copyRange);
    const duplicateDates = shiftDates.filter((date) =>
      state.shifts.some((shift) =>
        shift.employeeId === shiftForm.employeeId
        && shift.id !== shiftForm.id
        && shift.date === date,
      ),
    );
    if (duplicateDates.length > 0) {
      const duplicateDays = duplicateDates.map((date) => parseLocalDate(date).getDate()).join(", ");
      window.alert(`Shifts already scheduled for: ${duplicateDays}`);
      return;
    }

    const firstCreatedShiftId = nextId(state.shifts);
    const createdShiftIds = shiftForm.id
      ? []
      : shiftDates.map((_, index) => firstCreatedShiftId + index);

    setState((current) => {
      let nextShiftId = nextId(current.shifts);
      const savedShifts = shiftDates.map((date) => ({
        ...shiftForm,
        date,
        start,
        end,
        id: shiftForm.id || nextShiftId++,
      }));
      const shifts = shiftForm.id
        ? current.shifts.map((shift) => (shift.id === shiftForm.id ? savedShifts[0] : shift))
        : [...current.shifts, ...savedShifts];

      return { ...current, shifts };
    });
    if (createdShiftIds.length > 0) {
      const createdAt = Date.now();
      setCreatedShiftTimes((current) => ({
        ...current,
        ...Object.fromEntries(createdShiftIds.map((id) => [id, createdAt])),
      }));
    }
    const changedShiftIds = shiftForm.id ? [shiftForm.id] : createdShiftIds;
    setUnpublishedShiftIds((current) => Array.from(new Set([...current, ...changedShiftIds])));
    setCreateShiftError("");
    setRepeatDates([]);
    setShiftForm({
      id: 0,
      employeeId: 0,
      date: today,
      start: "",
      end: "",
      role: "",
      station: "Floor",
    });
  }

  function toggleRepeatDate(date: string) {
    setShiftForm((form) => ({ ...form, date }));
    setRepeatDates((current) =>
      current.includes(date)
        ? current.filter((entry) => entry !== date)
        : [...current, date].sort(),
    );
  }

  function moveCopyRange(direction: -1 | 1) {
    setRepeatDates([]);
    setShiftForm((form) => ({
      ...form,
      date: shiftDateByRange(form.date, copyRange, direction),
    }));
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

  function openPtoRequest() {
    setPtoRequestForm({
      startDate: today,
      endDate: today,
      reason: "",
      explanation: "",
      useCustomTime: false,
      startTime: "09:00",
      endTime: "17:00",
    });
    setPtoRequestError("");
  }

  function submitPtoRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ptoRequestForm || !activeEmployee || mode !== "employee") return;

    if (!ptoRequestForm.reason) {
      setPtoRequestError("Choose Sick/Emergency or Vacation.");
      return;
    }
    if (ptoRequestForm.endDate < ptoRequestForm.startDate) {
      setPtoRequestError("The end date cannot be before the start date.");
      return;
    }
    if (ptoRequestForm.useCustomTime) {
      const startMinutes = timeToMinutes(ptoRequestForm.startTime);
      const endMinutes = timeToMinutes(ptoRequestForm.endTime);
      if (
        startMinutes === null
        || endMinutes === null
        || startMinutes % 60 !== 0
        || endMinutes % 60 !== 0
      ) {
        setPtoRequestError("PTO can only be requested in whole-hour increments. Choose times ending in :00.");
        return;
      }
      if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
        setPtoRequestError("The end time must be later than the start time.");
        return;
      }
    }
    const requestedPtoHours = ptoHoursForDateRange(
      ptoRequestForm.startDate,
      ptoRequestForm.endDate,
      ptoRequestForm.useCustomTime ? ptoRequestForm.startTime : undefined,
      ptoRequestForm.useCustomTime ? ptoRequestForm.endTime : undefined,
    );
    if (requestedPtoHours <= 0) {
      setPtoRequestError("Choose at least one weekday and a valid amount of PTO time.");
      return;
    }
    const employeePto = ptoRows.find((row) => row.employee.id === activeEmployee.id);
    const ptoHoursLeft = employeePto ? employeePto.ptoHours - employeePto.ptoUsed : 0;
    if (ptoHoursLeft < requestedPtoHours) {
      setPtoRequestError("You do not have enough PTO hours. You cannot submit this request.");
      return;
    }
    const explanation = ptoRequestForm.explanation.trim();
    if (!explanation) {
      setPtoRequestError("An explanation is required.");
      return;
    }

    setState((current) => ({
      ...current,
      ptoRequests: [
        ...(current.ptoRequests ?? []),
        {
          id: nextId(current.ptoRequests ?? []),
          employeeId: activeEmployee.id,
          startDate: ptoRequestForm.startDate,
          endDate: ptoRequestForm.endDate,
          startTime: ptoRequestForm.useCustomTime ? ptoRequestForm.startTime : undefined,
          endTime: ptoRequestForm.useCustomTime ? ptoRequestForm.endTime : undefined,
          reason: ptoRequestForm.reason as PtoRequest["reason"],
          explanation,
          status: "pending",
          requestedAt: new Date().toISOString(),
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
    if (status === "approved" && request.status !== "approved") {
      const employeePto = ptoRows.find((row) => row.employee.id === request.employeeId);
      const ptoHoursLeft = employeePto ? employeePto.ptoHours - employeePto.ptoUsed : 0;
      const requestedHours = ptoHoursForDateRange(
        request.startDate,
        request.endDate,
        request.startTime,
        request.endTime,
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
        request.id === reviewingPtoRequestId ? { ...request, status } : request,
      ),
    }));
    setReviewingPtoRequestId(null);
    setPtoReviewError("");
  }

  function cancelPtoRequest(requestId: number) {
    if (mode !== "employee") return;

    setState((current) => ({
      ...current,
      ptoRequests: (current.ptoRequests ?? []).map((request) =>
        request.id === requestId
        && request.employeeId === activeEmployeeId
        && request.status === "pending"
          ? { ...request, status: "cancelled" }
          : request,
      ),
    }));
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
    setEditingShift(shift);
  }

  function saveEditedShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShift) return;

    const start = parseTypedTime(editingShift.start);
    const end = parseTypedTime(editingShift.end);
    const role = editingShift.role.trim();
    if (!start || !end) {
      setEditShiftError("Enter a valid start and end time.");
      return;
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) {
      setEditShiftError("Start time must be earlier than end time.");
      return;
    }
    if (!role || !shiftEmployeeIds.has(editingShift.employeeId)) return;

    const hasDuplicate = state.shifts.some((shift) =>
      shift.id !== editingShift.id
      && shift.employeeId === editingShift.employeeId
      && shift.date === editingShift.date,
    );
    if (hasDuplicate) {
      window.alert("This employee already has a shift scheduled that day.");
      return;
    }

    setState((current) => ({
      ...current,
      shifts: current.shifts.map((shift) =>
        shift.id === editingShift.id
          ? { ...editingShift, start, end, role }
        : shift,
      ),
    }));
    setEditedShiftTimes((current) => ({ ...current, [editingShift.id]: Date.now() }));
    setUnpublishedShiftIds((current) => Array.from(new Set([...current, editingShift.id])));
    setLastEditedShiftId(editingShift.id);
    setEditShiftError("");
    setEditingShift(null);
  }

  function deleteEditingShift() {
    if (!editingShift) return;
    if (!window.confirm("Are you sure you want to delete this shift?")) return;

    setState((current) => ({
      ...current,
      shifts: current.shifts.filter((shift) => shift.id !== editingShift.id),
    }));
    setUnpublishedShiftIds((current) => current.filter((id) => id !== editingShift.id));
    setEditingShift(null);
  }

  function publishSchedule() {
    if (mode !== "manager") return;
    setUnpublishedShiftIds([]);
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
            onChange={(event) => setPin(event.target.value)}
            placeholder="PIN"
            aria-label="Access PIN"
            inputMode="numeric"
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
                {isTeamNavOpen ? (
                  <div className="sidebar-submenu" id="team-sidebar-menu">
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
                {isScheduleNavOpen ? (
                  <div className="sidebar-submenu" id="schedule-sidebar-menu">
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

          <section className="side-panel" aria-labelledby="permission-title">
            <p className="eyebrow">Permissions</p>
            <h2 id="permission-title">{activeEmployee?.name ?? "Guest"}</h2>
            <div className="permission-list">
              {activePermissions.map((permission) => (
                <span key={permission}>{permissionLabel(permission)}</span>
              ))}
            </div>
          </section>
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
                <div className="message-menu" ref={messageMenuRef}>
                  <button
                    type="button"
                    className="header-icon-button"
                    onClick={() => {
                      if (!isMessagesOpen) {
                        setSelectedConversationId(null);
                        setIsCreatingConversation(false);
                        setMessageError("");
                      }
                      setIsMessagesOpen((open) => !open);
                      setIsNotificationsOpen(false);
                      setIsAccountMenuOpen(false);
                    }}
                    aria-expanded={isMessagesOpen}
                    aria-haspopup="dialog"
                    aria-label="Messages"
                    title="Messages"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                    </svg>
                    {unreadConversationCount > 0 ? (
                      <span className="notification-badge" aria-label={`${unreadConversationCount} unread conversations`}>
                        {unreadConversationCount > 9 ? "9+" : unreadConversationCount}
                      </span>
                    ) : null}
                  </button>
                  {isMessagesOpen ? (
                    <div className="message-dropdown" role="dialog" aria-label="Messages">
                      {isCreatingConversation ? (
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
                      ) : selectedConversation ? (
                        <div className="conversation-view">
                          <div className="message-popout-heading">
                            <button
                              type="button"
                              className="message-back-button"
                              onClick={() => setSelectedConversationId(null)}
                              aria-label="Back to messages"
                            >
                              ←
                            </button>
                            <strong>{conversationTitle(selectedConversation, state.employees, activeEmployeeId)}</strong>
                          </div>
                          <div className="conversation-messages">
                            {selectedConversation.messages.map((message) => (
                              <div
                                className={message.senderEmployeeId === activeEmployeeId ? "team-message own" : "team-message"}
                                key={message.id}
                              >
                                <span>{employeeById(state.employees, message.senderEmployeeId)?.name ?? "Team member"}</span>
                                <p>{message.body}</p>
                                <time dateTime={message.sentAt}>{formatMessageTime(message.sentAt)}</time>
                              </div>
                            ))}
                          </div>
                          <form className="message-reply-form" onSubmit={sendTeamMessage}>
                            <input
                              value={messageDraft}
                              onChange={(event) => setMessageDraft(event.target.value)}
                              placeholder="Write a message"
                              aria-label="Reply message"
                            />
                            <button type="submit" disabled={!messageDraft.trim()}>Send</button>
                          </form>
                        </div>
                      ) : (
                        <>
                          <strong className="notification-title">Messages</strong>
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
                              Unread
                            </button>
                          </div>
                          <div className="message-conversation-list">
                            {visibleConversations.length > 0 ? visibleConversations.map((conversation) => {
                              const lastMessage = conversation.messages.at(-1);
                              return (
                                <button type="button" key={conversation.id} onClick={() => openConversation(conversation.id)}>
                                  <span className="message-member-avatar" aria-hidden="true">
                                    {conversationInitials(conversation, state.employees, activeEmployeeId)}
                                  </span>
                                  <span className="conversation-preview">
                                    <strong>{conversationTitle(conversation, state.employees, activeEmployeeId)}</strong>
                                    <small>{lastMessage?.body ?? "No messages yet"}</small>
                                  </span>
                                  {conversationHasUnreadMessages(conversation, activeEmployeeId) ? (
                                    <span className="unread-dot" aria-label="Unread" />
                                  ) : null}
                                </button>
                              );
                            }) : <p className="notification-empty">No {messageFilter === "unread" ? "unread " : ""}messages.</p>}
                          </div>
                          <button
                            type="button"
                            className="new-message-button"
                            onClick={() => {
                              setIsCreatingConversation(true);
                              setSelectedConversationId(null);
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
                      setIsNotificationsOpen((open) => !open);
                      setIsAccountMenuOpen(false);
                      setIsMessagesOpen(false);
                    }}
                    aria-expanded={isNotificationsOpen}
                    aria-haspopup="dialog"
                    aria-label="Notifications"
                    title="Notifications"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                    </svg>
                    {pendingNotificationCount > 0 ? (
                      <span className="notification-badge" aria-label={`${pendingNotificationCount} pending requests`}>
                        {pendingNotificationCount > 9 ? "9+" : pendingNotificationCount}
                      </span>
                    ) : null}
                  </button>
                  {isNotificationsOpen ? (
                    <div className="notification-dropdown" role="dialog" aria-label="Notifications">
                      <strong className="notification-title">Notifications</strong>
                      <div className="notification-tabs" role="tablist" aria-label="Notification categories">
                        <button
                          type="button"
                          className={activeNotificationTab === "team_requests" ? "active" : ""}
                          onClick={() => setActiveNotificationTab("team_requests")}
                          role="tab"
                          aria-selected={activeNotificationTab === "team_requests"}
                        >
                          Team requests
                        </button>
                        <button
                          type="button"
                          className={activeNotificationTab === "alerts" ? "active" : ""}
                          onClick={() => setActiveNotificationTab("alerts")}
                          role="tab"
                          aria-selected={activeNotificationTab === "alerts"}
                        >
                          Alerts
                        </button>
                      </div>
                      <div className="notification-list">
                        {activeNotificationTab === "team_requests" ? (
                          notificationRequests.length > 0 ? notificationRequests.map((request) => {
                            const employee = employeeById(state.employees, request.employeeId);
                            return (
                              <div className="notification-item" key={request.id}>
                                <strong>{employee?.name ?? "Employee"}</strong>
                                <span>{formatShortDate(request.startDate)} · {capitalize(request.status)}</span>
                              </div>
                            );
                          }) : <p className="notification-empty">No team requests.</p>
                        ) : (
                          <p className="notification-empty">No new alerts.</p>
                        )}
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
                    <button type="button" onClick={() => setActiveView("schedule")}>Manage schedule</button>
                    <button type="button" onClick={() => setActiveView("clockins")}>View clock-ins</button>
                    <button type="button" onClick={() => {
                      setActiveHoursSectionTab("pto");
                      setActiveView("hours");
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
                        onClick={(event) => event.currentTarget.querySelector("select")?.focus()}
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
                        {assignedManagers.length === 0 ? (
                          <select
                            value=""
                            onChange={(event) => {
                              addDepartmentManager(department.id, Number(event.target.value));
                              event.target.value = "";
                            }}
                            aria-label={`Add manager to ${department.name}`}
                          >
                            <option value="">Select manager</option>
                            {availableManagers.map((manager) => (
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
                            <span>Last name</span>
                            <input
                              value={employeeForm.lastName}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, lastName: event.target.value }))}
                              autoComplete="family-name"
                            />
                          </label>
                          <label>
                            <span>Email</span>
                            <input
                              type="email"
                              value={employeeForm.email}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, email: event.target.value }))}
                              autoComplete="email"
                            />
                          </label>
                          <label>
                            <span>Mobile phone number</span>
                            <input
                              type="tel"
                              value={employeeForm.phone}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, phone: formatPhoneNumberInput(event.target.value) }))}
                              placeholder="(___) ___-____"
                              autoComplete="tel"
                              maxLength={14}
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
                          <label>
                            <span>Role <b aria-hidden="true">*</b></span>
                            <select
                              value={employeeForm.role}
                              onChange={(event) => setEmployeeForm((form) => ({ ...form, role: event.target.value }))}
                              required
                            >
                              <option value="">Select</option>
                              {availableRoles.map((role) => (
                                <option value={role} key={role}>{role}</option>
                              ))}
                            </select>
                          </label>
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
                              value={employeeForm.pin}
                              onChange={(event) => setEmployeeForm((form) => ({
                                ...form,
                                pin: event.target.value.replace(/\D/g, ""),
                              }))}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="PIN"
                              required
                            />
                          </label>
                        </div>
                        <div className="team-member-access-level">
                          <span>Access level</span>
                          <strong>Employee</strong>
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
                  {activeEmployees.map((employee) => {
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
                                value={employee.pin}
                                onChange={(event) => updateEmployeePin(employee.id, event.target.value)}
                                aria-label={`PIN for ${employee.name}`}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="PIN"
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
                            <span>Manager</span>
                          ) : isEditing ? (
                            <select
                              value={employee.accessLevel}
                              onChange={(event) => updateEmployeeDetail(employee.id, "accessLevel", event.target.value)}
                              aria-label={`Access level for ${employee.name}`}
                            >
                              <option value="">Select</option>
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
                        <span role="cell" className={employee.active ? "roster-status active" : "roster-status"}>
                          {employee.active ? "Active" : "Terminated"}
                        </span>
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
                        {employee.id !== 1 ? (
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
                <label className="shift-date-control">
                  <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} aria-label="Schedule date" />
                  <strong>{employeeScheduleTab === "day" ? formatLongDate(scheduleDate) : employeeScheduleTab === "month" ? formatMonthYear(scheduleDate) : `${formatShortDate(scheduleWeekDays[0].date)} – ${formatShortDate(scheduleWeekDays[6].date)}`}</strong>
                </label>
                <button type="button" className="shift-arrow-button" onClick={() => moveScheduleDate(-1)} aria-label={`Previous ${employeeScheduleTab}`}>‹</button>
                <button type="button" className="shift-arrow-button" onClick={() => moveScheduleDate(1)} aria-label={`Next ${employeeScheduleTab}`}>›</button>
                <div className="shift-planner-actions">
                  <select className="shift-view-select" value={employeeScheduleTab} onChange={(event) => setEmployeeScheduleTab(event.target.value as EmployeeScheduleTab)} aria-label="Schedule view">
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="day">Day</option>
                  </select>
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
                  {mode === "manager" && unpublishedShiftCount > 0 ? (
                    <button type="button" className="shift-publish-button pending" onClick={publishSchedule}>
                      ↑ Publish ({unpublishedShiftCount})
                    </button>
                  ) : null}
                </div>
              </div>
              {mode === "manager" && (
                <details className="shift-editor-drawer">
                  <summary>Add shift</summary>
                  <form className="quick-form shift-form" onSubmit={saveShift}>
                  <select
                    value={shiftForm.employeeId}
                    onChange={(event) => {
                      const employeeId = Number(event.target.value);
                      const employee = employeeById(shiftEmployees, employeeId);
                      setShiftForm((form) => ({ ...form, employeeId, role: employee?.role ?? form.role }));
                    }}
                    aria-label="Shift employee"
                    disabled={shiftEmployees.length === 0}
                  >
                    <option value={0} disabled>Select Employee</option>
                    {shiftEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                  <TimeInput
                    value={shiftForm.start}
                    onChange={(start) => setShiftForm((form) => ({ ...form, start }))}
                    ariaLabel="Shift start"
                    placeholder="Start time"
                  />
                  <TimeInput
                    value={shiftForm.end}
                    onChange={(end) => setShiftForm((form) => ({ ...form, end }))}
                    ariaLabel="Shift end"
                    placeholder="End time"
                  />
                  <select
                    value={shiftForm.role}
                    onChange={(event) => setShiftForm((form) => ({ ...form, role: event.target.value }))}
                    aria-label="Shift role"
                  >
                    <option value="">Select role</option>
                    {availableRoles.map((role) => (
                      <option value={role} key={role}>{role}</option>
                    ))}
                  </select>
                  <fieldset className="copy-calendar" disabled={Boolean(shiftForm.id)}>
                    <legend>{copyRange === "week" ? "Week" : "Month"}</legend>
                    <div className="copy-calendar-toolbar">
                      <button
                        type="button"
                        onClick={() => moveCopyRange(-1)}
                        aria-label={`Previous ${copyRange}`}
                      >
                        <span aria-hidden="true">&lt;</span>
                      </button>
                      <strong>
                        {copyRange === "week" ? `Week of ${formatShortDate(shiftForm.date)}` : formatMonthYear(shiftForm.date)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => moveCopyRange(1)}
                        aria-label={`Next ${copyRange}`}
                      >
                        <span aria-hidden="true">&gt;</span>
                      </button>
                    </div>
                    <div className="copy-range-tabs" role="tablist" aria-label="Copy shift range">
                      {(["week", "month"] as CopyRange[]).map((range) => (
                        <button
                          type="button"
                          key={range}
                          className={copyRange === range ? "active" : ""}
                          onClick={() => {
                            setCopyRange(range);
                            setRepeatDates([]);
                          }}
                          role="tab"
                          aria-selected={copyRange === range}
                        >
                          {capitalize(range)}
                        </button>
                      ))}
                    </div>
                    <div className="copy-calendar-weekdays" aria-hidden="true">
                      {calendarWeekdayLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                    <div className="copy-calendar-grid">
                      {copyCalendarDays.map((day, index) =>
                        day ? (
                          <label
                            key={day.date}
                            className={repeatDates.includes(day.date) ? "active" : ""}
                            title={formatLongDate(day.date)}
                          >
                            <input
                              type="checkbox"
                              checked={repeatDates.includes(day.date)}
                              onChange={() => toggleRepeatDate(day.date)}
                            />
                            <span>{day.day}</span>
                          </label>
                        ) : (
                          <span key={`blank-${index}`} aria-hidden="true" />
                        ),
                      )}
                    </div>
                  </fieldset>
                  <button type="submit" disabled={shiftEmployees.length === 0}>Save</button>
                  {createShiftError ? <p className="shift-error-message" role="alert">{createShiftError}</p> : null}
                  </form>
                </details>
              )}
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
                                      className={`${mode === "employee" && shift.employeeId === activeEmployeeId ? "schedule-bar mine" : "schedule-bar"}${mode === "manager" ? " editable" : ""}`}
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

                                return (
                                  <div className="shift-week-cell" role="cell" key={day.date}>
                                    {dayShifts.map((shift) => (
                                      <button
                                        type="button"
                                        className={`shift-week-card${mode === "employee" && shift.employeeId === activeEmployeeId ? " mine" : ""}${mode === "manager" ? " editable" : ""}`}
                                        key={shift.id}
                                        onClick={() => openShiftEditor(shift)}
                                      >
                                        <strong>{formatCompactTimeRange(shift)}</strong>
                                        <span>{shift.role || "Shift"}</span>
                                      </button>
                                    ))}
                                    {dayShifts.length === 0 && timeOff ? (
                                      <div className="shift-time-off"><strong>⊘ Time off</strong><span>▣ {timeOff.startTime && timeOff.endTime ? `${formatTime12(timeOff.startTime)}–${formatTime12(timeOff.endTime)}` : "All day"}</span></div>
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

                          return (
                            <div className={`${day.date === today ? "shift-month-day today" : "shift-month-day"}${day.inMonth ? "" : " outside"}`} key={day.date}>
                              <button type="button" className="shift-month-date" onClick={() => { setScheduleDate(day.date); setEmployeeScheduleTab("day"); }}>
                                {day.day === "1" ? `${parseLocalDate(day.date).toLocaleDateString("en-US", { month: "short" })} 1` : day.day}
                              </button>
                              {visibleDayShifts.map((shift) => {
                                const employee = employeeById(state.employees, shift.employeeId);
                                return (
                                  <button type="button" className={`shift-month-card${mode === "employee" && shift.employeeId === activeEmployeeId ? " mine" : ""}`} key={shift.id} onClick={() => openShiftEditor(shift)}>
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
              <PanelHeading eyebrow="History" title="Employee clock-ins" />
              <div className="clock-table" role="table" aria-label="Clock-in history">
                <div role="row" className="table-head">
                  <span>Employee</span>
                  <span>Role</span>
                  <span>Event</span>
                  <span>Time</span>
                  <span>Explanation</span>
                </div>
                {state.clockEvents.map((event) => {
                  const employee = employeeById(state.employees, event.employeeId);
                  const explanation = eventExplanationDisplay(event, state.shifts, state.clockEvents);
                  return (
                    <div role="row" key={event.id}>
                      <span>{employee?.name ?? "Unknown"}</span>
                      <span>{employee?.role ?? "Unassigned"}</span>
                      <span>{clockEventLabel(event)}</span>
                      <span>{formatDateTime(event.at)}</span>
                      <span className={explanation.isException ? "event-explanation exception" : "event-explanation"}>
                        {explanation.isException ? (
                          <button
                            type="button"
                            className="event-explanation-panel"
                            onClick={() => setSelectedEventExplanation(explanation)}
                            aria-label={`View details for ${explanation.keyword}`}
                          >
                            <strong>{explanation.keyword}</strong>
                          </button>
                        ) : (
                          <span>{explanation.text}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
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
              <div className="pto-request-section">
                <div>
                  <p className="eyebrow">Time off requests</p>
                  {mode === "manager" ? <h3>Employee Requests</h3> : null}
                </div>
                {mode === "employee" ? (
                  <button type="button" onClick={openPtoRequest}>Request PTO</button>
                ) : null}
              </div>
              <div className="pto-request-list">
                {displayedPtoRequests.map((request) => {
                    const employee = employeeById(state.employees, request.employeeId);
                    return (
                      <article className={`pto-request-card${mode === "manager" && request.status !== "cancelled" ? " reviewable" : ""}`} key={request.id}>
                        <strong className="pto-request-employee">{employee?.name ?? "Employee"}</strong>
                        <dl className="pto-request-fields">
                          <div>
                            <dt>Date requested off:</dt>
                            <dd>{formatShortDate(request.startDate)}{request.endDate !== request.startDate ? ` - ${formatShortDate(request.endDate)}` : ""}</dd>
                          </div>
                          {request.startTime && request.endTime ? (
                            <div>
                              <dt>Time requested:</dt>
                              <dd>{formatTime12(request.startTime)} - {formatTime12(request.endTime)}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>Reason:</dt>
                            <dd>{request.reason === "vacation" ? "Vacation" : "Sick / Emergency"}</dd>
                          </div>
                          <div>
                            <dt>Explanation:</dt>
                            <dd>{request.explanation}</dd>
                          </div>
                        </dl>
                        <span className="pto-request-timestamp">Requested at {formatDateTime(request.requestedAt)}</span>
                        <div className="pto-request-card-actions">
                          {mode === "employee" && request.status === "pending" ? (
                            <button type="button" className="pto-cancel-action" onClick={() => cancelPtoRequest(request.id)}>Cancel</button>
                          ) : null}
                          <span className={`pto-request-status ${request.status}`}>{capitalize(request.status)}</span>
                        </div>
                        {mode === "manager" && request.status !== "cancelled" ? (
                          <button
                            type="button"
                            className="pto-request-panel-button"
                            onClick={() => {
                              setPtoReviewError("");
                              setReviewingPtoRequestId(request.id);
                            }}
                            aria-label={`Review ${employee?.name ?? "employee"} PTO request`}
                          />
                        ) : null}
                      </article>
                    );
                  })}
                {sortedPtoRequests.length === 0 ? (
                  <EmptyState text="No PTO requests submitted." />
                ) : null}
                {sortedPtoRequests.length > 3 ? (
                  <button
                    type="button"
                    className="pto-requests-expand-button"
                    onClick={() => setArePtoRequestsExpanded((current) => !current)}
                    aria-expanded={arePtoRequestsExpanded}
                    aria-label={arePtoRequestsExpanded ? "Hide older time off requests" : "Show older time off requests"}
                  >
                    <span aria-hidden="true">{arePtoRequestsExpanded ? "⌃" : "⌄"}</span>
                  </button>
                ) : null}
              </div>
              <div className="pto-balance-section">
                <div className="panel-heading pto-heading">
                  <div>
                    <p className="eyebrow">Paid time off</p>
                    <p>Employees earn 1 hour of PTO for every 30 hours worked.</p>
                    <p className="pto-usage-note">Approved requests use 8 PTO hours per weekday.</p>
                  </div>
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
                      <strong role="cell">{formatWorkedHours(hoursWorked)}</strong>
                      <strong role="cell" className="pto-earned">{ptoHours} hrs</strong>
                      <strong role="cell">{formatPtoHours(ptoUsed)}</strong>
                      <strong role="cell" className="pto-left">{formatPtoHours(ptoHours - ptoUsed)}</strong>
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
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {mode === "manager" && employeePendingDeletion ? (
        <div className="modal-backdrop" role="presentation">
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

      {mode === "manager" && reviewingPtoRequest ? (
        <div className="modal-backdrop" role="presentation">
          <div className="pto-review-modal" role="dialog" aria-modal="true" aria-labelledby="pto-review-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PTO request</p>
                <h2 id="pto-review-title">{employeeById(state.employees, reviewingPtoRequest.employeeId)?.name ?? "Employee"}</h2>
              </div>
              <button type="button" onClick={() => setReviewingPtoRequestId(null)} aria-label="Close PTO review">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <dl className="pto-review-details">
              <div>
                <dt>Date requested off</dt>
                <dd>{formatShortDate(reviewingPtoRequest.startDate)}{reviewingPtoRequest.endDate !== reviewingPtoRequest.startDate ? ` - ${formatShortDate(reviewingPtoRequest.endDate)}` : ""}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{reviewingPtoRequest.reason === "vacation" ? "Vacation" : "Sick / Emergency"}</dd>
              </div>
              {reviewingPtoRequest.startTime && reviewingPtoRequest.endTime ? (
                <div>
                  <dt>Time requested</dt>
                  <dd>{formatTime12(reviewingPtoRequest.startTime)} - {formatTime12(reviewingPtoRequest.endTime)}</dd>
                </div>
              ) : null}
            </dl>
            <div className="pto-review-explanation">
              <strong>Explanation</strong>
              <p>{reviewingPtoRequest.explanation}</p>
            </div>
            <p className="pto-review-prompt">Approve or deny this PTO request?</p>
            {ptoReviewError ? <p className="shift-error-message" role="alert">{ptoReviewError}</p> : null}
            <div className="pto-review-actions">
              <button type="button" className="approve-action" onClick={() => decidePtoRequest("approved")}>Approve</button>
              <button type="button" className="deny-action" onClick={() => decidePtoRequest("denied")}>Deny</button>
            </div>
          </div>
        </div>
      ) : null}

      {mode === "employee" && ptoRequestForm ? (
        <div className="modal-backdrop" role="presentation">
          <form className="pto-request-modal" onSubmit={submitPtoRequest} role="dialog" aria-modal="true" aria-labelledby="pto-request-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Paid time off</p>
                <h2 id="pto-request-title">Request PTO</h2>
              </div>
              <button type="button" onClick={() => setPtoRequestForm(null)} aria-label="Close PTO request">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
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
            <label className="pto-custom-time-toggle">
              <input
                type="checkbox"
                checked={ptoRequestForm.useCustomTime}
                onChange={(event) => setPtoRequestForm((form) => form ? { ...form, useCustomTime: event.target.checked } : form)}
              />
              <span>Specify hours instead of requesting full days</span>
            </label>
            {ptoRequestForm.useCustomTime ? (
              <div className="pto-request-times">
                <label>
                  <span>Start time</span>
                  <input
                    type="time"
                    step="3600"
                    value={ptoRequestForm.startTime}
                    onChange={(event) => setPtoRequestForm((form) => form ? { ...form, startTime: event.target.value } : form)}
                    required
                  />
                </label>
                <label>
                  <span>End time</span>
                  <input
                    type="time"
                    step="3600"
                    value={ptoRequestForm.endTime}
                    onChange={(event) => setPtoRequestForm((form) => form ? { ...form, endTime: event.target.value } : form)}
                    required
                  />
                </label>
              </div>
            ) : (
              <p className="pto-full-shift-note">Full-day requests use 8 PTO hours per selected weekday.</p>
            )}
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
              <span>Explanation</span>
              <textarea
                value={ptoRequestForm.explanation}
                onChange={(event) => setPtoRequestForm((form) => form ? { ...form, explanation: event.target.value } : form)}
                placeholder="Explain your PTO request"
                maxLength={timeExceptionExplanationLimit}
                required
              />
              <small>{ptoRequestForm.explanation.length}/{timeExceptionExplanationLimit}</small>
            </label>
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
            {ptoRequestError ? <p className="shift-error-message" role="alert">{ptoRequestError}</p> : null}
            <div className="hours-edit-actions">
              <button type="button" onClick={() => setPtoRequestForm(null)}>Cancel</button>
              <button type="submit">Submit request</button>
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
            <select
              value={editingShift.employeeId}
              onChange={(event) => {
                const employeeId = Number(event.target.value);
                const employee = employeeById(shiftEmployees, employeeId);
                setEditingShift((shift) => shift ? { ...shift, employeeId, role: employee?.role ?? shift.role } : shift);
              }}
              aria-label="Edit shift employee"
            >
              {shiftEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={editingShift.date}
              onChange={(event) => setEditingShift((shift) => shift ? { ...shift, date: event.target.value } : shift)}
              aria-label="Edit shift date"
            />
            <TimeInput
              value={editingShift.start}
              onChange={(start) => setEditingShift((shift) => shift ? { ...shift, start } : shift)}
              ariaLabel="Edit shift start"
              placeholder="Start time"
              selectOnFocus
            />
            <TimeInput
              value={editingShift.end}
              onChange={(end) => setEditingShift((shift) => shift ? { ...shift, end } : shift)}
              ariaLabel="Edit shift end"
              placeholder="End time"
              selectOnFocus
            />
            <select
              value={editingShift.role}
              onChange={(event) => setEditingShift((shift) => shift ? { ...shift, role: event.target.value } : shift)}
              aria-label="Edit shift role"
            >
              <option value="">Select role</option>
              {availableRoles.map((role) => (
                <option value={role} key={role}>{role}</option>
              ))}
            </select>
            {editShiftError ? <p className="shift-error-message" role="alert">{editShiftError}</p> : null}
            <div className="modal-actions">
              <button type="button" className="delete-action" onClick={deleteEditingShift}>Delete</button>
              <button type="button" onClick={() => setEditingShift(null)}>Cancel</button>
              <button type="submit">Save changes</button>
            </div>
          </form>
        </div>
      ) : null}

      {selectedEventExplanation ? (
        <div className="modal-backdrop" role="presentation">
          <div className="event-detail-modal" role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Event details</p>
                <h2 id="event-detail-title">{selectedEventExplanation.keyword}</h2>
              </div>
              <button type="button" onClick={() => setSelectedEventExplanation(null)} aria-label="Close event details">
                &times;
              </button>
            </div>
            <dl className="event-detail-list">
              <div>
                <dt>Scheduled</dt>
                <dd>{selectedEventExplanation.scheduledTime}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{selectedEventExplanation.actualTime}</dd>
              </div>
            </dl>
            <div className="event-detail-explanation">
              <p className="eyebrow">Explanation</p>
              <p>{selectedEventExplanation.text}</p>
            </div>
          </div>
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
  return employee.pin === managerPin;
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

function clockEventLabel(event: ClockEvent) {
  if (event.type === "in") return "Clock in";
  if (event.type === "out") return "Clock out";
  if (event.type === "break_end") return `${breakDurationLabel(event)} break ended`;
  return `${breakDurationLabel(event)} break started`;
}

function eventExplanationDisplay(event: ClockEvent, shifts: Shift[], events: ClockEvent[]) {
  const text = event.explanation?.trim();
  if (!text) {
    return {
      actualTime: "",
      isException: false,
      keyword: "",
      scheduledTime: "",
      text: "n/a",
    };
  }

  return {
    actualTime: formatClockTime(event.at),
    isException: true,
    keyword: eventExceptionKeyword(event, shifts),
    scheduledTime: scheduledEventTimeLabel(event, shifts, events),
    text,
  };
}

function scheduledEventTimeLabel(event: ClockEvent, shifts: Shift[], events: ClockEvent[]) {
  if (event.type === "break_end") {
    const breakStart = matchingBreakStartEvent(event, events);
    const breakEnd = breakStart ? breakEndTime(breakStart) : undefined;
    return breakEnd ? formatClockTime(breakEnd.toISOString()) : "n/a";
  }

  const shift = shiftForClockEvent(event, shifts);
  if (!shift) return "n/a";

  const scheduledTime = event.type === "in" ? shiftStartDateTime(shift) : shiftEndDateTime(shift);
  return formatClockTime(scheduledTime.toISOString());
}

function eventExceptionKeyword(event: ClockEvent, shifts: Shift[]) {
  if (event.type === "break_end") return "returned from break late";
  if (event.type === "break") return "started break exception";

  const shift = shiftForClockEvent(event, shifts);
  if (!shift) return "no scheduled shift";

  const eventTime = new Date(event.at).getTime();
  const scheduledTime = event.type === "in"
    ? shiftStartDateTime(shift).getTime()
    : shiftEndDateTime(shift).getTime();
  const timing = timingStatus(eventTime, scheduledTime);

  if (event.type === "in") return `clocked in ${timing}`;
  return `clocked out ${timing}`;
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

  try {
    const parsed = JSON.parse(stored) as StaffState;
    const employees = parsed.employees
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
            ? "Manager"
            : normalizedEmployee.accessLevel === "Employee" ? "Employee" : "",
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
      managerIds: employees.filter((employee) => employee.accessLevel === "Manager").map((employee) => employee.id),
    };
    const departments = [
      unassignedDepartment ?? fallbackDepartment,
      ...savedDepartments.filter((department) => department !== unassignedDepartment),
    ];

    return {
      ...parsed,
      employees,
      departments,
      shifts: parsed.shifts.filter((shift) => employeeIds.has(shift.employeeId)),
      clockEvents: parsed.clockEvents.filter((event) => employeeIds.has(event.employeeId)),
      hoursAdjustments: (parsed.hoursAdjustments ?? []).filter((adjustment) => employeeIds.has(adjustment.employeeId)),
      ptoRequests: (parsed.ptoRequests ?? []).filter((request) => employeeIds.has(request.employeeId)),
      conversations: (parsed.conversations ?? [])
        .map((conversation) => ({
          ...conversation,
          participantIds: conversation.participantIds.filter((employeeId) => employeeIds.has(employeeId)),
          messages: (conversation.messages ?? []).map((message) => ({
            ...message,
            readByEmployeeIds: message.readByEmployeeIds ?? [],
          })),
        }))
        .filter((conversation) => conversation.participantIds.length > 0),
    };
  } catch {
    window.localStorage.removeItem(storageKey);
    return starterState;
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

function repeatDatesForRange(date: string, dates: string[], range: CopyRange) {
  if (dates.length === 0) return [date];

  const { start, end } = dateRangeForCalendarTab(parseLocalDate(date), range);
  const selectedDates = dates.filter((entry) => {
    const selectedDate = parseLocalDate(entry);
    return selectedDate >= start && selectedDate <= end;
  });

  return selectedDates.length > 0 ? selectedDates : [date];
}

function shiftDateByRange(date: string, range: CopyRange, direction: -1 | 1) {
  const selectedDate = parseLocalDate(date);

  if (range === "week") {
    selectedDate.setDate(selectedDate.getDate() + direction * 7);
  } else {
    selectedDate.setMonth(selectedDate.getMonth() + direction);
  }

  return toDateInputValue(selectedDate);
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

function mondayMonthCalendarDays(date: string) {
  const selectedDate = parseLocalDate(date);
  const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const days: ({ date: string; day: string } | null)[] = [];

  for (let index = 0; index < (firstDay.getDay() + 6) % 7; index += 1) days.push(null);
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const calendarDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    days.push({ date: toDateInputValue(calendarDate), day: day.toString() });
  }

  return days;
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
  return conversation.messages.some(
    (message) => message.senderEmployeeId !== employeeId && !message.readByEmployeeIds.includes(employeeId),
  );
}

function conversationTitle(conversation: TeamConversation, employees: Employee[], activeEmployeeId: number) {
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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function ptoHoursUsedThisYear(requests: PtoRequest[], employeeId: number, year: number) {
  return requests
    .filter((request) => request.employeeId === employeeId && request.status === "approved")
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
        request.startTime,
        request.endTime,
      );
    }, 0);
}

function ptoHoursForDateRange(startDate: string, endDate: string, startTime?: string, endTime?: string) {
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  let weekdays = 0;

  while (current <= end) {
    if (current.getDay() !== 0 && current.getDay() !== 6) weekdays += 1;
    current.setDate(current.getDate() + 1);
  }

  const startMinutes = startTime ? timeToMinutes(startTime) : null;
  const endMinutes = endTime ? timeToMinutes(endTime) : null;
  const hoursPerDay = startMinutes !== null && endMinutes !== null
    ? Math.max(0, endMinutes - startMinutes) / 60
    : 8;

  return weekdays * hoursPerDay;
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

function roundHoursToMinutes(hours: number, minutes: HoursRounding) {
  if (minutes === "actual") return hours;

  const totalMinutes = hours * 60;
  const lowerMinutes = Math.floor(totalMinutes / minutes) * minutes;
  const shouldRoundUp = totalMinutes - lowerMinutes >= minutes / 2;
  const roundedMinutes = shouldRoundUp ? lowerMinutes + minutes : lowerMinutes;

  return roundedMinutes / 60;
}

function permissionLabel(permission: Permission) {
  return permission.replaceAll("_", " ");
}

function SidebarNavIcon({ icon }: { icon: string }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      {icon === "gear" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      ) : icon}
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

function TimeInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  selectOnFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  selectOnFocus?: boolean;
}) {
  const [draft, setDraft] = useState(() => (value ? formatTime12(value) : ""));

  useEffect(() => {
    setDraft(value ? formatTime12(value) : "");
  }, [value]);

  function commitTime() {
    if (!draft.trim()) {
      onChange("");
      setDraft("");
      return;
    }

    const parsed = parseTypedTime(draft);
    if (!parsed) {
      setDraft(value ? formatTime12(value) : "");
      return;
    }

    onChange(parsed);
    setDraft(formatTime12(parsed));
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        if (selectOnFocus) event.currentTarget.select();
      }}
      onClick={(event) => {
        if (selectOnFocus) event.currentTarget.select();
      }}
      onBlur={commitTime}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commitTime();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      inputMode="text"
    />
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
