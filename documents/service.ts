import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, json, readAuthBody } from "../auth/http";
import { newToken, rateKey, tokenIsValid } from "../auth/crypto";
import type { createAuthService } from "../auth/service";
import { readSessionCookie, isLoopback } from "../auth/http";
import { registeredDevice } from "../kiosk/device";
import type { AuthenticatedAccount } from "../auth/types";
import type { createAccessService } from "../access/service";
import { atomicBatch } from "../kiosk/database";
import type { Database } from "../workforce/context";
import { WorkspaceTransaction } from "../workforce/transaction";
import { canonical, newRecordId } from "../workforce/contract";
import * as v from "../workforce/validation";
import { documentNames, maxFileBytes } from "./types";
import type { DocumentBucket } from "./types";
import { downloadHeaders, fileBytes, validateFileName, validateSignature } from "./validation";

class FreshUploadError extends AuthError { constructor(message: string) { super(409, message); } }
type Access = ReturnType<typeof createAccessService>;
type ManagementContext = Awaited<ReturnType<Access["workspaceContext"]>>;
type Context = Pick<ManagementContext, "employeeFilter" | "activeActor" | "requirePermission" | "requireEmployee"> & { account: AuthenticatedAccount; selfPhoto?: boolean };
export function createDocumentService(db: Database, access: Access, options: { bucket?: DocumentBucket; secret: string; now?: () => number; selfAuth?: ReturnType<typeof createAuthService> }) {
  const now = options.now ?? Date.now;
  async function photoContext(request: Request): Promise<Context> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
    if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use your own browser for profile photos.");
    const session = await options.selfAuth!.getSession(readSessionCookie(request.headers.get("cookie"), url));
    if (!session || session.account.accessLevel !== "employee") throw new AuthError(401, "Sign in as an employee.");
    const { account, version, sessionId } = session;
    const guard = () => sql`EXISTS (SELECT 1 FROM accounts a JOIN account_sessions acs ON acs.account_id = a.id JOIN employees e ON e.id = a.employee_id WHERE a.id = ${account.id} AND a.employee_id = ${account.employeeId} AND a.access_level = 'employee' AND a.session_version = ${version} AND acs.id = ${sessionId} AND acs.session_version = a.session_version AND a.login_enabled = 1 AND a.disabled_at IS NULL AND acs.revoked_at IS NULL AND julianday(acs.expires_at) > julianday(${new Date(now()).toISOString()}) AND julianday(COALESCE(acs.last_seen_at, acs.created_at)) > julianday(${new Date(now() - 1800000).toISOString()}) AND e.active = 1 AND e.terminated = 0)`;
    return { account, selfPhoto: true, activeActor: guard, employeeFilter: column => sql`${column} = ${account.employeeId}`, requirePermission: () => {}, requireEmployee: async id => { if (id !== account.employeeId) throw new AuthError(404, "Photo not found."); } };
  }
  async function employee(ctx: Context, id: number, write: boolean, kind: string) {
    if (ctx.selfPhoto && (kind !== "photo" || id !== ctx.account.employeeId)) throw new AuthError(404, "Photo not found.");
    if (kind === "photo") { ctx.requirePermission("team.read"); await ctx.requireEmployee(id, write ? "team.manage" : "team.read"); return; }
    ctx.requirePermission("team.read"); ctx.requirePermission("documents.read");
    await ctx.requireEmployee(id, write ? "documents.manage" : "documents.download");
    if (write) ctx.requirePermission("team.manage");
    if (kind === "onboarding") ctx.requirePermission("team.private.read");
  }
  async function fileRecord(ctx: Context, id: string, write: boolean) {
    const [row] = await db.select({ file: s.files, upload: s.documentUploads }).from(s.files).innerJoin(s.documentUploads, eq(s.documentUploads.fileId, s.files.id)).where(and(eq(s.files.id, id), sql`${s.files.status} <> 'deleted'`)).limit(1);
    if (!row) throw new AuthError(404, "Document not found.");
    await employee(ctx, row.file.employeeId, write, row.upload.isProfilePhoto ? "photo" : row.upload.kind);
    if (write && row.file.uploadedByAccountId !== ctx.account.id) throw new AuthError(403, "This upload belongs to a different account.");
    return { file: row.file, upload: row.upload.isProfilePhoto ? { ...row.upload, kind: "photo" as const } : row.upload };
  }
  async function prepare(ctx: Context, request: Request) {
    const body = await readAuthBody(request); v.keys(body, ["id", "employeeId", "kind", "title", "expirationDate", "fileName", "contentType", "sizeBytes", "sha256"]);
    if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid upload identifier.");
    const id = body.id; const employeeId = v.integer(body.employeeId); const kind = v.oneOf(body.kind, ["certificate", "onboarding", "photo"]);
    await employee(ctx, employeeId, true, kind);
    const title = v.text(body.title, 100, true); const expiration = body.expirationDate ? v.date(body.expirationDate) : null;
    if (kind === "onboarding" && (!(documentNames as readonly string[]).includes(title) || expiration)) throw new AuthError(400, "Choose a supported onboarding document.");
    const name = v.text(body.fileName, 180, true); const type = v.text(body.contentType, 60, true); validateFileName(name, type);
    if (kind === "photo" && !["image/png", "image/jpeg"].includes(type)) throw new AuthError(415, "Profile photos must be PNG or JPEG.");
    const size = v.integer(body.sizeBytes, 1, maxFileBytes); const sha256 = v.text(body.sha256, 64, true);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AuthError(400, "Invalid file checksum.");
    const hash = rateKey(options.secret, canonical(body));
    const existing = await db.get<{ hash: string; accountId: number; status: string }>(sql`SELECT du.body_hash AS hash, f.uploaded_by_account_id AS accountId, f.status FROM document_uploads du JOIN files f ON f.id = du.file_id WHERE du.file_id = ${id}`);
    if (existing) {
      if (existing.hash !== hash || existing.accountId !== ctx.account.id || existing.status === "deleted") throw new AuthError(409, "This upload identifier is already in use.");
      return json({ fileId: id, ready: existing.status === "ready" });
    }
    const stamp = new Date(now()).toISOString(); const expires = new Date(now() + 15 * 60000).toISOString(); const certId = kind === "certificate" ? newRecordId() : null;
    await atomicBatch(db, [
      sql`INSERT INTO files (id, employee_id, uploaded_by_account_id, object_key, file_name, content_type, size_bytes, sha256, status, created_at, updated_at)
        SELECT ${id}, e.id, ${ctx.account.id}, ${`employee-documents/${employeeId}/${id}`}, ${name}, ${type}, ${size}, ${sha256}, 'pending', ${stamp}, ${stamp}
        FROM employees e WHERE e.id = ${employeeId} AND ${ctx.employeeFilter(sql`e.id`)} AND ${ctx.activeActor()} ON CONFLICT(id) DO NOTHING`,
      sql`INSERT INTO document_uploads (file_id, body_hash, kind, is_profile_photo, title, certificate_id, expiration_date, employee_version, expires_at, created_at)
        SELECT ${id}, ${hash}, ${kind === "photo" ? "certificate" : kind}, ${kind === "photo" ? 1 : 0}, ${title}, ${certId}, ${expiration}, e.version, ${expires}, ${stamp} FROM employees e WHERE e.id = ${employeeId} AND changes() = 1`,
    ]);
    const reserved = await db.get<{ hash: string; accountId: number }>(sql`SELECT du.body_hash AS hash, f.uploaded_by_account_id AS accountId FROM document_uploads du JOIN files f ON f.id = du.file_id WHERE du.file_id = ${id}`);
    if (!reserved || reserved.hash !== hash || reserved.accountId !== ctx.account.id) throw new AuthError(409, "Your access or the upload changed. Reload before uploading.");
    return json({ fileId: id, ready: false });
  }
  async function upload(ctx: Context, request: Request, id: string) {
    const row = await fileRecord(ctx, id, true); const { file, upload } = row;
    const bytes = await fileBytes(request);
    if (request.headers.get("content-type") !== file.contentType || bytes.length !== file.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new AuthError(400, "The upload does not match the chosen file.");
    validateSignature(bytes, file.contentType);
    const latest = await db.get<{ status: string; version: number }>(sql`SELECT f.status, e.version FROM files f JOIN employees e ON e.id = f.employee_id WHERE f.id = ${id}`);
    if (latest?.status === "ready") {
      const stored = await options.bucket!.get(file.objectKey);
      if (!stored || stored.size !== file.sizeBytes || stored.customMetadata?.sha256 !== file.sha256 || stored.customMetadata?.fileId !== id) throw new AuthError(503, "The stored file is temporarily unavailable.");
      await stored.body.cancel(); return json({ fileId: id, employeeId: file.employeeId });
    }
    if (latest?.status !== "pending") throw new AuthError(409, "This upload is no longer available.");
    if (upload.expiresAt <= new Date(now()).toISOString()) throw new FreshUploadError("This upload expired. Retry to start a fresh upload.");
    if (latest.version !== upload.employeeVersion) throw new FreshUploadError("The employee record changed. Reload and retry the upload.");
    // R2 and D1 cannot share a transaction. Pending objects remain inaccessible;
    // finalize the link, status, employee/workspace version and audit atomically.
    await options.bucket!.put(file.objectKey, bytes, { httpMetadata: { contentType: file.contentType }, customMetadata: { fileId: id, sha256: file.sha256! } });
    const [state] = await db.select().from(s.workforceState);
    const stamp = new Date(now()).toISOString(); const tx = new WorkspaceTransaction(db, ctx, newToken(), stamp);
    tx.update(s.files, { status: "ready", updatedAt: stamp }, sql`id = ${id} AND status = 'pending' AND uploaded_by_account_id = ${ctx.account.id}`);
    tx.update(s.employees, { version: upload.employeeVersion + 1, updatedAt: stamp }, sql`id = ${file.employeeId} AND version = ${upload.employeeVersion} AND ${ctx.employeeFilter(sql`employees.id`)}`);
    if (upload.kind === "certificate") tx.insert(s.employeeCertificates, { id: upload.certificateId, employeeId: file.employeeId, name: upload.title, expirationDate: upload.expirationDate, fileId: id, createdAt: stamp, updatedAt: stamp });
    else if (upload.kind === "photo") {
      tx.write(sql`UPDATE files SET status = 'deleted', updated_at = ${stamp} WHERE id IN (SELECT file_id FROM employee_photos WHERE employee_id = ${file.employeeId}) AND id <> ${id} AND ${tx.receipt}`);
      tx.insert(s.employeePhotos, { employeeId: file.employeeId, fileId: id }, sql`1 = 1`, { target: ["employeeId"], update: ["fileId"] });
    } else {
      tx.write(sql`UPDATE files SET status = 'deleted', updated_at = ${stamp} WHERE id IN (SELECT file_id FROM onboarding_document_files WHERE employee_id = ${file.employeeId} AND document_name = ${upload.title}) AND id <> ${id} AND ${tx.receipt}`);
      tx.insert(s.onboardingDocumentLabels, { employeeId: file.employeeId, documentName: upload.title, fileName: file.fileName, createdAt: stamp, updatedAt: stamp }, sql`1 = 1`, { target: ["employeeId", "documentName"], update: ["fileName", "updatedAt"] });
      tx.insert(s.onboardingDocumentFiles, { employeeId: file.employeeId, documentName: upload.title, fileId: id, createdAt: stamp, updatedAt: stamp }, sql`1 = 1`, { target: ["employeeId", "documentName"], update: ["fileId", "updatedAt"] });
    }
    if (!await tx.commit(state?.revision ?? 0, upload.bodyHash, ["document-upload"])) throw new AuthError(409, "The workspace changed. Retry the upload after reloading.");
    return json({ fileId: id, employeeId: file.employeeId });
  }
  async function download(ctx: Context, id: string) {
    const { file, upload } = await fileRecord(ctx, id, false);
    if (file.status !== "ready") throw new AuthError(404, "Document not found.");
    const linked = await db.get(sql`SELECT 1 FROM files f WHERE f.id = ${id} AND f.status = 'ready' AND (EXISTS (SELECT 1 FROM employee_certificates c WHERE c.file_id = f.id AND c.employee_id = f.employee_id) OR EXISTS (SELECT 1 FROM onboarding_document_files o WHERE o.file_id = f.id AND o.employee_id = f.employee_id) OR EXISTS (SELECT 1 FROM employee_photos p WHERE p.file_id = f.id AND p.employee_id = f.employee_id)) AND ${ctx.activeActor()}`);
    if (!linked) throw new AuthError(404, "Document not found.");
    const object = await options.bucket!.get(file.objectKey);
    if (!object || object.size !== file.sizeBytes || object.customMetadata?.fileId !== id || object.customMetadata?.sha256 !== file.sha256) throw new AuthError(503, "The stored file is temporarily unavailable.");
    const current = await db.get(sql`SELECT 1 FROM files f WHERE f.id = ${id} AND f.status = 'ready' AND ${ctx.activeActor()} AND ${ctx.employeeFilter(sql`f.employee_id`)}`);
    if (!current) throw new AuthError(403, "Your access changed. Sign in again.");
    return new Response(object.body, { headers: { ...downloadHeaders(file.fileName, file.contentType, file.sizeBytes), ...(upload.kind === "photo" ? { "Content-Disposition": "inline" } : {}) } });
  }
  async function handle(request: Request) {
    try {
      const ctx = options.selfAuth ? await photoContext(request) : await access.workspaceContext(request);
      const path = new URL(request.url).pathname.slice((options.selfAuth ? "/api/self/photo/" : "/api/documents/").length);
      if (!options.bucket) throw new AuthError(503, "Private file storage is not connected yet.");
      if (path === "prepare" && request.method === "POST") return await prepare(ctx, request);
      const match = /^([A-Za-z0-9_-]{43})\/(content|download)$/.exec(path);
      if (!match) throw new AuthError(404, "Document not found.");
      if (match[2] === "content" && request.method === "PUT") return await upload(ctx, request, match[1]);
      if (match[2] === "download" && request.method === "GET") return await download(ctx, match[1]);
      return json({ error: "Method not allowed." }, 405);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message, ...(error instanceof FreshUploadError ? { freshUpload: true } : {}) }, error.status);
      console.error("Protected document request failed.");
      return json({ error: "The file could not be confirmed. Reload the latest data before retrying." }, 503);
    }
  }
  return { handle };
}
