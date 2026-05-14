import { describe, expect, it } from "vitest";

import { dedup, inMemoryDedupAdapter } from "../src/index.js";

describe("Idempotency dedup helper", () => {
  describe("First receipt", () => {
    it("returns { duplicate: false } the first time a message id is seen", async () => {
      const adapter = inMemoryDedupAdapter();
      const result = await dedup("msg_first", { ttl: "1h", adapter });
      expect(result).toEqual({ duplicate: false });
    });
  });

  describe("Duplicate receipt", () => {
    it("returns { duplicate: true } on the second call within the TTL", async () => {
      const adapter = inMemoryDedupAdapter();
      await dedup("msg_dup", { ttl: "1h", adapter });
      const second = await dedup("msg_dup", { ttl: "1h", adapter });
      expect(second).toEqual({ duplicate: true });
    });

    it("treats entries past their TTL as fresh first receipts", async () => {
      let nowMs = Date.parse("2026-05-14T15:00:00Z");
      const adapter = inMemoryDedupAdapter({ now: () => new Date(nowMs) });

      const first = await dedup("msg_ttl", { ttl: 60, adapter });
      expect(first).toEqual({ duplicate: false });

      nowMs += 61_000;
      const second = await dedup("msg_ttl", { ttl: 60, adapter });
      expect(second).toEqual({ duplicate: false });
    });

    it("accepts string durations like '1h', '30m', '7d'", async () => {
      const adapter = inMemoryDedupAdapter();
      expect(await dedup("msg_a", { ttl: "1h", adapter })).toEqual({ duplicate: false });
      expect(await dedup("msg_a", { ttl: "1h", adapter })).toEqual({ duplicate: true });
      expect(await dedup("msg_b", { ttl: "7d", adapter })).toEqual({ duplicate: false });
    });
  });

  describe("Concurrent dedup calls", () => {
    it("exactly one of two concurrent calls returns duplicate:false (in-memory adapter)", async () => {
      const adapter = inMemoryDedupAdapter();
      const [a, b] = await Promise.all([
        dedup("msg_race", { ttl: "1h", adapter }),
        dedup("msg_race", { ttl: "1h", adapter }),
      ]);
      const duplicates = [a, b].filter((r) => r.duplicate);
      expect(duplicates).toHaveLength(1);
    });

    it("under 100 concurrent calls for the same id, exactly one wins", async () => {
      const adapter = inMemoryDedupAdapter();
      const results = await Promise.all(
        Array.from({ length: 100 }, () => dedup("msg_storm", { ttl: "1h", adapter })),
      );
      const firsts = results.filter((r) => !r.duplicate);
      expect(firsts).toHaveLength(1);
    });
  });

  describe("Redis is opt-in only", () => {
    it("@postel/edge runs without Redis as a dependency (in-memory adapter is built in)", async () => {
      const adapter = inMemoryDedupAdapter();
      expect(typeof adapter.record).toBe("function");
      const r = await dedup("msg_no_redis", { ttl: "1h", adapter });
      expect(r.duplicate).toBe(false);
    });
  });
});
