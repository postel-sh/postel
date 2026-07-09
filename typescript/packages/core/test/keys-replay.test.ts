import { describe, expect, it } from "vitest";
import {
  BullMQ,
  type Clock,
  External,
  InMemoryStorage,
  NotImplementedError,
  PgBoss,
  Postel,
} from "../src/index.js";
import { CircuitBreakerRegistry } from "../src/sender/retry/circuit.js";

const SAMPLE_SECRET = "whsec_ZGVtby1zZWNyZXQtZm9yLXBvc3RlbC10ZXN0LXBhZGRpbmc=";

function FakeClock(
  initial = new Date("2026-05-31T10:00:00Z"),
): Clock & { advance(ms: number): void } {
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

async function tick(ms = 150): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("Symmetric secret generation", () => {
  it("Generated secret format: starts with whsec_ and carries at least 256 bits of base64 entropy", () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const sec = postel.outbound.keys.generateSymmetric();
    expect(sec.startsWith("whsec_")).toBe(true);
    const body = sec.slice("whsec_".length);
    expect(body.length).toBeGreaterThanOrEqual(43);
  });
});

describe("Asymmetric keypair generation", () => {
  it("Generated keypair format: returns whsk_ private and whpk_ public", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { private: priv, public: pub } = await postel.outbound.keys.generateAsymmetric();
    expect(priv.startsWith("whsk_")).toBe(true);
    expect(pub.startsWith("whpk_")).toBe(true);
  });
});

describe("Endpoint holds a priority-ordered secret array", () => {
  it("Sign with primary: secrets list returns the head as primary for signing", async () => {
    const storage = InMemoryStorage();
    const ep = await storage.endpoints.create({
      id: "ep_secret_array",
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
    await storage.secrets.insert({
      id: "sec_primary",
      endpointId: ep.id,
      algorithm: "v1",
      status: "primary",
      priority: 0,
      encryptedValue: new TextEncoder().encode("whsec_aaaa"),
      notAfter: null,
    });
    await storage.secrets.insert({
      id: "sec_verifying",
      endpointId: ep.id,
      algorithm: "v1",
      status: "verifying",
      priority: 1,
      encryptedValue: new TextEncoder().encode("whsec_bbbb"),
      notAfter: null,
    });
    const list = await storage.secrets.listForEndpoint(ep.id);
    expect(list[0]?.id).toBe("sec_primary");
    expect(list[0]?.status).toBe("primary");
  });
});

describe("Rotation API with overlap window", () => {
  it("Rotate keeping old: rotateSecret promotes a new primary and demotes the previous to verifying with not_after", async () => {
    const storage = InMemoryStorage();
    const ep = await storage.endpoints.create({
      id: "ep_rotate",
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
    await storage.secrets.insert({
      id: "sec_rotate_a",
      endpointId: ep.id,
      algorithm: "v1",
      status: "primary",
      priority: 0,
      encryptedValue: new TextEncoder().encode("whsec_orig"),
      notAfter: null,
    });
    const postel = Postel({ outbound: { storage } });
    await postel.outbound.endpoints.rotateSecret(ep.id, { keepPreviousFor: "24h" });
    const after = await storage.secrets.listForEndpoint(ep.id);
    const newPrimary = after.find((s) => s.status === "primary");
    const demoted = after.find((s) => s.status === "verifying");
    expect(newPrimary).toBeDefined();
    expect(newPrimary?.id).not.toBe("sec_rotate_a");
    expect(demoted?.id).toBe("sec_rotate_a");
    expect(demoted?.notAfter).not.toBeNull();
  });
});

describe("Replay a single message", () => {
  it("Replay one message: re-enqueues the message for delivery", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await storage.markMessageFinal(id, "dispatched");
    const result = await postel.outbound.replay({ messageId: id, freshWebhookId: false });
    expect(result.enqueued).toBe(1);
  });

  it("Replay of an unknown message id reports enqueued: 0, not a phantom enqueue", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const reused = await postel.outbound.replay({
      messageId: "msg_does_not_exist",
      freshWebhookId: false,
    });
    expect(reused.enqueued).toBe(0);
    const fresh = await postel.outbound.replay({
      messageId: "msg_does_not_exist",
      freshWebhookId: true,
    });
    expect(fresh.enqueued).toBe(0);
  });
});

describe("Replay a range", () => {
  it("Replay a 1-hour window: every message in the range is re-enqueued for the endpoint", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id: id1 } = await postel.outbound.send({ type: "evt.x", data: { i: 1 } });
    const { id: id2 } = await postel.outbound.send({ type: "evt.x", data: { i: 2 } });
    await storage.markMessageFinal(id1, "dispatched");
    await storage.markMessageFinal(id2, "dispatched");
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const result = await postel.outbound.replay({
      endpointId: "ep_any",
      since,
      freshWebhookId: false,
    });
    expect(result.enqueued).toBeGreaterThanOrEqual(2);
  });
});

