import { accessRequest } from "./account-access-client";
import type { Access, Account } from "./account-access-client";

// Both department and account screens use the account access version/transaction.
export async function changeManagerDepartment(account: Pick<Account, "id" | "version">, departmentId: number, assigned: boolean, request = accessRequest) {
  const current = await request<Access>(`accounts/${account.id}`);
  if (current.account.version !== account.version || current.account.accessLevel !== "manager") {
    throw new Error("Account access changed. Reload manager assignments before trying again.");
  }
  const departmentIds = current.departmentIds.filter(id => id !== departmentId);
  if (assigned) departmentIds.push(departmentId);
  return request<Access>(`accounts/${account.id}`, undefined, { version: current.account.version, permissions: current.permissions, departmentIds });
}
