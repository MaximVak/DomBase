import type { Shift } from "../workforce/model";
export type NotifyMode = "all" | "changed" | "none";
export type PublishOptions = { departmentId: number | null; period: { start: string; end: string } | null; notify: NotifyMode; inApp: boolean; email: boolean };
export type EmailDeliveryState = "pending" | "sending" | "accepted" | "uncertain" | "cancelled";
export type PublicationDelivery = { id: number; version: number; department: string; period: { start: string; end: string } | null; notify: NotifyMode; inAppCount: number; emails: Record<EmailDeliveryState, number>; recipients: { employeeId: number; name: string; inApp: boolean; email: EmailDeliveryState | "no_address" | "not_requested" }[] };
export type PublishPreview = { revision: number; reviewToken: string; needsReview: boolean; issues: string[]; warnings: import("./schedule-conflicts").ConflictAssessment | null; entries: { id: number; action: "add" | "edit" | "remove"; employee: string; before: string; after: string }[]; changes: number; remaining: number; recipients: { employeeId: number; name: string; inApp: boolean; email: boolean }[]; optedOut: number; missingEmail: number; emailDestinations: number; emailConfigured: boolean; masterEnabled: boolean; shifts: Shift[]; latest: PublicationDelivery | null };
const planned = (shift: Shift) => JSON.stringify([shift.employeeId,shift.date,shift.start,shift.end,shift.role,shift.station,shift.shiftType ?? "work",shift.color ?? "blue",shift.notes ?? ""]);
export function changedSchedulePeople(published: Shift[], upserts: Shift[], deletedIds: number[]) {
  const ids = new Set<number>(); const originals = new Map(published.map(shift => [shift.id, shift]));
  for (const row of upserts) { const old = originals.get(row.id); if (!old || planned(old) !== planned(row)) { ids.add(row.employeeId); if (old) ids.add(old.employeeId); } }
  for (const id of deletedIds) { const old = originals.get(id); if (old) ids.add(old.employeeId); }
  return ids;
}
