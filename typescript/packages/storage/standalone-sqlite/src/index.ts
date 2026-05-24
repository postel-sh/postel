import type { DedupAdapter, DedupResult } from "@postel/core";
import type { Database, Statement } from "better-sqlite3";

export interface SqliteDedupAdapterOptions {
  readonly db: Database;
  readonly tableName?: string;
  readonly now?: () => Date;
}

const DEFAULT_TABLE = "postel_received_messages";

interface CachedStatements {
  readonly insert: Statement<[string, number]>;
  readonly purge: Statement<[number]>;
}

function ensureTable(db: Database, tableName: string): CachedStatements {
  db.exec(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (
       message_id TEXT PRIMARY KEY,
       expires_at INTEGER NOT NULL
     )`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS "${tableName}_expires_idx" ON "${tableName}" (expires_at)`);

  const insert = db.prepare<[string, number]>(
    `INSERT OR IGNORE INTO "${tableName}" (message_id, expires_at) VALUES (?, ?)`,
  );
  const purge = db.prepare<[number]>(`DELETE FROM "${tableName}" WHERE expires_at <= ?`);
  return { insert, purge };
}

export function sqliteDedupAdapter(options: SqliteDedupAdapterOptions): DedupAdapter {
  const tableName = options.tableName ?? DEFAULT_TABLE;
  const now = options.now ?? (() => new Date());
  const { insert, purge } = ensureTable(options.db, tableName);

  let purgeCounter = 0;

  return {
    async record(messageId: string, ttlSeconds: number): Promise<DedupResult> {
      const currentMs = now().getTime();
      purge.run(currentMs);
      const expiresAtMs = currentMs + ttlSeconds * 1000;
      const info = insert.run(messageId, expiresAtMs);
      if (++purgeCounter % 100 === 0) {
        purge.run(currentMs);
      }
      return { duplicate: info.changes === 0 };
    },
  };
}
