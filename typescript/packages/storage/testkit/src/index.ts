import type { Clock, EndpointRecord, NewMessage, ReservedMessage, Storage } from "@postel/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A clock the battery can wind forward deterministically. SQL adapters take the
// same `{ clock }` and write timestamps explicitly, so lease / TTL math is
// identical to the in-memory reference regardless of backend.
export interface ConformanceClock extends Clock {
  advance(ms: number): void;
}

export function makeFakeClock(initial = new Date("2026-05-26T10:00:00.000Z")): ConformanceClock {
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

export interface StorageTestContext {
  readonly storage: Storage;
  readonly clock: ConformanceClock;
}

// Spin up a throwaway MySQL 8 for the testcontainers-gated MySQL tiers shared by
// every MySQL-targeting adapter (native + ORM dialects). Dynamically imported so
// non-MySQL test runs never load `@testcontainers/mysql` (Docker only). The
// returned `uri` is a `mysql://` connection string each adapter builds its own
// client from.
export async function startMysqlContainer(
  image = "mysql:8.0",
): Promise<{ uri: string; stop: () => Promise<void> }> {
  // Prefer a shared MySQL provided by the CI job (a GitHub Actions service
  // container) when POSTEL_MYSQL_URL is set. Spinning up a per-tier
  // testcontainer for all five adapters on a constrained runner is flaky (the
  // container lifecycle alone blows the hook budget); one healthchecked service
  // shared across the serially-run tiers is reliable. Set the server default to
  // READ COMMITTED (recommended for SKIP LOCKED queues) and hand back the URL
  // without owning the lifecycle.
  const { POSTEL_MYSQL_URL: sharedUrl } = process.env;
  if (sharedUrl) {
    const { createPool } = await import("mysql2/promise");
    const pool = createPool(sharedUrl);
    try {
      await pool.query("SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED");
    } finally {
      await pool.end();
    }
    return { uri: sharedUrl, stop: async () => {} };
  }
  // Local fallback: own a throwaway container, defaulting it to READ COMMITTED.
  const { MySqlContainer } = await import("@testcontainers/mysql");
  const container = await new MySqlContainer(image)
    .withCommand(["--transaction-isolation=READ-COMMITTED"])
    .start();
  return {
    uri: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

export interface StorageTestCapabilities {
  // Run the LISTEN/NOTIFY push scenario (adapters that advertise notify).
  readonly notify: boolean;
  // An uncommitted write in an open host transaction is invisible to a
  // concurrent reserveBatch (true for in-memory and multi-connection Postgres;
  // false for single-connection pglite / better-sqlite3).
  readonly txIsolation: boolean;
}

export interface StorageTestFactory {
  readonly name: string;
  readonly capabilities: StorageTestCapabilities;
  // The version reserveBatch's backend reports from schemaVersion(). Optional;
  // when omitted the battery only asserts a positive integer.
  readonly expectedSchemaVersion?: number;
  // Timeout (ms) for the setup/teardown hooks. Testcontainers tiers need a
  // generous value — spinning up a real DB (image pull + init + healthcheck)
  // routinely exceeds vitest's 10s default, especially for MySQL.
  readonly setupTimeoutMs?: number;
  // Once, before the suite: create pools / run migrations.
  setup?(): Promise<void>;
  // Per test: a fresh clock and a clean dataset.
  create(): Promise<StorageTestContext>;
  // Once, after the suite: close pools / drop the backend.
  teardown?(): Promise<void>;
}

function buildMessage(clock: ConformanceClock, overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: overrides.id ?? "msg_test_1",
    tenantId: overrides.tenantId ?? null,
    type: overrides.type ?? "order.created",
    data: overrides.data ?? { id: "ord_1" },
    channels: overrides.channels ?? null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    version: overrides.version ?? null,
    ttlSeconds: overrides.ttlSeconds ?? null,
    createdAt: overrides.createdAt ?? clock.now(),
    expiresAt: overrides.expiresAt ?? null,
    ...(overrides.replayOf !== undefined ? { replayOf: overrides.replayOf } : {}),
  };
}

function buildEndpoint(
  overrides: Partial<EndpointRecord> = {},
): Omit<EndpointRecord, "createdAt" | "updatedAt"> {
  return {
    id: overrides.id ?? "ep_1",
    tenantId: overrides.tenantId ?? null,
    url: overrides.url ?? "https://example.com/hook",
    state: overrides.state ?? "active",
    types: overrides.types ?? null,
    channels: overrides.channels ?? null,
    retryPolicy: overrides.retryPolicy ?? null,
    headers: overrides.headers ?? null,
    signing: overrides.signing ?? null,
    metadata: overrides.metadata ?? null,
    allowHttp: overrides.allowHttp ?? false,
    maxInflight: overrides.maxInflight ?? null,
    http: overrides.http ?? null,
    circuitBreaker: overrides.circuitBreaker ?? null,
    autoDisable: overrides.autoDisable ?? null,
    filter: overrides.filter ?? null,
    transform: overrides.transform ?? null,
  };
}

// Runs the full storage-layer behavior battery against the adapter the factory
// builds. Every adapter (and the in-memory reference) calls this from a
// `*.test.ts`; backend-incapable scenarios are skipped via factory.capabilities.
export function runStorageTests(factory: StorageTestFactory): void {
  describe(`Storage conformance: ${factory.name}`, () => {
    if (factory.setup) beforeAll(() => factory.setup?.(), factory.setupTimeoutMs);
    if (factory.teardown) afterAll(() => factory.teardown?.(), factory.setupTimeoutMs);

    const itNotify = factory.capabilities.notify ? it : it.skip;
    const itTxIsolation = factory.capabilities.txIsolation ? it : it.skip;

    describe("BYO storage interface", () => {
      it("exposes the full operation set", async () => {
        const { storage } = await factory.create();
        expect(typeof storage.insertMessage).toBe("function");
        expect(typeof storage.insertOrReuseByIdempotencyKey).toBe("function");
        expect(typeof storage.reserveBatch).toBe("function");
        expect(typeof storage.recordAttempt).toBe("function");
        expect(typeof storage.renewLease).toBe("function");
        expect(typeof storage.releaseLease).toBe("function");
        expect(typeof storage.expireStaleLeases).toBe("function");
        expect(typeof storage.loadEndpointsForMessage).toBe("function");
        expect(typeof storage.getMessage).toBe("function");
        expect(typeof storage.listMessages).toBe("function");
        expect(typeof storage.rangeQuery).toBe("function");
        expect(typeof storage.reconcile).toBe("function");
        expect(typeof storage.dedup).toBe("function");
        expect(typeof storage.transaction).toBe("function");
        expect(typeof storage.endpoints.create).toBe("function");
        expect(typeof storage.secrets.insert).toBe("function");
        expect(typeof storage.tenants.upsert).toBe("function");
        expect(typeof storage.tenants.list).toBe("function");
      });

      it("Introspection reads return a message and its attempts: getMessage / listMessages / attempts", async () => {
        const { storage, clock } = await factory.create();
        await storage.insertMessage(
          buildMessage(clock, { id: "msg_intro_1", tenantId: "t_intro", type: "order.created" }),
        );
        await storage.recordAttempt({
          id: "att_intro_1",
          messageId: "msg_intro_1",
          endpointId: "ep_1",
          tenantId: "t_intro",
          attemptNumber: 1,
          status: "success",
          scheduledFor: null,
          startedAt: clock.now(),
          completedAt: clock.now(),
          responseCode: 200,
          responseHeaders: null,
          responseBody: null,
          latencyMs: 12,
          error: null,
          replayOf: null,
        });

        const message = await storage.getMessage("msg_intro_1");
        expect(message?.id).toBe("msg_intro_1");
        expect(message?.status).toBe("pending");
        expect(message?.data).toEqual({ id: "ord_1" });

        expect(await storage.getMessage("msg_missing")).toBeUndefined();

        const attempts = await storage.attempts.latestForMessage("msg_intro_1");
        expect(attempts.map((a) => a.status)).toEqual(["success"]);
        expect(attempts[0]?.responseCode).toBe(200);
        expect(attempts[0]?.latencyMs).toBe(12);

        const listed = await storage.listMessages({ tenantId: "t_intro" });
        expect(listed.map((m) => m.id)).toContain("msg_intro_1");
        const filtered = await storage.listMessages({ tenantId: "t_intro", types: ["nope"] });
        expect(filtered.map((m) => m.id)).not.toContain("msg_intro_1");
        // Generous timeout: real-DB tiers (pglite WASM, MySQL containers) run
        // this multi-round-trip case well past vitest's 5s default under CI load.
      }, 30_000);

      it("Tenant reads return a record and a paginated page: tenants.get / tenants.list", async () => {
        const { storage, clock } = await factory.create();
        await storage.tenants.upsert("t_page_1", null);
        clock.advance(1000);
        await storage.tenants.upsert("t_page_2", null);
        clock.advance(1000);
        await storage.tenants.upsert("t_page_3", null);

        const got = await storage.tenants.get("t_page_2");
        expect(got?.id).toBe("t_page_2");
        expect(await storage.tenants.get("t_tenant_missing")).toBeUndefined();

        const page1 = await storage.tenants.list({ limit: 2 });
        expect(page1.items.map((t) => t.id)).toEqual(["t_page_3", "t_page_2"]);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await storage.tenants.list({ limit: 2, cursor: page1.nextCursor as string });
        expect(page2.items.map((t) => t.id)).toEqual(["t_page_1"]);
        expect(page2.nextCursor).toBeNull();
        // Generous timeout: real-DB tiers (pglite WASM, MySQL containers) run
        // this multi-round-trip case well past vitest's 5s default under CI load.
      }, 30_000);

      it("Worker reservation can't be expressed as CRUD: reserveBatch combines lock + lease + return atomically", async () => {
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_a" }));
        await storage.insertMessage(buildMessage(clock, { id: "msg_b" }));
        const reserved = await storage.reserveBatch({
          workerId: "w1",
          leaseMs: 60_000,
          batchSize: 5,
          now: clock.now(),
        });
        expect(reserved.map((r) => r.id).sort()).toEqual(["msg_a", "msg_b"]);
        expect(reserved.every((r) => r.leaseExpiresAt instanceof Date)).toBe(true);
        // Generous timeout: real-DB tiers (pglite WASM, MySQL containers) can run
        // this well past vitest's 5s default under CI load.
      }, 30_000);
    });

    describe("Schema is a fixed set of canonical tables", () => {
      it("Schema version handshake: schemaVersion returns the library-compatible value", async () => {
        const { storage } = await factory.create();
        const v = await storage.schemaVersion();
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(1);
        if (factory.expectedSchemaVersion !== undefined) {
          expect(v).toBe(factory.expectedSchemaVersion);
        }
      });
    });

    describe("Optional storage capabilities", () => {
      it("advertises a capabilities object", async () => {
        const { storage } = await factory.create();
        expect(typeof storage.capabilities.notify).toBe("boolean");
        expect(typeof storage.capabilities.subscribe).toBe("boolean");
        expect(typeof storage.capabilities.transactional).toBe("boolean");
        expect(typeof storage.capabilities.streaming).toBe("boolean");
      });

      itNotify(
        "Native push when notify is available: insertMessage fires a post-commit notify on postel_messages_new",
        async () => {
          const { storage, clock } = await factory.create();
          if (!storage.subscribe)
            throw new Error("expected subscribe to exist when notify is advertised");
          let received: string | undefined;
          const off = storage.subscribe("postel_messages_new", (p) => {
            received = p;
          });
          await storage.insertMessage(buildMessage(clock, { id: "msg_notify_1" }));
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          expect(received).toContain("msg_notify_1");
          off();
        },
      );
    });

    describe("Worker lease lifecycle", () => {
      it("Default lease duration: reserved rows carry lease_expires_at = reserved_at + leaseMs", async () => {
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_lease_1" }));
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
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_crash_1" }));
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
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_renew_1" }));
        await storage.reserveBatch({
          workerId: "w1",
          leaseMs: 60_000,
          batchSize: 1,
          now: clock.now(),
        });
        clock.advance(30_000);
        const ok = await storage.renewLease("msg_renew_1", "w1", 60_000, clock.now());
        expect(ok).toBe(true);
        const wrongWorker = await storage.renewLease("msg_renew_1", "w-other", 60_000, clock.now());
        expect(wrongWorker).toBe(false);
      });
    });

    describe("Host transaction passthrough", () => {
      it("Outbox insert participates in host transaction: rollback removes the staged row", async () => {
        const { storage, clock } = await factory.create();
        await expect(
          storage.transaction(async (tx) => {
            await storage.insertMessage(buildMessage(clock, { id: "msg_tx_rollback_1" }), { tx });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        let depth = 0;
        for await (const _ of storage.rangeQuery({})) depth += 1;
        expect(depth).toBe(0);
      });

      it("Outbox insert participates in host transaction: commit persists the row", async () => {
        const { storage, clock } = await factory.create();
        await storage.transaction(async (tx) => {
          await storage.insertMessage(buildMessage(clock, { id: "msg_tx_commit_1" }), { tx });
        });
        const ids: string[] = [];
        for await (const m of storage.rangeQuery({})) ids.push(m.id);
        expect(ids).toContain("msg_tx_commit_1");
      });

      it("Endpoint delete inside a rolled-back transaction leaves no phantom deleted transition", async () => {
        const { storage } = await factory.create();
        const ep = await storage.endpoints.create(buildEndpoint({ id: "ep_rollback" }));
        await expect(
          storage.transaction(async (tx) => {
            await storage.endpoints.delete(ep.id, { tx });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(await storage.endpoints.get(ep.id)).toBeDefined();
        const transitions = await storage.endpoints.listStateTransitions(ep.id);
        expect(transitions.some((t) => t.reason === "deleted")).toBe(false);
      });

      itTxIsolation(
        "Outbox insert is isolated: an uncommitted message is not reservable mid-transaction",
        async () => {
          const { storage, clock } = await factory.create();
          const now = clock.now();
          await expect(
            storage.transaction(async (tx) => {
              await storage.insertMessage(buildMessage(clock, { id: "msg_dirty_1" }), { tx });
              const reserved = await storage.reserveBatch({
                workerId: "w1",
                leaseMs: 60_000,
                batchSize: 10,
                now,
              });
              expect(reserved.map((m) => m.id)).not.toContain("msg_dirty_1");
              throw new Error("rollback");
            }),
          ).rejects.toThrow("rollback");
          const afterRollback = await storage.reserveBatch({
            workerId: "w1",
            leaseMs: 60_000,
            batchSize: 10,
            now,
          });
          expect(afterRollback.map((m) => m.id)).not.toContain("msg_dirty_1");
        },
      );

      itTxIsolation(
        "Introspection reads are isolated: getMessage / listMessages do not surface an uncommitted message",
        async () => {
          const { storage, clock } = await factory.create();
          await expect(
            storage.transaction(async (tx) => {
              await storage.insertMessage(
                buildMessage(clock, { id: "msg_intro_dirty", tenantId: "t_intro_dirty" }),
                { tx },
              );
              expect(await storage.getMessage("msg_intro_dirty")).toBeUndefined();
              const listed = await storage.listMessages({ tenantId: "t_intro_dirty" });
              expect(listed.map((m) => m.id)).not.toContain("msg_intro_dirty");
              throw new Error("rollback");
            }),
          ).rejects.toThrow("rollback");
          expect(await storage.getMessage("msg_intro_dirty")).toBeUndefined();
        },
        30_000,
      );

      it("Outbox insert becomes reservable once the host transaction commits", async () => {
        const { storage, clock } = await factory.create();
        await storage.transaction(async (tx) => {
          await storage.insertMessage(buildMessage(clock, { id: "msg_clean_1" }), { tx });
        });
        const reserved = await storage.reserveBatch({
          workerId: "w1",
          leaseMs: 60_000,
          batchSize: 10,
          now: clock.now(),
        });
        expect(reserved.map((m) => m.id)).toContain("msg_clean_1");
      });
    });

    describe("Workers drain the outbox safely under concurrency", () => {
      it("Two workers, no double dispatch: every message reserved exactly once", async () => {
        const { storage, clock } = await factory.create();
        for (let i = 0; i < 10; i++) {
          await storage.insertMessage(buildMessage(clock, { id: `msg_race_${i}` }));
        }
        const now = clock.now();
        const [a, b] = await Promise.all([
          storage.reserveBatch({ workerId: "w1", leaseMs: 60_000, batchSize: 5, now }),
          storage.reserveBatch({ workerId: "w2", leaseMs: 60_000, batchSize: 5, now }),
        ]);
        const all = [...a, ...b].map((m) => m.id);
        expect(all.length).toBe(10);
        expect(new Set(all).size).toBe(10);
      }, 30_000);
    });

    describe("Tenant-scoped row-level access in queries", () => {
      it("Tenant filter applied: reserveBatch and rangeQuery only return the tenant's rows", async () => {
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_t1", tenantId: "t_1" }));
        await storage.insertMessage(buildMessage(clock, { id: "msg_t2", tenantId: "t_2" }));
        const reserved = await storage.reserveBatch({
          workerId: "w1",
          leaseMs: 60_000,
          batchSize: 10,
          tenantId: "t_1",
          now: clock.now(),
        });
        expect(reserved.map((m) => m.id)).toEqual(["msg_t1"]);
        const ranged: string[] = [];
        for await (const m of storage.rangeQuery({ tenantId: "t_2" })) ranged.push(m.id);
        expect(ranged).toEqual(["msg_t2"]);
      });
    });

    describe("Attempt status enum casing", () => {
      it("ssrf-blocked: attempt rows accept kebab-case status values", async () => {
        const { storage, clock } = await factory.create();
        await storage.insertMessage(buildMessage(clock, { id: "msg_ssrf_1" }));
        await storage.recordAttempt({
          id: "att_1",
          messageId: "msg_ssrf_1",
          endpointId: "ep_1",
          tenantId: null,
          attemptNumber: 1,
          status: "ssrf-blocked",
          scheduledFor: null,
          startedAt: clock.now(),
          completedAt: clock.now(),
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
        const { storage } = await factory.create();
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

    describe("Memory and cache strategies", () => {
      it("dedup TTL is honored exactly", async () => {
        const { storage, clock } = await factory.create();
        const first = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
        expect(first.duplicate).toBe(false);
        const second = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
        expect(second.duplicate).toBe(true);
        clock.advance(61_000);
        const third = await storage.dedup("msg_ttl", { ttlSeconds: 60 });
        expect(third.duplicate).toBe(false);
      });
    });

    describe("Idempotent send by client-supplied key", () => {
      it("Repeat send with same key: insertOrReuseByIdempotencyKey returns the same id and inserts only once", async () => {
        const { storage, clock } = await factory.create();
        const a = await storage.insertOrReuseByIdempotencyKey(
          buildMessage(clock, { id: "msg_idem_a", idempotencyKey: "abc" }),
        );
        expect(a.reused).toBe(false);
        const b = await storage.insertOrReuseByIdempotencyKey(
          buildMessage(clock, { id: "msg_idem_b", idempotencyKey: "abc" }),
        );
        expect(b.reused).toBe(true);
        expect(b.id).toBe(a.id);
        let count = 0;
        for await (const _ of storage.rangeQuery({})) count += 1;
        expect(count).toBe(1);
      });
    });
  });
}
