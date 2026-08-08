"use client";

import { useMemo, useState } from "react";

const navItems = [
  { id: "overview", label: "Overview", icon: "H" },
  { id: "tasks", label: "Tasks", icon: "T" },
  { id: "calendar", label: "Calendar", icon: "C" },
  { id: "household", label: "Household", icon: "M" },
  { id: "budget", label: "Budget", icon: "$" },
] as const;

const tasks = [
  {
    title: "Pay electric bill",
    owner: "Max",
    due: "Today",
    area: "Finance",
    status: "Due",
    urgent: true,
  },
  {
    title: "Schedule HVAC filter change",
    owner: "Jordan",
    due: "Tomorrow",
    area: "Maintenance",
    status: "Planned",
    urgent: false,
  },
  {
    title: "Order groceries",
    owner: "Avery",
    due: "Friday",
    area: "Supplies",
    status: "Shared",
    urgent: false,
  },
  {
    title: "Update emergency contacts",
    owner: "Max",
    due: "This week",
    area: "Safety",
    status: "Open",
    urgent: false,
  },
];

const events = [
  { day: "Fri", date: "08", title: "Trash pickup", time: "7:00 AM" },
  { day: "Sat", date: "09", title: "Farmers market", time: "10:30 AM" },
  { day: "Mon", date: "11", title: "Rent due", time: "9:00 AM" },
];

const members = [
  { name: "Max", role: "Owner", focus: "Bills, documents, setup" },
  { name: "Jordan", role: "Admin", focus: "Maintenance and calendar" },
  { name: "Avery", role: "Member", focus: "Groceries and errands" },
];

const inventory = [
  { item: "Paper towels", level: "Low", note: "Add to next store run" },
  { item: "Air filters", level: "2 left", note: "Replace monthly" },
  { item: "First aid kit", level: "Ready", note: "Checked this month" },
];

const budgets = [
  { name: "Bills", spent: 820, total: 1250 },
  { name: "Groceries", spent: 284, total: 650 },
  { name: "Home care", spent: 96, total: 300 },
];

const notes = [
  "Wi-Fi: DomBase-Home / stored in vault",
  "Water shutoff is under the kitchen sink.",
  "Package code for front gate expires monthly.",
];

type NavId = (typeof navItems)[number]["id"];

