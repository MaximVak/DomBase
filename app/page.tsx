"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type Mode = "manager" | "employee";
type ViewId = "dashboard" | "employees" | "schedule" | "clockins" | "hours";
type CalendarTab = "today" | "week" | "month";
type CopyRange = "week" | "month";
type EmployeeScheduleTab = "day" | "week";
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
  role: string;
  pin: string;
  active: boolean;
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

type StaffState = {
  employees: Employee[];
  shifts: Shift[];
  clockEvents: ClockEvent[];
};

const managerPin = "0000";
const storageKey = "dombase-staff-state-v1";
const timeExceptionExplanationLimit = 250;
const calendarWeekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const scheduleStartHour = 6;
const scheduleEndHour = 18;
const scheduleHourLabels = Array.from(
  { length: (scheduleEndHour - scheduleStartHour) / 2 + 1 },
  (_, index) => scheduleStartHour + index * 2,
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
  employee: ["clock_self", "view_schedule"],
};

const navItems: { id: ViewId; label: string; icon: string; managerOnly?: boolean }[] = [
  { id: "dashboard", label: "Calendar", icon: "C" },
  { id: "schedule", label: "Schedule", icon: "S" },
  { id: "hours", label: "Hours", icon: "H", managerOnly: true },
  { id: "clockins", label: "Events", icon: "E", managerOnly: true },
  { id: "employees", label: "Team", icon: "T", managerOnly: true },
];

const starterState: StaffState = {
  employees: [
    { id: 1, name: "Serge Vakulchik", role: "Manager", pin: "0000", active: true },
  ],
  shifts: [],
  clockEvents: [],
};

