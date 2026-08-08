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
const today = "2026-08-07";
const storageKey = "dombase-staff-state-v1";

const permissionsByMode: Record<Mode, Permission[]> = {
  manager: [
    "manage_employees",
    "manage_roles",
    "manage_shifts",
    "view_clockins",
    "clock_self",
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
  const [state, setState] = useState<StaffState>(() => readStoredState());
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>("employee");
  const [pin, setPin] = useState("");
  const [activeEmployeeId, setActiveEmployeeId] = useState<number>(1);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [authMessage, setAuthMessage] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ name: "", role: "", pin: "" });
  const [shiftForm, setShiftForm] = useState({
    id: 0,
    employeeId: 1,
    date: today,
    start: "09:00",
    end: "17:00",
    role: "Manager",
    station: "Floor",
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  const activeEmployee = state.employees.find((employee) => employee.id === activeEmployeeId);
  const activeEmployees = state.employees.filter((employee) => employee.active);
  const activeEmployeeIds = new Set(activeEmployees.map((employee) => employee.id));
  const activePermissions = permissionsByMode[mode];
  const visibleNavItems = navItems.filter((item) => mode === "manager" || !item.managerOnly);
  const todaysShifts = state.shifts
    .filter((shift) => shift.date === today && activeEmployeeIds.has(shift.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  const myShift = todaysShifts.find((shift) => shift.employeeId === activeEmployeeId);
  const clockedInIds = useMemo(() => {
    return new Set(
      state.employees
        .filter((employee) => lastClockEvent(state.clockEvents, employee.id)?.type === "in")
        .map((employee) => employee.id),
    );
  }, [state.clockEvents, state.employees]);
  const activeClockEvent = lastClockEvent(state.clockEvents, activeEmployeeId);
  const activeIsClockedIn = activeClockEvent?.type === "in";

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
    if (!employeeForm.name.trim() || !employeeForm.role.trim() || !employeeForm.pin.trim()) return;

    setState((current) => ({
      ...current,
      employees: [
        ...current.employees,
        {
          id: nextId(current.employees),
          name: employeeForm.name.trim(),
          role: employeeForm.role.trim(),
          pin: employeeForm.pin.trim(),
          active: true,
        },
      ],
    }));
    setEmployeeForm({ name: "", role: "", pin: "" });
  }

  function removeEmployee(employeeId: number) {
    if (activeEmployeeId === employeeId) {
      setActiveEmployeeId(1);
    }

    setState((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== employeeId),
      shifts: current.shifts.filter((shift) => shift.employeeId !== employeeId),
      clockEvents: current.clockEvents.filter((event) => event.employeeId !== employeeId),
    }));
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

  function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => {
      const savedShift = { ...shiftForm, id: shiftForm.id || nextId(current.shifts) };
      const shifts = shiftForm.id
        ? current.shifts.map((shift) => (shift.id === shiftForm.id ? savedShift : shift))
        : [...current.shifts, savedShift];

      return { ...current, shifts };
    });
    setShiftForm({
      id: 0,
      employeeId: activeEmployeeId,
      date: today,
      start: "09:00",
      end: "17:00",
      role: activeEmployee?.role ?? "Staff",
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
            <div>
              <p className="eyebrow">Workforce</p>
              <h1>DomBase</h1>
            </div>
          </div>
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="Enter PIN"
            aria-label="Access PIN"
            inputMode="numeric"
          />
          <button type="submit">Unlock</button>
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
            <button type="button" className="sign-out-button" onClick={signOut}>Lock</button>
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
              <p className="eyebrow">Friday, August 7, 2026</p>
              <h2>{activeViewLabel(activeView)}</h2>
            </div>
            <div className="mode-toggle" aria-label="Current access mode">
              <span className={mode === "employee" ? "active" : ""}>Employee</span>
              <span className={mode === "manager" ? "active" : ""}>Manager</span>
            </div>
          </header>

          <section className="summary-strip" aria-label="Staff summary">
            <div>
              <p className="eyebrow">Live floor</p>
              <h3>{clockedInIds.size} clocked in across {todaysShifts.length} scheduled shifts.</h3>
            </div>
            <div className="summary-metrics">
              <Metric label="Employees" value={activeEmployees.length.toString()} />
              <Metric label="Roles" value={new Set(activeEmployees.map((employee) => employee.role)).size.toString()} />
              <Metric label="Clock events" value={state.clockEvents.length.toString()} />
            </div>
          </section>

          {activeView === "dashboard" && (
            <div className="content-grid">
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

              {mode === "manager" && (
                <section className="panel">
                  <PanelHeading eyebrow="Manager" title="Quick controls" />
                  <div className="control-grid">
                    <button type="button" onClick={() => setActiveView("employees")}>Add employee</button>
                    <button type="button" onClick={() => setActiveView("schedule")}>Create shift</button>
                    <button type="button" onClick={() => setActiveView("clockins")}>View clock-ins</button>
                  </div>
                </section>
              )}
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
              <div className="employee-grid">
                {activeEmployees.map((employee) => (
                  <article className="employee-card" key={employee.id}>
                    <div className="avatar">{employee.name.charAt(0)}</div>
                    <div>
                      <h3>{employee.name}</h3>
                      <input
                        value={employee.role}
                        onChange={(event) => updateRole(employee.id, event.target.value)}
                        aria-label={`Role for ${employee.name}`}
                      />
                      <p>PIN {employee.pin} / Active</p>
                    </div>
                    {employee.active && employee.id !== 1 ? (
                      <button type="button" onClick={() => removeEmployee(employee.id)}>Remove</button>
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
                      const employee = employeeById(state.employees, employeeId);
                      setShiftForm((form) => ({ ...form, employeeId, role: employee?.role ?? form.role }));
                    }}
                    aria-label="Shift employee"
                  >
                    {activeEmployees.map((employee) => (
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
                  <input
                    value={shiftForm.station}
                    onChange={(event) => setShiftForm((form) => ({ ...form, station: event.target.value }))}
                    placeholder="Station"
                    aria-label="Shift station"
                  />
                  <button type="submit">{shiftForm.id ? "Save" : "Create"}</button>
                </form>
              )}
              <div className="calendar-grid">
                {state.shifts
                  .slice()
                  .filter((shift) => activeEmployeeIds.has(shift.employeeId))
                  .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
                  .map((shift) => {
                    const employee = employeeById(activeEmployees, shift.employeeId);
                    if (!employee) return null;

                    return (
                      <article className="calendar-shift" key={shift.id}>
                        <div className="date-tile">
                          <span>{weekday(shift.date)}</span>
                          <strong>{dayNumber(shift.date)}</strong>
                        </div>
                        <div>
                          <h3>{employee.name}</h3>
                          <p>{shift.start} - {shift.end} / {shift.role} / {shift.station}</p>
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

function weekday(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function dayNumber(date: string) {
  return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(`${date}T12:00:00`));
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
      <div className="avatar">{employee?.name.charAt(0) ?? "?"}</div>
      <div>
        <h3>{employee?.name ?? "Open shift"}</h3>
        <p>{shift.start} - {shift.end}</p>
      </div>
      <div className="shift-meta">
        <strong>{shift.role}</strong>
        <span>{shift.station}</span>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}