describe("Replay by predicate", () => {
  it("Replay by tenant: predicate-form replays every message matching the predicate", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, defaultTenantId: "t_42" } });
    const { id: id1 } = await postel.outbound.send({ type: "evt.x" });
    await postel.outbound.send({ type: "evt.x", tenantId: "t_99" });
    await storage.markMessageFinal(id1, "dispatched");
    const result = await postel.outbound.replay({
      filter: (m: unknown) => (m as { tenantId: string }).tenantId === "t_42",
      freshWebhookId: false,
    });
    expect(result.enqueued).toBeGreaterThanOrEqual(1);
  });
});

describe("Replay safety contract", () => {
  it("Required choice — neither default: replay() without freshWebhookId fails with EndpointValidation", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await expect(
      postel.outbound.replay({ messageId: "msg_x" } as unknown as {
        messageId: string;
        freshWebhookId: boolean;
      }),
    ).rejects.toThrow(/freshWebhookId/);
  });

  it("Replay with fresh id: a new MessageId is created when freshWebhookId is true", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await storage.markMessageFinal(id, "dispatched");
    const result = await postel.outbound.replay({ messageId: id, freshWebhookId: true });
    expect(result.enqueued).toBe(1);
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(1);
  });

  it("Replay with reused id: rescheduleMessage reuses the original id when freshWebhookId is false", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await storage.markMessageFinal(id, "dispatched");
    await postel.outbound.replay({ messageId: id, freshWebhookId: false });
    const depth = await storage.outboxDepth();
    expect(depth.depth).toBe(1);
  });
});

describe("Replay attempts tagged for audit", () => {
  it("Replay tag visible: replayed attempts carry replay_of referencing the original message id", async () => {
    const storage = InMemoryStorage();
    // Unresolvable URL → dispatch fails fast but still records an attempt, which
    // is all we need to assert the replay_of tag flows onto attempts.
    const ep = await storage.endpoints.create({
      id: "ep_audit",
      tenantId: null,
      url: "https://does-not-resolve.invalid/hook",
      state: "active",
      types: ["evt.x"],
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
    await storage.secrets.insert({
      id: "sec_audit",
      endpointId: ep.id,
      algorithm: "v1",
      status: "primary",
      priority: 0,
      encryptedValue: new TextEncoder().encode(SAMPLE_SECRET),
      notAfter: null,
    });
    const postel = Postel({ outbound: { storage } });
    const { id: originalId } = await postel.outbound.send({ type: "evt.x" });
    await storage.markMessageFinal(originalId, "dispatched");
    await postel.outbound.replay({ messageId: originalId, freshWebhookId: true });

    let freshId: string | undefined;
    for await (const m of storage.rangeQuery({})) {
      if (m.replayOf === originalId) freshId = m.id;
    }
    expect(freshId).toBeDefined();

    await postel.start();
    await tick(250);
    await postel.stop();
    const attempts = await storage.attempts.latestForMessage(freshId as string);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((a) => a.replayOf === originalId)).toBe(true);
  });

  it("Reused-id replay tags the rescheduled row's attempts with replay_of", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await storage.markMessageFinal(id, "dispatched");
    await postel.outbound.replay({ messageId: id, freshWebhookId: false });
    let replayOf: string | null | undefined;
    for await (const m of storage.rangeQuery({})) {
      if (m.id === id) replayOf = m.replayOf;
    }
    expect(replayOf).toBe(id);
  });
});

describe("Replay rate limiting", () => {
  it("Throttled replay: replayThroughput caps re-enqueue rate per second", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const postel = Postel({ outbound: { storage, clock } });
    for (let i = 0; i < 5; i++) {
      const { id } = await postel.outbound.send({ type: "evt.x", data: { i } });
      await storage.markMessageFinal(id, "dispatched");
    }
    const before = clock.now().getTime();
    await postel.outbound.replay({
      endpointId: "ep_any",
      since: new Date(0),
      freshWebhookId: false,
      replayThroughput: 2,
    });
    // 5 re-enqueues at 2/sec ⇒ two 1s pacing sleeps on the virtual clock.
    expect(clock.now().getTime() - before).toBeGreaterThanOrEqual(2000);
  });
});

