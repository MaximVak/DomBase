import { sql } from "drizzle-orm";
import type { Database } from "../workforce/context";
import { atomicBatch } from "../kiosk/database";
import type { DocumentBucket } from "./types";

// Only abandoned, never-published uploads are eligible. Replaced ready documents
// retain their bytes for recovery. A deleted marker prevents late publication;
// future runs retry deletion if an in-flight R2 write arrives after this run.
export async function cleanupDocumentUploads(db: Database, bucket: DocumentBucket, now = Date.now()) {
  const cutoff = new Date(now - 24 * 3600000).toISOString(); const stamp = new Date(now).toISOString();
  const pending = await db.all<{ id: string }>(sql`SELECT f.id FROM files f JOIN document_uploads du ON du.file_id = f.id WHERE f.status = 'pending' AND du.expires_at < ${cutoff} ORDER BY du.expires_at LIMIT 20`);
  for (const row of pending) await atomicBatch(db, [
    sql`UPDATE files SET status = 'deleted', updated_at = ${stamp} WHERE id = ${row.id} AND status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM employee_certificates WHERE file_id = ${row.id}) AND NOT EXISTS (SELECT 1 FROM onboarding_document_files WHERE file_id = ${row.id})`,
    sql`INSERT INTO audit_log (action, entity_type, entity_id, created_at) SELECT 'document.upload_expired', 'file', ${row.id}, ${stamp} WHERE changes() = 1`,
  ]);
  const deleted = await db.all<{ id: string; key: string }>(sql`SELECT f.id, f.object_key AS key FROM files f WHERE f.status = 'deleted'
    AND EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'document.upload_expired' AND a.entity_id = f.id)
    AND NOT EXISTS (SELECT 1 FROM employee_certificates WHERE file_id = f.id) AND NOT EXISTS (SELECT 1 FROM onboarding_document_files WHERE file_id = f.id)
    ORDER BY f.updated_at LIMIT 20`);
  for (const row of deleted) {
    await bucket.delete(row.key);
    // Rotate tombstones through a bounded scan, so old completed deletions do
    // not prevent cleanup of later failures or an exceptionally late R2 write.
    await db.run(sql`UPDATE files SET updated_at = ${stamp} WHERE id = ${row.id} AND status = 'deleted'`);
  }
  return { expired: pending.length, deletionAttempts: deleted.length };
}