export default function Home() {
  const today = getLocalDateValue();
  const [state, setState] = useState<StaffState>(() => readStoredState());
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>("employee");
  const [pin, setPin] = useState("");
  const [activeEmployeeId, setActiveEmployeeId] = useState<number>(1);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [activeCalendarTab, setActiveCalendarTab] = useState<CalendarTab>("today");
  const [activeHoursTab, setActiveHoursTab] = useState<CalendarTab>("today");
  const [hoursRounding, setHoursRounding] = useState<HoursRounding>("actual");
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ name: "", role: "", pin: "" });
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [copyRange, setCopyRange] = useState<CopyRange>("week");
  const [scheduleDate, setScheduleDate] = useState(today);
  const [hoursDate, setHoursDate] = useState(today);
  const [employeeScheduleTab, setEmployeeScheduleTab] = useState<EmployeeScheduleTab>("day");
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
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
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeEmployee = state.employees.find((employee) => employee.id === activeEmployeeId);
  const activeEmployees = useMemo(
    () => state.employees.filter((employee) => employee.active),
    [state.employees],
  );
  const shiftEmployees = useMemo(
    () => activeEmployees.filter((employee) => !isManagerEmployee(employee)),
    [activeEmployees],
  );
  const shiftEmployeeIds = useMemo(
    () => new Set(shiftEmployees.map((employee) => employee.id)),
    [shiftEmployees],
  );
  const activePermissions = permissionsByMode[mode];
  const visibleNavItems = navItems.filter((item) => mode === "manager" || !item.managerOnly);
  const copyCalendarDays = useMemo(
    () => copyRange === "week" ? weekCalendarDays(shiftForm.date) : monthCalendarDays(shiftForm.date),
    [copyRange, shiftForm.date],
  );
  const todaysShifts = state.shifts
    .filter((shift) => shift.date === today && shiftEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  const calendarShifts = useMemo(
    () =>
      shiftsForCalendarRange(state.shifts, shiftEmployeeIds, today, activeCalendarTab).sort(
        (a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
      ),
    [activeCalendarTab, shiftEmployeeIds, state.shifts, today],
  );
  const scheduleDayShifts = useMemo(
    () =>
      state.shifts
        .filter((shift) => shift.date === scheduleDate && shiftEmployeeIds.has(shift.employeeId))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [scheduleDate, shiftEmployeeIds, state.shifts],
  );
  const scheduleDayEmployeeIds = useMemo(
    () => new Set(scheduleDayShifts.map((shift) => shift.employeeId)),
    [scheduleDayShifts],
  );
  const scheduleWeekDays = useMemo(
    () =>
      weekCalendarDays(scheduleDate).map((day) => ({
        ...day,
        shifts: state.shifts
          .filter((shift) => shift.date === day.date && shiftEmployeeIds.has(shift.employeeId))
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [scheduleDate, shiftEmployeeIds, state.shifts],
  );
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
    () =>
      shiftEmployees.map((employee) => ({
        employee,
        hours: roundHoursToMinutes(
          workedHoursForRange(
            state.clockEvents,
            employee.id,
            dateRangeForCalendarTab(parseLocalDate(hoursDate), activeHoursTab),
            currentTime,
          ),
          hoursRounding,
        ),
      })),
    [activeHoursTab, currentTime, hoursDate, hoursRounding, shiftEmployees, state.clockEvents],
  );

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
      setMode("manager");
      setActiveEmployeeId(employee?.id ?? 1);
      setActiveView("dashboard");
      setIsUnlocked(true);
      setAuthMessage("Manager mode active. All controls are available.");
      setPin("");
      return;
    }

    if (employee) {
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

  function signOut() {
    setIsUnlocked(false);
    setMode("employee");
    setActiveEmployeeId(1);
    setActiveView("dashboard");
    setPin("");
    setAuthMessage("");
  }

  function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = employeeForm.name.trim();
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
          role,
          pin,
          active: true,
        },
      ],
    }));
    setEmployeeForm({ name: "", role: "", pin: "" });
    setEmployeeMessage("");
  }

  function removeEmployee(employeeId: number) {
    if (!window.confirm("Are you sure you want to remove this employee?")) {
      return;
    }

    if (activeEmployeeId === employeeId) {
      setActiveEmployeeId(1);
    }

    setState((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== employeeId),
      shifts: current.shifts.filter((shift) => shift.employeeId !== employeeId),
      clockEvents: current.clockEvents.filter((event) => event.employeeId !== employeeId),
    }));
    setEmployeeMessage("");
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
    setState((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === employeeId ? { ...employee, pin } : employee,
      ),
    }));
  }

  function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shiftEmployeeIds.has(shiftForm.employeeId)) return;

    const start = parseTypedTime(shiftForm.start);
    const end = parseTypedTime(shiftForm.end);
    if (!start || !end) return;

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
    nextDate.setDate(nextDate.getDate() + direction * (employeeScheduleTab === "week" ? 7 : 1));
    setScheduleDate(toDateInputValue(nextDate));
  }

  function moveHoursDate(direction: -1 | 1) {
    setHoursDate((date) => shiftDateByCalendarTab(date, activeHoursTab, direction));
  }

  function openShiftEditor(shift: Shift) {
    if (mode !== "manager") return;
    setEditingShift(shift);
  }

  function saveEditedShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShift) return;

    const start = parseTypedTime(editingShift.start);
    const end = parseTypedTime(editingShift.end);
    const role = editingShift.role.trim();
    if (!start || !end || !role || !shiftEmployeeIds.has(editingShift.employeeId)) return;

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
    setEditingShift(null);
  }

  function deleteEditingShift() {
    if (!editingShift) return;
    if (!window.confirm("Are you sure you want to delete this shift?")) return;

    setState((current) => ({
      ...current,
      shifts: current.shifts.filter((shift) => shift.id !== editingShift.id),
    }));
    setEditingShift(null);
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
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f2f7fc] text-[#12213a]">
      <div className="app-frame">
        <aside className="sidebar" aria-label="DomBase staff sections">
          <div className="brand-lockup" aria-label="DomBase workforce">
            <span className="brand-mark">D</span>
            <div>
              <p className="eyebrow">Workforce</p>
              <h1>DomBase</h1>
            </div>
          </div>

          <section className="pin-panel" aria-label="Signed in user">
            <div>
              <p className="eyebrow">Access</p>
              <h2>{mode === "manager" ? "Manager mode" : "Employee mode"}</h2>
            </div>
            <button type="button" className="sign-out-button" onClick={signOut}>Logout</button>
            <p>{authMessage}</p>
          </section>

          <nav className="nav-list">
            {visibleNavItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={activeView === item.id ? "nav-button active" : "nav-button"}
                onClick={() => setActiveView(item.id)}
                aria-pressed={activeView === item.id}
                title={item.label}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
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
              <h2>{activeViewLabel(activeView)}</h2>
            </div>
            <p className="welcome-message">{activeEmployee?.name ?? "Guest"}</p>
          </header>

          {activeView === "dashboard" && (
            <section className="summary-strip" aria-label="Staff summary">
              <div>
                <p className="eyebrow">Live floor</p>
                <h3>{clockedInIds.size} clocked in across {todaysShifts.length} scheduled shifts.</h3>
              </div>
              <div className="summary-metrics">
                <Metric label="Employees" value={shiftEmployees.length.toString()} />
                <Metric label="Roles" value={new Set(shiftEmployees.map((employee) => employee.role)).size.toString()} />
                <Metric label="Clock events" value={state.clockEvents.length.toString()} />
              </div>
            </section>
          )}

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
                    <Metric label="Active employees" value={shiftEmployees.length.toString()} />
                    <Metric label="Scheduled today" value={todaysShifts.length.toString()} />
                    <Metric label="Clocked in" value={clockedInIds.size.toString()} />
                  </div>
                  <div className="control-grid">
                    <button type="button" onClick={() => setActiveView("employees")}>Manage employees</button>
                    <button type="button" onClick={() => setActiveView("schedule")}>Manage schedule</button>
                    <button type="button" onClick={() => setActiveView("clockins")}>View clock-ins</button>
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

          {activeView === "employees" && mode === "manager" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="People" title="Employees and roles" />
              <form className="quick-form employee-form" onSubmit={addEmployee}>
                <input
                  value={employeeForm.name}
                  onChange={(event) => setEmployeeForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Employee name"
                  aria-label="Employee name"
                />
                <input
                  value={employeeForm.role}
                  onChange={(event) => setEmployeeForm((form) => ({ ...form, role: event.target.value }))}
                  placeholder="Role"
                  aria-label="Employee role"
                />
                <input
                  value={employeeForm.pin}
                  onChange={(event) => setEmployeeForm((form) => ({ ...form, pin: event.target.value }))}
                  placeholder="PIN"
                  aria-label="Employee PIN"
                  inputMode="numeric"
                />
                <button type="submit">Add</button>
              </form>
              {employeeMessage ? <p className="form-message" role="alert">{employeeMessage}</p> : null}
              <div className="employee-grid">
                {activeEmployees.map((employee) => (
                  <article className="employee-card" key={employee.id}>
                    <div className="employee-fields">
                      <div className="employee-field">
                        <span>Name:</span>
                        {editingEmployeeId === employee.id ? (
                          <input
                            value={employee.name}
                            onChange={(event) => updateEmployeeName(employee.id, event.target.value)}
                            aria-label={`Name for ${employee.name}`}
                          />
                        ) : (
                          <h3>{employee.name}</h3>
                        )}
                      </div>
                      <div className="employee-field">
                        <span>Role:</span>
                        {editingEmployeeId === employee.id ? (
                          <input
                            value={employee.role}
                            onChange={(event) => updateRole(employee.id, event.target.value)}
                            aria-label={`Role for ${employee.name}`}
                          />
                        ) : (
                          <p>{employee.role}</p>
                        )}
                      </div>
                      <div className="employee-field">
                        <span>PIN:</span>
                        {editingEmployeeId === employee.id ? (
                          <input
                            value={employee.pin}
                            onChange={(event) => updateEmployeePin(employee.id, event.target.value)}
                            aria-label={`PIN for ${employee.name}`}
                            inputMode="numeric"
                          />
                        ) : (
                          <p>{employee.pin}</p>
                        )}
                      </div>
                    </div>
                    {employee.active && employee.id !== 1 ? (
                      <div className="employee-actions">
                        <button
                          type="button"
                          className="employee-edit-button"
                          onClick={() => setEditingEmployeeId((current) => (current === employee.id ? null : employee.id))}
                        >
                          {editingEmployeeId === employee.id ? "Done" : "Edit"}
                        </button>
                        <button type="button" onClick={() => removeEmployee(employee.id)}>Remove</button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeView === "schedule" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="Calendar" title="Schedule Calendar" />
              {mode === "manager" && (
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
                    placeholder="Start shift"
                  />
                  <TimeInput
                    value={shiftForm.end}
                    onChange={(end) => setShiftForm((form) => ({ ...form, end }))}
                    ariaLabel="Shift end"
                    placeholder="End shift"
                  />
                  <input
                    value={shiftForm.role}
                    onChange={(event) => setShiftForm((form) => ({ ...form, role: event.target.value }))}
                    placeholder="Role"
                    aria-label="Shift role"
                  />
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
                </form>
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
                      scheduleDayShifts.length > 0 ? (
                        <div className="schedule-chart" aria-label={`Team schedule for ${formatLongDate(scheduleDate)}`}>
                          <div className="schedule-chart-header" aria-hidden="true">
                            <span />
                            <div className="schedule-time-grid">
                              {scheduleHourLabels.map((hour) => (
                                <span key={hour}>{formatHourLabel(hour)}</span>
                              ))}
                            </div>
                          </div>
                          {shiftEmployees.filter((employee) => scheduleDayEmployeeIds.has(employee.id)).map((employee) => {
                            const employeeShifts = scheduleDayShifts.filter((shift) => shift.employeeId === employee.id);

                            return (
                              <div className="schedule-chart-row" key={employee.id}>
                                <div className="schedule-member">
                                  <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                                  <strong>{employee.name}</strong>
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
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <EmptyState text="No team shifts scheduled for this day." />
                      )
                    ) : (
                      <div className="week-schedule-list">
                        {scheduleWeekDays.map((day) => (
                          <section className="week-schedule-day" key={day.date}>
                            <button
                              type="button"
                              className="week-schedule-heading"
                              onClick={() => {
                                setScheduleDate(day.date);
                                setEmployeeScheduleTab("day");
                              }}
                              aria-label={`View bar graph for ${formatLongDate(day.date)}`}
                            >
                              <strong>{weekday(day.date)}</strong>
                              <span>{formatShortDate(day.date)}</span>
                            </button>
                            <div className="week-shift-list">
                              {day.shifts.length > 0 ? day.shifts.map((shift) => {
                                const employee = employeeById(state.employees, shift.employeeId);

                                return (
                                  <article
                                    className={`${mode === "employee" && shift.employeeId === activeEmployeeId ? "week-shift mine" : "week-shift"}${mode === "manager" ? " editable" : ""}`}
                                    key={shift.id}
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
                                    <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee?.name ?? "Open shift")}</span>
                                    <div>
                                      <strong>{employee?.name ?? "Open shift"}</strong>
                                      <span>{formatTimeRange(shift)} | {shift.role} | {formatScheduledHours(shift)} hours</span>
                                    </div>
                                  </article>
                                );
                              }) : (
                                <p className="employee-shift-empty">No shifts scheduled.</p>
                              )}
                            </div>
                          </section>
                        ))}
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

          {activeView === "hours" && mode === "manager" && (
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
                </div>
              </div>
              <div className="hours-list">
                {hoursRows.map(({ employee, hours }) => (
                  <article className="hours-row" key={employee.id}>
                    <div>
                      <span className="schedule-avatar" aria-hidden="true">{employeeInitials(employee.name)}</span>
                      <div>
                        <strong>{employee.name}</strong>
                        <span>{employee.role}</span>
                      </div>
                    </div>
                    <strong>{formatWorkedHours(hours)}</strong>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>
      </div>

      <nav className="bottom-nav" aria-label="Mobile DomBase staff sections">
        {visibleNavItems.slice(0, 4).map((item) => (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? "bottom-button active" : "bottom-button"}
            onClick={() => setActiveView(item.id)}
            title={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

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
              placeholder="Start shift"
            />
            <TimeInput
              value={editingShift.end}
              onChange={(end) => setEditingShift((shift) => shift ? { ...shift, end } : shift)}
              ariaLabel="Edit shift end"
              placeholder="End shift"
            />
            <input
              value={editingShift.role}
              onChange={(event) => setEditingShift((shift) => shift ? { ...shift, role: event.target.value } : shift)}
              placeholder="Role"
              aria-label="Edit shift role"
            />
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

function activeViewLabel(activeView: ViewId) {
  return navItems.find((item) => item.id === activeView)?.label ?? "Calendar";
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

function readStoredState() {
  if (typeof window === "undefined") return starterState;

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return starterState;

  try {
    const parsed = JSON.parse(stored) as StaffState;
    const employees = parsed.employees
      .map((employee) =>
        employee.id === 1 && employee.pin === managerPin
          ? { ...employee, name: "Serge Vakulchik" }
          : employee,
      )
      .filter((employee) => !isStarterPlaceholderEmployee(employee));
    const employeeIds = new Set(employees.map((employee) => employee.id));

    return {
      ...parsed,
      employees,
      shifts: parsed.shifts.filter((shift) => employeeIds.has(shift.employeeId)),
      clockEvents: parsed.clockEvents.filter((event) => employeeIds.has(event.employeeId)),
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

function monthCalendarDays(date: string) {
  const selectedDate = parseLocalDate(date);
  const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const days: ({ date: string; day: string } | null)[] = [];

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const calendarDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    days.push({ date: toDateInputValue(calendarDate), day: day.toString() });
  }

  return days;
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

function formatWorkedHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const displayHours = Math.floor(totalMinutes / 60);
  const displayMinutes = totalMinutes % 60;

  return `${displayHours} hrs ${displayMinutes} mins`;
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
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
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
