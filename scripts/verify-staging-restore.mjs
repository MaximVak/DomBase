import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, stat, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename, sep } from "node:path";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, projectRoot } from "./staging.mjs";
import { configPath, runLocalDb } from "./local-db.mjs";

let platform;
let temporary;
let phase = "validate private backup";
try {
  if (process.argv.length !== 3) throw new Error("Provide one private staging SQL backup file.");
  const file = await realpath(resolve(process.argv[2]));
  const backupRoot = await realpath(resolve(projectRoot, ".wrangler/backups"));
  if (!file.startsWith(`${backupRoot}${sep}`) || !file.endsWith(".sql")) throw new Error("Use an approved private staging backup.");
  const info = await stat(file);
  if (!info.isFile() || !info.size || (info.mode & 0o077)) throw new Error("Backup must be a nonempty owner-only SQL file.");
  const config = await readStagingConfig();
  phase = "read hosted row counts and schema metadata";
  const endpoint = `/accounts/${stagingAccount}/d1/database/${config.d1_databases[0].database_id}/query`;
  async function remote(sql) {
    const r = await cloudflare(endpoint, { method: "POST", body: { sql, params: [] } });
    if (!Array.isArray(r) || r.some(row => !row.success)) throw new Error("Remote verification query failed.");
    return r[0].results;
  }
  const metadataSql = "SELECT name, type FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type, name";
  const projectMetadata = rows => rows.filter(row => !row.name.startsWith("sqlite_") && !row.name.startsWith("_cf_"));
  const expectedMetadata = projectMetadata(await remote(metadataSql));
  // Verify the actual hosted schema, including before an additive release when
  // local declarations already contain tables not yet present on the server.
  const tables = expectedMetadata.filter(row => row.type === "table" && row.name !== "d1_migrations").map(row => row.name).sort();
  if (!tables.length || tables.some(name => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))) throw new Error("Unexpected hosted table inventory.");
  const migrationsSql = "SELECT id, name, applied_at FROM d1_migrations ORDER BY id";
  const expectedMigrations = await remote(migrationsSql);
  // Hosted D1 has a small compound-SELECT limit. Keep each count query bounded.
  const countQueries = [];
  for (let index = 0; index < tables.length; index += 2) {
    countQueries.push(tables.slice(index, index + 2).map(name => `SELECT '${name}' AS table_name, count(*) AS row_count FROM "${name}"`).join(" UNION ALL "));
  }
  const expected = [];
  for (const query of countQueries) expected.push(...await remote(query));
  await mkdir(resolve(projectRoot, ".wrangler"), { recursive: true });
  temporary = await mkdtemp(join(projectRoot, ".wrangler/restore-check-"));
  phase = "import into isolated local D1";
  const { getPlatformProxy, unstable_splitSqlQuery } = await import("wrangler");
  const statements = unstable_splitSqlQuery(await readFile(file, "utf8"));
  const creates = [];
  const records = [];
  const indexesAndTriggers = [];
  for (const statement of statements) {
    const head = statement.replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/, "");
    if (/^PRAGMA\b/i.test(head)) continue;
    if (/^CREATE TABLE\b/i.test(head)) creates.push(statement);
    else if (/^CREATE (?:UNIQUE )?(?:INDEX|TRIGGER)\b/i.test(head)) indexesAndTriggers.push(statement);
    else records.push(statement);
  }
  // The provider dump interleaves table creation with data. Create all FK targets
  // first, load records with deferred checks, then restore indexes/triggers.
  // The original private export is never modified.
  const ordered = join(temporary, "restore.sql");
  await writeFile(ordered, ["PRAGMA defer_foreign_keys=TRUE", ...creates, ...records, ...indexesAndTriggers].join(";\n") + ";\n", { mode: 0o600 });
  await runLocalDb("execute", ["--file", ordered], temporary);
  platform = await getPlatformProxy({ configPath, persist: { path: join(temporary, "v3") }, remoteBindings: false, envFiles: [] });
  phase = "compare restored data and schema";
  async function local(sql) { return (await platform.env.DB.prepare(sql).all()).results; }
  const restored = [];
  for (const query of countQueries) restored.push(...await local(query));
  assert.deepEqual(restored, expected, "All declared table row counts must survive restore");
  assert.deepEqual(projectMetadata(await local(metadataSql)), expectedMetadata, "Tables, indexes and custom triggers must survive restore");
  assert.deepEqual(await local("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await local(migrationsSql), expectedMigrations, "Every migration record must survive restore");
  if ((await local("SELECT count(*) AS count FROM audit_log"))[0].count) {
    await assert.rejects(platform.env.DB.prepare("UPDATE audit_log SET action = action WHERE id = (SELECT min(id) FROM audit_log)").run());
  }
  console.log(JSON.stringify({ backup: basename(file), isolatedRestore: "passed", tables: tables.length, recordCounts: "matched", indexesAndTriggers: "matched", foreignKeys: "passed", migrations: expectedMigrations.length, auditProtection: "passed" }));
} catch (error) {
  console.error(`Staging restore verification failed during ${phase} (${error.code ?? error.name ?? "error"}); SQL and backup contents withheld for privacy.`);
  const categories = String(error.message).match(/SQLITE_[A-Z_]+|FOREIGN KEY constraint failed|UNIQUE constraint failed|already exists|syntax error|incomplete input|not authorized|does not support|no such table/gi);
  if (categories) console.error(`Diagnostic categories: ${[...new Set(categories)].join(", ")}`);
  const missing = String(error.message).match(/no such table:\s*([a-zA-Z_][a-zA-Z0-9_.]*)/i)?.[1];
  if (missing) console.error(`Missing schema object during restore: ${missing}`);
  process.exitCode = 1;
} finally {
  try { await platform?.dispose(); }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
