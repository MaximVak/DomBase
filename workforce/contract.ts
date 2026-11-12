import type { BasicInfo, StaffState } from "./model";
import type { ScheduleEnforcement } from "../app/schedule-enforcement";
import type { PermissionMap } from "../access/policy";
export type { BasicInfo, StaffState };
export type Entity = "employee" | "department" | "schedule-event" | "schedule-draft" | "schedule-publish" | "timecard" | "hours-adjustment" | "pto-request" | "pto-policy" | "availability" | "conversation" | "settings" | "business" | "notifications";
export type Change = { entity: Entity; id: number; before: unknown; after: unknown };
export type WorkspaceData = {
  period?: import("./period").WorkspacePeriod;
  revision: number;
  state: StaffState;
  basicInfo: BasicInfo;
  settings: ScheduleEnforcement;
  permissions: PermissionMap;
  primaryOwnerEmployeeId: number | null;
  departmentManagers?: { accountId: number; departmentId: number; name: string; disabled: boolean; setupPending: boolean }[];
  opened: Record<number, string[]>;
  dismissed: Record<number, string[]>;
  employeeVersions: Record<number, number>;
  teamPeriod?: { payPeriod: import("../team/rules").PayPeriod; anchorDate: string };
};
export const defaultInfo: BasicInfo = { companyName: "Molding Mart", locationName: "Molding Mart", locationPhone: "", companyPhone: "", accountOwner: "", address1: "", address2: "", city: "Sacramento", stateProvince: "California", postalCode: "", country: "United States", timeZone: "America/Los_Angeles", businessType: "", businessCategory: "", website: "" };
export const emptyState = (): StaffState => ({ employees: [], departments: [], shifts: [], scheduleEvents: [], clockEvents: [], hoursAdjustments: [], timeCardEdits: [], ptoRequests: [], ptoPolicies: [], conversations: [], scheduleUpdates: [], scheduleHasBeenPublished: false, pendingScheduleUpdateEmployeeIds: [], scheduleDraftsByManager: {}, availabilityRequests: [], hoursRoundingMinutes: 15 });
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
// Caller-selected IDs are random record identifiers, never identity/authority.
export function newRecordId() { const value = crypto.getRandomValues(new Uint32Array(2)); return (value[0] & 0xfffff) * 4294967296 + value[1] || 1; }
