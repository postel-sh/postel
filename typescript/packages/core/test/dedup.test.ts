import { describe, expect, it } from "vitest";

import { InMemoryDedup, Postel, Secret } from "../src/index.js";
import type { InMemoryDedupOptions } from "../src/index.js";

const TEST_SECRET = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";

function inboundSource(options?: InMemoryDedupOptions) {
  const postel = Postel({
    inbound: { vendor: { verify: Secret(TEST_SECRET), dedup: InMemoryDedup(options) } },
  });
  return postel.inbound.vendor;
}

describe("Idempotency dedup helper", () => {
  describe("First receipt", () => {
    it("returns { duplicate: false } the first time a message id is seen", async () => {
      const source = inboundSource();
      const result = await source.dedup("msg_first", { ttl: "1h" });
      expect(result).toEqual({ duplicate: false });
    });
  });

  describe("Duplicate receipt", () => {
    it("returns { duplicate: true } on the second call within the TTL", async () => {
      const source = inboundSource();
      await source.dedup("msg_dup", { ttl: "1h" });
      const second = await source.dedup("msg_dup", { ttl: "1h" });
      expect(second).toEqual({ duplicate: true });
    });

    it("treats entries past their TTL as fresh first receipts", async () => {
      let nowMs = Date.parse("2026-05-14T15:00:00Z");
      const source = inboundSource({ now: () => new Date(nowMs) });

      const first = await source.dedup("msg_ttl", { ttl: 60 });
      expect(first).toEqual({ duplicate: false });

      nowMs += 61_000;
      const second = await source.dedup("msg_ttl", { ttl: 60 });
      expect(second).toEqual({ duplicate: false });
    });

    it("accepts string durations like '1h', '30m', '7d'", async () => {
      const source = inboundSource();
      expect(await source.dedup("msg_a", { ttl: "1h" })).toEqual({ duplicate: false });
      expect(await source.dedup("msg_a", { ttl: "1h" })).toEqual({ duplicate: true });
      expect(await source.dedup("msg_b", { ttl: "7d" })).toEqual({ duplicate: false });
    });
  });

  describe("Concurrent dedup calls", () => {
    it("exactly one of two concurrent calls returns duplicate:false (in-memory adapter)", async () => {
      const source = inboundSource();
      const [a, b] = await Promise.all([
        source.dedup("msg_race", { ttl: "1h" }),
        source.dedup("msg_race", { ttl: "1h" }),
      ]);
      const duplicates = [a, b].filter((r) => r.duplicate);
      expect(duplicates).toHaveLength(1);
    });

    it("under 100 concurrent calls for the same id, exactly one wins", async () => {
      const source = inboundSource();
      const results = await Promise.all(
        Array.from({ length: 100 }, () => source.dedup("msg_storm", { ttl: "1h" })),
      );
      const firsts = results.filter((r) => !r.duplicate);
      expect(firsts).toHaveLength(1);
    });
  });

  describe("Redis is opt-in only", () => {
    it("@postel/core runs without Redis as a dependency (in-memory adapter is built in)", async () => {
      const adapter = InMemoryDedup();
      expect(typeof adapter.record).toBe("function");
      const source = inboundSource();
      const r = await source.dedup("msg_no_redis", { ttl: "1h" });
      expect(r.duplicate).toBe(false);
    });
  });
});
