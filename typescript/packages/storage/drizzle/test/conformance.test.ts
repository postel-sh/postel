import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { DrizzleStorage } from "../src/index.js";

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
