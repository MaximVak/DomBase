import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { runDueBackup, backupStatus, createBackupWorker, recordBackupAlerts } from "../backup/hosted.mjs";
import { deliverBackupEmail, backupEmailStatus } from "../backup/email.mjs";
import { backupCalendar, publicFingerprint } from "../backup/hosted-format.mjs";
import { recoverHostedBundle } from "../backup/recovery.mjs";
import { hash } from "../backup/snapshot.mjs";
import { restoreIntoEmpty, invalidateRecoveredAccess } from "../scripts/backup-core.mjs";
import { runOffsiteCopy } from "../backup/offsite.mjs";
import { offsitePrefix } from "../backup/b2.mjs";

const secrets = { AUTH_RATE_LIMIT_SECRET: "isolated-hosted-backup-authentication-secret-32-characters", AUTH_PRIVATE_FIELD_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
const now = Date.parse("2026-11-10T11:00:00Z"); // 03:00 Pacific.
const keys = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey), privateKey = await crypto.subtle.exportKey("jwk", keys.privateKey);
async function fixture(t) {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true }); const root = await mkdtemp(join(projectRoot, ".wrangler/hosted-backup-test-"));
  const sourcePath = join(root, "source"); await runLocalDb("migrate", [], sourcePath);
  const config = join(root, "backup.json");
  await writeFile(config, JSON.stringify({ name: "isolated-backup", main: join(projectRoot, "backup/worker.mjs"), compatibility_date: "2026-05-15", compatibility_flags: ["nodejs_compat"], d1_databases: [{ binding: "DB", database_name: "dombase-local", database_id: "00000000-0000-4000-8000-000000000000" }], r2_buckets: [{ binding: "FILES", bucket_name: "dombase-local-files" }, { binding: "BACKUPS", bucket_name: "isolated-backup-archives" }] }));
  const { getPlatformProxy } = await import("wrangler"); const platform = await getPlatformProxy({ configPath: config, persist: { path: join(sourcePath, "v3") }, remoteBindings: false, envFiles: [] });
  const destinations = [];
  t.after(async () => { try { await platform.dispose(); for (const p of destinations) await p.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  const schema = await loadServerModule("db/schema.ts"); const db = drizzle(platform.env.DB, { schema });
  const { seedDemo } = await loadServerModule("demo/seed.ts"); await seedDemo(db, { weekStart: "2026-11-02" });
  const { issueSetupToken, createAuthService, createAccessService, createDocumentService, createBackupStatusService, newToken } = await loadServerModule("tests/support/workforce-runtime.ts");
  const email = "hosted-recovery@example.test", password = "Isolated hosted recovery verification password!", origin = "http://localhost:3000";
  const req = (path, cookie = "", body, method = body === undefined ? "GET" : "POST") => new Request(origin + path, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": body instanceof Uint8Array ? "application/pdf" : "application/json" }) }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const ok = async r => { assert.equal(r.status, 200); return r.json(); };
  const auth = createAuthService(db, { secret: secrets.AUTH_RATE_LIMIT_SECRET }); const access = createAccessService(db, auth);
  const grant = await issueSetupToken(db, { email, displayName: "Fictional backup Owner", accessLevel: "owner" }); await ok(await auth.handle(req("/api/auth/setup", "", { token: grant.token, password })));
  const signed = await auth.handle(req("/api/auth/login", "", { email, password })); await ok(signed); const cookie = signed.headers.get("set-cookie").split(";")[0];
  const docs = createDocumentService(db, access, { secret: secrets.AUTH_RATE_LIMIT_SECRET, bucket: platform.env.FILES }); const uploads = [];
  for (const [kind, title, label] of [["certificate", "Fictional certificate", "certificate"], ["onboarding", "W-4 Form", "old"], ["onboarding", "W-4 Form", "current"]]) {
    const bytes = new TextEncoder().encode(`%PDF-1.4\n% Fictional hosted recovery ${label}\n%%EOF\n`); const id = newToken();
    await ok(await docs.handle(req("/api/documents/prepare", cookie, { id, employeeId: 900001, kind, title, fileName: "fictional.pdf", contentType: "application/pdf", sizeBytes: bytes.length, sha256: hash(bytes) })));
    await ok(await docs.handle(req(`/api/documents/${id}/content`, cookie, bytes, "PUT"))); uploads.push({ id, bytes });
  }
  const { encryptSsn } = await loadServerModule("workforce/private.ts");
  await db.insert(schema.employeeProfiles).values({ employeeId: 900001, ssnEncrypted: encryptSsn("000-45-6789", 900001, secrets.AUTH_PRIVATE_FIELD_KEY) }).onConflictDoUpdate({ target: schema.employeeProfiles.employeeId, set: { ssnEncrypted: encryptSsn("000-45-6789", 900001, secrets.AUTH_PRIVATE_FIELD_KEY) } });
  const env = { ...platform.env, BACKUP_PUBLIC_KEY: JSON.stringify(publicKey) };
  const completion = async day => (await env.BACKUPS.get(`daily/${day}.json`))?.json();
  const readPart = async key => new Uint8Array(await (await env.BACKUPS.get(key)).arrayBuffer());
  return { env, db, auth, access, createBackupStatusService, req, cookie, email, password, uploads, completion, readPart, schema, async destination() { const p = await getPlatformProxy({ configPath, persist: { path: join(root, `destination-${destinations.length}`, "v3") }, remoteBindings: false, envFiles: [] }); destinations.push(p); return p; } };
}

test("hosted daily calendar follows Pacific days and DST, including the skipped 2AM hour", () => {
  assert.deepEqual(backupCalendar(Date.parse("2026-03-08T09:59:00Z")), { day: "2026-03-08", hour: 1 });
  assert.deepEqual(backupCalendar(Date.parse("2026-03-08T10:00:00Z")), { day: "2026-03-08", hour: 3 });
  assert.deepEqual(backupCalendar(Date.parse("2026-11-01T09:30:00Z")), { day: "2026-11-01", hour: 1 });
});
test("hosted encrypted daily backup restores exact DB/files/keys and leaves live access unchanged", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  assert.equal((await runDueBackup(f.env, secrets, { now: Date.parse("2026-11-10T09:00:00Z") })).reason, "before daily start");
  const first = await runDueBackup(f.env, secrets, { now }); assert.equal(first.completed, true); assert.equal(first.objects, 3); assert.equal(first.tables, 63);
  const receipt = await f.completion("2026-11-10"); assert.equal(receipt.fingerprint, publicFingerprint(publicKey));
  assert.equal(JSON.stringify(receipt).includes(secrets.AUTH_RATE_LIMIT_SECRET), false); assert.equal(JSON.stringify(receipt).includes("fictional.pdf"), false);
  assert.equal((await runDueBackup(f.env, secrets, { now: now + 60000 })).reason, "already completed");
  const status = await backupStatus(f.env.BACKUPS, now); assert.equal(status.stale, false); assert.equal(status.lastAttempt.state, "succeeded");
  const interrupted = await (await f.env.BACKUPS.get("control/status.json")).json(); interrupted.lastAttempt.state = "failed";
  await f.env.BACKUPS.put("control/status.json", JSON.stringify(interrupted));
  assert.equal((await runDueBackup(f.env, secrets, { now: now + 120000 })).reason, "already completed");
  assert.equal((await backupStatus(f.env.BACKUPS, now + 120000)).lastAttempt.state, "succeeded", "A completed archive repairs a stale failure without another backup");
  const manifestBytes = await f.readPart(receipt.manifest.key); assert.equal(Buffer.from(manifestBytes).includes(Buffer.from(secrets.AUTH_PRIVATE_FIELD_KEY)), false);
  const independent = new Map();
  const copyEnv = { ...f.env, BACKUP_B2: JSON.stringify({ bucket: "isolated-native-backups", region: "us-west-004", keyId: "fictionalkey123", applicationKey: "fictionalapplicationkey123456" }) };
  await runOffsiteCopy(copyEnv, { now, clientFactory: () => ({ copy: async (key, bytes) => { independent.set(key, bytes.slice()); } }) });
  assert.ok(independent.has(offsitePrefix + `daily/${receipt.localDay}.json`));
  // Recovery reads only the independent copy; it cannot fall back to R2.
  const copiedReceipt = JSON.parse(new TextDecoder().decode(independent.get(offsitePrefix + `daily/${receipt.localDay}.json`)));
  const payload = await recoverHostedBundle(copiedReceipt, async key => independent.get(offsitePrefix + key), privateKey); const target = await f.destination();
  const result = await restoreIntoEmpty({ database: target.env.DB, bucket: target.env.FILES, payload }); assert.equal(result.exactDatabase, true); assert.equal(result.exactFiles, true);
  const { decryptSsn } = await loadServerModule("workforce/private.ts"); const profile = (await target.env.DB.prepare("SELECT ssn_encrypted FROM employee_profiles WHERE employee_id=900001").all()).results[0]; assert.equal(decryptSsn(profile.ssn_encrypted, 900001, payload.secrets.AUTH_PRIVATE_FIELD_KEY), "000-45-6789");
  await invalidateRecoveredAccess(target.env.DB); const { createAuthService } = await loadServerModule("auth/service.ts"); const { createAccessService } = await loadServerModule("access/service.ts"); const { createDocumentService } = await loadServerModule("documents/service.ts");
  const recovered = drizzle(target.env.DB, { schema: f.schema }); const auth = createAuthService(recovered, { secret: secrets.AUTH_RATE_LIMIT_SECRET });
  assert.equal((await auth.handle(f.req("/api/auth/session", f.cookie))).status, 401); assert.equal((await f.auth.handle(f.req("/api/auth/session", f.cookie))).status, 200);
  const login = await auth.handle(f.req("/api/auth/login", "", { email: f.email, password: f.password })); assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie").split(";")[0];
  const docs = createDocumentService(recovered, createAccessService(recovered, auth), { secret: secrets.AUTH_RATE_LIMIT_SECRET, bucket: target.env.FILES });
  for (const row of [f.uploads[0], f.uploads[2]]) { const r = await docs.handle(f.req(`/api/documents/${row.id}/download`, cookie)); assert.equal(r.status, 200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), row.bytes); }
  assert.equal((await docs.handle(f.req(`/api/documents/${f.uploads[1].id}/download`, cookie))).status, 404);
  await assert.rejects(restoreIntoEmpty({ database: target.env.DB, bucket: target.env.FILES, payload }), /empty database/);
  assert.equal((await runDueBackup(f.env, secrets, { now: now + 86400000 })).completed, true); assert.ok(await f.completion("2026-11-10")); assert.ok(await f.completion("2026-11-11"));
});
test("hosted backup leases serialize runners; incomplete/corrupt files fail closed and retry", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const results = await Promise.all([runDueBackup(f.env, secrets, { now }), runDueBackup(f.env, secrets, { now })]); assert.equal(results.filter(r => r.completed).length, 1);
  const receipt = await f.completion("2026-11-10");
  await assert.rejects(recoverHostedBundle(receipt, async key => { const b = await f.readPart(key); b[0] ^= 1; return b; }, privateKey), /damaged/);
  const wrong = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  await assert.rejects(recoverHostedBundle(receipt, f.readPart, await crypto.subtle.exportKey("jwk", wrong.privateKey)), /fingerprint/);
  const file = (await f.env.DB.prepare("SELECT object_key FROM files WHERE status='ready' LIMIT 1").all()).results[0]; const saved = new Uint8Array(await (await f.env.FILES.get(file.object_key)).arrayBuffer()); await f.env.FILES.delete(file.object_key);
  const next = now + 86400000; assert.equal((await runDueBackup(f.env, secrets, { now: next })).failed, true); assert.equal(await f.completion("2026-11-11"), undefined);
  let status = await backupStatus(f.env.BACKUPS, next); assert.equal(status.lastAttempt.state, "failed"); assert.equal(status.stale, true); assert.equal(status.lastSuccess.localDay, "2026-11-10");
  assert.equal((await runDueBackup(f.env, secrets, { now: next + 1000 })).reason, "running or retry cooldown");
  await f.env.FILES.put(file.object_key, saved); assert.equal((await runDueBackup(f.env, secrets, { now: next + 16 * 60000 })).completed, true);
  const worker = createBackupWorker(f.env, () => next + 20 * 60000);
  assert.equal((await worker.fetch(new Request("https://backup.internal/daily"))).status, 404);
  assert.equal((await worker.fetch(new Request("https://backup.internal/daily", { method: "POST", body: JSON.stringify({ ...secrets, target: "other-account" }) }))).status, 400);
  const view = await (await worker.fetch(new Request("https://backup.internal/status"))).json(); assert.equal(view.stale, false); assert.equal(JSON.stringify(view).includes(secrets.AUTH_RATE_LIMIT_SECRET), false);
});
test("backup status requires current Owner auth and exposes only safe counters", { timeout: 120000 }, async t => {
  const f = await fixture(t); await runDueBackup(f.env, secrets, { now });
  const service = f.createBackupStatusService(f.db, f.access, createBackupWorker(f.env, () => now));
  assert.equal((await service.handle(f.req("/api/backups/status"))).status, 401);
  const result = await service.handle(f.req("/api/backups/status", f.cookie)); assert.equal(result.status, 200); const text = await result.text(); assert.doesNotMatch(text, /wrappedKey|manifest\.bin|AUTH_RATE|fictional\.pdf/);
  assert.equal((await service.handle(f.req("/api/backups/status", f.cookie, {}))).status, 405);
  await f.db.run(sql`UPDATE accounts SET access_level='general_manager',session_version=session_version+1 WHERE normalized_email=${f.email}`);
  assert.equal((await service.handle(f.req("/api/backups/status", f.cookie))).status, 401);
  const r = await f.auth.handle(f.req("/api/auth/login", "", { email: f.email, password: f.password })); const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await service.handle(f.req("/api/backups/status", cookie))).status, 403);
});


