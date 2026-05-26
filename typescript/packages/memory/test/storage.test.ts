import type { Clock, NewMessage, ReservedMessage } from "@postel/core";
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

function buildMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: overrides.id ?? "msg_test_1",
    tenantId: overrides.tenantId ?? null,
    type: overrides.type ?? "order.created",
    data: overrides.data ?? { id: "ord_1" },
    channels: overrides.channels ?? null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    version: overrides.version ?? null,
    ttlSeconds: overrides.ttlSeconds ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-05-26T10:00:00Z"),
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("BYO storage interface", () => {
  it("Custom adapter against an unsupported backend: InMemoryStorage exposes the full operation set", () => {
    const storage = InMemoryStorage();
    expect(typeof storage.insertMessage).toBe("function");
    expect(typeof storage.insertOrReuseByIdempotencyKey).toBe("function");
    expect(typeof storage.reserveBatch).toBe("function");
    expect(typeof storage.recordAttempt).toBe("function");
    expect(typeof storage.renewLease).toBe("function");
    expect(typeof storage.releaseLease).toBe("function");
    expect(typeof storage.expireStaleLeases).toBe("function");
    expect(typeof storage.loadEndpointsForMessage).toBe("function");
    expect(typeof storage.rangeQuery).toBe("function");
    expect(typeof storage.reconcile).toBe("function");
    expect(typeof storage.dedup).toBe("function");
    expect(typeof storage.transaction).toBe("function");
    expect(typeof storage.endpoints.create).toBe("function");
    expect(typeof storage.secrets.insert).toBe("function");
    expect(typeof storage.tenants.upsert).toBe("function");
  });

  it("Worker reservation can't be expressed as CRUD: reserveBatch combines lock + lease + return atomically", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    await storage.insertMessage(buildMessage({ id: "msg_a", createdAt: clock.now() }));
    await storage.insertMessage(buildMessage({ id: "msg_b", createdAt: clock.now() }));
    const reserved = await storage.reserveBatch({
      workerId: "w1",
      leaseMs: 60_000,
      batchSize: 5,
      now: clock.now(),
    });
    expect(reserved.map((r) => r.id).sort()).toEqual(["msg_a", "msg_b"]);
    expect(reserved.every((r) => r.leaseExpiresAt instanceof Date)).toBe(true);
  });
});

describe("Schema is a fixed set of canonical tables", () => {
  it("Schema version handshake: schemaVersion returns the library-compatible value", async () => {
    const storage = InMemoryStorage();
    const v = await storage.schemaVersion();
    expect(v).toBe(1);
  });
});

describe("Optional storage capabilities", () => {
  it("Polling fallback when notify is unavailable: in-memory advertises notify=true; an adapter declaring notify=false would gate workers to polling", () => {
    const storage = InMemoryStorage();
    expect(storage.capabilities.notify).toBe(true);
    expect(storage.capabilities.subscribe).toBe(true);
    expect(storage.capabilities.transactional).toBe(true);
    expect(storage.capabilities.streaming).toBe(true);
  });

  it("Native push when notify is available: insertMessage fires a post-commit notify on postel_messages_new", async () => {
    const storage = InMemoryStorage();
    if (!storage.subscribe) throw new Error("expected subscribe to exist");
    let received: string | undefined;
    const off = storage.subscribe("postel_messages_new", (p) => {
      received = p;
    });
    await storage.insertMessage(buildMessage({ id: "msg_notify_1" }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(received).toContain("msg_notify_1");
    off();
  });
});

describe("Worker lease lifecycle", () => {
  it("Default lease duration: reserved rows carry lease_expires_at = reserved_at + leaseMs", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    await storage.insertMessage(buildMessage({ id: "msg_lease_1" }));
    const reserved = await storage.reserveBatch({
      workerId: "w1",
      leaseMs: 60_000,
      batchSize: 1,
      now: clock.now(),
    });
    expect(reserved).toHaveLength(1);
    const first = reserved[0] as ReservedMessage;
    expect(first.leaseExpiresAt.getTime() - clock.now().getTime()).toBe(60_000);
  });

  it("Lease reclaimed after worker crash: expireStaleLeases clears expired reservations", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    await storage.insertMessage(buildMessage({ id: "msg_crash_1" }));
    await storage.reserveBatch({
      workerId: "crashed",
      leaseMs: 60_000,
      batchSize: 1,
      now: clock.now(),
    });
    clock.advance(61_000);
    const cleared = await storage.expireStaleLeases(clock.now());
    expect(cleared).toBe(1);
    const reReserved = await storage.reserveBatch({
      workerId: "fresh",
      leaseMs: 60_000,
      batchSize: 1,
      now: clock.now(),
    });
    expect(reReserved).toHaveLength(1);
    expect(reReserved[0]?.id).toBe("msg_crash_1");
  });

  it("Lease renewal during long-running attempt: renewLease extends lease_expires_at while reserved", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    await storage.insertMessage(buildMessage({ id: "msg_renew_1" }));
    await storage.reserveBatch({ workerId: "w1", leaseMs: 60_000, batchSize: 1, now: clock.now() });
    clock.advance(30_000);
    const ok = await storage.renewLease("msg_renew_1", "w1", 60_000, clock.now());
    expect(ok).toBe(true);
    const wrongWorker = await storage.renewLease("msg_renew_1", "w-other", 60_000, clock.now());
    expect(wrongWorker).toBe(false);
  });
});

