import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";
import Database from "better-sqlite3";

import { SqliteStorage } from "../src/index.js";

// SQLite is single-connection and single-writer: it can't honor cross-connection
// LISTEN/NOTIFY (notify=false) or mid-transaction read isolation against a
// concurrent reserveBatch (txIsolation=false), so those scenarios are skipped.
runStorageTests({
  name: "@postel/sqlite",
  expectedSchemaVersion: 4,
  capabilities: { notify: false, txIsolation: false },
  async create() {
    const clock = makeFakeClock();
    const db = new Database(":memory:");
    return { storage: SqliteStorage({ db, clock }), clock };
  },
});
