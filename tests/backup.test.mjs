import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, readFile, writeFile, chmod, stat, readdir } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { createBackup, readBackup, snapshotDatabase, restoreIntoEmpty, invalidateRecoveredAccess, recoveryKey, containedBackup } from "../scripts/backup-core.mjs";

test("local backup command rejects remote and restore-target overrides", () => {
  for (const args of [["create", "--remote"], ["verify", "--target", ".wrangler/state"], ["daily", "--config", "wrangler.staging.jsonc"]]) {
    const result = spawnSync(process.execPath, [join(projectRoot, "scripts/backup-local.mjs"), ...args], { cwd: projectRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /No remote or restore-target overrides/);
  }
});

test("encrypted local backups restore all D1 data, protected files and private-field keys with revoked sessions", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true }); const root = await mkdtemp(join(projectRoot, ".wrangler/backup-check-"));
  const { getPlatformProxy } = await import("wrangler"); let source, destination;
  t.after(async () => { try { await source?.dispose(); await destination?.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  const sourcePath = join(root, "source"), destinationPath = join(root, "recovered"); await runLocalDb("migrate", [], sourcePath);
  const open = state => getPlatformProxy({ configPath, persist: { path: join(state, "v3") }, remoteBindings: false, envFiles: [] });
  source = await open(sourcePath); const s = await loadServerModule("db/schema.ts"); const db = drizzle(source.env.DB, { schema: s });
  const { seedDemo } = await loadServerModule("demo/seed.ts"); await seedDemo(db, { weekStart: "2026-11-02" });
  const { createAuthService, issueSetupToken } = await loadServerModule("auth/service.ts"); const { createAccessService } = await loadServerModule("access/service.ts");
  const { createDocumentService } = await loadServerModule("documents/service.ts"); const { encryptSsn, decryptSsn } = await loadServerModule("workforce/private.ts"); const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
  const secrets = { AUTH_RATE_LIMIT_SECRET: "isolated-backup-authentication-secret-32-characters", AUTH_PRIVATE_FIELD_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
  const password = "Isolated backup Owner verification passphrase!", email = "backup-owner@example.test", origin = "http://localhost:3000";
  const auth = createAuthService(db, { secret: secrets.AUTH_RATE_LIMIT_SECRET });
  const req = (path, cookie = "", body, method = body === undefined ? "GET" : "POST") => new Request(origin + path, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": body instanceof Uint8Array ? (body[0] === 137 ? "image/png" : "application/pdf") : "application/json" }) }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const good = async response => { assert.equal(response.status, 200); return response.json(); };
  const setup = await issueSetupToken(db, { email, displayName: "Backup fixture Owner", accessLevel: "owner" }); await good(await auth.handle(req("/api/auth/setup", "", { token: setup.token, password })));
  const signed = await auth.handle(req("/api/auth/login", "", { email, password })); await good(signed); const cookie = signed.headers.get("set-cookie").split(";")[0];
  const owner = (await db.select().from(s.accounts).where(eq(s.accounts.normalizedEmail, email)))[0];
  const documents = createDocumentService(db, createAccessService(db, auth), { secret: secrets.AUTH_RATE_LIMIT_SECRET, bucket: source.env.FILES });
  const upload = async (kind, title, text) => {
    const bytes = kind === "photo" ? Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]) : new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`); const id = newToken();
    const details = { id, employeeId: 900001, kind, title, fileName: kind === "photo" ? "fictional.png" : "fictional.pdf", contentType: kind === "photo" ? "image/png" : "application/pdf", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    await good(await documents.handle(req("/api/documents/prepare", cookie, details))); await good(await documents.handle(req(`/api/documents/${id}/content`, cookie, bytes, "PUT"))); return { id, bytes };
  };
  const certificate = await upload("certificate", "Backup fixture", "Disposable certificate");
  const replaced = await upload("onboarding", "W-4 Form", "Disposable old onboarding form");
  const current = await upload("onboarding", "W-4 Form", "Disposable current onboarding form");
  const photo = await upload("photo", "Profile photo", "Disposable photo");
  const invitationToken = newToken(), invitationId = newToken();
  await db.insert(s.teamInvitations).values({ id: invitationId, employeeId: 900003, channel: "email", recipient: "recovered-invite@example.test", tokenHash: tokenHash(invitationToken), localTokenEncrypted: encryptSsn(invitationToken, 900003, secrets.AUTH_PRIVATE_FIELD_KEY, `invitation:${invitationId}`), issuedByAccountId: owner.id, issuerVersion: owner.sessionVersion, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await db.update(s.teamSettings).set({ payPeriod: "biweekly" }).where(eq(s.teamSettings.id, 1));
  await db.insert(s.employeeProfiles).values({ employeeId: 900001, ssnEncrypted: encryptSsn("000-34-5678", 900001, secrets.AUTH_PRIVATE_FIELD_KEY) });
  await db.insert(s.clockEvents).values({ employeeId: 900002, eventType: "in", occurredAt: "2026-11-02T17:00:00.000Z", roleName: "Demo Sales Associate", source: "system" });
  await db.insert(s.invitationEmails).values({ invitationId, state: "pending", nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const pendingSetup = await issueSetupToken(db, { email: "pending-backup@example.test", displayName: "Pending recovery fixture", accessLevel: "manager" });
  const deviceToken = newToken(), personToken = newToken(), approvalToken = newToken(); const expires = new Date(Date.now() + 3600000).toISOString();
  await db.insert(s.kioskDevices).values({ id: "backup-fixture-device", name: "Backup fixture tablet", registeredByAccountId: owner.id });
  await db.insert(s.deviceSessions).values({ id: "backup-device-session", deviceId: "backup-fixture-device", tokenHash: tokenHash(deviceToken), expiresAt: expires });
  await db.insert(s.kioskInteractions).values({ id: "backup-interaction", deviceSessionId: "backup-device-session", employeeId: 900001, tokenHash: tokenHash(personToken), expiresAt: expires });
  await db.insert(s.kioskClockRequests).values({ id: "backup-clock-request", interactionId: "backup-interaction", eventType: "in", roleId: 902001, requiresApproval: true, expiresAt: expires });
  await db.insert(s.kioskApprovalSessions).values({ id: "backup-approval", deviceSessionId: "backup-device-session", accountId: owner.id, tokenHash: tokenHash(approvalToken), action: "clock", targetId: "backup-clock-request", expiresAt: expires });
  await db.insert(s.pinSessions).values({ employeeId: 900001, mode: "employee", sessionTokenHash: tokenHash(newToken()), expiresAt: expires });
  const recognitionId = newToken();
  await db.insert(s.recognitionPreferences).values({ employeeId: 900001, shareBirthday: true });
  await db.insert(s.teamShoutouts).values({ id: recognitionId, senderEmployeeId: 900001, recipientEmployeeId: 900002, actorAccountId: owner.id, category: "teamwork", body: "Fictional preserved recognition", bodyHash: "backup-fixture-hash", createdAt: new Date().toISOString() });
  await db.insert(s.shoutoutModeration).values({ shoutoutId: recognitionId, actorAccountId: owner.id, createdAt: new Date().toISOString() });
  const directory = join(root, "archives"), keyPath = join(root, "keys/recovery.key"); const key = await recoveryKey(keyPath); let backup, payload;
  await t.test("private encrypted bundle includes the full schema, data, replaced files and recovery keys", async () => {
    backup = await createBackup({ database: source.env.DB, bucket: source.env.FILES, secrets, directory, key });
    const bytes = await readFile(backup.file); assert.equal(bytes.includes(Buffer.from(email)), false); assert.equal(bytes.includes(Buffer.from("scrypt$16384")), false); assert.equal(bytes.includes(certificate.bytes), false); assert.equal(bytes.includes(Buffer.from(secrets.AUTH_RATE_LIMIT_SECRET)), false);
    assert.equal((await stat(backup.file)).mode & 0o777, 0o600); assert.equal((await stat(keyPath)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700);
    payload = await readBackup(backup.file, key); assert.equal(payload.snapshot.tables.length, 64); assert.equal(payload.objects.length, 4); assert.equal(payload.secrets.AUTH_PRIVATE_FIELD_KEY, secrets.AUTH_PRIVATE_FIELD_KEY);
    assert.equal(await containedBackup(backup.file, directory), backup.file);
  });
  await t.test("wrong key, damaged ciphertext, loose permissions and external paths are rejected", async () => {
    await assert.rejects(readBackup(backup.file, randomBytes(32)), /authentication failed/);
    const damaged = Buffer.from(await readFile(backup.file)); damaged[damaged.length - 1] ^= 1; const file = join(directory, "damaged.dombase"); await writeFile(file, damaged, { mode: 0o600 }); await assert.rejects(readBackup(file, key), /authentication failed/);
    await chmod(file, 0o644); await assert.rejects(readBackup(file, key), /owner-only/); await chmod(file, 0o600);
    await assert.rejects(containedBackup(keyPath, directory), /private backup directory/);
  });
  await t.test("missing or corrupt published/replaced objects prevent a misleading successful backup", async () => {
    const file = (await db.select().from(s.files).where(eq(s.files.id, replaced.id)))[0]; const object = await source.env.FILES.get(file.objectKey); const bytes = new Uint8Array(await object.arrayBuffer()); const metadata = { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata };
    await source.env.FILES.delete(file.objectKey); await assert.rejects(createBackup({ database: source.env.DB, bucket: source.env.FILES, secrets, directory, key }), /missing/);
    await source.env.FILES.put(file.objectKey, new TextEncoder().encode("corrupt"), metadata); await assert.rejects(createBackup({ database: source.env.DB, bucket: source.env.FILES, secrets, directory, key }), /checksum/);
    await source.env.FILES.put(file.objectKey, bytes, metadata); assert.equal((await readdir(directory)).filter(name => name.endsWith(".partial")).length, 0);
  });
  await t.test("restore refuses a populated destination without changing its original records", async () => {
    const before = await snapshotDatabase(source.env.DB);
    await assert.rejects(restoreIntoEmpty({ database: source.env.DB, bucket: source.env.FILES, payload }), /new empty database/);
    assert.equal((await snapshotDatabase(source.env.DB)).digest, before.digest);
  });
  await t.test("fresh isolated D1/R2 restores all table contents, migrations, sequences, indexes and triggers", async () => {
    destination = await open(destinationPath);
    const result = await restoreIntoEmpty({ database: destination.env.DB, bucket: destination.env.FILES, payload });
    assert.deepEqual(result, { tables: 63, migrations: 13, objects: 4, exactDatabase: true, exactFiles: true });
    await assert.rejects(destination.env.DB.prepare("UPDATE clock_events SET event_type=event_type").run());
    await assert.rejects(destination.env.DB.prepare("UPDATE audit_log SET action=action").run());
    await assert.rejects(destination.env.DB.prepare("UPDATE wage_rates SET amount_cents=amount_cents").run());
    const recovered = drizzle(destination.env.DB, { schema: s }); assert.equal((await recovered.select().from(s.employeePhotos))[0].fileId, photo.id); assert.equal((await recovered.select().from(s.teamSettings))[0].payPeriod, "biweekly");
    const profile = (await recovered.select().from(s.employeeProfiles))[0]; assert.equal(decryptSsn(profile.ssnEncrypted, profile.employeeId, payload.secrets.AUTH_PRIVATE_FIELD_KEY), "000-34-5678");
  });
  await t.test("recovery revokes all old contexts while preserving passwords, files and immutable history", async () => {
    await invalidateRecoveredAccess(destination.env.DB); const recovered = drizzle(destination.env.DB, { schema: s });
    assert.ok((await recovered.select().from(s.teamInvitations))[0].revokedAt);
    const { dispatchInvitationEmails } = await loadServerModule("team/email.ts");
    let sends = 0;
    await dispatchInvitationEmails(recovered, { AUTH_PRIVATE_FIELD_KEY: payload.secrets.AUTH_PRIVATE_FIELD_KEY, INVITATION_EMAIL_FROM: "invites@example.test", INVITATION_EMAIL_REPLY_TO: "ops@example.test", INVITATION_EMAIL_ORIGIN: "https://app.example.test", INVITATION_EMAIL: { send: async () => { sends++; return { messageId: "must-not-send" }; } } });
    assert.equal(sends, 0);
    assert.equal((await recovered.select().from(s.invitationEmails))[0].state, "cancelled");
    assert.equal((await recovered.select().from(s.recognitionPreferences))[0].shareBirthday, true);
    assert.equal((await recovered.select().from(s.teamShoutouts))[0].body, "Fictional preserved recognition");
    assert.equal((await recovered.select().from(s.shoutoutModeration))[0].shoutoutId, recognitionId);
    await assert.rejects(destination.env.DB.prepare("DELETE FROM team_shoutouts").run());
    const recoveredAuth = createAuthService(recovered, { secret: payload.secrets.AUTH_RATE_LIMIT_SECRET });
    assert.equal((await recoveredAuth.handle(req("/api/auth/session", cookie))).status, 401);
    assert.equal((await recoveredAuth.handle(req("/api/auth/setup/inspect", "", { token: pendingSetup.token }))).status, 401);
    const { registeredDevice } = await loadServerModule("kiosk/device.ts"); assert.equal(await registeredDevice(recovered, `dombase-kiosk-device=${deviceToken}`, new URL(origin)), null);
    for (const [table, field] of [[s.kioskInteractions, "endedAt"], [s.kioskApprovalSessions, "usedAt"], [s.kioskClockRequests, "cancelledAt"]]) assert.ok((await recovered.select().from(table))[0][field]);
    const fresh = await recoveredAuth.handle(req("/api/auth/login", "", { email, password })); await good(fresh); const freshCookie = fresh.headers.get("set-cookie").split(";")[0];
    const service = createDocumentService(recovered, createAccessService(recovered, recoveredAuth), { secret: payload.secrets.AUTH_RATE_LIMIT_SECRET, bucket: destination.env.FILES });
    for (const fixture of [certificate, current, photo]) { const response = await service.handle(req(`/api/documents/${fixture.id}/download`, freshCookie)); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.bytes); }
    assert.equal((await service.handle(req(`/api/documents/${replaced.id}/download`, freshCookie))).status, 404);
    assert.equal((await recovered.select().from(s.clockEvents)).length, 1); assert.equal((await recovered.select().from(s.auditLog).where(eq(s.auditLog.action, "system.recovery_completed"))).length, 1);
    assert.equal((await auth.handle(req("/api/auth/session", cookie))).status, 200, "The source account/session is unchanged");
    assert.deepEqual(await recovered.all(sql`PRAGMA foreign_key_check`), []);
  });
  await t.test("recovered data and file bytes survive restarting the isolated runtime", async () => {
    await destination.dispose(); destination = await open(destinationPath);
    assert.equal((await destination.env.DB.prepare("SELECT COUNT(*) AS count FROM employees").all()).results[0].count, 10);
    const certificateRow = payload.snapshot.tables.find(table => table.name === "files"); const keyIndex = certificateRow.columns.indexOf("object_key"), idIndex = certificateRow.columns.indexOf("id"); const objectKey = certificateRow.rows.find(row => row[idIndex] === certificate.id)[keyIndex];
    assert.deepEqual(new Uint8Array(await (await destination.env.FILES.get(objectKey)).arrayBuffer()), certificate.bytes);
    assert.equal((await destination.env.DB.prepare("SELECT COUNT(*) AS count FROM account_sessions WHERE revoked_at IS NULL").all()).results[0].count, 1, "Only the fresh post-recovery sign-in remains active");
  });
});
