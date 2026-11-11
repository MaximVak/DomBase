import { mkdir, open, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName, projectRoot } from "./staging.mjs";
import { loadServerModule } from "./server-runtime.mjs";

// Initial Owner identities are configured privately by the deployment operator.
const owners = JSON.parse(process.env.DOMBASE_STAGING_OWNERS ?? await readFile(join(projectRoot, ".wrangler/secrets/staging-owners.json"), "utf8"));
if (!owners || Array.isArray(owners) || typeof owners !== "object" || !Object.values(owners).every(name => typeof name === "string")) throw new Error("Configure confirmed initial Owner identities privately.");
const [flag, input] = process.argv.slice(2);
if (flag !== "--email" || process.argv.length !== 4 || !Object.hasOwn(owners, input?.toLowerCase())) throw new Error("Provide --email for a confirmed Stage 0 staging Owner.");
const email = input.toLowerCase();
const config = await readStagingConfig();
const databaseId = config.d1_databases[0].database_id;
const metadata = await cloudflare(`/accounts/${stagingAccount}/d1/database/${databaseId}`);
if (metadata.uuid !== databaseId || metadata.name !== stagingName) throw new Error("Wrong hosted database.");
const { newToken, tokenHash } = await loadServerModule("auth/crypto.ts");
async function query(sql, params = []) {
  const result = await cloudflare(`/accounts/${stagingAccount}/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params } });
  if (!Array.isArray(result) || result.some(row => !row.success)) throw new Error("Private setup operation failed.");
  return result[0].results;
}
await query("INSERT INTO accounts (email, normalized_email, display_name, access_level) VALUES (?, ?, ?, 'owner') ON CONFLICT DO NOTHING", [email, email, owners[email]]);
const [account] = await query("SELECT id, access_level, login_enabled, disabled_at, session_version FROM accounts WHERE normalized_email = ?", [email]);
if (!account || account.access_level !== "owner" || account.login_enabled || account.disabled_at) throw new Error("This account cannot receive an initial password setup link; no password or access was reset.");
const subdomain = (await cloudflare(`/accounts/${stagingAccount}/workers/subdomain`)).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Invalid hosted subdomain.");
const token = newToken();
const time = new Date().toISOString();
const expires = new Date(Date.now() + 3600000).toISOString();
// Fail closed: a later insertion failure leaves prior unused links invalidated.
await query("UPDATE account_setup_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL", [time, account.id]);
await query("INSERT INTO account_setup_tokens (id, account_id, token_hash, issued_session_version, expires_at) VALUES (?, ?, ?, ?, ?)",
  [newToken(), account.id, tokenHash(token), account.session_version, expires]);
const directory = join(projectRoot, ".wrangler/private-setup");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const file = join(directory, `staging-${owners[email].toLowerCase()}-${randomBytes(6).toString("hex")}.txt`);
const handle = await open(file, "wx", 0o600);
try {
  await handle.writeFile(`Private initial setup for ${owners[email]} (${email})\nExpires: ${expires}\nOne use; share privately with this person. They choose their own password.\nThis is the staging test site; workforce changes save to its shared database.\n\nhttps://${stagingName}.${subdomain}.workers.dev/setup#token=${token}\n`);
} finally { await handle.close(); }
console.log(`Owner identity prepared with login disabled. Private one-hour setup link saved to ${file}`);
console.log("No password was chosen or email sent. Active accounts cannot be reset by this command.");
