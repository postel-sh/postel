import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { MysqlStorage } from "../src/index.js";

// Requirement: MySQL support across the adapter matrix
describe("MySQL support across the adapter matrix", () => {
  it("Standalone MySQL adapter reserves outbox rows: notify=false (polling), no LISTEN/NOTIFY surface", () => {
    // Lazy pool — constructing with a connectionString opens nothing until a query.
    const storage = MysqlStorage({ connectionString: "mysql://u:p@localhost:3306/postel" });
    // MySQL has no LISTEN/NOTIFY, so workers poll.
    expect(storage.capabilities.notify).toBe(false);
    expect(storage.capabilities.subscribe).toBe(false);
    expect(storage.capabilities.transactional).toBe(true);
    expect(storage.capabilities.streaming).toBe(true);
    // Unlike @postel/pg, no push surface is exposed.
    expect((storage as { notify?: unknown }).notify).toBeUndefined();
    expect((storage as { subscribe?: unknown }).subscribe).toBeUndefined();
    // Reservation under FOR UPDATE SKIP LOCKED is exercised against real MySQL in
    // conformance.test.ts (testcontainers); the query shape has no RETURNING and
    // is select-then-update.
  });

  it("requires a pool or a connectionString", () => {
    expect(() => MysqlStorage({})).toThrow(/pool.*connectionString/u);
  });

  it("Adapter category declared in package metadata: @postel/mysql is standalone", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { postel?: { adapter?: { category?: string } } };
    expect(pkg.postel?.adapter?.category).toBe("standalone");
  });
});
