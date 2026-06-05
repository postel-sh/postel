import { makeFakeClock, runStorageTests, startMysqlContainer } from "@postel/storage-testkit";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it } from "vitest";

import { type DrizzleDatabase, DrizzleStorage } from "../src/index.js";

// Exercises the adapter through a Drizzle better-sqlite3 database. Single
// connection, so notify and tx-isolation are skipped; the Postgres dialect
// shares the same SQL and is proven by @postel/pg.
runStorageTests({
  name: "@postel/drizzle (sqlite dialect)",
  expectedSchemaVersion: 4,
  capabilities: { notify: false, txIsolation: false },
  async create() {
    const clock = makeFakeClock();
    const db = drizzle(new Database(":memory:"));
    return {
      storage: DrizzleStorage({ db, dialect: "sqlite", clock }),
      clock,
    };
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
// POSTEL_MYSQL_TESTCONTAINERS (Docker). Proves the mysql branch: select-then-
// update reservation under FOR UPDATE SKIP LOCKED and ON DUPLICATE KEY UPDATE
// dedup, with transaction isolation.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  let pool: { query(sql: string): Promise<unknown>; end(): Promise<void> } | undefined;
  let db: DrizzleDatabase | undefined;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/drizzle (mysql dialect, testcontainers)",
    expectedSchemaVersion: 4,
    setupTimeoutMs: 120_000,
    capabilities: { notify: false, txIsolation: true },
    async setup() {
      const { createPool } = await import("mysql2/promise");
      const { drizzle: drizzleMysql } = await import("drizzle-orm/mysql2");
      const container = await startMysqlContainer();
      const realPool = createPool(container.uri);
      pool = realPool as unknown as typeof pool;
      db = drizzleMysql(realPool) as unknown as DrizzleDatabase;
      stop = async () => {
        await realPool.end();
        await container.stop();
      };
      await DrizzleStorage({ db, dialect: "mysql", autoMigrate: true }).schemaVersion();
    },
    async create() {
      if (!db || !pool) throw new Error("db not initialized");
      for (const table of RESET_TABLES) await pool.query(`delete from ${table}`);
      const clock = makeFakeClock();
      return {
        storage: DrizzleStorage({ db, dialect: "mysql", clock, autoMigrate: false }),
        clock,
      };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/drizzle (mysql dialect) — set POSTEL_MYSQL_TESTCONTAINERS=1 (Docker)", () => {
    it("skipped without Docker", () => {});
  });
}
