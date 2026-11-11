import type { AccessLevel, PermissionMap } from "../access/policy";
export type Account = { id: number; employeeId: number | null; displayName: string; email: string; accessLevel: AccessLevel; version: number; disabledAt: string | null; loginEnabled: boolean };
export type Access = { account: Account; permissions: PermissionMap; departmentIds: number[] };
export type Department = { id: number; name: string };
export type EmployeeLink = { id: number; name: string };
export async function accessRequest<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/access/${path}`, { signal, cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load access settings.");
  return result;
}
export function roleName(level: AccessLevel) {
  return { owner: "Owner", general_manager: "General Manager", manager: "Manager", employee: "Employee" }[level];
}
