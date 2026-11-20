export type LockAction = "lock" | "unlock";
export type LockEvent = {
  id: number;
  targetKey: string;
  employeeId: number | null;
  startDate: string;
  endDate: string;
  startsAt: string;
  endsAt: string;
  action: LockAction;
  actor: string;
  at: string;
};
export type TimesheetLocks = { revision: number; canLockPeriod: boolean; active: LockEvent[]; history: LockEvent[] };

export function timesheetCardKey(employeeId: number, punchId: number, cardId?: number) {
  return `${cardId ? "card" : "punch"}:${employeeId}:${cardId ?? punchId}`;
}
