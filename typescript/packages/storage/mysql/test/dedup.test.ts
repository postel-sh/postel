import { ttlToSeconds } from "@postel/core";
import type { DedupAdapter, DedupResult } from "@postel/core";
import { describe, expect, it } from "vitest";

import { MysqlDedup, type MysqlDedupClient } from "../src/index.js";

function dedup(
  messageId: string,
  options: { ttl: number | string; adapter: DedupAdapter },
): Promise<DedupResult> {
  return options.adapter.record(messageId, ttlToSeconds(options.ttl));
}

interface MockRow {
  message_id: string;
  expires_at: number;
}

// Emulates a mysql2 pool/connection's `query` for the statements the dedup
// adapter issues — INSERT IGNORE (affectedRows 1 inserted / 0 duplicate) and a
// conditional UPDATE (1 if an expired row is refreshed / 0 if a live row is
// left untouched). This is why the adapter avoids ON DUPLICATE KEY UPDATE: its
// no-op IF branch still reports a changed row, so affectedRows can't tell a
// live duplicate from an expired refresh.
class MockMysqlClient implements MysqlDedupClient {
  private readonly rows = new Map<string, MockRow>();
  public ddlCalls = 0;
  public queries: Array<{ sql: string; values: unknown[] }> = [];

  async query(sql: string, values: unknown[]): Promise<[unknown, unknown]> {
    this.queries.push({ sql, values });
    const trimmed = sql.replace(/\s+/gu, " ").trim();
    if (trimmed.startsWith("CREATE TABLE")) {
      this.ddlCalls++;
      return [{ affectedRows: 0 }, []];
    }
    if (trimmed.startsWith("INSERT IGNORE")) {
      const [messageId, expiresMs] = values as [string, number];
      if (this.rows.has(messageId)) return [{ affectedRows: 0 }, []];
      this.rows.set(messageId, { message_id: messageId, expires_at: expiresMs });
      return [{ affectedRows: 1 }, []];
    }
    if (trimmed.startsWith("UPDATE")) {
      const [expiresMs, messageId, currentMs] = values as [number, string, number];
      const existing = this.rows.get(messageId);
      if (existing && existing.expires_at <= currentMs) {
        this.rows.set(messageId, { message_id: messageId, expires_at: expiresMs });
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }
    throw new Error(`unexpected query: ${trimmed}`);
  }
}

describe("Idempotency dedup helper", () => {
  describe("First receipt", () => {
    it("returns { duplicate: false } the first time a message id is seen (MySQL)", async () => {
      const client = new MockMysqlClient();
      const adapter = MysqlDedup({ client });
      expect(await dedup("msg_first_mysql", { ttl: "1h", adapter })).toEqual({ duplicate: false });
    });
  });

  describe("Duplicate receipt", () => {
    it("returns { duplicate: true } on the second call within the TTL (MySQL)", async () => {
      const client = new MockMysqlClient();
      const adapter = MysqlDedup({ client });
      await dedup("msg_dup_mysql", { ttl: "1h", adapter });
      expect(await dedup("msg_dup_mysql", { ttl: "1h", adapter })).toEqual({ duplicate: true });
    });

    it("entries past their TTL are treated as fresh first receipts (MySQL)", async () => {
      let nowMs = Date.parse("2026-05-14T15:00:00Z");
      const client = new MockMysqlClient();
      const adapter = MysqlDedup({ client, now: () => new Date(nowMs) });
      expect(await dedup("msg_ttl_mysql", { ttl: 60, adapter })).toEqual({ duplicate: false });
      nowMs += 61_000;
      expect(await dedup("msg_ttl_mysql", { ttl: 60, adapter })).toEqual({ duplicate: false });
    });
  });

  describe("Concurrent dedup calls", () => {
    it("relies on INSERT IGNORE atomicity — exactly one fresh receipt (MySQL)", async () => {
      const client = new MockMysqlClient();
      const adapter = MysqlDedup({ client });
      const [a, b] = await Promise.all([
        dedup("msg_race_mysql", { ttl: "1h", adapter }),
        dedup("msg_race_mysql", { ttl: "1h", adapter }),
      ]);
      expect([a, b].filter((r) => r.duplicate)).toHaveLength(1);
    });
  });

  it("uses INSERT IGNORE then a conditional UPDATE (expires_at <= now) — not ON DUPLICATE KEY", async () => {
    const client = new MockMysqlClient();
    const adapter = MysqlDedup({ client });
    await dedup("msg_inspect", { ttl: 60, adapter });
    expect(client.queries.some((q) => q.sql.includes("INSERT IGNORE"))).toBe(true);
    expect(client.queries.every((q) => !q.sql.includes("ON DUPLICATE KEY"))).toBe(true);
  });

  it("runs DDL once (auto-migrate, single CREATE TABLE) and reuses it across record() calls", async () => {
    const client = new MockMysqlClient();
    const adapter = MysqlDedup({ client });
    await dedup("a", { ttl: 60, adapter });
    await dedup("b", { ttl: 60, adapter });
    expect(client.ddlCalls).toBe(1);
  });

  it("skips DDL when autoMigrate: false (the host owns migrations)", async () => {
    const client = new MockMysqlClient();
    const adapter = MysqlDedup({ client, autoMigrate: false });
    await dedup("x", { ttl: 60, adapter });
    expect(client.ddlCalls).toBe(0);
  });
});
