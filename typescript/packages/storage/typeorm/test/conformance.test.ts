import "reflect-metadata";
import { makeFakeClock, runStorageTests, startMysqlContainer } from "@postel/storage-testkit";
import { DataSource } from "typeorm";
import { describe, it } from "vitest";

import { TypeOrmStorage } from "../src/index.js";

const RESET_TABLES = [
  "messages",
  "attempts",
  "endpoint_secrets",
  "endpoint_state_transitions",
  "endpoints",
  "tenants",
  "postel_received_messages",
];

// Exercises the adapter through a TypeORM better-sqlite3 DataSource — a real
// ORM over a real database. Single connection, so notify and tx-isolation are
// skipped; the Postgres / MySQL dialect paths share the same code and run on
// real servers (MySQL below; Postgres mirrors @postel/pg's SQL).
let sqliteDs: DataSource | undefined;
runStorageTests({
  name: "@postel/typeorm (better-sqlite3)",
  expectedSchemaVersion: 5,
  capabilities: { notify: false, txIsolation: false },
  async setup() {
    sqliteDs = new DataSource({ type: "better-sqlite3", database: ":memory:" });
    await sqliteDs.initialize();
    await TypeOrmStorage({
      dataSource: sqliteDs,
      dialect: "sqlite",
      autoMigrate: true,
    }).schemaVersion();
  },
  async create() {
    if (!sqliteDs) throw new Error("DataSource not initialized");
    for (const table of RESET_TABLES) await sqliteDs.query(`delete from ${table}`);
    const clock = makeFakeClock();
    return {
      storage: TypeOrmStorage({
        dataSource: sqliteDs,
        dialect: "sqlite",
        clock,
        autoMigrate: false,
      }),
      clock,
    };
  },
  async teardown() {
    if (sqliteDs) await sqliteDs.destroy();
  },
});

// Real-MySQL tier (multiple connections), gated on POSTEL_MYSQL_TESTCONTAINERS
// (Docker). Proves the mysql branch: select-then-update reservation under
// FOR UPDATE SKIP LOCKED and ON DUPLICATE KEY UPDATE dedup, with isolation.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  let ds: DataSource | undefined;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/typeorm (mysql, testcontainers)",
    expectedSchemaVersion: 5,
    setupTimeoutMs: 120_000,
    capabilities: { notify: false, txIsolation: true },
    async setup() {
      const container = await startMysqlContainer();
      ds = new DataSource({ type: "mysql", connectorPackage: "mysql2", url: container.uri });
      await ds.initialize();
      stop = async () => {
        await ds?.destroy();
        await container.stop();
      };
      await TypeOrmStorage({ dataSource: ds, dialect: "mysql", autoMigrate: true }).schemaVersion();
    },
    async create() {
      if (!ds) throw new Error("DataSource not initialized");
      for (const table of RESET_TABLES) await ds.query(`delete from ${table}`);
      const clock = makeFakeClock();
      return {
        storage: TypeOrmStorage({ dataSource: ds, dialect: "mysql", clock, autoMigrate: false }),
        clock,
      };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/typeorm (mysql) — set POSTEL_MYSQL_TESTCONTAINERS=1 (Docker)", () => {
    it("skipped without Docker", () => {});
  });
}
