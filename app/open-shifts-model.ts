import type { ShiftColor } from "./shift-builder";
export type OpenShift = { id: number; roleId: number; role: string; departmentId: number | null; date: string; start: string; end: string; station: string; color: ShiftColor; notes?: string; version: number; filledShiftId?: number | null; archived?: boolean; pendingClaims?: number };
export type OpenShiftDraft = { upserted: OpenShift[]; deletedIds: number[] };
export type OpenSchedule = { published: OpenShift[]; draft: OpenShiftDraft | null; roles: { id: number; name: string; departmentId: number | null }[] };
export type ClaimStatus = "pending" | "approved" | "declined" | "withdrawn" | "cancelled";
export type OpenShiftClaim = { id: number; openShiftId: number; employeeId: number; employee?: string; status: ClaimStatus; version: number; openVersion: number; requestedAt: string; decidedAt: string | null; reason: string; shift: Pick<OpenShift, "id" | "role" | "departmentId" | "date" | "start" | "end" | "station" | "color"> };
export type OwnOpenShifts = { revision: number; contextToken: string; eligible: boolean; startDate: string; endDate: string; open: (OpenShift & { canClaim: boolean; unavailable: string })[]; claims: OpenShiftClaim[]; nextCursor: number | null };
export function workingOpenShifts(data: OpenSchedule) {
  const replaced = new Set([...(data.draft?.upserted.map(row => row.id) ?? []), ...(data.draft?.deletedIds ?? [])]);
  return [...data.published.filter(row => !row.archived && !row.filledShiftId && !replaced.has(row.id)), ...(data.draft?.upserted ?? [])].sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id-b.id);
}
export function openShiftIsFuture(date: string, start: string, now: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  return `${date}T${start}` > `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function occupiedScheduleIntervals(rows:{date:string;start:string;end:string;shiftType?:string}[]) {
 const intervals=rows.map(row=>{const dayOff=row.shiftType==='day_off',start=Date.parse(`${row.date}T${dayOff?'00:00':row.start}:00Z`);let end=Date.parse(`${row.date}T${dayOff?'00:00':row.end}:00Z`);if(dayOff||end<=start)end+=86400000;return{start,end};}).filter(row=>Number.isFinite(row.start)&&Number.isFinite(row.end)).sort((a,b)=>a.start-b.start);
 const merged:{start:number;end:number}[]=[];for(const row of intervals){const prior=merged.at(-1);if(prior&&row.start<=prior.end)prior.end=Math.max(prior.end,row.end);else merged.push({...row});}return merged;
}
export function openShiftConflicts(shift:{date:string;start:string;end:string},occupied:{start:number;end:number}[]){
 const start=Date.parse(`${shift.date}T${shift.start}:00Z`),end=Date.parse(`${shift.date}T${shift.end}:00Z`);let low=0,high=occupied.length;while(low<high){const middle=(low+high)>>>1;if(occupied[middle].end<=start)low=middle+1;else high=middle;}return low<occupied.length&&occupied[low].start<end;
}
