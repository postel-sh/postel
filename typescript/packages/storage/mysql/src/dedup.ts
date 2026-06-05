import type { DedupAdapter, DedupResult } from "@postel/core";

// The slice of a mysql2 `Pool` / `Connection` the dedup adapter calls. mysql2's
// promise `query` resolves to `[result, fields]`; for INSERT the result is a
// `ResultSetHeader` carrying `affectedRows`. A real mysql2 pool/connection
// satisfies this structurally.
export interface MysqlDedupClient {
  query(sql: string, values: unknown[]): Promise<[unknown, unknown]>;
}

export interface MysqlDedupOptions {
  readonly client: MysqlDedupClient;
  readonly tableName?: string;
  readonly now?: () => Date;
  readonly autoMigrate?: boolean;
}

const DEFAULT_TABLE = "postel_received_messages";

function affectedRows(result: unknown): number {
  return (result as { affectedRows?: number }).affectedRows ?? 0;
}

export async function ensureMysqlDedupTable(
  client: MysqlDedupClient,
  tableName = DEFAULT_TABLE,
): Promise<void> {
  // BIGINT epoch-ms expiry (timezone-independent); index declared inline so the
  // whole DDL is a single idempotent `CREATE TABLE IF NOT EXISTS` (MySQL has no
  // `CREATE INDEX IF NOT EXISTS`).
  await client.query(
    `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
       message_id VARCHAR(191) PRIMARY KEY,
       expires_at BIGINT NOT NULL,
       INDEX ${tableName}_expires_idx (expires_at)
     )`,
    [],
  );
}

export function MysqlDedup(options: MysqlDedupOptions): DedupAdapter {
  const tableName = options.tableName ?? DEFAULT_TABLE;
  const now = options.now ?? (() => new Date());

  let migrated = options.autoMigrate === false;
  let migrationPromise: Promise<void> | undefined;

  function migrateOnce(): Promise<void> {
    if (migrated) return Promise.resolve();
    if (!migrationPromise) {
      migrationPromise = ensureMysqlDedupTable(options.client, tableName).then(() => {
        migrated = true;
      });
    }
    return migrationPromise;
  }

  return {
    async record(messageId: string, ttlSeconds: number): Promise<DedupResult> {
      await migrateOnce();
      const currentMs = now().getTime();
      const expiresMs = currentMs + ttlSeconds * 1000;
      // INSERT IGNORE has clean affectedRows (1 inserted / 0 duplicate). MySQL's
      // ON DUPLICATE KEY UPDATE can't distinguish a no-op refresh from a live
      // duplicate (its IF branch still reports a changed row), so split the two:
      const [inserted] = await options.client.query(
        `INSERT IGNORE INTO \`${tableName}\` (message_id, expires_at) VALUES (?, ?)`,
        [messageId, expiresMs],
      );
      if (affectedRows(inserted) > 0) return { duplicate: false };
      // Row exists — refresh only if expired (a live row no-matches → 0 → dup).
      const [refreshed] = await options.client.query(
        `UPDATE \`${tableName}\` SET expires_at = ? WHERE message_id = ? AND expires_at <= ?`,
        [expiresMs, messageId, currentMs],
      );
      return { duplicate: affectedRows(refreshed) === 0 };
    },
  };
}