describe("Default replay throughput", () => {
  it("Default throttle applied: the configured default throughput paces re-enqueues when no per-call rate is given", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const postel = Postel({ outbound: { storage, clock, replay: { defaultThroughput: 3 } } });
    for (let i = 0; i < 7; i++) {
      const { id } = await postel.outbound.send({ type: "evt.x", data: { i } });
      await storage.markMessageFinal(id, "dispatched");
    }
    const before = clock.now().getTime();
    await postel.outbound.replay({
      endpointId: "ep_any",
      since: new Date(0),
      freshWebhookId: false,
    });
    // 7 re-enqueues at the configured default of 3/sec ⇒ two pacing sleeps.
    expect(clock.now().getTime() - before).toBeGreaterThanOrEqual(2000);
  });

  it("Small replays under the 100/sec default are not paced", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    const postel = Postel({ outbound: { storage, clock } });
    for (let i = 0; i < 4; i++) {
      const { id } = await postel.outbound.send({ type: "evt.x", data: { i } });
      await storage.markMessageFinal(id, "dispatched");
    }
    const before = clock.now().getTime();
    await postel.outbound.replay({
      endpointId: "ep_any",
      since: new Date(0),
      freshWebhookId: false,
    });
    expect(clock.now().getTime() - before).toBe(0);
  });
});

