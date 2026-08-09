"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "manager" | "employee";
type ViewId = "dashboard" | "employees" | "schedule" | "clockins";
type CalendarTab = "today" | "week" | "month";
type CopyRange = "week" | "month";
type Permission =
  | "manage_employees"
  | "manage_roles"
  | "manage_shifts"
  | "view_clockins"
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
  type: "in" | "out";
  at: string;
};

type StaffState = {
  employees: Employee[];
  shifts: Shift[];
  clockEvents: ClockEvent[];
};

const managerPin = "0000";
const storageKey = "dombase-staff-state-v1";
const calendarWeekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const permissionsByMode: Record<Mode, Permission[]> = {
  manager: [
    "manage_employees",
    "manage_roles",
    "manage_shifts",
    "view_clockins",
    "view_schedule",
  ],
  employee: ["clock_self", "view_schedule"],
};

const navItems: { id: ViewId; label: string; icon: string; managerOnly?: boolean }[] = [
  { id: "dashboard", label: "Calendar", icon: "C" },
  { id: "schedule", label: "Schedule", icon: "S" },
  { id: "clockins", label: "Clock-ins", icon: "C", managerOnly: true },
  { id: "employees", label: "Employees", icon: "E", managerOnly: true },
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
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ name: "", role: "", pin: "" });
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [copyRange, setCopyRange] = useState<CopyRange>("week");
  const [repeatDates, setRepeatDates] = useState<string[]>([]);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<number>>(() => new Set());
  const [inlineShiftForm, setInlineShiftForm] = useState<Pick<Shift, "id" | "start" | "end" | "role"> | null>(null);
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
  const myShift = todaysShifts.find((shift) => shift.employeeId === activeEmployeeId);
  const clockedInIds = useMemo(() => {
    return new Set(
      state.employees
        .filter((employee) => employee.active && !isManagerEmployee(employee))
        .filter((employee) => lastClockEvent(state.clockEvents, employee.id)?.type === "in")
        .map((employee) => employee.id),
    );
  }, [state.clockEvents, state.employees]);
  const activeClockEvent = lastClockEvent(state.clockEvents, activeEmployeeId);
  const activeIsClockedIn = activeClockEvent?.type === "in";

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

  function editShift(shift: Shift) {
    setInlineShiftForm({ id: shift.id, start: shift.start, end: shift.end, role: shift.role });
  }

  function saveInlineShift() {
    if (!inlineShiftForm) return;
    const start = parseTypedTime(inlineShiftForm.start);
    const end = parseTypedTime(inlineShiftForm.end);
    const role = inlineShiftForm.role.trim();
    if (!start || !end || !role) return;

    setState((current) => ({
      ...current,
      shifts: current.shifts.map((shift) =>
        shift.id === inlineShiftForm.id ? { ...shift, start, end, role } : shift,
      ),
    }));
    setInlineShiftForm(null);
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

  function toggleShiftSelection(shiftId: number) {
    setSelectedShiftIds((current) => {
      const next = new Set(current);
      if (next.has(shiftId)) next.delete(shiftId);
      else next.add(shiftId);
      return next;
    });
  }

  function deleteSelectedShifts() {
    const count = selectedShiftIds.size;
    if (count === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${count === 1 ? "this shift" : `these ${count} shifts`}?`)) return;

    setState((current) => ({
      ...current,
      shifts: current.shifts.filter((shift) => !selectedShiftIds.has(shift.id)),
    }));
    setSelectedShiftIds(new Set());
  }

  function clock(type: "in" | "out") {
    setState((current) => ({
      ...current,
      clockEvents: [
        {
          id: nextId(current.clockEvents),
          employeeId: activeEmployeeId,
          type,
          at: new Date().toISOString(),
        },
        ...current.clockEvents,
      ],
    }));
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
                    </div>
                    <button
                      type="button"
                      className={activeIsClockedIn ? "danger-action" : "primary-action"}
                      onClick={() => clock(activeIsClockedIn ? "out" : "in")}
                    >
                      {activeIsClockedIn ? "Clock out" : "Clock in"}
                    </button>
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
                    <p className="eyebrow">Calendar</p>
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
              {mode === "manager" && selectedShiftIds.size > 0 && (
                <div className="shift-bulk-actions" role="status">
                  <span>{selectedShiftIds.size} {selectedShiftIds.size === 1 ? "shift" : "shifts"} selected</span>
                  <button type="button" onClick={deleteSelectedShifts}>Delete</button>
                </div>
              )}
              <div className="employee-shift-list">
                {shiftEmployees.map((employee) => {
                  const employeeShifts = state.shifts
                    .filter((shift) => shift.employeeId === employee.id)
                    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

                  return (
                    <details className="employee-shift-group" key={employee.id}>
                      <summary>
                        <span>{employee.name}</span>
                        <span className="employee-shift-count">
                          {employeeShifts.length} {employeeShifts.length === 1 ? "shift" : "shifts"}
                        </span>
                      </summary>
                      <div className="employee-shift-content">
                        {employeeShifts.length > 0 ? employeeShifts.map((shift) => (
                          <article className="calendar-shift compact" key={shift.id}>
                            {mode === "manager" && (
                              <label className="shift-selector" title="Select shift">
                                <input
                                  type="checkbox"
                                  checked={selectedShiftIds.has(shift.id)}
                                  onChange={() => toggleShiftSelection(shift.id)}
                                  aria-label={`Select ${employee.name}'s shift on ${formatLongDate(shift.date)}`}
                                />
                              </label>
                            )}
                            <div className="date-tile">
                              <span>{weekday(shift.date)}</span>
                              <strong>{dayNumber(shift.date)}</strong>
                            </div>
                            {inlineShiftForm?.id === shift.id ? (
                              <div className="inline-shift-editor">
                                <TimeInput
                                  value={inlineShiftForm.start}
                                  onChange={(start) => setInlineShiftForm((form) => form ? { ...form, start } : form)}
                                  ariaLabel="Edit shift start"
                                  placeholder="Start shift"
                                />
                                <TimeInput
                                  value={inlineShiftForm.end}
                                  onChange={(end) => setInlineShiftForm((form) => form ? { ...form, end } : form)}
                                  ariaLabel="Edit shift end"
                                  placeholder="End shift"
                                />
                                <input
                                  type="text"
                                  value={inlineShiftForm.role}
                                  onChange={(event) => setInlineShiftForm((form) => form ? { ...form, role: event.target.value } : form)}
                                  placeholder="Role"
                                  aria-label="Edit shift role"
                                />
                                <div className="inline-shift-actions">
                                  <button type="button" onClick={saveInlineShift}>Save</button>
                                  <button type="button" onClick={() => setInlineShiftForm(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <p>{formatShiftSummary(shift)}</p>
                            )}
                            {mode === "manager" && inlineShiftForm?.id !== shift.id && (
                              <div className="row-actions">
                                <button type="button" onClick={() => editShift(shift)}>Edit</button>
                              </div>
                            )}
                          </article>
                        )) : (
                          <p className="employee-shift-empty">No shifts scheduled.</p>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
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
                </div>
                {state.clockEvents.map((event) => {
                  const employee = employeeById(state.employees, event.employeeId);
                  return (
                    <div role="row" key={event.id}>
                      <span>{employee?.name ?? "Unknown"}</span>
                      <span>{employee?.role ?? "Unassigned"}</span>
                      <span>{event.type === "in" ? "Clock in" : "Clock out"}</span>
                      <span>{formatDateTime(event.at)}</span>
                    </div>
                  );
                })}
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

function lastClockEvent(events: ClockEvent[], employeeId: number) {
  return events
    .filter((event) => event.employeeId === employeeId)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
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

function dayNumber(date: string) {
  return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(`${date}T12:00:00`));
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
  if (tab === "week") return "This week";
  return "This month";
}

function calendarTabEmptyLabel(tab: CalendarTab) {
  if (tab === "today") return "today";
  if (tab === "week") return "this week";
  return "this month";
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatShiftSummary(shift: Shift) {
  return `${shift.role} / ${formatTimeRange(shift)} / ${formatScheduledHours(shift)} hours`;
}

function formatTimeRange(shift: Shift) {
  return `${formatTime12(shift.start)} - ${formatTime12(shift.end)}`;
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