export default function Home() {
  const [activeView, setActiveView] = useState<NavId>("overview");
  const [quietMode, setQuietMode] = useState(false);
  const [newTask, setNewTask] = useState("");

  const doneCount = 9;
  const openTasks = tasks.length;
  const urgentTasks = tasks.filter((task) => task.urgent).length;

  const completion = useMemo(() => {
    return Math.round((doneCount / (doneCount + openTasks)) * 100);
  }, [openTasks]);

  return (
    <main className="min-h-screen bg-[#f2f7fc] text-[#12213a]">
      <div className="app-frame">
        <aside className="sidebar" aria-label="DomBase sections">
          <div className="brand-lockup" aria-label="DomBase home">
            <span className="brand-mark">D</span>
            <div>
              <p className="eyebrow">Homebase</p>
              <h1>DomBase</h1>
            </div>
          </div>

          <nav className="nav-list">
            {navItems.map((item) => (
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

          <section className="side-panel" aria-labelledby="privacy-title">
            <div>
              <p className="eyebrow">Access</p>
              <h2 id="privacy-title">Private household</h2>
            </div>
            <label className="switch-row">
              <span>Quiet mode</span>
              <input
                type="checkbox"
                checked={quietMode}
                onChange={() => setQuietMode((value) => !value)}
              />
            </label>
          </section>
        </aside>

        <section className="workspace" aria-live="polite">
          <header className="topbar">
            <div>
              <p className="eyebrow">Friday, August 7</p>
              <h2>{activeViewLabel(activeView)}</h2>
            </div>
            <button type="button" className="primary-action">
              <span aria-hidden="true">+</span>
              Add
            </button>
          </header>

          <section className="hero-strip" aria-label="Home summary">
            <div>
              <p className="eyebrow">Household pulse</p>
              <h3>Everything important at home, in one calm place.</h3>
            </div>
            <div className="hero-metrics">
              <Metric label="Open tasks" value={openTasks.toString()} />
              <Metric label="Urgent" value={urgentTasks.toString()} />
              <Metric label="On track" value={`${completion}%`} />
            </div>
          </section>

          {activeView === "overview" && (
            <div className="content-grid overview-grid">
              <section className="panel main-panel">
                <PanelHeading eyebrow="Today" title="Priority queue" action="View all" />
                <div className="task-stack">
                  {tasks.slice(0, 3).map((task) => (
                    <TaskItem key={task.title} {...task} />
                  ))}
                </div>
              </section>

              <section className="panel">
                <PanelHeading eyebrow="Next up" title="Calendar" action="Add event" />
                <div className="event-stack">
                  {events.map((event) => (
                    <EventItem key={event.title} {...event} />
                  ))}
                </div>
              </section>

              <section className="panel">
                <PanelHeading eyebrow="Supplies" title="Inventory watch" />
                <InventoryList />
              </section>

              <section className="panel">
                <PanelHeading eyebrow="Notes" title="Pinned info" />
                <ul className="note-list">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {activeView === "tasks" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="Tasks" title="Shared responsibilities" />
              <form
                className="quick-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setNewTask("");
                }}
              >
                <input
                  value={newTask}
                  onChange={(event) => setNewTask(event.target.value)}
                  placeholder="Add a household task"
                  aria-label="New household task"
                />
                <button type="submit">Capture</button>
              </form>
              <div className="task-stack">
                {tasks.map((task) => (
                  <TaskItem key={task.title} {...task} />
                ))}
              </div>
            </section>
          )}

          {activeView === "calendar" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="Calendar" title="Shared schedule" action="Sync calendar" />
              <div className="event-stack large">
                {events.map((event) => (
                  <EventItem key={event.title} {...event} />
                ))}
              </div>
            </section>
          )}

          {activeView === "household" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="People" title="Household members" action="Invite" />
              <div className="member-grid">
                {members.map((member) => (
                  <article className="member-card" key={member.name}>
                    <div className="avatar">{member.name.charAt(0)}</div>
                    <div>
                      <h3>{member.name}</h3>
                      <p>{member.role}</p>
                      <span>{member.focus}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeView === "budget" && (
            <section className="panel feature-panel">
              <PanelHeading eyebrow="Budget" title="Bills and shared spending" action="Add bill" />
              <div className="budget-stack">
                {budgets.map((budget) => (
                  <BudgetBar key={budget.name} {...budget} />
                ))}
              </div>
            </section>
          )}
        </section>
      </div>

      <nav className="bottom-nav" aria-label="Mobile DomBase sections">
        {navItems.slice(0, 4).map((item) => (
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

function activeViewLabel(activeView: NavId) {
  const current = navItems.find((item) => item.id === activeView);
  return current ? current.label : "Overview";
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
  action,
}: {
  eyebrow: string;
  title: string;
  action?: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action ? <button type="button">{action}</button> : null}
    </div>
  );
}

function TaskItem({
  title,
  owner,
  due,
  area,
  status,
  urgent,
}: {
  title: string;
  owner: string;
  due: string;
  area: string;
  status: string;
  urgent: boolean;
}) {
  return (
    <article className={urgent ? "task-item urgent" : "task-item"}>
      <label className="check-label">
        <input type="checkbox" aria-label={`Mark ${title} complete`} />
        <span />
      </label>
      <div className="task-body">
        <h3>{title}</h3>
        <p>
          {owner} / {area}
        </p>
      </div>
      <div className="task-meta">
        <strong>{due}</strong>
        <span>{status}</span>
      </div>
    </article>
  );
}

function EventItem({
  day,
  date,
  title,
  time,
}: {
  day: string;
  date: string;
  title: string;
  time: string;
}) {
  return (
    <article className="event-item">
      <div className="date-tile">
        <span>{day}</span>
        <strong>{date}</strong>
      </div>
      <div>
        <h3>{title}</h3>
        <p>{time}</p>
      </div>
    </article>
  );
}

function InventoryList() {
  return (
    <div className="inventory-list">
      {inventory.map((entry) => (
        <article key={entry.item}>
          <div>
            <h3>{entry.item}</h3>
            <p>{entry.note}</p>
          </div>
          <span>{entry.level}</span>
        </article>
      ))}
    </div>
  );
}

function BudgetBar({
  name,
  spent,
  total,
}: {
  name: string;
  spent: number;
  total: number;
}) {
  const percent = Math.round((spent / total) * 100);

  return (
    <article className="budget-row">
      <div>
        <h3>{name}</h3>
        <p>
          ${spent} of ${total}
        </p>
      </div>
      <div className="progress-track" aria-label={`${name} budget ${percent}% used`}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </article>
  );
}
