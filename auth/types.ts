export type DashboardAccount = {
  id: number;
  employeeId: number | null;
  email: string;
  displayName: string;
  accessLevel: "owner" | "general_manager" | "manager";
};
export type EmployeeAccount = Omit<DashboardAccount, "employeeId" | "accessLevel"> & { employeeId: number; accessLevel: "employee" };
export type AuthenticatedAccount = DashboardAccount | EmployeeAccount;