test("backup alerts persist in R2 across retries/restarts, deduplicate concurrent checks and recover only after success", { timeout: 120000 }, async t => {
  const f = await fixture(t); await runDueBackup(f.env, secrets, { now });
  const file = (await f.env.DB.prepare("SELECT object_key FROM files WHERE status='ready' LIMIT 1").all()).results[0];
  const saved = new Uint8Array(await (await f.env.FILES.get(file.object_key)).arrayBuffer()); await f.env.FILES.delete(file.object_key);
  const next = now + 86400000;
  const daily = () => new Request("https://backup.internal/daily", { method: "POST", body: JSON.stringify(secrets) });
  const worker = createBackupWorker(f.env, () => next);
  assert.equal((await worker.fetch(daily())).status, 503);
  const first = await (await f.env.BACKUPS.get("control/status.json")).json(); assert.equal(first.alerts.active.kind, "failed");
  await Promise.all([recordBackupAlerts(f.env.BACKUPS, next + 1000), recordBackupAlerts(f.env.BACKUPS, next + 1000)]);
  const etag = (await f.env.BACKUPS.head("control/status.json")).etag;
  assert.equal((await worker.fetch(daily())).status, 200, "cooldown is not another failed backup");
  assert.equal((await f.env.BACKUPS.head("control/status.json")).etag, etag, "unchanged checks must not rewrite alerts");
  const restart = createBackupWorker(f.env, () => next + 5000);
  const status = await (await restart.fetch(new Request("https://backup.internal/status"))).json(); assert.deepEqual(status.alerts, first.alerts);
  await f.env.FILES.put(file.object_key, saved);
  const recovered = createBackupWorker(f.env, () => next + 16 * 60000); assert.equal((await recovered.fetch(daily())).status, 200);
  const result = await (await f.env.BACKUPS.get("control/status.json")).json(); assert.equal(result.alerts.active, null); assert.equal(result.alerts.lastRecovery.incidentId, first.alerts.active.id);
  assert.ok(await f.completion("2026-11-10")); assert.ok(await f.completion("2026-11-11"));
  await recordBackupAlerts(f.env.BACKUPS, next + 17 * 60000); assert.deepEqual((await (await f.env.BACKUPS.get("control/status.json")).json()).alerts, result.alerts);
  const bad = createBackupWorker(f.env, () => next + 18 * 60000);
  assert.equal((await bad.fetch(new Request("https://backup.internal/daily", { method:"POST",body:JSON.stringify({...secrets,AUTH_RATE_LIMIT_SECRET:""}) }))).status,503);
  assert.equal((await (await f.env.BACKUPS.get("control/status.json")).json()).alerts.active.kind,"failed");
  const confirmed = createBackupWorker(f.env, () => next + 19 * 60000);
  assert.equal((await confirmed.fetch(daily())).status,200);
  const healed = await (await f.env.BACKUPS.get("control/status.json")).json();assert.equal(healed.alerts.active,null);assert.equal(healed.lastAttempt.state,"succeeded");
  assert.equal(healed.lastSuccess.createdAt,result.lastSuccess.createdAt,"revalidation repairs health without replacing the completed archive");
  const safe = {...result, alerts:{active:null,lastRecovery:{...result.alerts.lastRecovery,privateKey:"must-never-project"}}, privateKey:"must-never-project"};
  const service = f.createBackupStatusService(f.db,f.access,{fetch:async()=>Response.json({...safe,configured:true,stale:false,checkedAt:new Date(next+17*60000).toISOString()})});
  const projection = await service.handle(f.req("/api/backups/status",f.cookie)); assert.equal(projection.status,200);assert.doesNotMatch(await projection.text(),/must-never-project|privateKey|wrappedKey/);
  const broken = f.createBackupStatusService(f.db,f.access,{fetch:async()=>{throw new Error("sensitive database credential details");}});
  const unavailable = await broken.handle(f.req("/api/backups/status",f.cookie));assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/sensitive|credential details/);
});


