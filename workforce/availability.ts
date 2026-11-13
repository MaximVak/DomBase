import { AuthError } from "../auth/http";
import { availabilityWeekdays } from "../app/availability-model";
import * as v from "./validation";
import * as s from "../db/schema";
import type { WorkspaceTransaction } from "./transaction";

export function availabilitySlots(value: unknown) {
  const entries = v.list(value, 100).map(entry => {
    const slot = v.object(entry); v.keys(slot, ["day", "preference", "startHour", "endHour", "location"]);
    const dayOfWeek = availabilityWeekdays.indexOf(v.text(slot.day, 10));
    const start = v.number(slot.startHour, 0, 24) * 60, end = v.number(slot.endHour, 0, 24) * 60;
    const startMinute = Math.round(start), endMinute = Math.round(end);
    if (dayOfWeek < 0 || endMinute <= startMinute || startMinute > 1439 || Math.abs(start - startMinute) > 0.000001 || Math.abs(end - endMinute) > 0.000001) throw new AuthError(400, "Enter valid availability times to the minute.");
    if (slot.location !== undefined) v.text(slot.location, 100);
    return { dayOfWeek, startMinute, endMinute, preference: v.oneOf(slot.preference, ["preferred", "unavailable"]) };
  });
  for (const [i, slot] of entries.entries()) if (entries.slice(0, i).some(other => other.dayOfWeek === slot.dayOfWeek && other.startMinute < slot.endMinute && other.endMinute > slot.startMinute)) throw new AuthError(400, "Availability periods on the same day must not overlap.");
  return entries;
}
export function appendAvailability(tx: WorkspaceTransaction, input: { id: number; employeeId: number; accountId: number; effectiveDate: string; note: string; slots: ReturnType<typeof availabilitySlots>; approvalRequired: boolean }) {
  tx.insert(s.availabilityRequests, { id: input.id, employeeId: input.employeeId, submittedByAccountId: input.accountId, effectiveDate: input.effectiveDate, requestNote: input.note, status: input.approvalRequired ? "pending" : "approved", submittedAt: tx.stamp, decidedAt: input.approvalRequired ? null : tx.stamp });
  for (const slot of input.slots) tx.insert(s.availabilitySlots, { requestId: input.id, ...slot });
}
