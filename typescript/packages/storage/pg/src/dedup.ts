import type { DedupAdapter, DedupResult } from "@postel/core";

export interface PgClient {
  query<R extends { rowCount?: number | null }>(text: string, values: unknown[]): Promise<R>;
}

export interface PgDedupOptions {
  readonly client: PgClient;
  readonly tableName?: string;
  readonly schema?: string;
  readonly now?: () => Date;
  readonly autoMigrate?: boolean;
}

const DEFAULT_TABLE = "postel_received_messages";

function qualifiedTable(schema: string | undefined, tableName: string): string {
  if (!schema) return `"${tableName}"`;
  return `"${schema}"."${tableName}"`;
}

export async function ensurePgDedupTable(
  client: PgClient,
  tableName = DEFAULT_TABLE,
  schema?: string,
): Promise<void> {
  const fqtn = qualifiedTable(schema, tableName);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${fqtn} (
       message_id text PRIMARY KEY,
       expires_at timestamptz NOT NULL
     )`,
    [],
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS "${tableName}_expires_idx" ON ${fqtn} (expires_at)`,
    [],
  );
}

export function PgDedup(options: PgDedupOptions): DedupAdapter {
  const tableName = options.tableName ?? DEFAULT_TABLE;
  const fqtn = qualifiedTable(options.schema, tableName);
  const now = options.now ?? (() => new Date());

  let migrated = options.autoMigrate === false;
  let migrationPromise: Promise<void> | undefined;

  function migrateOnce(): Promise<void> {
    if (migrated) return Promise.resolve();
    if (!migrationPromise) {
      migrationPromise = ensurePgDedupTable(options.client, tableName, options.schema).then(() => {
        migrated = true;
      });
    }
    return migrationPromise;
  }

  return {
    async record(messageId: string, ttlSeconds: number): Promise<DedupResult> {
      await migrateOnce();
      const currentIso = now().toISOString();
      const expiresIso = new Date(now().getTime() + ttlSeconds * 1000).toISOString();
      const res = await options.client.query<{ rowCount?: number | null }>(
        `INSERT INTO ${fqtn} (message_id, expires_at)
         VALUES ($1, $2)
         ON CONFLICT (message_id) DO UPDATE
           SET expires_at = EXCLUDED.expires_at
           WHERE ${fqtn}.expires_at <= $3
         RETURNING message_id`,
        [messageId, expiresIso, currentIso],
      );
      return { duplicate: (res.rowCount ?? 0) === 0 };
    },
  };
}
