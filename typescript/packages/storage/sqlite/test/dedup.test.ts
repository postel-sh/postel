import { ttlToSeconds } from "@postel/core";
import type { DedupAdapter, DedupResult } from "@postel/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteDedup } from "../src/index.js";

function dedup(
  messageId: string,
  options: { ttl: number | string; adapter: DedupAdapter },
): Promise<DedupResult> {
  return options.adapter.record(messageId, ttlToSeconds(options.ttl));
}

describe("Idempotency dedup helper", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("First receipt", () => {
    it("returns { duplicate: false } the first time a message id is seen (SQLite)", async () => {
      const adapter = SqliteDedup({ db });
      const result = await dedup("msg_first", { ttl: "1h", adapter });
      expect(result).toEqual({ duplicate: false });
    });
  });

  describe("Duplicate receipt", () => {
    it("returns { duplicate: true } on the second call within the TTL (SQLite)", async () => {
      const adapter = SqliteDedup({ db });
      await dedup("msg_dup", { ttl: "1h", adapter });
      const second = await dedup("msg_dup", { ttl: "1h", adapter });
      expect(second).toEqual({ duplicate: true });
    });

    it("entries past their TTL are treated as fresh first receipts (SQLite)", async () => {
      let nowMs = Date.parse("2026-05-14T15:00:00Z");
      const adapter = SqliteDedup({ db, now: () => new Date(nowMs) });
      const first = await dedup("msg_ttl", { ttl: 60, adapter });
      expect(first).toEqual({ duplicate: false });
      nowMs += 61_000;
      const second = await dedup("msg_ttl", { ttl: 60, adapter });
      expect(second).toEqual({ duplicate: false });
    });
  });

  describe("Concurrent dedup calls", () => {
    it("exactly one of two concurrent dedup calls wins under SQLite", async () => {
      const adapter = SqliteDedup({ db });
      const [a, b] = await Promise.all([
        dedup("msg_race_sqlite", { ttl: "1h", adapter }),
        dedup("msg_race_sqlite", { ttl: "1h", adapter }),
      ]);
      expect([a, b].filter((r) => r.duplicate)).toHaveLength(1);
    });

    it("exactly one wins under 50 concurrent calls (SQLite)", async () => {
      const adapter = SqliteDedup({ db });
      const results = await Promise.all(
        Array.from({ length: 50 }, () => dedup("msg_storm_sqlite", { ttl: "1h", adapter })),
      );
      const firsts = results.filter((r) => !r.duplicate);
      expect(firsts).toHaveLength(1);
    });
  });

  it("creates the dedup table with the configured name", () => {
    SqliteDedup({ db, tableName: "custom_dedup" });
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("custom_dedup") as { name: string } | undefined;
    expect(row?.name).toBe("custom_dedup");
  });
});
