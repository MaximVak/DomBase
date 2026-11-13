import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import { b2Config, createB2Client, offsitePrefix } from "../backup/b2.mjs";
import { privateFile, writePrivateJson, privateDirectory } from "./backup-core.mjs";
import { projectRoot, readStagingConfig, stagingBackupName, stagingAccount, wrangler } from "./staging.mjs";

const configFile = resolve(projectRoot, ".wrangler/secrets/staging-b2.json");
const workerConfig = resolve(projectRoot, "wrangler.backup.jsonc");
export async function readOffsiteConfig() {
  await privateFile(configFile);
  return b2Config(JSON.parse(await readFile(configFile, "utf8")));
}
async function jsonRequest(url, authorization, body) {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: authorization, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || Number(response.headers.get("content-length")) > 65536) { await response.body?.cancel(); throw new Error("Backblaze configuration request failed."); }
  const text = await response.text(); if (text.length > 65536) throw new Error("Backblaze response exceeds limit.");
  return JSON.parse(text);
}
export async function inspectOffsite(config, request = jsonRequest) {
  const auth = await request("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", `Basic ${Buffer.from(`${config.keyId}:${config.applicationKey}`).toString("base64")}`);
  const storage = auth.apiInfo?.storageApi, allowed = storage?.allowed;
  const capabilities = allowed?.capabilities ?? [];
  if (storage?.s3ApiUrl !== `https://s3.${config.region}.backblazeb2.com`
    || !/^https:\/\/api[0-9]+\.backblazeb2\.com$/.test(storage.apiUrl)
    || allowed?.buckets?.length !== 1 || allowed.buckets[0].name !== config.bucket || allowed.namePrefix !== offsitePrefix
    || !["listBuckets", "readFiles", "writeFiles"].every(capability => capabilities.includes(capability))
    || capabilities.some(capability => !["listBuckets", "readBuckets", "listFiles", "readFiles", "writeFiles", "listAllBucketNames"].includes(capability))) throw new Error("Use a single-bucket, prefix-restricted application key with read/write files and listBuckets, without delete/admin capabilities.");
  const result = await request(`${storage.apiUrl}/b2api/v4/b2_list_buckets`, auth.authorizationToken, { accountId: auth.accountId, bucketId: allowed.buckets[0].id });
  const bucket = result.buckets?.[0], rules = bucket?.lifecycleRules;
  if (result.buckets?.length !== 1 || bucket.bucketName !== config.bucket || bucket.bucketType !== "allPrivate" || bucket.corsRules?.length
    || rules?.length !== 1 || rules[0].fileNamePrefix !== offsitePrefix || rules[0].daysFromUploadingToHiding !== 30 || rules[0].daysFromHidingToDeleting !== 1) throw new Error("Backblaze needs a private bucket, no CORS, and the scoped 30-day hide/1-day delete lifecycle rule.");
  return { private: true, restrictedKey: true, retentionDays: 30, deletionDelayDays: 1 };
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!["check", "activate"].includes(action) || args.length) throw new Error("Use check or activate without target overrides.");
  await readStagingConfig();
  const config = await readOffsiteConfig(), inspected = await inspectOffsite(config);
  // Verify the real upload/download path without writing a completion marker.
  const client = createB2Client(config);
  await client.copy(`${offsitePrefix}checks/${crypto.randomUUID()}.bin`, crypto.getRandomValues(new Uint8Array(64)));
  if (action === "activate") {
    const target = JSON.parse(await readFile(workerConfig, "utf8"));
    if (target.name !== stagingBackupName || target.account_id !== stagingAccount || target.workers_dev !== false || target.preview_urls !== false) throw new Error("Unexpected backup service target.");
    // Only the restricted application key goes to the private backup Worker.
    const { bucket, region, keyId, applicationKey } = config;
    await wrangler(["secret", "put", "BACKUP_B2", "--config", workerConfig], { input: JSON.stringify({ bucket, region, keyId, applicationKey }) + "\n", capture: true });
  }
  const report = { checkedAt: new Date().toISOString(), provider: "Backblaze B2", ...inspected, bytesVerified: true, activated: action === "activate", restoreTested: false };
  await privateDirectory(resolve(projectRoot, ".wrangler/releases"));
  await writePrivateJson(resolve(projectRoot, ".wrangler/releases/offsite-configuration.json"), report);
  console.log(JSON.stringify(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Off-site setup failed. Check the private account/key, bucket restrictions and lifecycle; provider details withheld."); process.exitCode = 1; });
}
