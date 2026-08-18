import { describe, expect, it } from "vitest";
import type { Clock } from "../src/clock.js";
import { stubDispatchOne } from "../src/sender/dispatcher/dispatch.js";
import { drainOnce } from "../src/sender/worker/drain.js";
import { WorkerPool } from "../src/sender/worker/pool.js";
import { InMemoryStorage } from "../src/storage/memory/adapter.js";

function FakeClock(initial: Date): Clock & { advance(ms: number): void } {
  let current = initial;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

async function seedMessages(
  storage: ReturnType<typeof InMemoryStorage>,
  count: number,
  now: Date,
  prefix = "msg",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await storage.insertMessage({
      id: `${prefix}_${i}`,
      tenantId: null,
      type: "outbox.event",
      data: null,
      channels: null,
      idempotencyKey: null,
      version: null,
      ttlSeconds: null,
      createdAt: now,
      expiresAt: null,
    });
  }
}

describe("Bounded single-pass drain for serverless invocation", () => {
  it("Stops at maxMessages", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const storage = InMemoryStorage();
    await seedMessages(storage, 50, now);

    const result = await drainOnce(
      { storage, clock: { now: () => now, sleep: async () => {} }, dispatchOne: stubDispatchOne },
      { maxMessages: 10, deadline: "30s" },
    );

    expect(result.processed).toBe(10);
    expect(result.reachedDeadline).toBe(false);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(40);
  });

  it("Stops at deadline", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const storage = InMemoryStorage();
    await seedMessages(storage, 50, now);
    const clock = FakeClock(now);

    // No endpoints are registered, so each reserved message finalizes as
    // "dispatched" without calling dispatchOne. Advancing the clock on that
    // finalize hook simulates real dispatch latency: the first reserved
    // batch pushes the clock well past the 10ms deadline, so the next
    // reservation attempt observes an elapsed deadline before reserving any
    // more of the remaining messages.
    const originalMarkMessageFinal = storage.markMessageFinal.bind(storage);
    storage.markMessageFinal = async (messageId, status) => {
      clock.advance(20);
      return originalMarkMessageFinal(messageId, status);
    };

    const result = await drainOnce(
      { storage, clock, dispatchOne: stubDispatchOne },
      { maxMessages: 50, deadline: "10ms" },
    );

    expect(result.reachedDeadline).toBe(true);
    expect(result.processed).toBeLessThan(50);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(50 - result.processed);
  });

  it("Safe alongside a running worker pool", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const storage = InMemoryStorage();
    await seedMessages(storage, 30, now);

    const dispatched: string[] = [];
    const originalMarkMessageFinal = storage.markMessageFinal.bind(storage);
    storage.markMessageFinal = async (messageId, status) => {
      dispatched.push(messageId);
      return originalMarkMessageFinal(messageId, status);
    };

    const clock = { now: () => now, sleep: async () => {} };
    const pool = new WorkerPool({
      storage,
      clock,
      concurrency: 2,
      dispatchOne: stubDispatchOne,
      batchSize: 4,
      idleMs: 5,
      janitorIntervalMs: 60_000,
    });
    await pool.start();
    try {
      const result = await drainOnce(
        { storage, clock, dispatchOne: stubDispatchOne },
        { maxMessages: 30, deadline: "5s" },
      );
      // Give the concurrently running pool a chance to finish reserving
      // whatever `drain()` didn't get to.
      await new Promise((resolve) => setTimeout(resolve, 200));
      void result;
    } finally {
      await pool.stop();
    }

    expect(dispatched.length).toBe(30);
    expect(new Set(dispatched).size).toBe(30);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(0);
  });
});
