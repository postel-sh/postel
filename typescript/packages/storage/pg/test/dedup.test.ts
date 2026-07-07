import { ttlToSeconds } from "@postel/core";
import type { DedupAdapter, DedupResult } from "@postel/core";
import { describe, expect, it } from "vitest";

import { type PgClient, PgDedup } from "../src/index.js";

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

class MockPgClient implements PgClient {
  private readonly rows = new Map<string, MockRow>();
  public ddlCalls = 0;
  public queries: Array<{ text: string; values: unknown[] }> = [];

  async query<R extends { rowCount?: number | null }>(text: string, values: unknown[]): Promise<R> {
    this.queries.push({ text, values });
    const trimmed = text.replace(/\s+/gu, " ").trim();
    if (trimmed.startsWith("CREATE TABLE") || trimmed.startsWith("CREATE INDEX")) {
      this.ddlCalls++;
      return { rowCount: 0, rows: [] } as unknown as R;
    }
    if (trimmed.startsWith("INSERT INTO")) {
      const [messageId, expiresIso, currentIso] = values as [string, string, string];
      const currentMs = Date.parse(currentIso);
      const expiresMs = Date.parse(expiresIso);
      const existing = this.rows.get(messageId);
      if (!existing) {
        this.rows.set(messageId, { message_id: messageId, expires_at: expiresMs });
        return {
          rowCount: 1,
          rows: [{ message_id: messageId }],
        } as unknown as R;
      }
      if (existing.expires_at <= currentMs) {
        this.rows.set(messageId, { message_id: messageId, expires_at: expiresMs });
        return {
          rowCount: 1,
          rows: [{ message_id: messageId }],
        } as unknown as R;
      }
      return { rowCount: 0, rows: [] } as unknown as R;
    }
    throw new Error(`unexpected query: ${trimmed}`);
  }
}

describe("Idempotency dedup helper", () => {
  describe("First receipt", () => {
    it("returns { duplicate: false } the first time a message id is seen (Postgres)", async () => {
      const client = new MockPgClient();
      const adapter = PgDedup({ client });
      const result = await dedup("msg_first_pg", { ttl: "1h", adapter });
      expect(result).toEqual({ duplicate: false });
    });
  });

  describe("Duplicate receipt", () => {
    it("returns { duplicate: true } on the second call within the TTL (Postgres)", async () => {
      const client = new MockPgClient();
      const adapter = PgDedup({ client });
      await dedup("msg_dup_pg", { ttl: "1h", adapter });
      const second = await dedup("msg_dup_pg", { ttl: "1h", adapter });
      expect(second).toEqual({ duplicate: true });
    });

    it("entries past their TTL are treated as fresh first receipts (Postgres)", async () => {
      let nowMs = Date.parse("2026-05-14T15:00:00Z");
      const client = new MockPgClient();
      const adapter = PgDedup({ client, now: () => new Date(nowMs) });
      expect(await dedup("msg_ttl_pg", { ttl: 60, adapter })).toEqual({ duplicate: false });
      nowMs += 61_000;
      expect(await dedup("msg_ttl_pg", { ttl: 60, adapter })).toEqual({ duplicate: false });
    });
  });

  describe("Concurrent dedup calls", () => {
    it("relies on Postgres INSERT ... ON CONFLICT atomicity (verified at SQL level)", async () => {
      const client = new MockPgClient();
      const adapter = PgDedup({ client });
      const [a, b] = await Promise.all([
        dedup("msg_race_pg", { ttl: "1h", adapter }),
        dedup("msg_race_pg", { ttl: "1h", adapter }),
      ]);
      expect([a, b].filter((r) => r.duplicate)).toHaveLength(1);
    });
  });

  it("uses INSERT ... ON CONFLICT (message_id) DO UPDATE ... WHERE expires_at <= now()", async () => {
    const client = new MockPgClient();
    const adapter = PgDedup({ client });
    await dedup("msg_inspect", { ttl: 60, adapter });
    const insertSql = client.queries.find((q) => q.text.includes("INSERT INTO"))?.text ?? "";
    expect(insertSql).toMatch(/ON CONFLICT \(message_id\) DO UPDATE/u);
    expect(insertSql).toMatch(/WHERE\s+"postel_received_messages"\.expires_at\s+<=\s+\$3/u);
  });

  it("runs DDL once (auto-migrate) and reuses the table across record() calls", async () => {
    const client = new MockPgClient();
    const adapter = PgDedup({ client });
    await dedup("a", { ttl: 60, adapter });
    await dedup("b", { ttl: 60, adapter });
    expect(client.ddlCalls).toBe(2);
  });

  it("skips DDL when autoMigrate: false (the host owns migrations)", async () => {
    const client = new MockPgClient();
    const adapter = PgDedup({ client, autoMigrate: false });
    await dedup("x", { ttl: 60, adapter });
    expect(client.ddlCalls).toBe(0);
  });
});
