import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import type { DocumentBucket } from "../documents/types";
import { canonical, newRecordId } from "../workforce/contract";
import type { Database } from "../workforce/context";
import { employeeNotificationAllowed } from "../workforce/notification-preferences";
import { WorkspaceTransaction } from "../workforce/transaction";
import * as v from "../workforce/validation";
import { conversationAccess, messagingEnabled, uploadToken } from "./context";
import type { MessengerActor } from "./context";
import type { MessengerRoster, Person } from "./model";
import { messengerFilesPerMessage } from "./model";

const active = sql`e.active=1 AND e.terminated=0`;
const enabledActor = (actor: MessengerActor) => sql`${actor.activeActor()} AND ${messagingEnabled}`;
const within = (value: SQL, values: readonly (number | string)[]) => sql`${value} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

export async function roster(db: Database, actor: MessengerActor): Promise<MessengerRoster> {
  const [people, departments] = await Promise.all([
    db.all<Person>(sql`SELECT e.id,e.name FROM employees e WHERE ${active} AND e.id<>${actor.account.employeeId}
      AND ${actor.employeeScope(sql`e.id`)} AND ${enabledActor(actor)} ORDER BY e.name,e.id LIMIT 500`),
    db.all<Person>(sql`SELECT d.id,d.name FROM departments d WHERE d.archived=0 AND ${actor.departmentScope(sql`d.id`)}
      AND ${enabledActor(actor)} ORDER BY d.name,d.id LIMIT 100`),
  ]);
  return { people, departments, canGroupBySchedule: actor.scheduleScope !== "none" };
}

export async function commitMessengerWrite<T>(db: Database, actor: { account: { id: number } }, guard: SQL, body: Record<string, unknown>, secret: string, now: number,
  prepare: (tx: WorkspaceTransaction) => Promise<T>, result: (key: string) => Promise<T>, entity = "conversation"): Promise<T> {
  if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid message request identifier.");
  const key = body.id;
  const hash = "messenger:" + rateKey(secret, canonical(body));
  const previous = async () => {
    const row = await db.get<{ id: number; hash: string }>(sql`SELECT account_id AS id,body_hash AS hash FROM workforce_commits WHERE id=${key} AND ${guard}`);
    if (!row) return undefined;
    if (row.id !== actor.account.id || row.hash !== hash) throw new AuthError(409, "This message request is already in use.");
    return result(key);
  };
  const prior = await previous();
  if (prior !== undefined) return prior;
  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = await db.get<{ revision: number }>(sql`SELECT revision FROM workforce_state WHERE id=1 AND ${guard}`);
    if (!revision) throw new AuthError(404, "Conversation unavailable.");
    const tx = new WorkspaceTransaction(db, { account: actor.account, activeActor: () => sql`${guard}
      AND NOT EXISTS(SELECT 1 FROM workforce_commits WHERE id=${key})` }, key, new Date(now).toISOString());
    const ready = await prepare(tx);
    if (await tx.commit(revision.revision, hash, [entity])) return ready;
    const retry = await previous();
    if (retry !== undefined) return retry;
  }
  throw new AuthError(409, "Messaging changed. Retry your request.");
}

export async function createConversation(db: Database, actor: MessengerActor, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["action", "id", "conversationId", "source", "name", "people", "departmentId", "date"]);
  const kind = v.oneOf(body.source, ["people", "department", "schedule"]);
  const id = v.integer(body.conversationId);
  const own = actor.account.employeeId;
  let name = v.text(body.name ?? "", 100);
  let members: SQL;
  let scope = enabledActor(actor);
  if (kind === "people") {
    const ids = v.list(body.people, 99).map(person => v.integer(person));
    if (!ids.length || new Set(ids).size !== ids.length || ids.includes(own)) throw new AuthError(400, "Choose teammates once each.");
    members = sql`${within(sql`e.id`, ids)} AND ${actor.employeeScope(sql`e.id`)}`;
    const check = await db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM employees e WHERE ${members} AND ${active} AND ${scope}`);
    if (check?.count !== ids.length) throw new AuthError(403, "One or more teammates are outside your access.");
  } else if (kind === "department") {
    const dep = v.integer(body.departmentId);
    scope = sql`${scope} AND EXISTS (SELECT 1 FROM departments d WHERE d.id=${dep} AND d.archived=0 AND ${actor.departmentScope(sql`d.id`)})`;
    const department = await db.get<{ name: string }>(sql`SELECT name FROM departments WHERE id=${dep} AND ${scope}`);
    if (!department) throw new AuthError(404, "Department unavailable.");
    name ||= department.name.slice(0, 100);
    members = sql`${actor.employeeScope(sql`e.id`)} AND EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id
      WHERE er.employee_id=e.id AND er.active=1 AND r.archived=0 AND r.department_id=${dep})`;
  } else {
    const date = v.date(body.date);
    if (actor.scheduleScope === "none") throw new AuthError(403, "Schedule access is required.");
    const published = sql`sh.date=${date} AND sh.archived_at IS NULL AND sh.publication_id IS NOT NULL AND sh.shift_type='work'`;
    if (actor.scheduleScope === "own") scope = sql`${scope} AND EXISTS (SELECT 1 FROM shifts sh WHERE sh.employee_id=${own} AND ${published})`;
    members = sql`${actor.employeeScope(sql`e.id`)} AND EXISTS (SELECT 1 FROM shifts sh JOIN roles r ON r.id=sh.role_id JOIN departments d ON d.id=r.department_id
      WHERE sh.employee_id=e.id AND r.archived=0 AND d.archived=0 AND ${published} AND ${actor.roleScope(sql`sh.role_id`)})`;
    name ||= "Schedule " + date;
  }
  return commitMessengerWrite(db, actor, scope, body, secret, now, async tx => {
    const others = await db.all<{ id: number }>(sql`SELECT e.id FROM employees e WHERE e.id<>${own} AND ${active} AND ${members} AND ${scope} ORDER BY e.id LIMIT 100`);
    if (!others.length || others.length >= 100) throw new AuthError(400, "Choose a group with between 1 and 99 other teammates.");
    const eligible = sql`SELECT e.id FROM employees e WHERE ${active} AND (e.id=${own} OR (${members})) AND ${scope}`;
    tx.insert(s.conversations, { id, creatorEmployeeId: own, name: name || null, createdAt: tx.stamp, updatedAt: tx.stamp },
      sql`NOT EXISTS(SELECT 1 FROM conversations WHERE id=${id}) AND (SELECT COUNT(*) FROM (${eligible}))=${others.length + 1}`);
    tx.write(sql`INSERT INTO conversation_members (conversation_id,employee_id,joined_at)
      SELECT ${id},candidate.id,${tx.stamp} FROM (${eligible}) candidate
      WHERE ${tx.receipt} AND ${within(sql`candidate.id`, [own, ...others.map(row => row.id)])}`, others.length + 1);
    return { id };
  }, async () => ({ id }));
}