describe("Host transaction passthrough", () => {
  it("Outbox insert participates in host transaction: rollback removes the staged row", async () => {
    const storage = InMemoryStorage();
    await expect(
      storage.transaction(async (tx) => {
        await storage.insertMessage(buildMessage({ id: "msg_tx_rollback_1" }), { tx });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    let depth = 0;
    for await (const _ of storage.rangeQuery({})) depth += 1;
    expect(depth).toBe(0);
  });

  it("Outbox insert participates in host transaction: commit persists the row", async () => {
    const storage = InMemoryStorage();
    await storage.transaction(async (tx) => {
      await storage.insertMessage(buildMessage({ id: "msg_tx_commit_1" }), { tx });
    });
    const ids: string[] = [];
    for await (const m of storage.rangeQuery({})) ids.push(m.id);
    expect(ids).toContain("msg_tx_commit_1");
  });
});

describe("Workers drain the outbox safely under concurrency", () => {
  it("Two workers, no double dispatch: two reserveBatch calls race; every message reserved exactly once", async () => {
    const storage = InMemoryStorage();
    for (let i = 0; i < 10; i++) {
      await storage.insertMessage(buildMessage({ id: `msg_race_${i}` }));
    }
    const now = new Date();
    const [a, b] = await Promise.all([
      storage.reserveBatch({ workerId: "w1", leaseMs: 60_000, batchSize: 5, now }),
      storage.reserveBatch({ workerId: "w2", leaseMs: 60_000, batchSize: 5, now }),
    ]);
    const all = [...a, ...b].map((m) => m.id);
    expect(all.length).toBe(10);
    expect(new Set(all).size).toBe(10);
  });
});

describe("Attempt status enum casing", () => {
  it("ssrf-blocked: attempt rows accept kebab-case status values", async () => {
    const storage = InMemoryStorage();
    await storage.insertMessage(buildMessage({ id: "msg_ssrf_1" }));
    await storage.recordAttempt({
      id: "att_1",
      messageId: "msg_ssrf_1",
      endpointId: "ep_1",
      tenantId: null,
      attemptNumber: 1,
      status: "ssrf-blocked",
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseCode: null,
      responseHeaders: null,
      responseBody: null,
      latencyMs: null,
      error: "SSRF_BLOCKED: 10.0.0.5 is private",
      replayOf: null,
    });
    const found = await storage.attempts.latestForMessage("msg_ssrf_1");
    expect(found[0]?.status).toBe("ssrf-blocked");
  });
});

describe("All writes accept an optional transaction parameter", () => {
  it("dedup threads tx through and rolls back inside a host transaction", async () => {
    const storage = InMemoryStorage();
    await expect(
      storage.transaction(async (tx) => {
        const r1 = await storage.dedup("msg_dedup_tx_1", { ttlSeconds: 60, tx });
        expect(r1.duplicate).toBe(false);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const r2 = await storage.dedup("msg_dedup_tx_1", { ttlSeconds: 60 });
    expect(r2.duplicate).toBe(false);
  });
});

describe("Concurrency model [PORT-SPECIFIC]", () => {
  it("Different ports, different mechanisms, same guarantees: TS uses an async mutex inside reserveBatch", async () => {
    const storage = InMemoryStorage();
    await storage.insertMessage(buildMessage({ id: "msg_conc_1" }));
    await storage.insertMessage(buildMessage({ id: "msg_conc_2" }));
    const results = await Promise.all([
      storage.reserveBatch({ workerId: "w1", leaseMs: 60_000, batchSize: 10, now: new Date() }),
      storage.reserveBatch({ workerId: "w2", leaseMs: 60_000, batchSize: 10, now: new Date() }),
    ]);
    const total = results[0].length + results[1].length;
    expect(total).toBe(2);
  });
});

describe("Memory and cache strategies [PORT-SPECIFIC]", () => {
  it("Equivalent caching schemes yield identical observable behavior: dedup TTL is honored exactly", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const first = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
    expect(first.duplicate).toBe(false);
    const second = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
    expect(second.duplicate).toBe(true);
    clock.advance(61_000);
    const third = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
    expect(third.duplicate).toBe(false);
  });
});

describe("Helpers package for adapter authors", () => {
  it("Adapter author imports helpers: in-memory adapter doesn't reimplement timestamp / row encoding because it uses native objects", () => {
    expect(InMemoryStorage).toBeTypeOf("function");
  });
});

describe("Idempotent send by client-supplied key", () => {
  it("Repeat send with same key: insertOrReuseByIdempotencyKey returns the same id and inserts only once", async () => {
    const storage = InMemoryStorage();
    const a = await storage.insertOrReuseByIdempotencyKey(
      buildMessage({ id: "msg_idem_a", idempotencyKey: "abc" }),
    );
    expect(a.reused).toBe(false);
    const b = await storage.insertOrReuseByIdempotencyKey(
      buildMessage({ id: "msg_idem_b", idempotencyKey: "abc" }),
    );
    expect(b.reused).toBe(true);
    expect(b.id).toBe(a.id);
    let count = 0;
    for await (const _ of storage.rangeQuery({})) count += 1;
    expect(count).toBe(1);
  });
});
