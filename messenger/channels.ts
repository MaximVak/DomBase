import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { AuthError } from "../auth/http";
import { validEmail } from "../backup/email-config.mjs";
import { channelPosts } from "../db/schema";
import { newRecordId } from "../workforce/contract";
import type { Database } from "../workforce/context";
import { accountNotificationAllowed } from "../workforce/notification-preferences";
import * as v from "../workforce/validation";
import { channelAudience, channelGuard, channelsFor } from "./channel-access";
import type { ChannelActor } from "./channel-access";
import { channelIds } from "./channel-model";
import type { AnnouncementReceipts, Channel, ChannelFeed, ChannelPost } from "./channel-model";
import { commitMessengerWrite } from "./write";

export const announcementAddressHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const announcementEmailAllowed = accountNotificationAllowed(sql`a.id`, "announcement", "email");

async function requireChannel(db: Database, actor: ChannelActor, channel: Channel) {
  const guard = channelGuard(actor, sql`${channel}`);
  if (!await db.get(sql`SELECT 1 WHERE ${guard}`)) throw new AuthError(404, "Channel unavailable.");
  return guard;
}

function project(actor: ChannelActor) {
  return sql`p.id,p.channel,a.display_name AS author,p.title,p.body,p.pinned_at AS pinnedAt,p.created_at AS createdAt,
    r.read_at AS readAt,CASE WHEN p.title IS NOT NULL AND ${actor.canPublish} THEN 1 ELSE 0 END AS canManage
    FROM channel_posts p JOIN accounts a ON a.id=p.author_account_id
    LEFT JOIN channel_announcement_recipients r ON r.post_id=p.id AND r.account_id=${actor.account.id}`;
}

type Row = Omit<ChannelPost, "canManage"> & { canManage: number };
const asPost = (row: Row): ChannelPost => ({ ...row, canManage: !!row.canManage });

export async function readChannel(db: Database, actor: ChannelActor, channel: Channel, emailAvailable: boolean, before?: number, anchor?: number): Promise<ChannelFeed> {
  const guard = await requireChannel(db, actor, channel);
  const target = before ?? anchor;
  const cursor = target ? await db.get<{ createdAt: string }>(sql`SELECT created_at AS createdAt FROM channel_posts WHERE id=${target}
    AND channel=${channel} AND ${guard}`) : undefined;
  if (target && !cursor) throw new AuthError(404, "Post unavailable.");
  const period = cursor ? sql`(p.created_at<${cursor.createdAt} OR p.created_at=${cursor.createdAt} AND
    (p.id<${target} OR ${anchor !== undefined} AND p.id=${target}))` : sql`1`;
  const rows = await db.all<Row>(sql`SELECT ${project(actor)} WHERE p.channel=${channel} AND ${period} AND ${guard}
    ORDER BY p.created_at DESC,p.id DESC LIMIT 51`);
  return { channel, channels: channelsFor(actor), canPublish: actor.canPublish, emailAvailable: actor.canPublish && emailAvailable,
    canLoadOlder: rows.length > 50, posts: rows.slice(0, 50).reverse().map(asPost) };
}

export async function homeAnnouncements(db: Database, actor: ChannelActor) {
  const posts = await db.all<Row>(sql`SELECT ${project(actor)} WHERE p.pinned_at IS NOT NULL AND ${channelGuard(actor, sql`p.channel`)}
    ORDER BY p.pinned_at DESC,p.id DESC LIMIT 10`);
  return posts.map(asPost);
}

async function announcement(db: Database, actor: ChannelActor, id: number) {
  const row = await db.get<{ channel: Channel }>(sql`SELECT p.channel FROM channel_posts p WHERE p.id=${id} AND p.title IS NOT NULL
    AND ${channelGuard(actor, sql`p.channel`)}`);
  if (!row) throw new AuthError(404, "Announcement unavailable.");
  return row;
}

export async function readAnnouncementReceipts(db: Database, actor: ChannelActor, id: number): Promise<AnnouncementReceipts> {
  if (!actor.canPublish) throw new AuthError(403, "Announcement read confirmations are limited to Owners and General Managers.");
  const { channel } = await announcement(db, actor, id);
  const scoped = sql`r.post_id=${id} AND ${channelAudience(sql`${channel}`)} AND ${channelGuard(actor, sql`${channel}`)}`;
  const [counts, people] = await Promise.all([
    db.get<{ total: number; read: number }>(sql`SELECT COUNT(*) AS total,COUNT(r.read_at) AS read
      FROM channel_announcement_recipients r JOIN accounts a ON a.id=r.account_id WHERE ${scoped}`),
    db.all<AnnouncementReceipts["people"][number]>(sql`SELECT r.account_id AS accountId,a.display_name AS name,r.read_at AS readAt
      FROM channel_announcement_recipients r JOIN accounts a ON a.id=r.account_id WHERE ${scoped}
      ORDER BY r.read_at IS NULL,a.display_name,a.id LIMIT 250`),
  ]);
  return { ...counts!, people };
}

