import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// One database serves one company/location. Additional locations are out of scope.
const id = () => integer("id").primaryKey({ autoIncrement: true });
const timestamps = () => ({
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const departments = sqliteTable("departments", {
  id: id(),
  name: text("name").notNull().unique(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  version: integer("version").notNull().default(1),
  ...timestamps(),
});

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  departmentId: integer("department_id").references(() => departments.id),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  // Legacy scaffold metadata, not dashboard authorization. See accountPermissions.
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
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    startDate: text("start_date"),
    payrollId: text("payroll_id").notNull().default(""),
    payrollClassification: text("payroll_classification", { enum: ["W-2 Employee", "1099 Contractor"] }).notNull().default("W-2 Employee"),
    terminated: integer("terminated", { mode: "boolean" }).notNull().default(false),
    terminationDate: text("termination_date"),
    terminationReason: text("termination_reason"),
    terminationNote: text("termination_note"),
    eligibleForRehire: integer("eligible_for_rehire", { mode: "boolean" }),
    // Keyed lookup enables PIN uniqueness independently of salted verifiers.
    // Legacy rows have no lookup and must be enrolled/reset before PIN login.
    pinLookup: text("pin_lookup"),
    pinVersion: integer("pin_version").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pinHashIdx: uniqueIndex("employees_pin_hash_idx").on(table.pinHash),
    activeIdx: index("employees_active_idx").on(table.active),
    pinLookupIdx: uniqueIndex("employees_pin_lookup_idx").on(table.pinLookup),
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
    shiftType: text("shift_type", { enum: ["work", "day_off"] }).notNull().default("work"),
    color: text("color", { enum: ["blue", "green", "amber", "red", "violet", "gray"] }).notNull().default("blue"),
    station: text("station").notNull().default("Floor"),
    notes: text("notes").notNull().default(""),
    roleName: text("role_name").notNull().default(""),
    publicationId: integer("publication_id").references(() => schedulePublications.id),
    archivedAt: text("archived_at"),
    version: integer("version").notNull().default(1),
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
    eventType: text("event_type", { enum: ["in", "out", "break", "break_end"] }).notNull(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    shiftId: integer("shift_id").references(() => shifts.id),
    cardId: integer("card_id").references(() => timeCards.id),
    roleName: text("role_name").notNull().default(""),
    durationSeconds: integer("duration_seconds"),
    explanation: text("explanation").notNull().default(""),
    automatic: integer("automatic", { mode: "boolean" }).notNull().default(false),
    source: text("source", { enum: ["legacy", "kiosk", "manager", "system", "offline"] }).notNull().default("legacy"),
    deviceId: text("device_id").references(() => kioskDevices.id),
    recordedByAccountId: integer("recorded_by_account_id").references(() => accounts.id),
    receivedAt: text("received_at"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    employeeOccurredIdx: index("clock_events_employee_occurred_idx").on(
      table.employeeId,
      table.occurredAt,
    ),
    cardIdx: index("clock_events_card_idx").on(table.cardId),
    idempotencyIdx: uniqueIndex("clock_events_idempotency_idx").on(table.idempotencyKey),
  }),
);

// Legacy scaffold only: never accept these as dashboard or kiosk authorization.
// New session types below cannot inherit a legacy `mode = manager` session.
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

// Account identity and access are independent of an employee's job and row ID.
export const accounts = sqliteTable("accounts", {
  id: id(),
  employeeId: integer("employee_id").references(() => employees.id),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  displayName: text("display_name").notNull(),
  accessLevel: text("access_level", { enum: ["owner", "general_manager", "manager", "employee"] }).notNull().default("employee"),
  passwordHash: text("password_hash"),
  loginEnabled: integer("login_enabled", { mode: "boolean" }).notNull().default(false),
  disabledAt: text("disabled_at"),
  sessionVersion: integer("session_version").notNull().default(1),
  // Compare-and-set receipt for atomic permission/department changes.
  accessRevision: text("access_revision").notNull().default(""),
  ...timestamps(),
}, table => [
  uniqueIndex("accounts_email_idx").on(table.normalizedEmail),
  uniqueIndex("accounts_employee_idx").on(table.employeeId),
  check("accounts_access_check", sql`${table.accessLevel} IN ('owner', 'general_manager', 'manager', 'employee')`),
  check("accounts_email_check", sql`${table.normalizedEmail} = lower(trim(${table.email})) AND length(${table.normalizedEmail}) > 0`),
  check("accounts_login_check", sql`${table.loginEnabled} IN (0, 1) AND (${table.loginEnabled} = 0 OR (${table.passwordHash} IS NOT NULL AND length(${table.passwordHash}) > 0)) AND ${table.sessionVersion} > 0`),
]);

export const accountPermissions = sqliteTable("account_permissions", {
  accountId: integer("account_id").notNull().references(() => accounts.id),
  permission: text("permission").notNull(),
  allowed: integer("allowed", { mode: "boolean" }).notNull(),
}, table => [
  primaryKey({ columns: [table.accountId, table.permission] }),
  check("account_permissions_allowed_check", sql`${table.allowed} IN (0, 1)`),
]);

export const departmentManagers = sqliteTable("department_managers", {
  departmentId: integer("department_id").notNull().references(() => departments.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
}, table => [
  primaryKey({ columns: [table.departmentId, table.accountId] }),
  index("department_managers_account_idx").on(table.accountId),
]);

export const business = sqliteTable("business", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull(),
  locationName: text("location_name").notNull(),
  primaryOwnerAccountId: integer("primary_owner_account_id").references(() => accounts.id),
  locationPhone: text("location_phone").notNull().default(""),
  companyPhone: text("company_phone").notNull().default(""),
  address1: text("address1").notNull().default(""),
  address2: text("address2").notNull().default(""),
  city: text("city").notNull().default("Sacramento"),
  stateProvince: text("state_province").notNull().default("California"),
  postalCode: text("postal_code").notNull().default(""),
  country: text("country").notNull().default("United States"),
  timeZone: text("time_zone").notNull().default("America/Los_Angeles"),
  businessType: text("business_type").notNull().default(""),
  businessCategory: text("business_category").notNull().default(""),
  website: text("website").notNull().default(""),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [check("business_single_location_check", sql`${table.id} = 1`)]);

export const locationSettings = sqliteTable("location_settings", {
  businessId: integer("business_id").primaryKey().references(() => business.id),
  workWeekStart: integer("work_week_start").notNull().default(1),
  minRestHours: integer("min_rest_hours").notNull().default(10),
  availabilityReviewDays: integer("availability_review_days").notNull().default(90),
  scheduleStartHour: integer("schedule_start_hour").notNull().default(7),
  scheduleEndHour: integer("schedule_end_hour").notNull().default(17),
  lateMinutes: integer("late_minutes").notNull().default(1),
  earlyClockInMinutes: integer("early_clock_in_minutes").notNull().default(5),
  requireEarlyClockInExplanation: integer("require_early_clock_in_explanation", { mode: "boolean" }).notNull().default(true),
  requireLateClockInExplanation: integer("require_late_clock_in_explanation", { mode: "boolean" }).notNull().default(true),
  requireClockOutExplanation: integer("require_clock_out_explanation", { mode: "boolean" }).notNull().default(true),
  requireUnscheduledExplanation: integer("require_unscheduled_explanation", { mode: "boolean" }).notNull().default(true),
  noShowAlerts: integer("no_show_alerts", { mode: "boolean" }).notNull().default(true),
  noShowMinutes: integer("no_show_minutes").notNull().default(5),
  automaticClockOut: integer("automatic_clock_out", { mode: "boolean" }).notNull().default(true),
  automaticClockOutMinutes: integer("automatic_clock_out_minutes").notNull().default(120),
  notifyScheduleChanges: integer("notify_schedule_changes", { mode: "boolean" }).notNull().default(true),
  employeesOwnScheduleOnly: integer("employees_own_schedule_only", { mode: "boolean" }).notNull().default(false),
  requireAvailabilityApproval: integer("require_availability_approval", { mode: "boolean" }).notNull().default(true),
  restrictManagerDepartments: integer("restrict_manager_departments", { mode: "boolean" }).notNull().default(false),
  enableScheduleEvents: integer("enable_schedule_events", { mode: "boolean" }).notNull().default(true),
  mealBreakAfterHours: integer("meal_break_after_hours").notNull().default(5),
  mealBreakMinutes: integer("meal_break_minutes").notNull().default(30),
  mandatoryMealBreak: integer("mandatory_meal_break", { mode: "boolean" }).notNull().default(true),
  enableTeamMessaging: integer("enable_team_messaging", { mode: "boolean" }).notNull().default(true),
  hoursRoundingMinutes: integer("hours_rounding_minutes").notNull().default(15),
  kioskIdleSeconds: integer("kiosk_idle_seconds").notNull().default(30),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [
  check("location_settings_week_check", sql`${table.workWeekStart} BETWEEN 0 AND 6`),
  check("location_settings_conflict_limits_check", sql`${table.minRestHours} BETWEEN 0 AND 24 AND ${table.availabilityReviewDays} BETWEEN 0 AND 365`),
  check("location_settings_meal_duration_check", sql`${table.mealBreakMinutes} BETWEEN 30 AND 120`),
  check("location_settings_schedule_check", sql`${table.scheduleStartHour} BETWEEN 0 AND 23 AND ${table.scheduleEndHour} BETWEEN 1 AND 24 AND ${table.scheduleStartHour} < ${table.scheduleEndHour}`),
  check("location_settings_timing_check", sql`${table.lateMinutes} BETWEEN 1 AND 120 AND ${table.earlyClockInMinutes} BETWEEN 0 AND 120 AND ${table.noShowMinutes} BETWEEN 0 AND 120 AND ${table.automaticClockOutMinutes} BETWEEN 1 AND 1440 AND ${table.mealBreakAfterHours} BETWEEN 1 AND 24`),
  check("location_settings_rounding_check", sql`${table.hoursRoundingMinutes} IN (5, 10, 15) AND ${table.kioskIdleSeconds} BETWEEN 5 AND 600`),
]);

export const employeeProfiles = sqliteTable("employee_profiles", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  legalFirstName: text("legal_first_name").notNull().default(""),
  legalMiddleName: text("legal_middle_name").notNull().default(""),
  legalLastName: text("legal_last_name").notNull().default(""),
  dateOfBirth: text("date_of_birth"),
  // Reserved for encrypted values; no encryption or collection API exists yet.
  ssnEncrypted: text("ssn_encrypted"),
  homeAddress: text("home_address").notNull().default(""),
  homeAddressLine2: text("home_address_line2").notNull().default(""),
  homeCity: text("home_city").notNull().default(""),
  homeStateProvince: text("home_state_province").notNull().default(""),
  homePostalCode: text("home_postal_code").notNull().default(""),
  emergencyContact: text("emergency_contact").notNull().default(""),
  emergencyContactRelationship: text("emergency_contact_relationship").notNull().default(""),
  emergencyContactPhone: text("emergency_contact_phone").notNull().default(""),
  emergencyContactPreference: text("emergency_contact_preference").notNull().default(""),
  version: integer("version").notNull().default(1),
  ...timestamps(),
});

export const employeeSettings = sqliteTable("employee_settings", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  showInSchedule: integer("show_in_schedule", { mode: "boolean" }).notNull().default(true),
  sendLocationAlerts: integer("send_location_alerts", { mode: "boolean" }).notNull().default(true),
  includeInTimeClockErrors: integer("include_in_time_clock_errors", { mode: "boolean" }).notNull().default(true),
  eligibleForOpenShifts: integer("eligible_for_open_shifts", { mode: "boolean" }).notNull().default(true),
  canWaiveMissedBreaks: integer("can_waive_missed_breaks", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const employeeRoles = sqliteTable("employee_roles", {
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  roleId: integer("role_id").notNull().references(() => roles.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps(),
}, table => [primaryKey({ columns: [table.employeeId, table.roleId] })]);

export const wageRates = sqliteTable("wage_rates", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  roleId: integer("role_id").references(() => roles.id),
  basis: text("basis", { enum: ["hourly", "annual_salary"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  overtimeExempt: integer("overtime_exempt", { mode: "boolean" }).notNull().default(false),
  effectiveDate: text("effective_date").notNull(),
  recordedByAccountId: integer("recorded_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("wage_rates_employee_effective_idx").on(table.employeeId, table.effectiveDate),
  check("wage_rates_value_check", sql`typeof(${table.amountCents}) = 'integer' AND ${table.amountCents} >= 0 AND ${table.basis} IN ('hourly', 'annual_salary')`),
]);

export const employmentHistory = sqliteTable("employment_history", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  eventType: text("event_type", { enum: ["terminated", "rehired"] }).notNull(),
  date: text("date").notNull(),
  reason: text("reason").notNull().default(""),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("employment_history_employee_date_idx").on(table.employeeId, table.date),
  check("employment_history_type_check", sql`${table.eventType} IN ('terminated', 'rehired')`),
]);

export const employeeNotes = sqliteTable("employee_notes", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  authorAccountId: integer("author_account_id").notNull().references(() => accounts.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("employee_notes_employee_idx").on(table.employeeId)]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey().notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  uploadedByAccountId: integer("uploaded_by_account_id").notNull().references(() => accounts.id),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256"),
  status: text("status", { enum: ["pending", "ready", "deleted"] }).notNull().default("pending"),
  ...timestamps(),
}, table => [
  uniqueIndex("files_id_employee_idx").on(table.id, table.employeeId),
  index("files_employee_idx").on(table.employeeId),
  check("files_size_status_check", sql`${table.sizeBytes} >= 0 AND ${table.status} IN ('pending', 'ready', 'deleted')`),
]);

export const employeeCertificates = sqliteTable("employee_certificates", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  name: text("name").notNull(),
  expirationDate: text("expiration_date"),
  fileId: text("file_id"),
  ...timestamps(),
}, table => [
  foreignKey({ columns: [table.fileId, table.employeeId], foreignColumns: [files.id, files.employeeId] }),
  index("employee_certificates_employee_expiration_idx").on(table.employeeId, table.expirationDate),
]);

// The prototype stores filename labels here, not actual onboarding document bytes.
export const onboardingDocumentLabels = sqliteTable("onboarding_document_labels", {
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  documentName: text("document_name").notNull(),
  fileName: text("file_name").notNull(),
  ...timestamps(),
}, table => [primaryKey({ columns: [table.employeeId, table.documentName] })]);

export const accountSessions = sqliteTable("account_sessions", {
  id: text("id").primaryKey().notNull(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  sessionVersion: integer("session_version").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("account_sessions_account_expiry_idx").on(table.accountId, table.expiresAt)]);

// Operator-issued, short-lived invitations. Raw tokens are never stored here.
export const accountSetupTokens = sqliteTable("account_setup_tokens", {
  id: text("id").primaryKey().notNull(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  issuedSessionVersion: integer("issued_session_version").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("account_setup_tokens_account_idx").on(table.accountId)]);

export const kioskDevices = sqliteTable("kiosk_devices", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  registeredByAccountId: integer("registered_by_account_id").notNull().references(() => accounts.id),
  registeredAt: text("registered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
});

export const deviceSessions = sqliteTable("device_sessions", {
  id: text("id").primaryKey().notNull(),
  deviceId: text("device_id").notNull().references(() => kioskDevices.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("device_sessions_device_expiry_idx").on(table.deviceId, table.expiresAt)]);

export const kioskInteractions = sqliteTable("kiosk_interactions", {
  id: text("id").primaryKey().notNull(),
  deviceSessionId: text("device_session_id").notNull().references(() => deviceSessions.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  pinVersion: integer("pin_version").notNull().default(1),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("kiosk_interactions_device_idx").on(table.deviceSessionId)]);

export const managerApprovalCredentials = sqliteTable("manager_approval_credentials", {
  accountId: integer("account_id").primaryKey().references(() => accounts.id),
  pinHash: text("pin_hash").notNull(),
  pinLookup: text("pin_lookup").notNull().unique(),
  revision: text("revision").notNull().default("legacy-unenrolled"),
  ...timestamps(),
});

export const kioskApprovalSessions = sqliteTable("kiosk_approval_sessions", {
  id: text("id").primaryKey().notNull(),
  deviceSessionId: text("device_session_id").notNull().references(() => deviceSessions.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  sessionVersion: integer("session_version").notNull().default(1),
  credentialRevision: text("credential_revision").notNull().default("legacy-unenrolled"),
  tokenHash: text("token_hash").notNull().unique(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("kiosk_approval_sessions_device_idx").on(table.deviceSessionId)]);

// Server-prepared clock intents bind an approval to one device, person and action.
export const kioskClockRequests = sqliteTable("kiosk_clock_requests", {
  id: text("id").primaryKey().notNull(),
  interactionId: text("interaction_id").notNull().references(() => kioskInteractions.id),
  eventType: text("event_type", { enum: ["in", "out", "break", "break_end"] }).notNull(),
  roleId: integer("role_id").references(() => roles.id),
  shiftId: integer("shift_id").references(() => shifts.id),
  roleName: text("role_name").notNull().default(""),
  previousEventId: integer("previous_event_id").references(() => clockEvents.id),
  explanation: text("explanation").notNull().default(""),
  requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull(),
  approvalReason: text("approval_reason").notNull().default(""),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
  cancelledAt: text("cancelled_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("kiosk_clock_requests_interaction_idx").on(table.interactionId),
  check("kiosk_clock_requests_type_check", sql`${table.eventType} IN ('in', 'out', 'break', 'break_end')`),
]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey().notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  blockedUntil: text("blocked_until"),
}, table => [check("auth_rate_limits_count_check", sql`${table.failedAttempts} >= 0`)]);

export const schedulePublications = sqliteTable("schedule_publications", {
  id: id(),
  departmentId: integer("department_id").references(() => departments.id),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  notifyMode: text("notify_mode", { enum: ["all", "changed", "none"] }),
  notifyInApp: integer("notify_in_app", { mode: "boolean" }),
  notifyEmail: integer("notify_email", { mode: "boolean" }),
  scopeDepartments: text("scope_departments", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
  version: integer("version").notNull().unique(),
  publishedByAccountId: integer("published_by_account_id").notNull().references(() => accounts.id),
  publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [check("schedule_publications_version_check", sql`${table.version} > 0`)]);

export const scheduleDrafts = sqliteTable("schedule_drafts", {
  id: id(),
  ownerAccountId: integer("owner_account_id").notNull().unique().references(() => accounts.id),
  basePublicationVersion: integer("base_publication_version").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [check("schedule_drafts_version_check", sql`${table.basePublicationVersion} >= 0 AND ${table.version} > 0`)]);

export const scheduleDraftChanges = sqliteTable("schedule_draft_changes", {
  id: id(),
  draftId: integer("draft_id").notNull().references(() => scheduleDrafts.id),
  clientKey: text("client_key").notNull(),
  operation: text("operation", { enum: ["upsert", "delete"] }).notNull(),
  shiftId: integer("shift_id").references(() => shifts.id),
  employeeId: integer("employee_id").references(() => employees.id),
  roleId: integer("role_id").references(() => roles.id),
  roleName: text("role_name"),
  date: text("date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  shiftType: text("shift_type", { enum: ["work", "day_off"] }).notNull().default("work"),
  color: text("color", { enum: ["blue", "green", "amber", "red", "violet", "gray"] }).notNull().default("blue"),
  station: text("station"),
  notes: text("notes"),
}, table => [
  uniqueIndex("schedule_draft_changes_key_idx").on(table.draftId, table.clientKey),
  uniqueIndex("schedule_draft_changes_shift_idx").on(table.draftId, table.shiftId),
  check("schedule_draft_changes_operation_check", sql`(${table.operation} = 'delete' AND ${table.shiftId} IS NOT NULL) OR (${table.operation} = 'upsert' AND ${table.employeeId} IS NOT NULL AND ${table.date} IS NOT NULL AND ${table.startTime} IS NOT NULL AND ${table.endTime} IS NOT NULL AND ${table.roleName} IS NOT NULL)`),
]);

export const scheduleDraftEmployees = sqliteTable("schedule_draft_employees", {
  draftId: integer("draft_id").notNull().references(() => scheduleDrafts.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
}, table => [primaryKey({ columns: [table.draftId, table.employeeId] })]);

export const scheduleEvents = sqliteTable("schedule_events", {
  id: id(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  createdByAccountId: integer("created_by_account_id").notNull().references(() => accounts.id),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [index("schedule_events_date_idx").on(table.date)]);

// Identity/revision anchors only. Hours, wages and overtime remain derived.
export const timeCards = sqliteTable("time_cards", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  workDate: text("work_date").notNull(),
  roleId: integer("role_id").references(() => roles.id),
  roleName: text("role_name").notNull().default(""),
  source: text("source", { enum: ["punch", "manual"] }).notNull().default("punch"),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [
  uniqueIndex("time_cards_id_employee_idx").on(table.id, table.employeeId),
  index("time_cards_employee_date_idx").on(table.employeeId, table.workDate),
  check("time_cards_source_check", sql`${table.source} IN ('punch', 'manual') AND ${table.version} > 0`),
]);

export const timeCardEdits = sqliteTable("time_card_edits", {
  id: id(),
  cardId: integer("card_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  revision: integer("revision").notNull(),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  reason: text("reason").notNull(),
  before: text("before", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  after: text("after", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  foreignKey({ columns: [table.cardId, table.employeeId], foreignColumns: [timeCards.id, timeCards.employeeId] }),
  uniqueIndex("time_card_edits_card_revision_idx").on(table.cardId, table.revision),
  check("time_card_edits_revision_check", sql`${table.revision} > 0 AND length(trim(${table.reason})) > 0 AND json_valid(${table.before}) AND json_valid(${table.after})`),
]);

export const hoursAdjustments = sqliteTable("hours_adjustments", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  date: text("date").notNull(),
  adjustmentSeconds: integer("adjustment_seconds").notNull(),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("hours_adjustments_employee_date_idx").on(table.employeeId, table.date)]);

export const ptoPolicies = sqliteTable("pto_policies", {
  id: id(),
  name: text("name").notNull(),
  method: text("method", { enum: ["fixed", "rate"] }).notNull(),
  fixedAllowanceSeconds: integer("fixed_allowance_seconds").notNull().default(0),
  earnedSeconds: integer("earned_seconds").notNull().default(0),
  perWorkedSeconds: integer("per_worked_seconds").notNull().default(3600),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [check("pto_policies_method_check", sql`(${table.method} = 'fixed' AND ${table.fixedAllowanceSeconds} > 0) OR (${table.method} = 'rate' AND ${table.earnedSeconds} > 0 AND ${table.perWorkedSeconds} > 0)`)]);

export const ptoAssignments = sqliteTable("pto_assignments", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  policyId: integer("policy_id").notNull().references(() => ptoPolicies.id),
  startDate: text("start_date").notNull(),
  openingBalanceSeconds: integer("opening_balance_seconds").notNull().default(0),
  ...timestamps(),
}, table => [index("pto_assignments_policy_idx").on(table.policyId)]);

export const ptoRequests = sqliteTable("pto_requests", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  compensation: text("compensation", { enum: ["paid", "unpaid"] }).notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  reason: text("reason", { enum: ["sick_emergency", "vacation"] }).notNull(),
  explanation: text("explanation").notNull().default(""),
  status: text("status", { enum: ["pending", "approved", "denied", "cancelled"] }).notNull().default("pending"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
  decidedByAccountId: integer("decided_by_account_id").references(() => accounts.id),
  archivedAt: text("archived_at"),
  version: integer("version").notNull().default(1),
}, table => [
  index("pto_requests_employee_dates_idx").on(table.employeeId, table.startDate, table.endDate),
  index("pto_requests_status_idx").on(table.status),
  check("pto_requests_values_check", sql`${table.compensation} IN ('paid', 'unpaid') AND ${table.reason} IN ('sick_emergency', 'vacation') AND ${table.status} IN ('pending', 'approved', 'denied', 'cancelled') AND ${table.startDate} <= ${table.endDate}`),
]);

export const ptoDecisions = sqliteTable("pto_decisions", {
  id: id(),
  requestId: integer("request_id").notNull().references(() => ptoRequests.id),
  status: text("status", { enum: ["approved", "denied", "cancelled"] }).notNull(),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("pto_decisions_request_idx").on(table.requestId),
  check("pto_decisions_status_check", sql`${table.status} IN ('approved', 'denied', 'cancelled')`),
]);

export const availabilityRequests = sqliteTable("availability_requests", {
  id: id(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  submittedByAccountId: integer("submitted_by_account_id").references(() => accounts.id),
  effectiveDate: text("effective_date").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  requestNote: text("request_note").notNull().default(""),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
  decidedByAccountId: integer("decided_by_account_id").references(() => accounts.id),
  rejectionNote: text("rejection_note").notNull().default(""),
  version: integer("version").notNull().default(1),
}, table => [
  index("availability_requests_employee_effective_idx").on(table.employeeId, table.effectiveDate),
  check("availability_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
]);

export const availabilitySlots = sqliteTable("availability_slots", {
  id: id(),
  requestId: integer("request_id").notNull().references(() => availabilityRequests.id),
  dayOfWeek: integer("day_of_week").notNull(),
  preference: text("preference", { enum: ["preferred", "unavailable"] }).notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
}, table => [
  index("availability_slots_request_idx").on(table.requestId),
  check("availability_slots_range_check", sql`${table.dayOfWeek} BETWEEN 0 AND 6 AND ${table.startMinute} BETWEEN 0 AND 1439 AND ${table.endMinute} BETWEEN 1 AND 1440 AND ${table.startMinute} < ${table.endMinute} AND ${table.preference} IN ('preferred', 'unavailable')`),
]);

export const availabilityDecisions = sqliteTable("availability_decisions", {
  id: id(),
  requestId: integer("request_id").notNull().references(() => availabilityRequests.id),
  decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("availability_decisions_request_idx").on(table.requestId),
  check("availability_decisions_value_check", sql`${table.decision} IN ('approved', 'rejected')`),
]);

export const conversations = sqliteTable("conversations", {
  id: id(),
  creatorEmployeeId: integer("creator_employee_id").notNull().references(() => employees.id),
  name: text("name"),
  archivedAt: text("archived_at"),
  version: integer("version").notNull().default(1),
  ...timestamps(),
});

export const conversationMembers = sqliteTable("conversation_members", {
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  leftAt: text("left_at"),
}, table => [
  primaryKey({ columns: [table.conversationId, table.employeeId] }),
  index("conversation_members_employee_idx").on(table.employeeId),
]);

export const messages = sqliteTable("messages", {
  id: id(),
  conversationId: integer("conversation_id").notNull(),
  senderEmployeeId: integer("sender_employee_id").notNull(),
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  idempotencyKey: text("idempotency_key").unique(),
}, table => [
  foreignKey({ columns: [table.conversationId, table.senderEmployeeId], foreignColumns: [conversationMembers.conversationId, conversationMembers.employeeId] }),
  uniqueIndex("messages_id_conversation_idx").on(table.id, table.conversationId),
  index("messages_conversation_sent_idx").on(table.conversationId, table.sentAt),
  check("messages_body_check", sql`length(trim(${table.body})) > 0`),
]);

export const messageReads = sqliteTable("message_reads", {
  messageId: integer("message_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  readAt: text("read_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns: [table.messageId, table.employeeId] }),
  foreignKey({ columns: [table.messageId, table.conversationId], foreignColumns: [messages.id, messages.conversationId] }),
  foreignKey({ columns: [table.conversationId, table.employeeId], foreignColumns: [conversationMembers.conversationId, conversationMembers.employeeId] }),
]);

// One row per recipient/source; receipts do not require a second copy of a notice.
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey().notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  sourceKey: text("source_key").notNull(),
  kind: text("kind", { enum: ["alert", "request", "schedule"] }).notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publicationId: integer("publication_id").references(() => schedulePublications.id),
  ptoRequestId: integer("pto_request_id").references(() => ptoRequests.id),
  availabilityRequestId: integer("availability_request_id").references(() => availabilityRequests.id),
  eventTargetId: text("event_target_id"),
  openedAt: text("opened_at"),
  dismissedAt: text("dismissed_at"),
}, table => [
  uniqueIndex("notifications_employee_source_idx").on(table.employeeId, table.sourceKey),
  index("notifications_employee_time_idx").on(table.employeeId, table.occurredAt),
  check("notifications_kind_check", sql`${table.kind} IN ('alert', 'request', 'schedule')`),
]);

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  actorAccountId: integer("actor_account_id").references(() => accounts.id),
  employeeId: integer("employee_id").references(() => employees.id),
  deviceId: text("device_id").references(() => kioskDevices.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  // Redacted operational metadata only: never credentials, SSNs, or file contents.
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("audit_log_entity_idx").on(table.entityType, table.entityId),
  check("audit_log_metadata_check", sql`json_valid(${table.metadata})`),
]);

// Whole-workspace CAS coordinates related edits without storing client snapshots.
export const workforceState = sqliteTable("workforce_state", {
  id: integer("id").primaryKey().default(1),
  revision: integer("revision").notNull().default(0),
}, table => [check("workforce_state_singleton_check", sql`${table.id} = 1 AND ${table.revision} >= 0`)]);

export const workforceCommits = sqliteTable("workforce_commits", {
  id: text("id").primaryKey().notNull(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  bodyHash: text("body_hash").notNull(),
  attemptId: text("attempt_id").notNull().default(""),
  revision: integer("revision").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Ephemeral assertions inside one D1 batch; a failed conditional write aborts it.
export const workforceWriteChecks = sqliteTable("workforce_write_checks", {
  id: text("id").primaryKey().notNull(),
  passed: integer("passed").notNull(),
}, table => [check("workforce_write_checks_passed_check", sql`${table.passed} = 1`)]);

export const notificationReceipts = sqliteTable("notification_receipts", {
  accountId: integer("account_id").notNull().references(() => accounts.id),
  sourceKey: text("source_key").notNull(),
  openedAt: text("opened_at"),
  dismissedAt: text("dismissed_at"),
}, table => [primaryKey({ columns: [table.accountId, table.sourceKey] })]);

// Upload intents bind immutable file metadata to a current account/employee version.
export const documentUploads = sqliteTable("document_uploads", {
  fileId: text("file_id").primaryKey().notNull().references(() => files.id),
  bodyHash: text("body_hash").notNull(),
  kind: text("kind", { enum: ["certificate", "onboarding"] }).notNull(),
  isProfilePhoto: integer("is_profile_photo", { mode: "boolean" }).notNull().default(false),
  title: text("title").notNull(),
  certificateId: integer("certificate_id"),
  expirationDate: text("expiration_date"),
  employeeVersion: integer("employee_version").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [check("document_upload_kind_check", sql`${table.kind} IN ('certificate', 'onboarding')`)]);

// Actual onboarding bytes are linked separately from retained legacy filename labels.
export const onboardingDocumentFiles = sqliteTable("onboarding_document_files", {
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  documentName: text("document_name").notNull(),
  fileId: text("file_id").notNull(),
  ...timestamps(),
}, table => [primaryKey({ columns: [table.employeeId, table.documentName] }),
  foreignKey({ columns: [table.fileId, table.employeeId], foreignColumns: [files.id, files.employeeId] }),
]);

// Stage 1 adds forward-only team operations; existing workforce/history is retained.
export const teamSettings = sqliteTable("team_settings", {
  id: integer("id").primaryKey().default(1),
  payPeriod: text("pay_period", { enum: ["weekly", "biweekly", "semimonthly", "monthly"] }).notNull().default("weekly"),
  anchorDate: text("anchor_date").notNull().default("2026-11-02"),
  version: integer("version").notNull().default(1),
}, t => [check("team_settings_period_check", sql`${t.payPeriod} IN ('weekly', 'biweekly', 'semimonthly', 'monthly')`)]);
export const employeePhotos = sqliteTable("employee_photos", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  fileId: text("file_id").notNull(),
}, t => [foreignKey({ columns: [t.fileId, t.employeeId], foreignColumns: [files.id, files.employeeId] })]);
export const teamInvitations = sqliteTable("team_invitations", {
  id: text("id").primaryKey().notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  recipient: text("recipient").notNull(),
  tokenHash: text("token_hash").notNull(),
  localTokenEncrypted: text("local_token_encrypted").notNull(),
  issuedByAccountId: integer("issued_by_account_id").notNull().references(() => accounts.id),
  issuerVersion: integer("issuer_version").notNull(),
  acceptanceReceipt: text("acceptance_receipt").notNull().default(""),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"), revokedAt: text("revoked_at"),
  ...timestamps(),
}, t => [uniqueIndex("team_invitations_token_idx").on(t.tokenHash), index("team_invitations_employee_idx").on(t.employeeId), check("team_invitations_channel_check", sql`${t.channel} IN ('email', 'sms')`)]);

// Durable transactional outbox. Only invitations created after activation enter it.
export const invitationEmails = sqliteTable("invitation_emails", {
  invitationId: text("invitation_id").primaryKey().references(() => teamInvitations.id),
  state: text("state", { enum: ["pending", "sending", "accepted", "failed", "cancelled"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"), leaseUntil: text("lease_until"),
  nextAttemptAt: text("next_attempt_at").notNull(),
  acceptedAt: text("accepted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [index("invitation_emails_due_idx").on(t.state, t.nextAttemptAt),
  check("invitation_emails_state_check", sql`${t.state} IN ('pending','sending','accepted','failed','cancelled')`),
  check("invitation_emails_attempts_check", sql`${t.attempts} >= 0 AND ${t.attempts} <= 4`)]);

// Optional Stage 1 P2: consent and immutable employee recognition.
export const recognitionPreferences = sqliteTable("recognition_preferences", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  shareBirthday: integer("share_birthday", { mode: "boolean" }).notNull().default(false),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const teamShoutouts = sqliteTable("team_shoutouts", {
  id: text("id").primaryKey().notNull(),
  senderEmployeeId: integer("sender_employee_id").notNull().references(() => employees.id),
  recipientEmployeeId: integer("recipient_employee_id").notNull().references(() => employees.id),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  category: text("category").notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [index("team_shoutouts_recipient_date_idx").on(t.recipientEmployeeId, t.createdAt),
  check("team_shoutouts_people_check", sql`${t.senderEmployeeId} <> ${t.recipientEmployeeId}`),
  check("team_shoutouts_category_check", sql`${t.category} IN ('teamwork','helpfulness','customer_service','great_work')`),
  check("team_shoutouts_body_check", sql`length(${t.body}) BETWEEN 1 AND 500`),
]);
export const shoutoutModeration = sqliteTable("shoutout_moderation", {
  shoutoutId: text("shoutout_id").primaryKey().references(() => teamShoutouts.id),
  actorAccountId: integer("actor_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull(),
});

export const scheduleTemplates = sqliteTable("schedule_templates", {
  id: id(),
  name: text("name").notNull(),
  createdByAccountId: integer("created_by_account_id").notNull().references(() => accounts.id),
  version: integer("version").notNull().default(1),
  archivedAt: text("archived_at"),
  ...timestamps(),
}, table => [check("schedule_templates_values_check", sql`length(trim(${table.name})) BETWEEN 1 AND 100 AND ${table.version} > 0`)]);

export const scheduleTemplateEntries = sqliteTable("schedule_template_entries", {
  id: id(),
  templateId: integer("template_id").notNull().references(() => scheduleTemplates.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  roleId: integer("role_id").notNull().references(() => roles.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  shiftType: text("shift_type", { enum: ["work", "day_off"] }).notNull().default("work"),
  color: text("color", { enum: ["blue", "green", "amber", "red", "violet", "gray"] }).notNull().default("blue"),
  station: text("station").notNull().default("Floor"),
  notes: text("notes").notNull().default(""),
}, table => [index("schedule_template_entries_template_idx").on(table.templateId), check("schedule_template_entries_values_check", sql`${table.dayOfWeek} BETWEEN 0 AND 6 AND ${table.shiftType} IN ('work','day_off') AND ${table.color} IN ('blue','green','amber','red','violet','gray') AND ((${table.shiftType} = 'day_off' AND ${table.startTime} = '00:00' AND ${table.endTime} = '00:00') OR (${table.shiftType} = 'work' AND ${table.startTime} < ${table.endTime}))`)]);

export const scheduleNotificationPreferences = sqliteTable("schedule_notification_preferences", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id),
  inApp: integer("in_app", { mode: "boolean" }).notNull().default(true),
  email: integer("email", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
  ...timestamps(),
}, table => [check("schedule_notification_preferences_values_check", sql`${table.inApp} IN (0,1) AND ${table.email} IN (0,1) AND ${table.version} > 0`)]);

export const scheduleEmails = sqliteTable("schedule_emails", {
  id: text("id").primaryKey().notNull(),
  publicationId: integer("publication_id").notNull().references(() => schedulePublications.id),
  recipient: text("recipient").notNull(),
  state: text("state", { enum: ["pending", "sending", "accepted", "uncertain", "cancelled"] }).notNull().default("pending"),
  leaseToken: text("lease_token"),
  leaseUntil: text("lease_until"),
  acceptedAt: text("accepted_at"),
  ...timestamps(),
}, table => [uniqueIndex("schedule_emails_publication_recipient_idx").on(table.publicationId, table.recipient), index("schedule_emails_pending_idx").on(table.state, table.createdAt), check("schedule_emails_state_check", sql`${table.state} IN ('pending','sending','accepted','uncertain','cancelled')`)]);

export const schedulePublicationRecipients = sqliteTable("schedule_publication_recipients", {
  publicationId: integer("publication_id").notNull().references(() => schedulePublications.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  inApp: integer("in_app", { mode: "boolean" }).notNull(),
  emailRequested: integer("email_requested", { mode: "boolean" }).notNull(),
  emailId: text("email_id").references(() => scheduleEmails.id),
}, table => [primaryKey({ columns: [table.publicationId, table.employeeId] }), check("schedule_publication_recipients_flags_check", sql`${table.inApp} IN (0,1) AND ${table.emailRequested} IN (0,1)`)]);