export async function sendMessage(db: Database, actor: MessengerActor, bucket: DocumentBucket | undefined, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["action", "id", "conversationId", "body", "mentions", "attachments"]);
  const conversation = v.integer(body.conversationId);
  const { id: accountId, employeeId } = actor.account;
  const message = v.text(body.body, 4000);
  const mentionIds = v.list(body.mentions ?? [], 20).map(person => v.integer(person));
  const attachmentIds = v.list(body.attachments ?? [], messengerFilesPerMessage).map(uploadToken);
  if ((!message && !attachmentIds.length) || new Set(mentionIds).size !== mentionIds.length || mentionIds.includes(employeeId)
    || new Set(attachmentIds).size !== attachmentIds.length) throw new AuthError(400, "Write a message or add an attachment. Select each mention and attachment once.");
  const guard = conversationAccess(actor, sql`${conversation}`);
  const stored = message || (attachmentIds.length === 1 ? "Shared an attachment." : "Shared attachments.");
  return commitMessengerWrite(db, actor, guard, body, secret, now, async tx => {
    const members = sql`cm.conversation_id=${conversation} AND cm.left_at IS NULL AND ${within(sql`cm.employee_id`, mentionIds)}`;
    const mentions = mentionIds.length ? await db.all<{ id: number; name: string }>(sql`SELECT e.id,e.name FROM conversation_members cm JOIN employees e ON e.id=cm.employee_id
      WHERE ${members} AND ${active} AND ${guard}`) : [];
    if (mentions.length !== mentionIds.length || mentions.some(person => !message.includes("@" + person.name))) {
      throw new AuthError(400, "Mentions must name active members of this conversation.");
    }
    const fileGuard = sql`f.status='pending' AND f.uploaded_by_account_id=${accountId} AND a.file_id=f.id
      AND a.conversation_id=${conversation} AND a.message_id IS NULL AND a.expires_at>${tx.stamp}`;
    if (attachmentIds.length) {
      if (!bucket) throw new AuthError(503, "Attachment storage is unavailable.");
      const files = await db.all<{ id: string; key: string; hash: string; size: number }>(sql`SELECT f.id,f.object_key AS key,f.sha256 AS hash,f.size_bytes AS size
        FROM files f JOIN message_attachments a ON a.file_id=f.id WHERE ${within(sql`f.id`, attachmentIds)} AND ${fileGuard} AND ${guard}`);
      if (files.length !== attachmentIds.length) throw new AuthError(409, "One or more attachments are unavailable.");
      await Promise.all(files.map(async file => {
        const object = await bucket.get(file.key);
        const valid = object?.size === file.size && object.customMetadata?.sha256 === file.hash && object.customMetadata?.fileId === file.id;
        await object?.body.cancel();
        if (!valid) throw new AuthError(409, "An attachment has not finished uploading.");
      }));
    }
    const id = newRecordId();
    tx.insert(s.messages, { id, conversationId: conversation, senderEmployeeId: employeeId, body: stored, sentAt: tx.stamp, idempotencyKey: "messenger:" + tx.id });
    tx.insert(s.messageReads, { messageId: id, conversationId: conversation, employeeId, readAt: tx.stamp });
    if (mentions.length) {
      const notify = employeeNotificationAllowed(sql`e.id`, "mention", "inApp");
      tx.write(sql`INSERT INTO message_mentions (message_id,conversation_id,employee_id,name,notified)
        SELECT ${id},${conversation},e.id,e.name,CASE WHEN cm.muted=0 AND ${notify}
          AND EXISTS(SELECT 1 FROM accounts a WHERE a.employee_id=e.id AND a.login_enabled=1 AND a.disabled_at IS NULL) THEN 1 ELSE 0 END
        FROM conversation_members cm JOIN employees e ON e.id=cm.employee_id JOIN json_each(${JSON.stringify(mentions)}) j
          ON json_extract(j.value,'$.id')=e.id AND json_extract(j.value,'$.name')=e.name
        WHERE ${members} AND ${active} AND ${tx.receipt}`, mentions.length);
    }
    if (attachmentIds.length) {
      tx.write(sql`UPDATE message_attachments AS a SET message_id=${id} WHERE ${within(sql`a.file_id`, attachmentIds)}
        AND ${tx.receipt} AND EXISTS(SELECT 1 FROM files f WHERE ${fileGuard})`, attachmentIds.length);
      tx.write(sql`UPDATE files SET status='ready',updated_at=${tx.stamp} WHERE ${within(sql`id`, attachmentIds)}
        AND uploaded_by_account_id=${accountId} AND status='pending' AND ${tx.receipt}`, attachmentIds.length);
    }
    return { id };
  }, async key => {
    const prior = await db.get<{ id: number }>(sql`SELECT id FROM messages WHERE idempotency_key=${"messenger:" + key} AND conversation_id=${conversation} AND ${guard}`);
    if (!prior) throw new AuthError(404, "Message not found.");
    return prior;
  });
}

