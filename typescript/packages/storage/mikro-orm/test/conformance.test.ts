import { MikroORM } from "@mikro-orm/better-sqlite";
import { makeFakeClock, runStorageTests, startMysqlContainer } from "@postel/storage-testkit";
import { describe, it } from "vitest";

import { MikroOrmStorage } from "../src/index.js";

const RESET_TABLES = [
  "messages",
  "attempts",
  "endpoint_secrets",
  "endpoint_state_transitions",
  "endpoints",
  "tenants",
  "postel_received_messages",
];

// Exercises the adapter through a MikroORM better-sqlite instance — a real ORM
// over a real database. Single connection, so notify and tx-isolation are
// skipped; the Postgres / MySQL dialect paths share the same code (MySQL runs on
// a real server below).
let sqliteOrm: MikroORM | undefined;
runStorageTests({
  name: "@postel/mikro-orm (better-sqlite)",
  expectedSchemaVersion: 4,
  capabilities: { notify: false, txIsolation: false },
  async setup() {
    sqliteOrm = await MikroORM.init({
      dbName: ":memory:",
      entities: [],
      discovery: { warnWhenNoEntities: false },
    });
    await MikroOrmStorage({ orm: sqliteOrm, dialect: "sqlite", autoMigrate: true }).schemaVersion();
  },
  async create() {
    if (!sqliteOrm) throw new Error("orm not initialized");
    const conn = sqliteOrm.em.getConnection();
    for (const table of RESET_TABLES) await conn.execute(`delete from ${table}`);
    const clock = makeFakeClock();
    return {
      storage: MikroOrmStorage({ orm: sqliteOrm, dialect: "sqlite", clock, autoMigrate: false }),
      clock,
    };
  },
  async teardown() {
    if (sqliteOrm) await sqliteOrm.close();
  },
});

// Real-MySQL tier (pooled connections), gated on POSTEL_MYSQL_TESTCONTAINERS
// (Docker). Proves the mysql branch: select-then-update reservation under
// FOR UPDATE SKIP LOCKED and ON DUPLICATE KEY UPDATE dedup, with isolation.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamically-loaded driver-bound MikroORM
  let orm: any;
  let stop: (() => Promise<void>) | undefined;

  runStorageTests({
    name: "@postel/mikro-orm (mysql, testcontainers)",
    expectedSchemaVersion: 4,
    setupTimeoutMs: 120_000,
    capabilities: { notify: false, txIsolation: true },
    async setup() {
      const { MikroORM: MysqlMikroORM } = await import("@mikro-orm/mysql");
      const container = await startMysqlContainer();
      orm = await MysqlMikroORM.init({
        clientUrl: container.uri,
        entities: [],
        discovery: { warnWhenNoEntities: false },
      });
      stop = async () => {
        await orm?.close();
        await container.stop();
      };
      await MikroOrmStorage({ orm, dialect: "mysql", autoMigrate: true }).schemaVersion();
    },
    async create() {
      const conn = orm.em.getConnection();
      for (const table of RESET_TABLES) await conn.execute(`delete from ${table}`);
      const clock = makeFakeClock();
      return {
        storage: MikroOrmStorage({ orm, dialect: "mysql", clock, autoMigrate: false }),
        clock,
      };
    },
    async teardown() {
      if (stop) await stop();
    },
  });
} else {
  describe.skip("@postel/mikro-orm (mysql) — set POSTEL_MYSQL_TESTCONTAINERS=1 (Docker)", () => {
    it("skipped without Docker", () => {});
  });
}
