import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
export const id = value => '"' + value.replaceAll('"', '""') + '"';
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const internal = name => /^(?:sqlite_|_cf_)/i.test(name);
export const encode = value => Array.isArray(value) || value instanceof Uint8Array ? { blob: Buffer.from(value).toString("base64") } : value;
export const decode = value => value && typeof value === "object" ? Uint8Array.from(Buffer.from(value.blob, "base64")) : value;

export function checkSecrets(secrets) {
  if (!secrets || typeof secrets.AUTH_RATE_LIMIT_SECRET !== "string" || secrets.AUTH_RATE_LIMIT_SECRET.length < 32 || !/^[A-Za-z0-9_-]{43}$/.test(secrets.AUTH_PRIVATE_FIELD_KEY ?? "") || Buffer.from(secrets.AUTH_PRIVATE_FIELD_KEY, "base64url").length !== 32) throw new Error("The matching local authentication and private-field keys are required.");
  return { AUTH_RATE_LIMIT_SECRET: secrets.AUTH_RATE_LIMIT_SECRET, AUTH_PRIVATE_FIELD_KEY: secrets.AUTH_PRIVATE_FIELD_KEY };
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


export function checkObjects(snapshot, objects) {
  const keys = new Set();
  for (const object of objects) {
    if (typeof object.key !== "string" || object.key.length > 1024 || keys.has(object.key)) throw new Error("Invalid file inventory in backup."); keys.add(object.key);
    const bytes = Buffer.from(object.bytes, "base64"); if (bytes.length !== object.size || hash(bytes) !== object.sha256) throw new Error("Backup file checksum mismatch.");
  }
  checkFileInventory(snapshot, objects);
}


export function checkFileInventory(snapshot, objects) {
  const expired = new Set(rowsOf(snapshot, "audit_log").filter(row => row.action === "document.upload_expired").map(row => row.entity_id));
  const files = rowsOf(snapshot, "files");
  for (const file of files) {
    const object = objects.find(object => object.key === file.object_key);
    const required = file.status === "ready" || file.status === "deleted" && !expired.has(file.id) && file.sha256;
    if (required && !object) throw new Error("A published or retained document is missing; no complete backup can be made.");
    if (object && (object.size !== file.size_bytes || file.sha256 && object.sha256 !== file.sha256)) throw new Error("Document bytes do not match the database checksum.");
  }
}
