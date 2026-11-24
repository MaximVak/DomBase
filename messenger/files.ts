import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { AuthError, json } from "../auth/http";
import { downloadHeaders, fileBytes, validateFileName, validateSignature } from "../documents/validation";
import type { DocumentBucket } from "../documents/types";
import { atomicBatch } from "../kiosk/database";
import type { Database } from "../workforce/context";
import { conversationAccess, uploadToken } from "./context";
import type { MessengerActor } from "./context";
import { messengerFileLimit } from "./model";

type FileRecord = { name: string; type: string; size: number; hash: string; key: string };

export async function uploadMessengerFile(db: Database, actor: MessengerActor, bucket: DocumentBucket, request: Request, conversationId: number, now: number) {
  const guard = conversationAccess(actor, sql`${conversationId}`);
  if (!await db.get(sql`SELECT 1 WHERE ${guard}`)) throw new AuthError(404, "Conversation unavailable.");
  const id = uploadToken(request.headers.get("x-upload-id"));
  const type = request.headers.get("content-type") ?? "";
  let name = "";
  try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); }
  catch { throw new AuthError(400, "Choose a file with a valid name."); }
  const video = type === "video/mp4";
  if (video) {
    if (!/\.mp4$/i.test(name)) throw new AuthError(415, "Choose an MP4 video.");
    validateFileName(name.slice(0, -4) + ".pdf", "application/pdf");
  }
  else validateFileName(name, type);
  const bytes = await fileBytes(request, messengerFileLimit);
  if (video) {
    const brand = new TextDecoder().decode(bytes.subarray(4, 8));
    if (bytes.length < 16 || brand !== "ftyp") throw new AuthError(415, "The file contents do not match MP4.");
  } else validateSignature(bytes, type);
  const key = "message-attachments/" + id;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const stamp = new Date(now).toISOString();
  const expiresAt = new Date(now + 24 * 3600000).toISOString();
  await atomicBatch(db, [
    sql`INSERT INTO files (id,employee_id,uploaded_by_account_id,object_key,file_name,content_type,size_bytes,sha256,status,created_at,updated_at)
      SELECT ${id},${actor.account.employeeId},${actor.account.id},${key},${name},${type},${bytes.length},${hash},'pending',${stamp},${stamp}
      WHERE ${guard} AND (SELECT COUNT(*) FROM message_attachments a JOIN files f ON f.id=a.file_id
        WHERE f.uploaded_by_account_id=${actor.account.id} AND f.status='pending' AND a.expires_at>${stamp})<16
      ON CONFLICT DO NOTHING`,
    sql`INSERT INTO message_attachments (file_id,conversation_id,expires_at)
      SELECT ${id},${conversationId},${expiresAt} WHERE changes()=1`,
  ]);
  const record = await db.get<{ status: string }>(sql`SELECT f.status FROM files f JOIN message_attachments a ON a.file_id=f.id
    WHERE f.id=${id} AND a.conversation_id=${conversationId} AND f.uploaded_by_account_id=${actor.account.id}
      AND f.file_name=${name} AND f.content_type=${type} AND f.size_bytes=${bytes.length} AND f.sha256=${hash}
      AND (f.status='ready' OR f.status='pending' AND a.expires_at>${stamp}) AND ${guard}`);
  if (!record) throw new AuthError(409, "Attachment is unavailable. Remove it or try a new upload.");
  if (record.status === "pending") await bucket.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { fileId: id, sha256: hash } });
  return json({ id, name, type, size: bytes.length }, 201);
}

export async function downloadMessengerFile(db: Database, actor: MessengerActor, bucket: DocumentBucket, id: string) {
  uploadToken(id);
  const visible = conversationAccess(actor, sql`a.conversation_id`);
  const record = await db.get<FileRecord>(sql`SELECT f.file_name AS name,f.content_type AS type,f.size_bytes AS size,f.sha256 AS hash,f.object_key AS key
    FROM message_attachments a JOIN files f ON f.id=a.file_id WHERE a.file_id=${id} AND a.message_id IS NOT NULL AND f.status='ready' AND ${visible}`);
  if (!record) throw new AuthError(404, "Attachment not found.");
  const object = await bucket.get(record.key);
  if (!object || object.size !== record.size || object.customMetadata?.fileId !== id || object.customMetadata?.sha256 !== record.hash) {
    await object?.body.cancel();
    throw new AuthError(503, "Attachment is temporarily unavailable.");
  }
  if (!await db.get(sql`SELECT 1 FROM message_attachments a WHERE a.file_id=${id} AND a.message_id IS NOT NULL AND ${visible}`)) {
    await object.body.cancel();
    throw new AuthError(404, "Attachment not found.");
  }
  return new Response(object.body, { headers: downloadHeaders(record.name, record.type, object.size) });
}

export async function cleanupMessengerUploads(db: Database, bucket: DocumentBucket, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const cutoff = new Date(now - 24 * 3600000).toISOString();
  const pending = await db.all<{ id: string }>(sql`SELECT a.file_id AS id FROM message_attachments a JOIN files f ON f.id=a.file_id
    WHERE a.message_id IS NULL AND f.status='pending' AND a.expires_at<${cutoff} ORDER BY a.expires_at LIMIT 20`);
  for (const { id } of pending) await atomicBatch(db, [
    sql`UPDATE files SET status='deleted',updated_at=${stamp} WHERE id=${id} AND status='pending'
      AND EXISTS(SELECT 1 FROM message_attachments a WHERE a.file_id=${id} AND a.message_id IS NULL AND a.expires_at<${cutoff})`,
    sql`INSERT INTO audit_log (action,entity_type,entity_id,created_at)
      SELECT 'messenger.upload_expired','file',${id},${stamp} WHERE changes()=1`,
  ]);
  const expired = await db.all<{ id: string; key: string }>(sql`SELECT f.id,f.object_key AS key FROM files f JOIN message_attachments a ON a.file_id=f.id
    WHERE a.message_id IS NULL AND f.status='deleted' ORDER BY f.updated_at LIMIT 20`);
  for (const { id, key } of expired) {
    await bucket.delete(key);
    await db.run(sql`UPDATE files SET updated_at=${stamp} WHERE id=${id} AND status='deleted'`);
  }
}
