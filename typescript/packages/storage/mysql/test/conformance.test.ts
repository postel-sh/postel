import { makeFakeClock, runStorageTests, startMysqlContainer } from "@postel/storage-testkit";
import { describe, it } from "vitest";

import type { MysqlPool } from "../src/index.js";
import { MysqlStorage } from "../src/index.js";

const RESET_TABLES = [
  "messages",
  "attempts",
  "endpoint_secrets",
  "endpoint_state_transitions",
  "endpoints",
  "tenants",
  "postel_received_messages",
];

// Real-MySQL tier. MySQL has no embedded equivalent of pglite, so the full
// battery runs only here, gated on POSTEL_MYSQL_TESTCONTAINERS (Docker). It is
// multiple real connections — the authoritative proof of FOR UPDATE SKIP LOCKED
// contention and the select-then-update reservation under transaction isolation
// (notify off, txIsolation on). A dedicated CI job sets the flag.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  let pool: MysqlPool | undefined;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/mysql (testcontainers)",
    expectedSchemaVersion: 4,
    // MySQL container boot (pull + init + healthcheck) far exceeds vitest's 10s default.
    setupTimeoutMs: 120_000,
    capabilities: { notify: false, txIsolation: true },
    async setup() {
      const { createPool } = await import("mysql2/promise");
      const container = await startMysqlContainer();
      const realPool = createPool(container.uri);
      pool = realPool as unknown as MysqlPool;
      stop = async () => {
        await realPool.end();
        await container.stop();
      };
      await MysqlStorage({ pool, autoMigrate: true }).schemaVersion();
    },
    async create() {
      if (!pool) throw new Error("pool not initialized");
      for (const table of RESET_TABLES) await pool.query(`DELETE FROM ${table}`);
      const clock = makeFakeClock();
      return { storage: MysqlStorage({ pool, clock, autoMigrate: false }), clock };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/mysql (testcontainers) — set POSTEL_MYSQL_TESTCONTAINERS=1 (Docker) to run", () => {
    it("skipped without Docker", () => {});
  });
}
