// Local operator library. No Cloudflare client, network destination or live restore.
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, chmod, writeFile, readFile, open, rename, rm, stat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
const magic = Buffer.from("DOMBASE-BACKUP-1\n");
const maximumBytes = 128 * 1024 * 1024;
const id = value => '"' + value.replaceAll('"', '""') + '"';
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const internal = name => /^(?:sqlite_|_cf_)/i.test(name);
const encode = value => Array.isArray(value) || value instanceof Uint8Array ? { blob: Buffer.from(value).toString("base64") } : value;
const decode = value => value && typeof value === "object" ? Uint8Array.from(Buffer.from(value.blob, "base64")) : value;
const day = now => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

export async function privateDirectory(path) { await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); }
export async function writePrivateJson(path, value) {
  const temporary = path + `.partial-${randomUUID()}`; let handle;
  try { handle = await open(temporary, "wx", 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); await handle.close(); handle = null; await rename(temporary, path); }
  finally { await handle?.close(); await rm(temporary, { force: true }); }
}
export async function privateFile(path) { const info = await stat(path); if (!info.isFile() || info.mode & 0o077) throw new Error("Backup inputs must be private owner-only files."); return info; }
export async function recoveryKey(path) {
  await privateDirectory(resolve(path, "..")); let key;
  try { await privateFile(path); key = await readFile(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; key = randomBytes(32); try { await writeFile(path, key, { mode: 0o600, flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; await privateFile(path); key = await readFile(path); } }
  if (key.length !== 32) throw new Error("Invalid local recovery key; it was not replaced."); return key;
}
export function checkSecrets(secrets) {
  if (!secrets || typeof secrets.AUTH_RATE_LIMIT_SECRET !== "string" || secrets.AUTH_RATE_LIMIT_SECRET.length < 32 || !/^[A-Za-z0-9_-]{43}$/.test(secrets.AUTH_PRIVATE_FIELD_KEY ?? "") || Buffer.from(secrets.AUTH_PRIVATE_FIELD_KEY, "base64url").length !== 32) throw new Error("The matching local authentication and private-field keys are required.");
  return { AUTH_RATE_LIMIT_SECRET: secrets.AUTH_RATE_LIMIT_SECRET, AUTH_PRIVATE_FIELD_KEY: secrets.AUTH_PRIVATE_FIELD_KEY };
}
export async function readLocalSecrets(path) {
  await privateFile(path); const content = await readFile(path, "utf8"); const values = {};
  for (const name of ["AUTH_RATE_LIMIT_SECRET", "AUTH_PRIVATE_FIELD_KEY"]) {
    const match = content.match(new RegExp(`^${name}\\s*=\\s*["']?([^"'\\s]+)["']?\\s*$`, "m")); values[name] = match?.[1];
  }
  return checkSecrets(values);
}

export async function snapshotDatabase(database) {
  const query = "SELECT name,type,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name";
  const preliminary = (await database.prepare(query).all()).results.filter(row => !internal(row.name));
  const tables = preliminary.filter(row => row.type === "table").map(row => row.name).sort();
  if (!tables.includes("accounts") || !tables.includes("files") || !tables.includes("d1_migrations")) throw new Error("This is not the expected migrated application database.");
  const results = await database.batch([
    database.prepare(query),
    ...tables.flatMap(name => [database.prepare(`PRAGMA table_info(${id(name)})`), database.prepare(`SELECT * FROM ${id(name)} LIMIT 50001`)]),
    database.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name"),
  ]);
  const schema = results[0].results.filter(row => !internal(row.name));
  if (canonical(schema) !== canonical(preliminary)) throw new Error("Schema changed during backup; retry after migrations finish.");
  let count = 0;
  const records = tables.map((name, index) => {
    const columns = results[1 + index * 2].results.map(row => row.name); const source = results[2 + index * 2].results;
    count += source.length; if (source.length > 50000 || count > 50000) throw new Error("Local backup row limit reached; use a reviewed large-data export.");
    const rows = source.map(row => columns.map(column => encode(row[column]))).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return { name, columns, rows };
  });
  const sequences = results.at(-1).results.filter(row => tables.includes(row.name));
  return { schema, tables: records, sequences, digest: hash(canonical({ schema, records, sequences })) };
}
export function rowsOf(snapshot, name) { const table = snapshot.tables.find(table => table.name === name); if (!table) return []; return table.rows.map(row => Object.fromEntries(table.columns.map((column, index) => [column, row[index]]))); }

export async function snapshotObjects(bucket) {
  if (!bucket?.list || !bucket?.get) throw new Error("The private local FILES bucket is required for a complete backup.");
  const objects = []; let cursor; let total = 0; const seen = new Set();
  do {
    const page = await bucket.list({ ...(cursor ? { cursor } : {}), limit: 1000 });
    for (const entry of page.objects) {
      if (seen.has(entry.key)) throw new Error("File inventory changed during backup; retry."); seen.add(entry.key);
      const object = await bucket.get(entry.key); if (!object || object.size > 10 * 1024 * 1024) throw new Error("A local file is missing or exceeds the supported document size.");
      const bytes = Buffer.from(await object.arrayBuffer()); total += bytes.length;
      if (total > maximumBytes / 2) throw new Error("Local file backup limit reached; a streaming/offsite backup is required.");
      objects.push({ key: entry.key, bytes: bytes.toString("base64"), size: bytes.length, sha256: hash(bytes), httpMetadata: JSON.parse(JSON.stringify(object.httpMetadata ?? {})), customMetadata: object.customMetadata ?? {} });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}
export function checkObjects(snapshot, objects) {
  const expired = new Set(rowsOf(snapshot, "audit_log").filter(row => row.action === "document.upload_expired").map(row => row.entity_id));
  const files = rowsOf(snapshot, "files"); const keys = new Set();
  for (const object of objects) {
    if (typeof object.key !== "string" || object.key.length > 1024 || keys.has(object.key)) throw new Error("Invalid file inventory in backup."); keys.add(object.key);
    const bytes = Buffer.from(object.bytes, "base64"); if (bytes.length !== object.size || hash(bytes) !== object.sha256) throw new Error("Backup file checksum mismatch.");
  }
  for (const file of files) {
    const object = objects.find(object => object.key === file.object_key);
    const required = file.status === "ready" || file.status === "deleted" && !expired.has(file.id) && file.sha256;
    if (required && !object) throw new Error("A published or retained document is missing; no complete backup can be made.");
    if (object && (object.size !== file.size_bytes || file.sha256 && object.sha256 !== file.sha256)) throw new Error("Document bytes do not match the database checksum.");
  }
}

export async function createBackup({ database, bucket, secrets, directory, key, now = Date.now() }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("A private recovery key is required.");
  const snapshot = await snapshotDatabase(database); const objects = await snapshotObjects(bucket); checkObjects(snapshot, objects);
  const payload = { version: 1, source: "local", createdAt: new Date(now).toISOString(), localDay: day(now), snapshot, objects, secrets: checkSecrets(secrets) };
  const bytes = Buffer.from(JSON.stringify(payload)); if (bytes.length > maximumBytes) throw new Error("Local backup size limit reached.");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const bundle = Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
  await privateDirectory(directory); const name = `local-${payload.createdAt.replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.dombase`;
  const finalPath = join(directory, name); const temporary = finalPath + ".partial"; let handle;
  try { handle = await open(temporary, "wx", 0o600); await handle.writeFile(bundle); await handle.sync(); await handle.close(); handle = null; await rename(temporary, finalPath); }
  finally { await handle?.close(); await rm(temporary, { force: true }); }
  return { file: finalPath, createdAt: payload.createdAt, localDay: payload.localDay, applicationTables: snapshot.tables.length - 1, migrations: rowsOf(snapshot, "d1_migrations").length, rows: snapshot.tables.reduce((sum, table) => sum + table.rows.length, 0), objects: objects.length, bytes: bundle.length, sha256: hash(bundle) };
}
export async function readBackup(file, key) {
  const info = await privateFile(file); if (info.size > maximumBytes + 100 || info.size < magic.length + 29) throw new Error("Invalid backup size.");
  const bytes = await readFile(file); if (!bytes.subarray(0, magic.length).equals(magic)) throw new Error("Unsupported backup format.");
  let payload;
  try {
    const iv = bytes.subarray(magic.length, magic.length + 12), tag = bytes.subarray(magic.length + 12, magic.length + 28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(magic); decipher.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(magic.length + 28)), decipher.final()]).toString("utf8"));
  } catch { throw new Error("Backup authentication failed: wrong recovery key or damaged file."); }
  if (payload.version !== 1 || payload.source !== "local" || !Array.isArray(payload.snapshot?.tables) || !Array.isArray(payload.objects)) throw new Error("Invalid backup contents.");
  checkSecrets(payload.secrets); checkObjects(payload.snapshot, payload.objects); return payload;
}
export async function restoreIntoEmpty({ database, bucket, payload }) {
  const existing = (await database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.filter(row => !internal(row.name));
  if (existing.length) throw new Error("Recovery requires a new empty database; the current database was not changed.");
  if ((await bucket.list({ limit: 1 })).objects.length) throw new Error("Recovery requires an empty file bucket.");
  checkSecrets(payload.secrets); checkObjects(payload.snapshot, payload.objects);
  const snapshot = payload.snapshot;
  const statements = [database.prepare("PRAGMA defer_foreign_keys=ON")];
  for (const type of ["table", "index"]) for (const row of snapshot.schema.filter(row => row.type === type && row.sql)) {
    if (!/^CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE)\b/i.test(row.sql.trim())) throw new Error("Unexpected schema definition in backup.");
    statements.push(database.prepare(row.sql));
  }
  for (const table of snapshot.tables) for (const row of table.rows) statements.push(database.prepare(`INSERT INTO ${id(table.name)} (${table.columns.map(id).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`).bind(...row.map(decode)));
  for (const sequence of snapshot.sequences) {
    statements.push(database.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?").bind(sequence.seq, sequence.name));
    statements.push(database.prepare("INSERT INTO sqlite_sequence (name,seq) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)").bind(sequence.name, sequence.seq, sequence.name));
  }
  for (const row of snapshot.schema.filter(row => row.type === "trigger" && row.sql)) {
    if (!/^CREATE\s+TRIGGER\b/i.test(row.sql.trim())) throw new Error("Unexpected trigger definition in backup."); statements.push(database.prepare(row.sql));
  }
  await database.batch(statements);
  const restored = await snapshotDatabase(database);
  if (restored.digest !== snapshot.digest) throw new Error("Restored database rows or schema do not match the backup.");
  if ((await database.prepare("PRAGMA foreign_key_check").all()).results.length) throw new Error("Restored foreign keys failed verification.");
  for (const object of payload.objects) {
    const httpMetadata = { ...object.httpMetadata }; if (httpMetadata.cacheExpiry) httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
    await bucket.put(object.key, Uint8Array.from(Buffer.from(object.bytes, "base64")), { httpMetadata, customMetadata: object.customMetadata });
  }
  const objects = await snapshotObjects(bucket); if (canonical(objects) !== canonical(payload.objects)) throw new Error("Restored document bytes or metadata do not match.");
  return { tables: restored.tables.length - 1, migrations: rowsOf(restored, "d1_migrations").length, objects: objects.length, exactDatabase: true, exactFiles: true };
}
export async function invalidateRecoveredAccess(database, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const hasInvitations = (await database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_invitations'").all()).results.length > 0;
  await database.batch([
    ...(hasInvitations ? [database.prepare("UPDATE team_invitations SET revoked_at=?, updated_at=? WHERE revoked_at IS NULL AND used_at IS NULL").bind(stamp, stamp)] : []),
    database.prepare("UPDATE accounts SET session_version=session_version+1, updated_at=?").bind(stamp),
    database.prepare("UPDATE account_sessions SET revoked_at=? WHERE revoked_at IS NULL").bind(stamp),
    database.prepare("UPDATE account_setup_tokens SET used_at=? WHERE used_at IS NULL").bind(stamp),
    database.prepare("UPDATE kiosk_devices SET revoked_at=? WHERE revoked_at IS NULL").bind(stamp),
    database.prepare("UPDATE device_sessions SET revoked_at=? WHERE revoked_at IS NULL").bind(stamp),
    database.prepare("UPDATE kiosk_interactions SET ended_at=? WHERE ended_at IS NULL").bind(stamp),
    database.prepare("UPDATE kiosk_approval_sessions SET used_at=? WHERE used_at IS NULL").bind(stamp),
    database.prepare("UPDATE kiosk_clock_requests SET cancelled_at=? WHERE cancelled_at IS NULL AND completed_at IS NULL").bind(stamp),
    database.prepare("UPDATE pin_sessions SET expires_at=?").bind(stamp),
    database.prepare("INSERT INTO audit_log (action,entity_type,entity_id,metadata,created_at) VALUES ('system.recovery_completed','system','local-isolated-recovery','{\"sessionsRevoked\":true}',?)").bind(stamp),
  ]);
}
export async function containedBackup(file, directory) {
  const root = await realpath(directory), actual = await realpath(file);
  if (!actual.startsWith(root + sep) || !actual.endsWith(".dombase")) throw new Error("Choose an encrypted local backup from the private backup directory.");
  await privateFile(actual); return actual;
}
