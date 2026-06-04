import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

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
