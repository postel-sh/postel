import { makeFakeClock, runStorageTests, startMysqlContainer } from "@postel/storage-testkit";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { describe, it } from "vitest";

import { KyselyStorage } from "../src/index.js";

// Exercises the adapter through a Kysely SqliteDialect (better-sqlite3) — a real
// query builder over a real database. Single-connection, so notify and
// tx-isolation are skipped; the Postgres dialect path (FOR UPDATE SKIP LOCKED,
// LISTEN/NOTIFY) shares the same code and is exercised by @postel/pg's identical
// SQL plus the testcontainers tier.
runStorageTests({
  name: "@postel/kysely (sqlite dialect)",
  expectedSchemaVersion: 4,
  capabilities: { notify: false, txIsolation: false },
  async create() {
    const clock = makeFakeClock();
    const db = new Kysely<Record<string, never>>({
      dialect: new SqliteDialect({ database: new Database(":memory:") }),
    });
    return { storage: KyselyStorage({ db, dialect: "sqlite", clock }), clock };
  },
});

const RESET_TABLES = [
  "messages",
  "attempts",
  "endpoint_secrets",
  "endpoint_state_transitions",
  "endpoints",
  "tenants",
  "postel_received_messages",
];

// Real-MySQL dialect tier (multiple connections), gated on
// POSTEL_MYSQL_TESTCONTAINERS (Docker). Proves the mysql branch end-to-end:
// select-then-update reservation under FOR UPDATE SKIP LOCKED and the
// ON DUPLICATE KEY UPDATE dedup, with true transaction isolation.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  let db: Kysely<Record<string, never>> | undefined;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/kysely (mysql dialect, testcontainers)",
    expectedSchemaVersion: 4,
    setupTimeoutMs: 120_000,
    capabilities: { notify: false, txIsolation: true },
    async setup() {
      const { createPool } = await import("mysql2/promise");
      const { MysqlDialect } = await import("kysely");
      const container = await startMysqlContainer();
      const pool = createPool(container.uri);
      db = new Kysely<Record<string, never>>({ dialect: new MysqlDialect({ pool }) });
      stop = async () => {
        // NOTE: kysely + mysql2 leaves a pooled connection checked out after the
        // battery here, so pool.end()/db.destroy() hangs and the open socket
        // stalls the worker — which is why this tier is excluded from CI (see
        // .github/workflows/typescript.yml). Bound the close so opt-in local runs
        // don't hang forever; the underlying leak is a tracked follow-up.
        await container.stop();
        await Promise.race([
          pool.end().catch(() => {}),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 10_000);
          }),
        ]);
      };
      await KyselyStorage({ db, dialect: "mysql", autoMigrate: true }).schemaVersion();
    },
    async create() {
      if (!db) throw new Error("db not initialized");
      for (const table of RESET_TABLES) await sql.raw(`delete from ${table}`).execute(db);
      const clock = makeFakeClock();
      return { storage: KyselyStorage({ db, dialect: "mysql", clock, autoMigrate: false }), clock };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/kysely (mysql dialect) — set POSTEL_MYSQL_TESTCONTAINERS=1 (Docker)", () => {
    it("skipped without Docker", () => {});
  });
}
