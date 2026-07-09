import { InMemoryStorage } from "@postel/core";

import { makeFakeClock, runStorageTests } from "../src/index.js";

// Proves the shared battery passes against the in-memory reference adapter
// before any SQL adapter consumes it. The in-memory backend supports the full
// capability surface (push notify + true transaction isolation), so no
// scenarios are skipped here.
runStorageTests({
  name: "in-memory (reference)",
  expectedSchemaVersion: 5,
  capabilities: { notify: true, txIsolation: true },
  async create() {
    const clock = makeFakeClock();
    return { storage: InMemoryStorage({ clock }), clock };
  },
});
