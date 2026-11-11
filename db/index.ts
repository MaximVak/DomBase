import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { getTableName, sql } from "drizzle-orm";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Run the app through `npm run dev` with wrangler.local.jsonc for local development; remote deployments need their own real DB binding."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function isDatabaseReady() {
  const rows = await getDb().all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  const names = new Set(rows.map(row => row.name));
  return Object.values(schema).every(table => names.has(getTableName(table)));
}