export async function markConversation(db: Database, actor: MessengerActor, body: Record<string, unknown>, now: number) {
  const id = v.integer(body.conversationId);
  const access = conversationAccess(actor, sql`${id}`);
  if (!await db.get(sql`SELECT 1 WHERE ${access}`)) throw new AuthError(404, "Conversation unavailable.");
  if (body.action === "read") {
    v.keys(body, ["action", "conversationId", "through"]);
    const through = v.integer(body.through);
    await db.run(sql`INSERT INTO message_reads (message_id,conversation_id,employee_id,read_at)
      SELECT m.id,${id},${actor.account.employeeId},${new Date(now).toISOString()} FROM messages m JOIN messages cursor ON cursor.id=${through} AND cursor.conversation_id=${id}
      WHERE m.conversation_id=${id} AND (julianday(m.sent_at)<julianday(cursor.sent_at)
        OR julianday(m.sent_at)=julianday(cursor.sent_at) AND m.id<=cursor.id)
        AND ${access} ON CONFLICT DO NOTHING`);
  } else {
    v.keys(body, ["action", "conversationId", "pinned", "muted"]);
    if (body.pinned === undefined && body.muted === undefined) throw new AuthError(400, "Choose how to manage this conversation.");
    const pinned = body.pinned === undefined ? sql`pinned` : sql`${v.boolean(body.pinned)}`;
    const muted = body.muted === undefined ? sql`muted` : sql`${v.boolean(body.muted)}`;
    await db.run(sql`UPDATE conversation_members SET pinned=${pinned},muted=${muted} WHERE conversation_id=${id}
      AND employee_id=${actor.account.employeeId} AND left_at IS NULL AND ${access}`);
  }
  return { saved: true };
}
