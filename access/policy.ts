// Public labels/defaults only. Server context, account roles and grants come from D1.
export const permissionCatalog = [
  { id: "team.invite", label: "Invite employees to their own profile", manager: false, generalManager: false },
  { id: "team.read", label: "View team roster", manager: true, generalManager: true },
  { id: "team.contact.read", label: "View employee email and phone", manager: false, generalManager: true },
  { id: "team.manage", label: "Edit employee contact and job information", manager: false, generalManager: true },
  { id: "team.private.read", label: "View private employee profiles", manager: false, generalManager: false },
  { id: "team.notes.read", label: "View employee manager notes", manager: false, generalManager: false },
  { id: "departments.manage", label: "Manage departments and job roles", manager: false, generalManager: true },
  { id: "schedule.read", label: "View schedules", manager: true, generalManager: true },
  { id: "schedule.manage", label: "Create, edit and publish schedules", manager: true, generalManager: true },
  { id: "schedule.notes.read", label: "View shift notes", manager: false, generalManager: true },
  { id: "schedule.notes.manage", label: "Edit shift notes", manager: false, generalManager: true },
  { id: "timesheets.read", label: "View timesheets", manager: true, generalManager: true },
  { id: "timesheets.manage", label: "Correct timesheets", manager: false, generalManager: true },
  { id: "timesheets.lock", label: "Lock and unlock time cards", manager: false, generalManager: false },
  { id: "time_off.read", label: "View time-off requests", manager: true, generalManager: true },
  { id: "time_off.approve", label: "Approve time-off requests", manager: false, generalManager: true },
  { id: "availability.read", label: "View availability requests", manager: true, generalManager: true },
  { id: "availability.approve", label: "Approve availability requests", manager: false, generalManager: true },
  { id: "wages.read", label: "View wages", manager: false, generalManager: false },
  { id: "wages.manage", label: "Change wage rates", manager: false, generalManager: false },
  { id: "reports.read", label: "View company reports", manager: false, generalManager: true },
  { id: "exports.timesheets", label: "Export timesheets for accountants", manager: false, generalManager: false },
  { id: "messages.read", label: "Read conversations you belong to", manager: true, generalManager: true },
  { id: "documents.read", label: "View employee document metadata", manager: false, generalManager: false },
  { id: "documents.download", label: "Download employee documents", manager: false, generalManager: false },
  { id: "documents.manage", label: "Upload employee documents", manager: false, generalManager: false },
  { id: "settings.manage", label: "Change workplace settings", manager: false, generalManager: true },
  { id: "kiosk.manage", label: "Register and revoke clock devices", manager: false, generalManager: true },
  { id: "kiosk.approve", label: "Approve clock requests with a separate tablet PIN", manager: true, generalManager: true },
] as const;

export type Permission = typeof permissionCatalog[number]["id"];
export type PermissionMap = Record<Permission, boolean>;
export type AccessLevel = "owner" | "general_manager" | "manager" | "employee";

export function isPermission(value: string): value is Permission {
  return permissionCatalog.some(permission => permission.id === value);
}

export function permissionsFor(level: AccessLevel, overrides: ReadonlyArray<{ permission: string; allowed: boolean }>): PermissionMap {
  return Object.fromEntries(permissionCatalog.map(permission => {
    // Employees are not dashboard principals. Owner authority is not delegable.
    const override = overrides.find(row => row.permission === permission.id);
    const allowed = level === "owner" || ((level === "manager" || level === "general_manager") &&
      (override?.allowed ?? (level === "general_manager" ? permission.generalManager : permission.manager)));
    return [permission.id, allowed];
  })) as PermissionMap;
}