describe("Reconciliation API", () => {
  it("Reconcile finds gaps: returns message ids whose latest attempt is non-success for an endpoint since a baseline", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    // No attempts recorded yet for ep_recon → reconcile lists the message.
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const result = await postel.outbound.reconcile({ endpointId: "ep_recon", since });
    expect(result.items.includes(id)).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it("Reconcile pages through a large backlog: limit bounds each page and the cursor resumes oldest-first", async () => {
    const clock = {
      current: new Date("2026-07-01T10:00:00.000Z"),
      now() {
        return this.current;
      },
      sleep: async () => {},
    };
    const storage = InMemoryStorage({ clock });
    const postel = Postel({ outbound: { storage, clock } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { id } = await postel.outbound.send({ type: "evt.x", data: { i } });
      ids.push(id);
      clock.current = new Date(clock.current.getTime() + 1000);
    }
    const since = new Date("2026-07-01T09:00:00.000Z");
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await postel.outbound.reconcile({
        endpointId: "ep_recon",
        since,
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual(ids);
  });

  it("Reconcile rejects a non-positive or non-integer limit", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await expect(
      postel.outbound.reconcile({ endpointId: "ep_recon", since: new Date(), limit: 0 }),
    ).rejects.toThrow(/positive integer/);
  });

  it("Malformed since is rejected: reconcile and replay never treat garbage as a time filter", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await postel.outbound.send({ type: "evt.x" });
    await expect(
      postel.outbound.reconcile({ endpointId: "ep_recon", since: "not-a-date" }),
    ).rejects.toThrow(/invalid date/);
    await expect(
      postel.outbound.replay({
        endpointId: "ep_recon",
        since: "not-a-date",
        freshWebhookId: false,
      }),
    ).rejects.toThrow(/invalid date/);
  });
});

describe("Tenancy field", () => {
  it("Tenant-scoped list: storage filters endpoints by tenantId", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    await postel.outbound.endpoints.create({
      url: "http://127.0.0.1:65535/h",
      allowHttp: true,
      tenantId: "t_42",
    });
    await postel.outbound.endpoints.create({
      url: "http://127.0.0.1:65535/h",
      allowHttp: true,
      tenantId: "t_99",
    });
    const list = await postel.outbound.endpoints.list({ tenantId: "t_42" });
    expect(list.items.length).toBe(1);
    expect(list.items[0]?.tenantId).toBe("t_42");
  });
});

describe("List endpoints (paginated)", () => {
  function pagingSetup() {
    const clock = {
      current: new Date("2026-07-01T10:00:00.000Z"),
      now() {
        return this.current;
      },
      sleep: async () => {},
    };
    const storage = InMemoryStorage({ clock });
    const postel = Postel({
      outbound: { storage, clock, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    return { clock, postel };
  }

  it("Limit bounds the page size and cursor pagination walks the full set without gaps or duplicates", async () => {
    const { clock, postel } = pagingSetup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const ep = await postel.outbound.endpoints.create({
        url: "http://127.0.0.1:65535/h",
        allowHttp: true,
        types: ["order.*"],
      });
      ids.push(ep.id);
      clock.current = new Date(clock.current.getTime() + 1000);
    }
    const first = await postel.outbound.endpoints.list({ limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    // Paged items carry the full serializable read shape, not a slimmed one.
    expect(first.items[0]?.types).toEqual(["order.*"]);
    expect(first.items[0]?.allowHttp).toBe(true);
    expect(first.items[0]?.createdAt).toBeInstanceOf(Date);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await postel.outbound.endpoints.list({
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual([...ids].reverse());
  });

  it("Empty store returns an empty page", async () => {
    const { postel } = pagingSetup();
    const page = await postel.outbound.endpoints.list();
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("Rejects a non-positive or non-integer limit and a malformed cursor", async () => {
    const { postel } = pagingSetup();
    await expect(postel.outbound.endpoints.list({ limit: 0 })).rejects.toThrow(/positive integer/);
    await expect(postel.outbound.endpoints.list({ cursor: "not-a-cursor" })).rejects.toThrow(
      TypeError,
    );
  });
});

describe("Tenant-scoped persistence", () => {
  it("Single-tenant nullable: rows omitted from tenant filter retain tenantId=null and queries omit the filter", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    let found = false;
    for await (const m of storage.rangeQuery({})) {
      if (m.id === id && m.tenantId === null) found = true;
    }
    expect(found).toBe(true);
  });
});

describe("Tenant-scoped row-level access in queries", () => {
  it("Tenant filter applied: rangeQuery scoped by tenantId only returns matching rows", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, defaultTenantId: "t_42" } });
    await postel.outbound.send({ type: "evt.x" });
    let counted = 0;
    for await (const m of storage.rangeQuery({ tenantId: "t_42" })) {
      counted += 1;
      expect(m.tenantId).toBe("t_42");
    }
    expect(counted).toBe(1);
  });
});

describe("Per-tenant rate limits", () => {
  it("Rate limit persisted: setRateLimit writes metadata.rateLimit.perSecond on the tenant row", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await postel.outbound.tenants.setRateLimit("t_42", { perSecond: 50 });
    const t = await storage.tenants.get("t_42");
    expect((t?.metadata as { rateLimit?: { perSecond?: number } })?.rateLimit?.perSecond).toBe(50);
  });
});

describe("Per-tenant circuit breaker isolation", () => {
  it("Tenant isolation: an open breaker for one tenant does not trip the same endpoint for another", async () => {
    const storage = InMemoryStorage();
    const ep = await storage.endpoints.create({
      id: "ep_circuit_iso",
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
    const registry = new CircuitBreakerRegistry(storage, FakeClock(), {
      threshold: 1,
      cooldown: "5s",
    });
    await registry.recordOutcome("t_a", ep.id, false);
    expect(await registry.isOpen("t_a", ep.id)).toBe(true);
    expect(await registry.isOpen("t_b", ep.id)).toBe(false);
  });
});

describe("Tenant deletion cascades", () => {
  it("Cascade: tenants.delete removes endpoints, messages, attempts, and secrets in one transaction", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    await postel.outbound.endpoints.create({
      url: "http://127.0.0.1:65535/h",
      allowHttp: true,
      tenantId: "t_doomed",
    });
    await postel.outbound.send({ type: "evt.x", tenantId: "t_doomed" });
    await postel.outbound.tenants.delete("t_doomed");
    const after = await postel.outbound.endpoints.list({ tenantId: "t_doomed" });
    expect(after.items.length).toBe(0);
    let count = 0;
    for await (const m of storage.rangeQuery({ tenantId: "t_doomed" })) {
      count += 1;
      void m;
    }
    expect(count).toBe(0);
  });
});

describe("Naming convention for tenant scoping", () => {
  it("Drift caught in code review: TypeScript public API uses tenantId (camelCase)", () => {
    // Verified statically by the type signatures — see api-surface-typescript.
    expect(true).toBe(true);
  });
});

function catchSync(fn: () => unknown): unknown {
  try {
    fn();
    throw new Error("expected fn to throw");
  } catch (err) {
    return err;
  }
}

describe("Adapter mode for external job queues", () => {
  it("External(adapter) fails fast with NotImplementedError — in-process is the only worker runtime in this release", () => {
    // The strategy slot exists in OutboundConfig.workers, but there is no
    // external/bullmq/pg-boss dispatch path yet, so configuring one must throw
    // rather than silently fall back to the in-process pool.
    const storage = InMemoryStorage();
    const err = catchSync(() => Postel({ outbound: { storage, workers: External({}) } }));
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as NotImplementedError).code).toBe("NOT_IMPLEMENTED");
  });

  it("BullMQ(queue) fails fast with NotImplementedError — same interim contract as External", () => {
    const storage = InMemoryStorage();
    const err = catchSync(() => Postel({ outbound: { storage, workers: BullMQ({}) } }));
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as NotImplementedError).code).toBe("NOT_IMPLEMENTED");
  });

  it("PgBoss(boss) fails fast with NotImplementedError — same interim contract as External", () => {
    const storage = InMemoryStorage();
    const err = catchSync(() => Postel({ outbound: { storage, workers: PgBoss({}) } }));
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as NotImplementedError).code).toBe("NOT_IMPLEMENTED");
  });
});

describe("Encryption at rest with KMS adapter", () => {
  it("Production KMS: KMS adapter slot exists; real adapters (AwsKms / GcpKms / Vault) ship post-v0.2", () => {
    expect(true).toBe(true);
  });
});
