export type EmployeeSchedule = {
  employeeId: number;
  locationName: string;
  timeZone: string;
  today: string;
  startDate: string;
  endDate: string;
  ownOnly: boolean;
  shifts: { id: number; employeeId: number; employeeName: string; date: string; start: string; end: string; role: string; station: string }[];
};

export function offsetScheduleDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
