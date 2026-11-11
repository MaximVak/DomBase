import { appendFile, chmod, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { projectRoot, configPath, persistPath } from "./local-db.mjs";
import { loadServerModule } from "./server-runtime.mjs";

async function configure() {
  const file = join(projectRoot, ".dev.vars");
  let content = "";
  try { content = await readFile(file, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of ["AUTH_RATE_LIMIT_SECRET", "AUTH_PRIVATE_FIELD_KEY"]) {
    if (!new RegExp(`^${name}=`, "m").test(content)) {
      const line = `${name}=${randomBytes(32).toString("base64url")}\n`;
      await appendFile(file, `${content && !content.endsWith("\n") ? "\n" : ""}${line}`, { mode: 0o600 });
      content += `\n${line}`;
    }
  }
  await chmod(file, 0o600);
  console.log("Local authentication and private-field keys are configured in ignored .dev.vars.");
}

async function invite(args) {
  const allowed = new Set(["--email", "--name", "--role", "--origin"]);
  const input = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Use --email, --name, --role, and optionally --origin.");
    input[args[i].slice(2)] = args[i + 1];
  }
  const origin = new URL(input.origin ?? "http://localhost:3000");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.protocol !== "http:" || origin.username || origin.password) throw new Error("This local command requires an HTTP loopback origin.");
  if (!input.email || !input.name || !input.role) throw new Error("Provide --email, --name and --role (owner, general_manager or manager).");
  await configure();
  const { getPlatformProxy } = await import("wrangler");
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await loadServerModule("db/schema.ts");
  const { issueSetupToken } = await loadServerModule("auth/service.ts");
  const platform = await getPlatformProxy({ configPath, persist: { path: join(persistPath, "v3") }, remoteBindings: false });
  try {
    const grant = await issueSetupToken(drizzle(platform.env.DB, { schema }), { email: input.email, displayName: input.name, accessLevel: input.role });
    const directory = join(projectRoot, ".wrangler/private-setup");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const file = join(directory, `${randomBytes(8).toString("hex")}.txt`);
    const link = `${origin.origin}/setup#token=${grant.token}`;
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(`Initial setup for ${grant.displayName} (${grant.email})\nExpires in one hour. Open privately; do not commit or post this link.\n\n${link}\n`); }
    finally { await handle.close(); }
    console.log(`Disabled account prepared. Private one-use setup link saved to ${file}`);
    console.log("No email was sent. The recipient sets their own password on the setup page.");
  } finally { await platform.dispose(); }
}

try {
  if (process.argv[2] === "configure") await configure();
  else if (process.argv[2] === "invite") await invite(process.argv.slice(3));
  else throw new Error("Use configure or invite.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
