import { describe, expect, it } from "vitest";
import { stubDispatchOne } from "../src/sender/dispatcher/dispatch.js";
import { MAX_DISPATCH_CYCLES_PER_TENANT, Worker } from "../src/sender/worker/worker.js";
import { InMemoryStorage } from "../src/storage/memory/adapter.js";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Worker fairness across tenants", () => {
  it("Burst does not starve: tenant B's message dispatches within the bounded fairness window while tenant A floods 1000 messages", async () => {
    const storage = InMemoryStorage();
    const batchSize = 10;
    const now = new Date("2026-08-18T00:00:00Z");

    for (let i = 0; i < 1000; i++) {
      await storage.insertMessage({
        id: `msg_a_${i}`,
        tenantId: "tenant-a",
        type: "flood.event",
        data: null,
        channels: null,
        idempotencyKey: null,
        version: null,
        ttlSeconds: null,
        createdAt: now,
        expiresAt: null,
      });
    }
    await storage.insertMessage({
      id: "msg_b_0",
      tenantId: "tenant-b",
      type: "important.event",
      data: null,
      channels: null,
      idempotencyKey: null,
      version: null,
      ttlSeconds: null,
      createdAt: now,
      expiresAt: null,
    });

    const dispatchOrder: string[] = [];
    // No endpoints registered for either tenant, so dispatchMessage finalizes
    // every reserved message as "dispatched" immediately — this isolates the
    // test to the worker's reservation/rotation behavior.
    const originalMarkMessageFinal = storage.markMessageFinal.bind(storage);
    storage.markMessageFinal = async (messageId, status) => {
      dispatchOrder.push(messageId);
      return originalMarkMessageFinal(messageId, status);
    };

    const worker = new Worker({
      id: "w-fairness-test",
      storage,
      clock: { now: () => now, sleep: async () => {} },
      dispatchOne: stubDispatchOne,
      batchSize,
      leaseMs: 60_000,
      idleMs: 5,
      renewIntervalMs: 60_000,
    });

    const runLoopPromise = worker.runLoop();
    try {
      await waitFor(() => dispatchOrder.includes("msg_b_0"));
    } finally {
      await worker.drain();
      await runLoopPromise;
    }

    const bIndex = dispatchOrder.indexOf("msg_b_0");
    expect(bIndex).toBeGreaterThanOrEqual(0);
    // Tenant A can hold the worker for at most MAX_DISPATCH_CYCLES_PER_TENANT
    // consecutive cycles before yielding, so at most that many batches of
    // tenant A's backlog dispatch before tenant B gets its turn.
    expect(bIndex).toBeLessThanOrEqual(MAX_DISPATCH_CYCLES_PER_TENANT * batchSize);
    expect(bIndex).toBeLessThan(1000);
  });
});
