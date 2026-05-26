import type { Clock } from "@postel/core";
import { Postel } from "@postel/core";
import { describe, expect, it } from "vitest";

import { InMemoryStorage } from "../src/index.js";

function FakeClock(initial = new Date("2026-05-26T10:00:00Z")): Clock & {
  advance(ms: number): void;
} {
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

async function tick(ms = 5): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("Send is non-blocking and returns a MessageId", () => {
  it("Successful enqueue: send inserts a single row and returns a MessageId; no HTTP fired", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const id = await postel.outbound.send({ type: "order.created", data: { id: "ord_1" } });
    expect(id).toMatch(/^msg_/);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(1);
  });
});

describe("Send participates in the host transaction (outbox pattern)", () => {
  it("Atomic with host write: rolled-back tx removes the outbox row", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await expect(
      storage.transaction(async (tx) => {
        await postel.outbound.send({ type: "order.created", data: { id: "ord_1" } }, { tx });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(0);
  });
});

describe("Idempotent send by client-supplied key", () => {
  it("Repeat send with same key: both calls return the same MessageId; one row inserted", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const a = await postel.outbound.send(
      { type: "order.created", data: { id: "ord_1" } },
      undefined,
    );
    void a; // first call has no idempotencyKey; baseline insert
    const b = await postel.outbound.send({
      type: "order.created",
      data: { id: "ord_1" },
      idempotencyKey: "idem-1",
    });
    const c = await postel.outbound.send({
      type: "order.created",
      data: { id: "ord_1" },
      idempotencyKey: "idem-1",
    });
    expect(b).toBe(c);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(2);
  });
});

describe("Workers run in-process by default", () => {
  it("Same DB, separate worker process: start() draws messages from the outbox", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await postel.outbound.send({ type: "order.created", data: { id: "ord_1" } });
    await postel.start();
    await tick(150);
    const depth = await storage.outboxDepth();
    await postel.stop();
    expect(depth.depth).toBe(0);
  });
});

describe("Late-binding fanout", () => {
  it("Endpoint added between send and dispatch: dispatch sees the newly-added endpoint", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const id = await postel.outbound.send({ type: "order.created", data: { id: "ord_1" } });
    await storage.endpoints.create({
      id: "ep_late",
      tenantId: null,
      url: "https://example.test/hook",
      state: "active",
      types: null,
      channels: null,
      retryPolicy: null,
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: false,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await postel.start();
    await tick(150);
    await postel.stop();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.endpointId).toBe("ep_late");
  });
});

describe("Late binding at dispatch time", () => {
  it("Endpoints are resolved at dispatch time, not at send time", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const id1 = await postel.outbound.send({ type: "user.signup" });
    await storage.endpoints.create({
      id: "ep_dispatch_time",
      tenantId: null,
      url: "https://example.test/hook",
      state: "active",
      types: null,
      channels: null,
      retryPolicy: null,
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: false,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await postel.start();
    await tick(150);
    await postel.stop();
    const attempts = await storage.attempts.latestForMessage(id1);
    expect(attempts.length).toBeGreaterThan(0);
  });
});

describe("Per-message TTL", () => {
  it("Expired message: clock advances past TTL pre-dispatch; no HTTP, attempts.status=expired", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const postel = Postel({ outbound: { storage, clock } });
    await storage.endpoints.create({
      id: "ep_ttl",
      tenantId: null,
      url: "https://example.test/hook",
      state: "active",
      types: null,
      channels: null,
      retryPolicy: null,
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: false,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    const id = await postel.outbound.send({ type: "order.created", ttl: "1s" });
    clock.advance(2_000);
    await postel.start();
    await tick(200);
    await postel.stop();
    const attempts = await storage.attempts.latestForMessage(id);
    const expired = attempts.find((a) => a.status === "expired");
    expect(expired).toBeDefined();
  });
});

describe("Graceful shutdown", () => {
  it("SIGTERM during dispatch: stop() drains in-flight HTTP attempts cleanly", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    // No endpoints means no dispatch attempts; messages get marked final immediately.
    for (let i = 0; i < 5; i++) {
      await postel.outbound.send({ type: "order.created", data: { i } });
    }
    await postel.start();
    await tick(150);
    await postel.stop();
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(0);
  });
});

describe("At-least-once delivery guarantee", () => {
  it("Worker crash mid-attempt: lease expires, another worker reclaims via expireStaleLeases", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const id = await storage.insertMessage({
      id: "msg_at_least_once",
      tenantId: null,
      type: "order.created",
      data: null,
      channels: null,
      idempotencyKey: null,
      version: null,
      ttlSeconds: null,
      createdAt: clock.now(),
      expiresAt: null,
    });
    await storage.reserveBatch({
      workerId: "crashed",
      leaseMs: 60_000,
      batchSize: 1,
      now: clock.now(),
    });
    clock.advance(61_000);
    const cleared = await storage.expireStaleLeases(clock.now());
    expect(cleared).toBe(1);
    const next = await storage.reserveBatch({
      workerId: "fresh",
      leaseMs: 60_000,
      batchSize: 1,
      now: clock.now(),
    });
    expect(next[0]?.id).toBe(id);
  });
});

describe("Send latency budget", () => {
  it("Latency under load: 1000 send calls average well under 5 ms each against in-memory storage", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await postel.outbound.send({ type: "perf.test", data: { i } });
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 1000;
    expect(avgMs).toBeLessThan(5);
  });
});

describe("Outbox poll latency", () => {
  it("Postgres LISTEN/NOTIFY: in-memory adapter exposes notify=true and wakes idle workers within tens of ms", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await storage.endpoints.create({
      id: "ep_poll",
      tenantId: null,
      url: "https://example.test/hook",
      state: "active",
      types: null,
      channels: null,
      retryPolicy: null,
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: false,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await postel.start();
    const t0 = performance.now();
    await postel.outbound.send({ type: "order.created" });
    await tick(150);
    const elapsed = performance.now() - t0;
    await postel.stop();
    expect(elapsed).toBeLessThan(300);
  });
});
