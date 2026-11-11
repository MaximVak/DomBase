import type { SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema";

export type KioskOperatorDatabase = ReturnType<typeof drizzle<typeof schema>>;
// Compile parameters with Drizzle, execute one native D1 transaction. db.run()
// executes immediately and must never be placed inside a Drizzle batch array.
export async function atomicBatch(db: KioskOperatorDatabase, queries: [SQLWrapper, ...SQLWrapper[]]) {
  const dialect = new SQLiteSyncDialect();
  const statements = queries.map(query => {
    const { sql, params } = dialect.sqlToQuery(query.getSQL());
    return db.$client.prepare(sql).bind(...params);
  });
  return db.$client.batch(statements);
}
