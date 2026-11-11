import { equal, newRecordId } from "./contract";
import type { Change, StaffState, WorkspaceData } from "./contract";
const collections = { employees: "employee", departments: "department", scheduleEvents: "schedule-event", hoursAdjustments: "hours-adjustment", ptoRequests: "pto-request", ptoPolicies: "pto-policy", availabilityRequests: "availability", conversations: "conversation" } as const;
export function stateChanges(before: StaffState, after: StaffState, employeeKey: number): Change[] {
  const changes: Change[] = [];
  for (const [key, entity] of Object.entries(collections) as [keyof typeof collections, typeof collections[keyof typeof collections]][]) {
    const old = before[key]; const next = after[key];
    for (const row of next) { const previous = old.find(old => old.id === row.id) ?? null; if (!equal(previous, row)) changes.push({ entity, id: row.id, before: previous, after: row }); }
    for (const row of old) if (!next.some(next => next.id === row.id)) changes.push({ entity, id: row.id, before: row, after: null });
  }
  const oldDraft = before.scheduleDraftsByManager[employeeKey] ?? null; const newDraft = after.scheduleDraftsByManager[employeeKey] ?? null;
  if (!equal(oldDraft, newDraft)) changes.push({ entity: oldDraft && !newDraft && after.scheduleHasBeenPublished ? "schedule-publish" : "schedule-draft", id: 1, before: oldDraft, after: newDraft ?? (after.scheduleHasBeenPublished ? { publish: true } : null) });
  if (!equal(before.shifts, after.shifts) && !changes.some(change => change.entity === "schedule-publish")) throw new Error("Published shifts must be changed through a schedule draft.");
  if (!equal(before.clockEvents, after.clockEvents)) {
    const ids = before.clockEvents.filter(event => !after.clockEvents.some(next => equal(event, next))).map(event => event.id);
    const added = after.clockEvents.filter(event => !before.clockEvents.some(old => equal(old, event)));
    const edit = after.timeCardEdits?.find(edit => !before.timeCardEdits?.some(old => old.id === edit.id));
    if (!added.length || new Set([...added.map(e => e.employeeId), ...before.clockEvents.filter(e => ids.includes(e.id)).map(e => e.employeeId)]).size !== 1) throw new Error("Record clock actions on the registered tablet. Correct one time card at a time in Timesheets.");
    if (!edit) throw new Error("Clock actions belong on the registered tablet. Use Timesheets for attributed corrections.");
    changes.push({ entity: "timecard", id: edit.id || newRecordId(), before: { events: before.clockEvents.filter(event => ids.includes(event.id)) }, after: { employeeId: added[0].employeeId, date: edit.date, eventIds: ids, events: added, cardId: edit.cardId, reason: added[0].explanation || "Time card corrected", description: edit.after } });
  }
  if (before.hoursRoundingMinutes !== after.hoursRoundingMinutes) throw new Error("Save rounding through location settings.");
  return changes;
}
export function saveBody(data: WorkspaceData, changes: Change[], id: string) { return { id, revision: data.revision, employeeVersions: data.employeeVersions, changes }; }
