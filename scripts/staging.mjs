import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, rm, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const stagingPath = resolve(projectRoot, "wrangler.staging.jsonc");
const privateConfig = await readFile(stagingPath, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return {}; throw error; });
export const stagingAccount = process.env.DOMBASE_STAGING_ACCOUNT_ID ?? privateConfig.account_id;
if (typeof stagingAccount !== "string" || !/^[0-9a-f]{32}$/i.test(stagingAccount)) throw new Error("Set DOMBASE_STAGING_ACCOUNT_ID or create the private staging configuration first.");
export const stagingName = "dombase-staging";
export const stagingBucket = "dombase-staging-files";
export const stagingBackupName = "dombase-staging-backups";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
process.env.WRANGLER_LOG_PATH = resolve(projectRoot, ".wrangler/logs");
process.env.MINIFLARE_REGISTRY_PATH = resolve(projectRoot, ".wrangler/registry");

export function stagingConfig(databaseId, { files = false, maintenance = false, backups = false } = {}) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(databaseId) || databaseId === "00000000-0000-4000-8000-000000000000") {
    throw new Error("Staging requires a real Cloudflare D1 database ID.");
  }
  return {
    $schema: "./node_modules/wrangler/config-schema.json", name: stagingName,
    account_id: stagingAccount, main: "./worker/index.ts", compatibility_date: "2026-05-15",
    compatibility_flags: ["nodejs_compat"], workers_dev: true, preview_urls: false,
    assets: { directory: "./dist/client", binding: "ASSETS" },
    d1_databases: [{ binding: "DB", database_name: stagingName, database_id: databaseId, migrations_dir: "./drizzle" }],
    ...(files ? { r2_buckets: [{ binding: "FILES", bucket_name: stagingBucket }] } : {}),
    ...(backups ? { services: [{ binding: "BACKUP_SERVICE", service: stagingBackupName }] } : {}),
    ...(maintenance ? { triggers: { crons: ["* * * * *"] } } : {}),
  };
}

export async function readStagingConfig() {
  // The generated file is JSON (valid JSONC), deliberately without secrets.
  const config = JSON.parse(await readFile(stagingPath, "utf8"));
  const expected = stagingConfig(config.d1_databases?.[0]?.database_id ?? "", { files: config.r2_buckets !== undefined, maintenance: config.triggers !== undefined, backups: config.services !== undefined });
  for (const key of ["name", "account_id", "main", "compatibility_date", "workers_dev"]) {
    if (config[key] !== expected[key]) throw new Error(`Unexpected staging ${key}; refusing to change a different target.`);
  }
  if (JSON.stringify(config.r2_buckets) !== JSON.stringify(expected.r2_buckets)
    || JSON.stringify(config.services) !== JSON.stringify(expected.services)
    || JSON.stringify(config.triggers) !== JSON.stringify(expected.triggers)
    || JSON.stringify(config.d1_databases) !== JSON.stringify(expected.d1_databases)
    || JSON.stringify(config.assets) !== JSON.stringify(expected.assets)
    || !config.compatibility_flags?.includes("nodejs_compat")) throw new Error("Staging bindings differ from the approved target.");
  return config;
}

export function wrangler(args, { input, capture = false } = {}) {
  const executable = fileURLToPath(import.meta.resolve("wrangler/bin/wrangler.js"));
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: projectRoot, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: stagingAccount, CI: "true" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      output += data;
      if (!capture) process.stdout.write(data);
    });
    child.on("error", reject);
    child.on("close", code => code === 0 ? accept(output) : reject(new Error(`Cloudflare command failed (${code}).${capture ? " Output withheld for privacy." : ""}`)));
    child.stdin.end(input);
  });
}

export function databaseArgs(action, args = []) {
  const commands = { status: ["migrations", "list"], migrate: ["migrations", "apply"], info: ["info"] };
  if (!Object.hasOwn(commands, action) || args.length) throw new Error("Use status, migrate or info without target overrides.");
  return ["d1", ...commands[action], stagingName, "--config", stagingPath, ...(action === "info" ? [] : ["--remote"])];
}

