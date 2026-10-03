type RosterCopyEmployee = {
  id: number;
  name: string;
  email: string;
  phone: string;
  accessLevel: string;
  location: string;
  role: string;
  wage: string;
  active: boolean;
  terminated?: boolean;
};

export const rosterCopyHeaders = [
  "Team member", "Email", "Phone", "Access level", "Location", "Role", "Wage", "Status",
];

export function rosterCopyRows(employees: RosterCopyEmployee[]): string[][] {
  return employees.map((employee) => [
    employee.name,
    employee.email,
    employee.phone,
    employee.id === 1 ? "Admin" : employee.accessLevel,
    employee.location,
    employee.role,
    employee.wage,
    employee.terminated ? "Terminated" : employee.active ? "Active" : "Inactive",
  ]);
}

export function rosterCsv(rows: string[][]): string {
  const quote = (value: string) => {
    // Keep spreadsheet apps from interpreting user-entered values as formulas.
    const text = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${[rosterCopyHeaders, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}
