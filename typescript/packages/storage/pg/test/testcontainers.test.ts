import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";
import { describe, it } from "vitest";

import type { PgPool } from "../src/index.js";
import { PgStorage } from "../src/index.js";

// Real-Postgres tier. Gated on POSTEL_PG_TESTCONTAINERS (Docker required), so it
// stays out of the default `pnpm test` and runs in a dedicated CI job. Unlike
// the always-on pglite tier, this is multiple real connections — so it is the
// authoritative proof of true FOR UPDATE SKIP LOCKED contention and
// cross-connection LISTEN/NOTIFY (notify + txIsolation both on).
if (process.env.POSTEL_PG_TESTCONTAINERS) {
  let pool: PgPool | undefined;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/pg (testcontainers)",
    expectedSchemaVersion: 4,
    setupTimeoutMs: 120_000,
    capabilities: { notify: true, txIsolation: true },
    async setup() {
      const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
      const { Pool } = await import("pg");
      const container = await new PostgreSqlContainer("postgres:16-alpine").start();
      const realPool = new Pool({ connectionString: container.getConnectionUri() });
      pool = realPool as unknown as PgPool;
      stop = async () => {
        await realPool.end();
        await container.stop();
      };
      await PgStorage({ pool, autoMigrate: true }).schemaVersion();
    },
    async create() {
      if (!pool) throw new Error("pool not initialized");
      await pool.query(
        "TRUNCATE messages, attempts, endpoint_secrets, endpoint_state_transitions, endpoints, tenants, postel_received_messages",
      );
      const clock = makeFakeClock();
      return { storage: PgStorage({ pool, clock, autoMigrate: false }), clock };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/pg (testcontainers) — set POSTEL_PG_TESTCONTAINERS=1 (Docker) to run", () => {
    it("skipped without Docker", () => {});
  });
}
