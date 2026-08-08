import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    roleId: integer("role_id").references(() => roles.id),
    pinHash: text("pin_hash").notNull(),
    isManager: integer("is_manager", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pinHashIdx: uniqueIndex("employees_pin_hash_idx").on(table.pinHash),
    activeIdx: index("employees_active_idx").on(table.active),
  }),
);

export const shifts = sqliteTable(
  "shifts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    roleId: integer("role_id").references(() => roles.id),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    station: text("station").notNull().default("Floor"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    dateIdx: index("shifts_date_idx").on(table.date),
    employeeDateIdx: index("shifts_employee_date_idx").on(table.employeeId, table.date),
  }),
);

export const clockEvents = sqliteTable(
  "clock_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    eventType: text("event_type", { enum: ["in", "out"] }).notNull(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    shiftId: integer("shift_id").references(() => shifts.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    employeeOccurredIdx: index("clock_events_employee_occurred_idx").on(
      table.employeeId,
      table.occurredAt,
    ),
  }),
);

export const pinSessions = sqliteTable(
  "pin_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    mode: text("mode", { enum: ["manager", "employee"] }).notNull(),
    sessionTokenHash: text("session_token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tokenIdx: uniqueIndex("pin_sessions_token_idx").on(table.sessionTokenHash),
    expiresIdx: index("pin_sessions_expires_idx").on(table.expiresAt),
  }),
);