test("email delivery uses the fixed recipient, deduplicates real R2 leases, retries provider failures and cannot break backups", { timeout: 120000 }, async t => {
  const f = await fixture(t), sent = [];
  let fail = false;
  const env = { ...f.env, BACKUP_ALERT_TO:"ops@example.test",BACKUP_ALERT_FROM:"backups@example.test", BACKUP_EMAIL:{send:async value=>{sent.push(value);if(fail)throw new Error("credential-do-not-log");return {messageId:"synthetic-accepted"};}} };
  const active={id:"backup-failed-2026-11-10T11:00:00Z",kind:"failed",detectedAt:new Date(now).toISOString(),expectedDay:"2026-11-10",attemptAt:new Date(now).toISOString()};
  const alerts={active,lastRecovery:null};
  await deliverBackupEmail({...env,BACKUP_ALERT_FROM:undefined},alerts,null,now);assert.equal(sent.length,0);assert.equal((await backupEmailStatus({...env,BACKUP_ALERT_FROM:undefined})).configured,false);
  await Promise.all(Array.from({length:8},()=>deliverBackupEmail(env,alerts,null,now)));
  assert.equal(sent.length,1);assert.equal(sent[0].to,"ops@example.test");assert.equal(sent[0].from,"backups@example.test");assert.match(sent[0].subject,/failed/);assert.doesNotMatch(sent[0].text,/Private legal|AUTH_|fictional\.pdf|wrappedKey/);assert.equal(Object.keys(sent[0]).sort().join(','),'from,subject,text,to');
  await deliverBackupEmail(env,alerts,null,now+60000);assert.equal(sent.length,1);assert.equal((await backupEmailStatus(env)).state,"accepted");
  const next={active:{...active,id:"backup-stale-2026-11-11",kind:"stale"},lastRecovery:null};fail=true;
  await deliverBackupEmail(env,next,null,now+120000);assert.equal(sent.length,2);assert.equal((await backupEmailStatus(env)).state,"retrying");
  await deliverBackupEmail(env,next,null,now+180000);assert.equal(sent.length,2);
  fail=false;await deliverBackupEmail(env,next,null,now+18*60000);assert.equal(sent.length,3);
  const recovered={active:null,lastRecovery:{incidentId:next.active.id,kind:"stale",detectedAt:new Date(now).toISOString(),recoveredAt:new Date(now+19*60000).toISOString()}};
  await deliverBackupEmail(env,recovered,null,now+19*60000);await deliverBackupEmail(env,recovered,null,now+20*60000);assert.equal(sent.length,4);assert.match(sent[3].subject,/restored/);
  assert.equal((await backupEmailStatus({...env,BACKUP_ALERT_TO:"other@example.test"})).state,"ready","another recipient must not inherit an old acknowledgement");
  fail=true;
  const fresh={active:{...active,id:"backup-failed-2026-11-11T10:59:00Z",expectedDay:"2026-11-11",attemptAt:"2026-11-11T10:59:00Z"},lastRecovery:null};
  await f.env.BACKUPS.put("control/status.json",JSON.stringify({alerts:fresh}));
  const worker=createBackupWorker(env,()=>now+86400000);
  const r=await worker.fetch(new Request("https://backup.internal/daily",{method:"POST",body:JSON.stringify(secrets)}));assert.equal(r.status,200);assert.ok(await f.completion("2026-11-11"));assert.equal((await backupEmailStatus(env)).state,"retrying");
  const bad=await worker.fetch(new Request("https://backup.internal/daily",{method:"POST",body:JSON.stringify({...secrets,AUTH_RATE_LIMIT_SECRET:""})}));assert.equal(bad.status,503);
  const raw=await (await worker.fetch(new Request("https://backup.internal/status"))).json();assert.equal(raw.email.configured,true);assert.equal(raw.email.recipient,"ops@example.test");
  assert.doesNotMatch(JSON.stringify(raw),/credential-do-not-log|synthetic-accepted/);
  const service=f.createBackupStatusService(f.db,f.access,worker);const view=await service.handle(f.req('/api/backups/status',f.cookie));assert.equal(view.status,200);assert.equal((await view.json()).email.recipient,'ops@example.test');
});
