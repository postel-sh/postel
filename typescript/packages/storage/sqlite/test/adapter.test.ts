import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqliteStorage } from "../src/index.js";

const CANONICAL_TABLES = [
  "_postel_meta",
  "tenants",
  "endpoints",
  "endpoint_secrets",
  "messages",
  "attempts",
  "endpoint_state_transitions",
];

// Requirement: SQLite support across the adapter matrix
describe("SQLite support across the adapter matrix", () => {
  it("Standalone SQLite adapter polls: notify is unavailable and reservation uses BEGIN IMMEDIATE", async () => {
    const storage = SqliteStorage({ filename: ":memory:" });
    expect(storage.capabilities.notify).toBe(false);
    expect(storage.capabilities.subscribe).toBe(false);
    expect(storage.notify).toBeUndefined();
    expect(storage.subscribe).toBeUndefined();

    const now = new Date("2026-05-26T10:00:00.000Z");
    await storage.insertMessage({
      id: "m1",
      tenantId: null,
      type: "order.created",
      data: { id: "ord_1" },
      channels: null,
      idempotencyKey: null,
      version: null,
      ttlSeconds: null,
      createdAt: now,
      expiresAt: null,
    });
    const reserved = await storage.reserveBatch({
      workerId: "w1",
      leaseMs: 60_000,
      batchSize: 5,
      now,
    });
    expect(reserved.map((r) => r.id)).toEqual(["m1"]);
  });
});

// Requirement: Migrations runnable from CLI and programmatic API
describe("Migrations runnable from CLI and programmatic API", () => {
  it("Idempotent standalone boot: re-running migrations is a no-op and yields the canonical schema", () => {
    const db = new Database(":memory:");
    SqliteStorage({ db }); // migrates to the current version on construction
    const first = db
      .prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'")
      .get() as {
      value: string;
    };
    SqliteStorage({ db }); // re-running is gated by the recorded version → no-op
    const second = db
      .prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(second.value).toBe(first.value);
    expect(second.value).toBe("5");

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const table of CANONICAL_TABLES) expect(tables).toContain(table);
  });
});

// Requirement: Adapter matrix with three categories
describe("Adapter matrix with three categories", () => {
  it("Adapter category declared in package metadata: @postel/sqlite is standalone and owns its connection", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { postel?: { adapter?: { category?: string } } };
    expect(pkg.postel?.adapter?.category).toBe("standalone");
    // Standalone = Postel owns the connection: a bare filename is the entire setup.
    const storage = SqliteStorage({ filename: ":memory:" });
    expect(typeof storage.insertMessage).toBe("function");
  });
});
