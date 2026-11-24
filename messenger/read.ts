import { sql } from "drizzle-orm";
import { AuthError } from "../auth/http";
import type { Database } from "../workforce/context";
import { accountNotificationAllowed } from "../workforce/notification-preferences";
import { conversationAccess } from "./context";
import type { MessengerActor } from "./context";
import type { Attachment, MessengerHistory, MessengerHit, MessengerInbox, MessengerThread, Person } from "./model";

const memberName = sql`COALESCE(c.name, (SELECT group_concat(display_name, ', ') FROM (
  SELECT e.name AS display_name FROM conversation_members cm JOIN employees e ON e.id=cm.employee_id
  WHERE cm.conversation_id=c.id AND cm.employee_id<>own.employee_id AND cm.left_at IS NULL ORDER BY e.name,e.id)), 'Conversation')`;

export async function inbox(db: Database, actor: MessengerActor): Promise<MessengerInbox> {
  const { employeeId, id } = actor.account;
  const rows = await db.all<Omit<MessengerThread, "pinned" | "muted"> & { pinned: number; muted: number }>(sql`SELECT
      c.id, ${memberName} AS title, own.pinned, own.muted,
      (SELECT m.sent_at FROM messages m WHERE m.conversation_id=c.id ORDER BY julianday(m.sent_at) DESC,m.id DESC LIMIT 1) AS lastAt,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_employee_id<>${employeeId}
        AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id=m.id AND mr.employee_id=${employeeId})) AS unread,
      CASE WHEN own.muted=0 AND ${accountNotificationAllowed(id, "mention", "inApp")} THEN
        (SELECT COUNT(*) FROM message_mentions mm WHERE mm.conversation_id=c.id AND mm.employee_id=${employeeId} AND mm.notified=1
          AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id=mm.message_id AND mr.employee_id=${employeeId})) ELSE 0 END AS mentions
    FROM conversation_members own JOIN conversations c ON c.id=own.conversation_id
    WHERE own.employee_id=${employeeId} AND ${conversationAccess(actor, sql`c.id`)}
    ORDER BY own.pinned DESC, julianday(lastAt) DESC,julianday(c.created_at) DESC,c.id DESC LIMIT 200`);
  return { employeeId, threads: rows.map(row => ({ ...row, pinned: !!row.pinned, muted: !!row.muted })) };
}

export async function history(db: Database, actor: MessengerActor, conversation: number, before?: number, anchor?: number): Promise<MessengerHistory> {
  const access = conversationAccess(actor, sql`${conversation}`);
  if (!await db.get(sql`SELECT 1 WHERE ${access}`)) throw new AuthError(404, "Conversation unavailable.");
  const targetId = before ?? anchor;
  const target = targetId === undefined ? undefined : await db.get<{ sentAt: number }>(sql`SELECT julianday(sent_at) AS sentAt FROM messages WHERE id=${targetId} AND conversation_id=${conversation} AND ${access}`);
  if (targetId !== undefined && !target) throw new AuthError(404, "Message not found.");
  const period = target
    ? sql`(julianday(m.sent_at)<${target.sentAt} OR julianday(m.sent_at)=${target.sentAt} AND (${before === undefined} AND m.id=${targetId} OR m.id<${targetId}))`
    : sql`1`;
  const [rows, members] = await Promise.all([
    db.all<Omit<MessengerHit, "conversationId"> & { senderId: number }>(sql`SELECT m.id,m.sender_employee_id AS senderId,e.name AS sender,m.body,m.sent_at AS sentAt
      FROM messages m JOIN employees e ON e.id=m.sender_employee_id
      WHERE m.conversation_id=${conversation} AND ${period} AND ${access} ORDER BY julianday(m.sent_at) DESC,m.id DESC LIMIT 51`),
    db.all<Person>(sql`SELECT e.id,e.name FROM conversation_members cm JOIN employees e ON e.id=cm.employee_id
      WHERE cm.conversation_id=${conversation} AND cm.left_at IS NULL AND e.active=1 AND e.terminated=0 AND ${access} ORDER BY e.name,e.id`),
  ]);
  const visible = rows.slice(0, 50);
  const selected = JSON.stringify(visible.map(row => row.id));
  const [files, mentions] = visible.length ? await Promise.all([
    db.all<Attachment & { messageId: number }>(sql`SELECT f.id,f.file_name AS name,f.content_type AS type,f.size_bytes AS size,a.message_id AS messageId
      FROM message_attachments a JOIN files f ON f.id=a.file_id WHERE a.conversation_id=${conversation}
      AND a.message_id IN (SELECT value FROM json_each(${selected})) AND f.status='ready' AND ${access} ORDER BY f.created_at,f.id`),
    db.all<Person & { messageId: number }>(sql`SELECT employee_id AS id,name,message_id AS messageId FROM message_mentions
      WHERE conversation_id=${conversation} AND message_id IN (SELECT value FROM json_each(${selected})) AND ${access} ORDER BY name,employee_id`),
  ]) : [[], []];
  return { members, canLoadOlder: rows.length > 50, messages: visible.reverse().map(row => ({ ...row,
    attachments: files.filter(f => f.messageId === row.id).map(({ id, name, size, type }) => ({ id, name, size, type })),
    mentions: mentions.filter(m => m.messageId === row.id).map(({ id, name }) => ({ id, name })),
  })) };
}

export async function searchMessages(db: Database, actor: MessengerActor, term: string): Promise<MessengerHit[]> {
  if (term.length < 2) throw new AuthError(400, "Enter at least two characters.");
  return db.all<MessengerHit>(sql`SELECT m.id,c.id AS conversationId,e.name AS sender,substr(m.body,1,240) AS body,m.sent_at AS sentAt
    FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
    JOIN messages m ON m.conversation_id=c.id JOIN employees e ON e.id=m.sender_employee_id
    WHERE cm.employee_id=${actor.account.employeeId} AND cm.left_at IS NULL AND ${conversationAccess(actor, sql`c.id`)}
      AND (instr(lower(m.body),lower(${term}))>0 OR EXISTS (SELECT 1 FROM message_attachments a JOIN files f ON f.id=a.file_id
        WHERE a.message_id=m.id AND a.conversation_id=c.id AND f.status='ready' AND instr(lower(f.file_name),lower(${term}))>0))
    ORDER BY julianday(m.sent_at) DESC,m.id DESC LIMIT 50`);
}