export async function postToChannel(db: Database, actor: ChannelActor, body: Record<string, unknown>, opts: { secret: string; now: number; emailAvailable: boolean }) {
  const isAnnouncement = body.action === "announce";
  v.keys(body, isAnnouncement ? ["action", "id", "channel", "title", "body", "pin", "email"] : ["action", "id", "channel", "body"]);
  const channel = v.oneOf(body.channel, channelIds);
  const copy = isAnnouncement && v.boolean(body.email ?? false);
  const pinned = isAnnouncement && v.boolean(body.pin ?? false);
  const title = isAnnouncement ? v.text(body.title, 120, true) : null;
  const message = v.text(body.body, 4000, true);
  if (isAnnouncement && !actor.canPublish) throw new AuthError(403, "Only Owners and General Managers can publish announcements.");
  if (copy && !opts.emailAvailable) throw new AuthError(409, "Announcement email delivery is pending setup.");
  const guard = await requireChannel(db, actor, channel);
  const id = newRecordId();
  // The request id is also the receipt lookup for idempotent retries.
  const readResult = async (key: string) => {
    const row = await db.get<{ id: number }>(sql`SELECT id FROM channel_posts WHERE request_key=${key} AND author_account_id=${actor.account.id} AND ${guard}`);
    if (!row) throw new AuthError(409, "This channel request is already in use.");
    return row;
  };
  return commitMessengerWrite(db, actor, guard, body, opts.secret, opts.now, async tx => {
    tx.insert(channelPosts, { id, requestKey: tx.id, authorAccountId: actor.account.id, channel, title, body: message,
      pinnedAt: pinned ? tx.stamp : null, createdAt: tx.stamp });
    if (isAnnouncement) {
      const subscribers = copy ? await db.all<{ id: number; email: string }>(sql`SELECT a.id,a.normalized_email AS email FROM accounts a
        WHERE a.id<>${actor.account.id} AND ${channelAudience(sql`${channel}`)} AND ${announcementEmailAllowed}`) : [];
      const recipients = subscribers.filter(row => validEmail(row.email)).map(row => ({ ...row, hash: announcementAddressHash(row.email) }));
      const expiresAt = new Date(opts.now + 24 * 3600000).toISOString();
      tx.write(sql`INSERT INTO channel_announcement_recipients (post_id,account_id,read_at,destination_hash,expires_at,state,updated_at)
        SELECT ${id},a.id,CASE WHEN a.id=${actor.account.id} THEN ${tx.stamp} END,json_extract(e.value,'$.hash'),
          CASE WHEN e.value IS NOT NULL THEN ${expiresAt} END,CASE WHEN e.value IS NOT NULL THEN 'pending' END,${tx.stamp}
        FROM accounts a LEFT JOIN json_each(${JSON.stringify(recipients)}) e ON json_extract(e.value,'$.id')=a.id
          AND json_extract(e.value,'$.email')=a.normalized_email AND ${announcementEmailAllowed}
        WHERE ${tx.receipt} AND ${channelAudience(sql`${channel}`)}`);
    }
    return { id };
  }, readResult, "channel");
}

export async function updateAnnouncement(db: Database, actor: ChannelActor, body: Record<string, unknown>, now: number) {
  const isPin = body.action === "pin";
  v.keys(body, isPin ? ["action", "postId", "pinned"] : ["action", "postId"]);
  if (isPin && !actor.canPublish) throw new AuthError(403, "Only Owners and General Managers can change Home pins.");
  const id = v.integer(body.postId);
  const { channel } = await announcement(db, actor, id);
  const guard: SQL = channelGuard(actor, sql`${channel}`);
  const stamp = new Date(now).toISOString();
  if (isPin) {
    const pinned = v.boolean(body.pinned);
    await db.run(sql`UPDATE channel_posts SET pinned_at=CASE WHEN ${pinned} THEN COALESCE(pinned_at,${stamp}) END
      WHERE id=${id} AND title IS NOT NULL AND ${guard}`);
  } else {
    await db.run(sql`INSERT INTO channel_announcement_recipients (post_id,account_id,read_at,updated_at)
      SELECT ${id},${actor.account.id},${stamp},${stamp} WHERE ${guard}
      ON CONFLICT (post_id,account_id) DO UPDATE SET read_at=COALESCE(read_at,excluded.read_at)`);
  }
  return { saved: true };
}
