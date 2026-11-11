import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { stagingAccount } from "./staging.mjs";

// Operator-only tooling. Wrangler owns/refreshes these credentials; never print,
// copy, put them in argv, or send them to any host except Cloudflare's API.
async function credential() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const files = [join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
    join(homedir(), ".config/.wrangler/config/default.toml"), join(homedir(), ".wrangler/config/default.toml")];
  for (const file of files) {
    try {
      const match = (await readFile(file, "utf8")).match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m);
      if (match) return match[1];
    } catch (error) { if (error.code !== "ENOENT") throw new Error("Unable to read the Wrangler sign-in."); }
  }
  throw new Error("Sign in with Wrangler before accessing the hosted environment.");
}

export async function cloudflare(path, { method = "GET", body } = {}) {
  if (/[\\]|%(?:2e|2f|5c)|(?:^|\/)\.\.?(?:\/|$)/i.test(path)) throw new Error("Invalid Cloudflare resource path.");
  if (path !== "/memberships" && !path.startsWith(`/accounts/${stagingAccount}/`)) throw new Error("Only Serge's approved account is permitted.");
  if (path === "/memberships" && method !== "GET") throw new Error("Membership lookup is read-only.");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, redirect: "error", headers: { Authorization: `Bearer ${await credential()}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.success === false) {
    const codes = (result.errors ?? []).map(error => error.code).filter(code => Number.isInteger(code));
    throw new Error(`Cloudflare ${method} request failed (HTTP ${response.status}; codes ${codes.join(",") || "unavailable"}).`);
  }
  return result.result;
}
