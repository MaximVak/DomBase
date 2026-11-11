import { configPath, persistPath } from "./local-db.mjs";
import { join } from "node:path";
import { loadServerModule } from "./server-runtime.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--week")) throw new Error("Use demo:seed:local with an optional --week YYYY-MM-DD. Remote/config/target overrides are not allowed.");
// The target is fixed to the local emulator; this command has no Cloudflare API client.
const { getPlatformProxy } = await import("wrangler");
const { drizzle } = await import("drizzle-orm/d1");
const schema = await loadServerModule("db/schema.ts");
const { seedDemo } = await loadServerModule("demo/seed.ts");
const platform = await getPlatformProxy({ configPath, persist: { path: join(persistPath, "v3") }, remoteBindings: false, envFiles: [] });
try {
  const db = drizzle(platform.env.DB, { schema }); const result = await seedDemo(db, { weekStart: args[1] });
  console.log(JSON.stringify({ target: "local emulator only", ...result, credentials: "No passwords, PINs or login-enabled accounts seeded." }));
} finally { await platform.dispose(); }
