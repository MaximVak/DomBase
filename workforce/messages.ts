import { sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { equal } from "./contract";
import type { Change } from "./contract";
import type { RecordContext } from "./records";
import { employeeInScope } from "./records";
import * as v from "./validation";
export async function conversationChange(r: RecordContext, change: Change) {
  r.ctx.requirePermission("messages.read");
  if (!r.view.settings.enableTeamMessaging) throw new AuthError(403, "Messaging is disabled.");
  const employeeId = r.ctx.account.employeeId; if (!employeeId) throw new AuthError(403, "Link your dashboard account to an employee profile before messaging.");
  const employee = await employeeInScope(r, employeeId, true); if (!employee.active || employee.terminated) throw new AuthError(403, "This employee profile is inactive.");
  const before = change.before ? v.object(change.before) : null;
  if (before) {
    const [membership] = await r.db.select().from(s.conversationMembers).where(sql`conversation_id = ${change.id} AND employee_id = ${employeeId} AND left_at IS NULL`);
    if (!membership) throw new AuthError(404, "Conversation unavailable.");
  }
  if (change.after === null) {
    if (!before || before.creatorEmployeeId !== employeeId) throw new AuthError(403, "Only the conversation creator can archive it.");
    r.tx.update(s.conversations, { archivedAt: r.tx.stamp, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND creator_employee_id = ${employeeId} AND archived_at IS NULL`); return;
  }
  const data = v.object(change.after); v.keys(data, ["id", "name", "creatorEmployeeId", "participantIds", "messages", "pinnedByEmployeeIds", "mutedByEmployeeIds"]);
  const participantIds = v.list(data.participantIds, 100).map(id => v.integer(id));
  if (!participantIds.includes(employeeId) || new Set(participantIds).size !== participantIds.length || participantIds.length < 2) throw new AuthError(400, "Choose conversation members once each, including yourself.");
  const name = data.name ? v.text(data.name, 100) : null;
  if (!before) {
    if (data.creatorEmployeeId !== employeeId) throw new AuthError(403, "Conversation identity must match your employee profile.");
    for (const id of participantIds) { const target = await employeeInScope(r, id, id === employeeId); if (!target.active || target.terminated) throw new AuthError(400, "Choose active conversation members."); }
    r.tx.insert(s.conversations, { id: change.id, creatorEmployeeId: employeeId, name });
    for (const id of participantIds) r.tx.insert(s.conversationMembers, { conversationId: change.id, employeeId: id });
  } else {
    if (!equal(data.participantIds, before.participantIds) || data.creatorEmployeeId !== before.creatorEmployeeId) throw new AuthError(400, "Conversation membership cannot be forged or changed here.");
    if (data.name !== before.name) { if (before.creatorEmployeeId !== employeeId) throw new AuthError(403, "Only the creator can rename this conversation."); r.tx.update(s.conversations, { name, updatedAt: r.tx.stamp }, sql`id = ${change.id} AND archived_at IS NULL`); }
  }
  for (const property of ["pinnedByEmployeeIds", "mutedByEmployeeIds"]) {
    const old = v.list(before?.[property] ?? []); const next = v.list(data[property] ?? []);
    if (!equal(old.filter(id => id !== employeeId), next.filter(id => id !== employeeId))) throw new AuthError(403, "Change only your own conversation preferences.");
    if (!equal(old, next)) r.tx.update(s.conversationMembers, { [property === "pinnedByEmployeeIds" ? "pinned" : "muted"]: next.includes(employeeId) }, sql`conversation_id = ${change.id} AND employee_id = ${employeeId} AND left_at IS NULL`);
  }
  const oldMessages = v.list(before?.messages ?? [], 2000); const nextMessages = v.list(data.messages, 2000);
  for (const old of oldMessages) {
    const previous = v.object(old); const next = nextMessages.find(value => v.object(value).id === previous.id);
    if (!next) throw new AuthError(400, "Messages cannot be removed or overwritten.");
    const current = v.object(next);
    for (const key of ["body", "senderEmployeeId", "sentAt"]) if (current[key] !== previous[key]) throw new AuthError(400, "Existing messages cannot be changed.");
    const oldReads = v.list(previous.readByEmployeeIds); const newReads = v.list(current.readByEmployeeIds);
    if (!equal(oldReads.filter(id => id !== employeeId), newReads.filter(id => id !== employeeId)) || (oldReads.includes(employeeId) && !newReads.includes(employeeId))) throw new AuthError(403, "Only your own unread receipt can be marked read.");
    if (!oldReads.includes(employeeId) && newReads.includes(employeeId)) r.tx.insert(s.messageReads, { messageId: v.integer(previous.id), conversationId: change.id, employeeId, readAt: r.tx.stamp }, sql`1 = 1`, { target: ["messageId", "employeeId"], update: ["readAt"] });
  }
  for (const next of nextMessages.filter(value => !oldMessages.some(old => v.object(old).id === v.object(value).id))) {
    const row = v.object(next); v.keys(row, ["id", "senderEmployeeId", "body", "sentAt", "readByEmployeeIds"]);
    if (row.senderEmployeeId !== employeeId || !equal(row.readByEmployeeIds, [employeeId])) throw new AuthError(403, "Message identity must match the signed-in employee.");
    const id = v.integer(row.id);
    r.tx.insert(s.messages, { id, conversationId: change.id, senderEmployeeId: employeeId, body: v.text(row.body, 4000, true), sentAt: r.tx.stamp, idempotencyKey: `${r.tx.id}:${id}` }, before ? sql`EXISTS (SELECT 1 FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id WHERE cm.conversation_id = ${change.id} AND cm.employee_id = ${employeeId} AND cm.left_at IS NULL AND c.archived_at IS NULL)` : sql`1 = 1`);
    r.tx.insert(s.messageReads, { messageId: id, conversationId: change.id, employeeId, readAt: r.tx.stamp });
  }
}
