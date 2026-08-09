"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "manager" | "employee";
type ViewId = "dashboard" | "employees" | "schedule" | "clockins";
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
  { id: "dashboard", label: "Today", icon: "T" },
  { id: "employees", label: "Employees", icon: "P", managerOnly: true },
  { id: "schedule", label: "Schedule", icon: "S" },
  { id: "clockins", label: "Clock-ins", icon: "C", managerOnly: true },
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
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ name: "", role: "", pin: "" });
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [shiftForm, setShiftForm] = useState({
    id: 0,
    employeeId: 0,
    date: today,
    start: "09:00",
    end: "17:00",
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
  const todaysShifts = state.shifts
    .filter((shift) => shift.date === today && shiftEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
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

    setState((current) => {
      const savedShift = { ...shiftForm, id: shiftForm.id || nextId(current.shifts) };
      const shifts = shiftForm.id
        ? current.shifts.map((shift) => (shift.id === shiftForm.id ? savedShift : shift))
        : [...current.shifts, savedShift];

      return { ...current, shifts };
    });
    setShiftForm({
      id: 0,
      employeeId: 0,
      date: today,
      start: "09:00",
      end: "17:00",
      role: "",
      station: "Floor",
    });
  }

  function editShift(shift: Shift) {
    setShiftForm(shift);
    setActiveView("schedule");
  }

  function removeShift(shiftId: number) {
    setState((current) => ({
      ...current,
      shifts: current.shifts.filter((shift) => shift.id !== shiftId),
    }));
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
                <PanelHeading eyebrow="Coworkers" title="Shift times and roles" />
                <div className="shift-stack">
                  {todaysShifts.map((shift) => (
                    <ShiftRow
                      key={shift.id}
                      shift={shift}
                      employee={employeeById(state.employees, shift.employeeId)}
                      compact
                    />
                  ))}
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
              <PanelHeading eyebrow="Calendar" title="Schedule calendar" />
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
                  <input
                    type="date"
                    value={shiftForm.date}
                    onChange={(event) => setShiftForm((form) => ({ ...form, date: event.target.value }))}
                    aria-label="Shift date"
                  />
                  <input
                    type="time"
                    value={shiftForm.start}
                    onChange={(event) => setShiftForm((form) => ({ ...form, start: event.target.value }))}
                    aria-label="Shift start"
                  />
                  <input
                    type="time"
                    value={shiftForm.end}
                    onChange={(event) => setShiftForm((form) => ({ ...form, end: event.target.value }))}
                    aria-label="Shift end"
                  />
                  <input
                    value={shiftForm.role}
                    onChange={(event) => setShiftForm((form) => ({ ...form, role: event.target.value }))}
                    placeholder="Role"
                    aria-label="Shift role"
                  />
                  <button type="submit" disabled={shiftEmployees.length === 0}>Save</button>
                </form>
              )}
              <div className="calendar-grid">
                {state.shifts
                  .slice()
                  .filter((shift) => shiftEmployeeIds.has(shift.employeeId))
                  .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
                  .map((shift) => {
                    const employee = employeeById(shiftEmployees, shift.employeeId);
                    if (!employee) return null;

                    return (
                      <article className="calendar-shift" key={shift.id}>
                        <div className="date-tile">
                          <span>{weekday(shift.date)}</span>
                          <strong>{dayNumber(shift.date)}</strong>
                        </div>
                        <div>
                          <h3>{employee.name}</h3>
                          <p>{formatShiftSummary(shift)}</p>
                        </div>
                        {mode === "manager" && (
                          <div className="row-actions">
                            <button type="button" onClick={() => editShift(shift)}>Edit</button>
                            <button type="button" onClick={() => removeShift(shift.id)}>Delete</button>
                          </div>
                        )}
                      </article>
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
  return navItems.find((item) => item.id === activeView)?.label ?? "Today";
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
}: {
  shift: Shift;
  employee?: Employee;
  compact?: boolean;
}) {
  return (
    <article className={compact ? "shift-row compact" : "shift-row"}>
      <div>
        <h3>{employee?.name ?? "Open shift"}</h3>
        <p>{formatTimeRange(shift)}</p>
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
