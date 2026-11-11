import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingPath, stagingConfig, stagingAccount, stagingBucket, wrangler } from "./staging.mjs";

// No token creation, R2 subscription activation, public-domain changes or billing APIs.
export async function storageStatus() {
  const result = await cloudflare(`/accounts/${stagingAccount}/r2/buckets`);
  const buckets = result.buckets ?? result; if (!Array.isArray(buckets)) throw new Error("Unexpected R2 inventory.");
  if (!buckets.some(bucket => bucket.name === stagingBucket)) return { enabled: true, exists: false, private: null };
  const base = `/accounts/${stagingAccount}/r2/buckets/${stagingBucket}/domains`;
  const [managed, custom] = await Promise.all([cloudflare(`${base}/managed`), cloudflare(`${base}/custom`)]);
  const domains = custom.domains ?? custom; if (!Array.isArray(domains) || typeof managed.enabled !== "boolean") throw new Error("Could not verify bucket privacy.");
  return { enabled: true, exists: true, private: !managed.enabled && !domains.some(domain => domain.enabled !== false) };
}
export async function configureStorage() {
  const config = await readStagingConfig(); let status = await storageStatus();
  if (!status.exists) { await wrangler(["r2", "bucket", "create", stagingBucket, "--config", stagingPath], { capture: true }); status = await storageStatus(); }
  if (!status.private) throw new Error("The approved bucket must have no public access before it can be bound.");
  await writeFile(stagingPath, JSON.stringify(stagingConfig(config.d1_databases[0].database_id, { files: true, maintenance: Boolean(config.triggers) }), null, 2) + "\n");
  return { bucket: stagingBucket, private: true, bindingPrepared: true, deployed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, ...rest] = process.argv.slice(2);
  try {
    if (rest.length || !["status", "configure"].includes(action)) throw new Error("Use status or configure without overrides.");
    console.log(JSON.stringify(await (action === "status" ? storageStatus() : configureStorage())));
  } catch (error) { console.error(error.message); if (/10042/.test(error.message)) console.error("Serge-account R2 activation is required in the Cloudflare dashboard; no billing action was performed."); process.exitCode = 1; }
}
