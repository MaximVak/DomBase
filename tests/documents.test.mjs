import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";
import { cookiesOf } from "./support/kiosk-fixture.mjs";

const pdf = new TextEncoder().encode("%PDF-1.4\n% Disposable local document fixture\n%%EOF\n");
test("protected documents use real isolated D1/R2, scoped access and atomic publication", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true }); const statePath = await mkdtemp(join(projectRoot, ".wrangler/documents-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath); const { getPlatformProxy } = await import("wrangler");
  const open = () => getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createDocumentService, newToken, cleanupDocumentUploads } = await loadServerModule("tests/support/workforce-runtime.ts");
  const secret = "isolated-document-test-secret-at-least-32-characters"; const password = "Isolated document verification passphrase!"; const origin = "http://localhost:3000";
  let db; let auth; let access; let service; let bucket;
  function services() { db = drizzle(platform.env.DB, { schema }); bucket = platform.env.FILES; auth = createAuthService(db, { secret }); access = createAccessService(db, auth); service = createDocumentService(db, access, { bucket, secret }); }
  platform = await open(); services(); const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const login = async email => { const response = await auth.handle(new Request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })); assert.equal(response.status, 200); return cookiesOf(response)[0]; };
  let owner = await login(f.owner.email); let second = await login(f.secondOwner.email); let manager = await login(f.manager.email);
  const request = (path, cookie, body, method = body === undefined ? "GET" : "POST", headers = {}) => new Request(origin + "/api/documents/" + path, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": body instanceof Uint8Array ? "application/pdf" : "application/json" }), ...headers }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const call = (path, cookie, body, method, headers) => service.handle(request(path, cookie, body, method, headers));
  const ok = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const details = (overrides = {}) => ({ id: newToken(), employeeId: f.a.id, kind: "certificate", title: "Disposable safety certificate", expirationDate: "2027-11-01", fileName: "local-qa.pdf", contentType: "application/pdf", sizeBytes: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex"), ...overrides });
  const complete = async (body, cookie = owner) => { await ok(await call("prepare", cookie, body)); await ok(await call(`${body.id}/content`, cookie, pdf, "PUT")); return body.id; };
  let saved;
  await t.test("a pending intent exposes no bytes; finalization links private bytes, metadata and audit", async () => {
    const body = details(); await ok(await call("prepare", owner, body));
    assert.equal((await call(`${body.id}/download`, owner)).status, 404);
    await ok(await call(`${body.id}/content`, owner, pdf, "PUT")); saved = body.id;
    const response = await call(`${saved}/download`, second); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
    assert.match(response.headers.get("content-disposition"), /^attachment;/); assert.match(response.headers.get("cache-control"), /no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.match(response.headers.get("content-security-policy"), /sandbox/);
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, saved)); assert.equal(file.status, "ready"); assert.equal(file.sha256, body.sha256); assert.ok(await bucket.get(file.objectKey));
    const [certificate] = await db.select().from(schema.employeeCertificates).where(eq(schema.employeeCertificates.fileId, saved)); assert.equal(certificate.employeeId, f.a.id);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "workforce.changed")); assert.ok(audits.some(row => row.metadata.entities.includes("document-upload"))); assert.equal(JSON.stringify(audits).includes(body.fileName), false);
  });
  await t.test("identical retries do not duplicate certificates; changed metadata cannot reuse an identifier", async () => {
    const body = details(); const id = await complete(body); await complete(body);
    assert.equal((await db.select().from(schema.employeeCertificates).where(eq(schema.employeeCertificates.fileId, id))).length, 1);
    assert.equal((await call("prepare", owner, { ...body, title: "Forged metadata" })).status, 409);
    assert.equal((await call("prepare", second, body)).status, 409);
  });
  await t.test("anonymous, employee, PIN, tablet and ungranted Manager contexts cannot read or upload", async () => {
    for (const cookie of ["", `dombase-session=${f.employeeToken}`, `dombase-kiosk-device=${f.deviceToken}`]) assert.ok([401, 403].includes((await call(`${saved}/download`, cookie)).status));
    assert.equal((await call(`${saved}/download`, manager)).status, 403); assert.equal((await call("prepare", manager, details())).status, 403);
  });
  await t.test("explicit document grants still enforce employee department and onboarding privacy", async () => {
    for (const permission of ["documents.read", "documents.download", "documents.manage", "team.manage"]) await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission, allowed: true });
    assert.equal((await call(`${saved}/download`, manager)).status, 200);
    const outside = await complete(details({ employeeId: f.b.id })); assert.equal((await call(`${outside}/download`, manager)).status, 404);
    assert.equal((await call("prepare", manager, details({ employeeId: f.b.id }))).status, 404);
    assert.equal((await call("prepare", manager, details({ kind: "onboarding", title: "W-4 Form", expirationDate: undefined }))).status, 403);
  });
  await t.test("onboarding uploads have real links; replacement revokes old downloads and retains history bytes", async () => {
    const first = await complete(details({ kind: "onboarding", title: "W-4 Form", expirationDate: undefined }));
    const next = await complete(details({ kind: "onboarding", title: "W-4 Form", expirationDate: undefined, fileName: "replacement.pdf" }));
    assert.equal((await call(`${first}/download`, owner)).status, 404); assert.equal((await call(`${next}/download`, owner)).status, 200); assert.equal((await call(`${next}/download`, manager)).status, 403);
    const [link] = await db.select().from(schema.onboardingDocumentFiles).where(eq(schema.onboardingDocumentFiles.fileId, next)); assert.equal(link.employeeId, f.a.id);
    const [old] = await db.select().from(schema.files).where(eq(schema.files.id, first)); assert.equal(old.status, "deleted"); assert.ok(await bucket.get(old.objectKey));
  });
  await t.test("cross-origin, oversize, bad file types and forged contents fail without a ready record", async () => {
    assert.equal((await call("prepare", owner, details(), "POST", { Origin: "https://attacker.test" })).status, 403);
    assert.equal((await call("prepare", owner, details({ fileName: "payload.svg", contentType: "image/svg+xml" }))).status, 415);
    assert.equal((await call("prepare", owner, details({ fileName: "../secret.pdf" }))).status, 400);
    assert.equal((await call("prepare", owner, details({ sizeBytes: 10 * 1024 * 1024 + 1 }))).status, 400);
    const body = details(); await ok(await call("prepare", owner, body));
    assert.equal((await call(`${body.id}/content`, owner, pdf, "PUT", { Origin: "https://attacker.test" })).status, 403);
    assert.equal((await call(`${body.id}/content`, owner, pdf, "PUT", { "Content-Length": String(10 * 1024 * 1024 + 1) })).status, 413);
    const fake = new TextEncoder().encode("<html>not a PDF</html>"); const fakeBody = details({ sizeBytes: fake.length, sha256: createHash("sha256").update(fake).digest("hex") }); await ok(await call("prepare", owner, fakeBody));
    assert.equal((await call(`${fakeBody.id}/content`, owner, fake, "PUT")).status, 415); assert.equal((await call(`${fakeBody.id}/download`, owner)).status, 404);
  });
  await t.test("failed R2 storage never publishes a document and can be retried", async () => {
    const body = details(); await ok(await call("prepare", owner, body));
    const broken = createDocumentService(db, access, { secret, bucket: { delete: bucket.delete.bind(bucket), put: async () => { throw new Error("fixture storage outage"); }, get: bucket.get.bind(bucket) } });
    assert.equal((await broken.handle(request(`${body.id}/content`, owner, pdf, "PUT"))).status, 503);
    assert.equal((await call(`${body.id}/download`, owner)).status, 404); await complete(body);
  });
  await t.test("audit or stale employee guards roll back links, metadata status and versions", async () => {
    const body = details(); await ok(await call("prepare", owner, body));
    await db.run(sql`CREATE TRIGGER reject_document_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'workforce.changed' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`);
    assert.equal((await call(`${body.id}/content`, owner, pdf, "PUT")).status, 503);
    const [pending] = await db.select().from(schema.files).where(eq(schema.files.id, body.id)); assert.equal(pending.status, "pending"); assert.equal((await call(`${body.id}/download`, owner)).status, 404);
    await db.run(sql`DROP TRIGGER reject_document_audit`); await complete(body);
    const stale = details(); await ok(await call("prepare", owner, stale));
    await db.update(schema.employees).set({ version: sql`${schema.employees.version} + 1` }).where(eq(schema.employees.id, f.a.id));
    assert.equal((await call(`${stale.id}/content`, owner, pdf, "PUT")).status, 409);
    assert.equal((await db.select().from(schema.files).where(eq(schema.files.id, stale.id)))[0].status, "pending");
  });
  await t.test("concurrent retries publish once and cannot overwrite another file's identity", async () => {
    const body = details(); await ok(await call("prepare", owner, body));
    const results = await Promise.all([call(`${body.id}/content`, owner, pdf, "PUT"), call(`${body.id}/content`, owner, pdf, "PUT")]);
    assert.ok(results.some(response => response.status === 200)); assert.ok(results.every(response => [200, 409, 503].includes(response.status)));
    await complete(body); assert.equal((await db.select().from(schema.employeeCertificates).where(eq(schema.employeeCertificates.fileId, body.id))).length, 1);
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, body.id)); assert.equal(row.status, "ready");
    await assert.rejects(db.insert(schema.onboardingDocumentFiles).values({ employeeId: f.b.id, documentName: "W-4 Form", fileId: body.id }));
  });
  await t.test("expired intents, missing objects and a missing bucket fail closed", async () => {
    const body = details(); await ok(await call("prepare", owner, body)); await db.update(schema.documentUploads).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.documentUploads.fileId, body.id));
    assert.equal((await call(`${body.id}/content`, owner, pdf, "PUT")).status, 409);
    const missing = createDocumentService(db, access, { secret, bucket: { delete: bucket.delete.bind(bucket), put: bucket.put.bind(bucket), get: async () => null } }); assert.equal((await missing.handle(request(`${saved}/download`, owner))).status, 503);
    assert.equal((await createDocumentService(db, access, { secret }).handle(request("prepare", owner, details()))).status, 503);
  });
  await t.test("revocation during object storage prevents D1 publication", async () => {
    const body = details(); await ok(await call("prepare", second, body));
    const revoked = createDocumentService(db, access, { secret, bucket: { delete: bucket.delete.bind(bucket), get: bucket.get.bind(bucket), put: async (...args) => { await bucket.put(...args); await db.update(schema.accounts).set({ sessionVersion: sql`${schema.accounts.sessionVersion} + 1` }).where(eq(schema.accounts.id, f.secondOwner.id)); } } });
    assert.equal((await revoked.handle(request(`${body.id}/content`, second, pdf, "PUT"))).status, 409);
    assert.equal((await db.select().from(schema.files).where(eq(schema.files.id, body.id)))[0].status, "pending"); second = await login(f.secondOwner.email);
  });
  await t.test("abandoned upload cleanup leaves ready and replaced documents intact", async () => {
    const body = details(); await ok(await call("prepare", owner, body));
    const [pending] = await db.select().from(schema.files).where(eq(schema.files.id, body.id));
    await bucket.put(pending.objectKey, pdf, { customMetadata: { fileId: body.id, sha256: body.sha256 } });
    await db.update(schema.documentUploads).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.documentUploads.fileId, body.id));
    const result = await cleanupDocumentUploads(db, bucket); assert.ok(result.expired >= 1);
    assert.equal(await bucket.get(pending.objectKey), null); assert.equal((await db.select().from(schema.files).where(eq(schema.files.id, body.id)))[0].status, "deleted");
    const [ready] = await db.select().from(schema.files).where(eq(schema.files.id, saved)); assert.ok(await bucket.get(ready.objectKey));
    const [replaced] = await db.select().from(schema.files).where(sql`status = 'deleted' AND id IN (SELECT file_id FROM document_uploads WHERE kind = 'onboarding')`); assert.ok(await bucket.get(replaced.objectKey));
    await bucket.put(pending.objectKey, pdf); await cleanupDocumentUploads(db, bucket); assert.equal(await bucket.get(pending.objectKey), null);
  });
  await t.test("both D1 links and R2 bytes survive restarting the local runtime", async () => {
    await platform.dispose(); platform = await open(); services(); owner = await login(f.owner.email); manager = await login(f.manager.email);
    const response = await call(`${saved}/download`, owner); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  });
});
