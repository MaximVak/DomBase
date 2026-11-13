import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { b2Config, createB2Client, signedS3Headers, offsitePrefix } from "../backup/b2.mjs";
import { runOffsiteCopy, offsiteStatus, copyDays, monitorOffsite } from "../backup/offsite.mjs";
import { deliverBackupEmail } from "../backup/email.mjs";
import { hostedFormat } from "../backup/hosted-format.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { inspectOffsite } from "../scripts/offsite-staging.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const at = Date.parse("2026-11-13T13:00:00Z");
const configuration = { bucket: "isolated-backup-test", region: "us-west-004", keyId: "testaccesskey123", applicationKey: "testapplicationkey1234567890" };
const config = b2Config(configuration);

class Bucket {
  objects = new Map();
  serial = 0;
  async get(key) { const saved = this.objects.get(key); return saved ? { size: saved.bytes.length, etag: saved.etag, json: async () => JSON.parse(new TextDecoder().decode(saved.bytes)), arrayBuffer: async () => saved.bytes.slice().buffer } : null; }
  async put(key, body, options = {}) {
    const old = this.objects.get(key), condition = options.onlyIf;
    if (condition?.etagDoesNotMatch === "*" && old || condition?.etagMatches && old?.etag !== condition.etagMatches) return null;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    const etag = String(++this.serial); this.objects.set(key, { bytes, etag }); return { size: bytes.length, etag };
  }
}
function provider() {
  const objects = new Map(), calls = [];
  return { objects, calls, async fetcher(url, init) {
    calls.push({ url, method: init.method });
    const path = new URL(url).pathname, saved = objects.get(path);
    assert.equal(new URL(url).host, "s3.us-west-004.backblazeb2.com"); assert.equal(init.redirect, "error");
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=testaccesskey123\//);
    if (init.method === "HEAD") return new Response(null, { status: saved ? 200 : 404, headers: saved ? { "content-length": String(saved.bytes.length), "x-amz-meta-sha256": saved.hash } : {} });
    if (init.method === "PUT") { objects.set(path, { bytes: new Uint8Array(init.body).slice(), hash: init.headers["x-amz-meta-sha256"] }); return new Response(null); }
    return new Response(saved?.bytes ?? null, { status: saved ? 200 : 404 });
  } };
}
async function fixture(objects = 5, day = "2026-11-13") {
  const BACKUPS = new Bucket(), env = { BACKUPS, BACKUP_B2: JSON.stringify(configuration) }, remote = provider();
  const id = "00000000-0000-4000-8000-000000000001", root = `runs/${day}/${id}/`;
  const manifest = crypto.getRandomValues(new Uint8Array(32)); await BACKUPS.put(root + "manifest.bin", manifest);
  for (let i = 0; i < objects; i++) await BACKUPS.put(root + `object-${String(i).padStart(4, "0")}.bin`, crypto.getRandomValues(new Uint8Array(24)));
  const receipt = { format: hostedFormat, id, localDay: day, createdAt: day + "T10:05:00Z", fingerprint: "a".repeat(64), objects, wrappedKey: "opaque-envelope", manifest: { key: root + "manifest.bin", size: manifest.length, sha256: hash(manifest) } };
  await BACKUPS.put(`daily/${day}.json`, JSON.stringify(receipt));
  const clientFactory = c => createB2Client(c, { fetcher: remote.fetcher, clock: () => at });
  return { env, remote, receipt, root, clientFactory, run: (options = {}) => runOffsiteCopy(env, { now: at, clientFactory, ...options }) };
}
test("B2 credentials use a fixed HTTPS provider endpoint and reject arbitrary destinations", () => {
  assert.equal(b2Config(undefined), null);
  for (const extra of [{ endpoint: "https://example.test" }, { region: "us-west-004.backblazeb2.com.evil.test" }, { bucket: "../private" }, { applicationKey: "secret\ninjected" }]) assert.throws(() => b2Config({ ...configuration, ...extra }));
  assert.equal(b2Config({ ...configuration, applicationKey: "rotatedapplicationkey123456" }).identity, config.identity, "credential rotation keeps archive checkpoints");
  assert.notEqual(b2Config({ ...configuration, bucket: "different-backup-test" }).identity, config.identity);
});
test("S3 signature authenticates the request path, body, date and metadata", () => {
  // Fixed wire result from curl 8.7.1 --aws-sigv4 against an isolated local
  // HTTP server, with these fictional credentials/date/path/body. This checks
  // interoperability without copying the implementation's signing algorithm.
  const bytes = new TextEncoder().encode("encrypted archive bytes");
  const headers = signedS3Headers({ method: "PUT", host: "s3.us-west-004.backblazeb2.com", path: "/isolated-backup-test/dombase/staging/test.bin", bytes, ...config, now: at });
  assert.equal(headers.authorization, "AWS4-HMAC-SHA256 Credential=testaccesskey123/20261113/us-west-004/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=3608639368bf50ee7909c86412be6e1ec1312089ba2be79d0583dbc2ad7c65e2");
  assert.notEqual(signedS3Headers({ method: "PUT", host: headers.host, path: "/different", bytes, ...config, now: at }).authorization, headers.authorization);
});
test("copy resumes in bounded batches and publishes the completion marker last", async () => {
  const f = await fixture();
  await Promise.all([f.run(), f.run()]);
  const marker = `/${config.bucket}/${offsitePrefix}daily/2026-11-13.json`;
  assert.equal(f.remote.objects.has(marker), false);
  let status = await offsiteStatus(f.env, at); assert.equal(status.lastSuccess, null);
  await f.run({ now: at + 60000 });
  assert.ok(f.remote.objects.has(marker));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.remote.objects.get(marker).bytes)), f.receipt);
  assert.equal(f.remote.calls.filter(call => call.method === "PUT").at(-1).url.endsWith("daily/2026-11-13.json"), true);
  status = await offsiteStatus(f.env, at + 60000); assert.equal(status.state, "ready"); assert.equal(status.stale, false);
  const calls = f.remote.calls.length; await f.run({ now: at + 120000 }); assert.equal(f.remote.calls.length, calls, "completed days do not get duplicate versions");
  assert.equal(JSON.stringify(status).includes(config.applicationKey), false); assert.equal(JSON.stringify(status).includes(f.root), false);
});
test("network failures preserve checkpoints, alert immediately, respect retry cooldown and recover", async () => {
  const f = await fixture(0);
  const failed = await f.run({ clientFactory: () => ({ copy: async () => { throw new Error("SECRET provider failure"); } }) });
  assert.equal(failed.failed, true); assert.equal((await offsiteStatus(f.env, at)).alerts.active.kind, "failed");
  assert.equal((await f.run({ now: at + 1000 })).skipped, true); assert.equal(f.remote.calls.length, 0);
  await f.run({ now: at + 16 * 60000 });
  const recovered = await offsiteStatus(f.env, at + 16 * 60000); assert.equal(recovered.state, "ready"); assert.ok(recovered.alerts.lastRecovery);
});
test("read-back corruption cannot publish a complete copy", async () => {
  const f = await fixture(0);
  const clientFactory = c => createB2Client(c, { fetcher: (url, init) => init.method === "GET" ? new Response(new Uint8Array(32)) : f.remote.fetcher(url, init) });
  assert.equal((await f.run({ clientFactory })).failed, true);
  assert.equal([...f.remote.objects.keys()].some(key => key.includes("/daily/")), false);
});
test("missing/corrupt source parts and date mismatches fail closed", async () => {
  for (const kind of ["missing", "corrupt", "date"]) {
    const f = await fixture(0);
    if (kind === "missing") f.env.BACKUPS.objects.delete(f.root + "manifest.bin");
    if (kind === "corrupt") await f.env.BACKUPS.put(f.root + "manifest.bin", new Uint8Array(32));
    if (kind === "date") await f.env.BACKUPS.put("daily/2026-11-13.json", JSON.stringify({ ...f.receipt, localDay: "2026-11-12" }));
    assert.equal((await f.run()).failed, true); assert.equal(f.remote.objects.size, 0);
  }
});
test("only 30 recent Pacific days are copied; pending and invalid configuration are honest", async () => {
  const days = copyDays(Date.parse("2026-11-01T09:30:00Z")); assert.equal(days.length, 30); assert.equal(days[0], "2026-11-01"); assert.equal(days.at(-1), "2026-10-03");
  const f = await fixture(0, "2026-09-01"); await f.run(); assert.equal(f.remote.objects.size, 0); assert.equal((await offsiteStatus(f.env, at)).alerts.active.kind, "stale");
  assert.deepEqual(await offsiteStatus({ BACKUPS: f.env.BACKUPS }, at), { configured: false, state: "not_configured" });
  const bad = { BACKUPS: new Bucket(), BACKUP_B2: "invalid" }; assert.equal((await runOffsiteCopy(bad, { now: at })).failed, true); assert.equal((await offsiteStatus(bad, at)).state, "failed");
});
test("off-site alerts send to the existing fixed recipient independently from local alerts", async () => {
  const f = await fixture(0), sent = [];
  Object.assign(f.env, { BACKUP_ALERT_TO: "moldingmart@gmail.com", BACKUP_ALERT_FROM: "backups@example.test", BACKUP_EMAIL: { send: async message => { sent.push(message); return { messageId: "ack" }; } } });
  await f.run({ clientFactory: () => ({ copy: async () => { throw new Error(); } }) });
  await monitorOffsite(f.env, at); await monitorOffsite(f.env, at + 1000); assert.equal(sent.length, 1); assert.match(sent[0].subject, /Backblaze/); assert.equal(sent[0].to, "moldingmart@gmail.com");
  await deliverBackupEmail(f.env, (await offsiteStatus(f.env, at)).alerts, null, at); assert.equal(sent.length, 2, "local alert acknowledgement is independent");
  await f.run({ now: at + 16 * 60000 }); await monitorOffsite(f.env, at + 16 * 60000); assert.equal(sent.length, 3); assert.match(sent[2].subject, /restored/);
});
test("client refuses redirects, oversized responses and mismatched existing objects", async () => {
  const key = offsitePrefix + "checks/test.bin";
  const oversized = createB2Client(config, { fetcher: async () => new Response(new Uint8Array(9)) });
  await assert.rejects(oversized.get(key, 8)); await assert.rejects(oversized.get("../control/status.json"));
  const existing = createB2Client(config, { fetcher: async () => new Response(null, { headers: { "content-length": "9", "x-amz-meta-sha256": "wrong" } }) });
  await assert.rejects(existing.copy(key, new Uint8Array(9)), /differs/);
});
test("Owner API projection strips off-site credentials and internal paths", async () => {
  const { readBackupStatus } = await loadServerModule("backup/status.ts");
  const service = { fetch: async () => Response.json({ configured: true, stale: false, checkedAt: new Date(at).toISOString(), offsite: { configured: true, state: "ready", lastSuccess: { localDay: "2026-11-13", createdAt: new Date(at).toISOString(), secret: "PRIVATE" }, applicationKey: "PRIVATE", path: "PRIVATE" } }) };
  const status = await readBackupStatus(service); assert.equal(JSON.stringify(status).includes("PRIVATE"), false);
});
test("activation rejects public buckets, short retention and account-wide/admin keys before enabling copying", async () => {
  const auth = { accountId: "fictional-account", authorizationToken: "fictional-token", apiInfo: { storageApi: { s3ApiUrl: "https://s3.us-west-004.backblazeb2.com", apiUrl: "https://api004.backblazeb2.com", allowed: { buckets: [{ id: "one-bucket", name: config.bucket }], namePrefix: offsitePrefix, capabilities: ["listBuckets", "readBuckets", "readFiles", "writeFiles"] } } } };
  const listing = { buckets: [{ bucketName: config.bucket, bucketType: "allPrivate", corsRules: [], lifecycleRules: [{ fileNamePrefix: offsitePrefix, daysFromUploadingToHiding: 30, daysFromHidingToDeleting: 1 }] }] };
  const good = await inspectOffsite(config, async url => url.endsWith("b2_authorize_account") ? structuredClone(auth) : structuredClone(listing)); assert.equal(good.private, true);
  for (const mutate of [
    (a, b) => { b.buckets[0].bucketType = "allPublic"; },
    (a, b) => { b.buckets[0].lifecycleRules[0].daysFromUploadingToHiding = 1; },
    a => { a.apiInfo.storageApi.allowed.buckets = null; },
    a => { a.apiInfo.storageApi.allowed.capabilities.push("deleteFiles"); },
    a => { a.apiInfo.storageApi.allowed.capabilities.push("writeKeys"); },
    a => { a.apiInfo.storageApi.allowed.namePrefix = null; },
    a => { a.apiInfo.storageApi.apiUrl = "https://example.test"; },
  ]) {
    const a = structuredClone(auth), b = structuredClone(listing); mutate(a, b);
    await assert.rejects(inspectOffsite(config, async url => url.endsWith("b2_authorize_account") ? a : b));
  }
});
