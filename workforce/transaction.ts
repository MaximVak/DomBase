import { getTableColumns, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { atomicBatch } from "../kiosk/database";
import type { Database, Context } from "./context";
import { newToken } from "../auth/crypto";
const driver = (value: unknown) => value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value !== null && typeof value === "object" ? JSON.stringify(value) : value;
export class WorkspaceTransaction {
  readonly queries: SQL[] = [];
  readonly receipt: SQL;
  private checkIndex = 0;
  private readonly attemptId = newToken();
  constructor(readonly db: Database, readonly ctx: Pick<Context, "activeActor"> & { account: { id: number } }, readonly id: string, readonly stamp: string) {
    this.receipt = sql`EXISTS (SELECT 1 FROM workforce_commits WHERE id = ${id} AND account_id = ${ctx.account.id} AND attempt_id = ${this.attemptId})`;
  }
  write(query: SQL, expected?: number) {
    this.queries.push(query);
    if (expected !== undefined) this.queries.push(sql`INSERT INTO workforce_write_checks (id, passed)
      SELECT ${`${this.id}:${++this.checkIndex}`}, CASE WHEN changes() = ${expected} THEN 1 ELSE 0 END WHERE ${this.receipt}`);
  }
  insert(table: SQLiteTable, values: Record<string, unknown>, extra = sql`1 = 1`, conflict?: { target: string[]; update: string[] }) {
    const columns = getTableColumns(table); const names = Object.keys(values);
    const column = (key: string) => sql.identifier(columns[key].name);
    const onConflict = conflict ? sql`ON CONFLICT (${sql.join(conflict.target.map(column), sql`, `)}) DO UPDATE SET ${sql.join(conflict.update.map(key => sql`${column(key)} = excluded.${column(key)}`), sql`, `)} WHERE ${this.receipt}` : sql``;
    this.write(sql`INSERT INTO ${table} (${sql.join(names.map(column), sql`, `)}) SELECT ${sql.join(names.map(key => sql`${driver(values[key])}`), sql`, `)} WHERE ${this.receipt} AND ${extra} ${onConflict}`, 1);
  }
  update(table: SQLiteTable, values: Record<string, unknown>, where: SQL, expected = 1) {
    const columns = getTableColumns(table);
    this.write(sql`UPDATE ${table} SET ${sql.join(Object.entries(values).map(([key, value]) => sql`${sql.identifier(columns[key].name)} = ${driver(value)}`), sql`, `)} WHERE ${this.receipt} AND ${where}`, expected);
  }
  remove(table: SQLiteTable, where: SQL) { this.write(sql`DELETE FROM ${table} WHERE ${this.receipt} AND ${where}`); }
  async commit(revision: number, bodyHash: string, entities: string[]) {
    const result = await atomicBatch(this.db, [
      sql`UPDATE workforce_state SET revision = revision + 1 WHERE id = 1 AND revision = ${revision} AND ${this.ctx.activeActor()}`,
      sql`INSERT INTO workforce_commits (id, account_id, body_hash, revision, attempt_id, created_at)
        SELECT ${this.id}, ${this.ctx.account.id}, ${bodyHash}, ${revision + 1}, ${this.attemptId}, ${this.stamp} WHERE changes() = 1`,
      ...this.queries,
      sql`INSERT INTO audit_log (actor_account_id, action, entity_type, entity_id, metadata, created_at)
        SELECT ${this.ctx.account.id}, 'workforce.changed', 'workspace', ${this.id}, ${JSON.stringify({ entities, operations: this.checkIndex })}, ${this.stamp} WHERE ${this.receipt}`,
      sql`DELETE FROM workforce_write_checks WHERE id LIKE ${`${this.id}:%`}`,
    ]);
    return result[0].meta.changes === 1;
  }
}