async function environmentCopies(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await environmentCopies(path));
    else if (/^\.(?:dev\.vars|env)(?:\.|$)/.test(entry.name)) found.push(path);
  }
  return found;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "configure") {
    if (args.length !== 1) throw new Error("Provide the newly provisioned staging D1 ID.");
    const config = stagingConfig(args[0]);
    await writeFile(stagingPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log("Configured staging-account staging. Local configuration is unchanged.");
    return;
  }
  if (action === "inventory") {
    if (args.length) throw new Error("Inventory does not accept overrides.");
    await wrangler(["d1", "list", "--config", resolve(projectRoot, "wrangler.local.jsonc"), "--json"]);
    return;
  }
  const intended = await readStagingConfig();
  if (action === "sanitize") {
    if (args.length) throw new Error("Sanitize does not accept paths or overrides.");
    const built = JSON.parse(await readFile(resolve(projectRoot, "dist/server/wrangler.json"), "utf8"));
    if (built.name !== stagingName || built.account_id !== stagingAccount) throw new Error("Only staging build copies may be sanitized.");
    const copies = await environmentCopies(resolve(projectRoot, "dist"));
    for (const file of copies) await rm(file);
    console.log(`Removed ${copies.length} local environment copy/copies from staging output. Source environment files preserved.`);
    return;
  }
  const { cloudflare } = await import("./cloudflare-api.mjs");
  const database = await cloudflare(`/accounts/${stagingAccount}/d1/database/${intended.d1_databases[0].database_id}`);
  if (database.uuid !== intended.d1_databases[0].database_id || database.name !== stagingName) throw new Error("Hosted database identity does not match the staging target.");
  if (["status", "migrate", "info"].includes(action)) await wrangler(databaseArgs(action, args));
  else if (action === "deploy") {
    if (args.length) throw new Error("Deploy does not accept target overrides.");
    const built = resolve(projectRoot, "dist/server/wrangler.json");
    const config = JSON.parse(await readFile(built, "utf8"));
    if (config.name !== stagingName || config.account_id !== stagingAccount
      || config.d1_databases?.[0]?.database_id !== intended.d1_databases[0].database_id
      || JSON.stringify(config.triggers?.crons ?? []) !== JSON.stringify(intended.triggers?.crons ?? [])
      || JSON.stringify(config.r2_buckets ?? []) !== JSON.stringify(intended.r2_buckets ?? [])
      || JSON.stringify(config.services ?? []) !== JSON.stringify(intended.services ?? [])) throw new Error("Build the staging target before deploying; the current build targets a different environment.");
    if ((await environmentCopies(resolve(projectRoot, "dist"))).length) throw new Error("Run build:staging to remove local environment copies before deployment.");
    await wrangler(["deploy", "--config", built]);
  } else if (action === "secret") {
    if (args.length) throw new Error("Secret setup does not accept values or overrides.");
    const existing = await wrangler(["secret", "list", "--config", stagingPath], { capture: true });
    if (/\bAUTH_RATE_LIMIT_SECRET\b/.test(existing)) {
      console.log("Staging authentication secret already exists; preserved without rotation.");
      return;
    }
    const { randomBytes } = await import("node:crypto");
    const value = randomBytes(32).toString("base64url");
    // A separate secret from local development, passed on stdin, never in argv/logs.
    await wrangler(["secret", "put", "AUTH_RATE_LIMIT_SECRET", "--config", stagingPath], { input: `${value}\n`, capture: true });
    console.log("Configured a fresh staging authentication secret; value not displayed.");
  } else if (action === "backup") {
    if (args.length) throw new Error("Backup does not accept target overrides.");
    const file = resolve(projectRoot, ".wrangler/backups", `staging-${new Date().toISOString().replaceAll(":", "-")}.sql`);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, "", { mode: 0o600, flag: "wx" });
    await wrangler(["d1", "export", stagingName, "--remote", "--config", stagingPath, "--output", file], { capture: true });
    await chmod(file, 0o600);
    console.log(`Private staging database export saved to ${file}`);
  } else throw new Error("Use configure, inventory, sanitize, status, migrate, info, deploy, secret or backup.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
