import { PGlite } from "@electric-sql/pglite";
import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";

import { PgStorage } from "../src/index.js";
import { pgliteShim } from "./pglite-shim.js";

runStorageTests({
  name: "@postel/pg (pglite)",
  expectedSchemaVersion: 5,
  capabilities: { notify: false, txIsolation: false },
  async create() {
    const clock = makeFakeClock();
    const pool = pgliteShim(new PGlite());
    return { storage: PgStorage({ pool, clock }), clock };
  },
});
