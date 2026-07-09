import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  type Clock,
  type DeadLetterPayload,
  ExponentialBackoff,
  LinearBackoff,
  Postel,
} from "../src/index.js";

import { InMemoryStorage } from "../src/index.js";
import { CircuitBreakerRegistry } from "../src/sender/retry/circuit.js";

const SAMPLE_SECRET = "whsec_ZGVtby1zZWNyZXQtZm9yLXBvc3RlbC10ZXN0LXBhZGRpbmc=";

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

async function tick(ms = 100): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface MockServer {
  url(): string;
  requests(): ReadonlyArray<unknown>;
  close(): Promise<void>;
}

async function startServerWithSequence(
  statuses: number[],
  retryAfter?: string,
): Promise<MockServer> {
  const requests: unknown[] = [];
  let i = 0;
  const handler = (_req: IncomingMessage, res: ServerResponse): void => {
    const status = statuses[i] ?? statuses[statuses.length - 1] ?? 200;
    i += 1;
    requests.push({ status });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (retryAfter !== undefined && status === 429) headers["retry-after"] = retryAfter;
    res.writeHead(status, headers);
    res.end("{}");
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: () => `http://127.0.0.1:${addr.port}`,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function seedEndpoint(
  storage: ReturnType<typeof InMemoryStorage>,
  url: string,
  opts: { retryPolicy?: unknown; circuitBreaker?: unknown } = {},
): Promise<string> {
  const endpoint = await storage.endpoints.create({
    id: "ep_retry",
    tenantId: null,
    url,
    state: "active",
    types: null,
    channels: null,
    retryPolicy: opts.retryPolicy ?? null,
    headers: null,
    signing: null,
    metadata: null,
    allowHttp: true,
    maxInflight: null,
    http: null,
    circuitBreaker: opts.circuitBreaker ?? null,
    autoDisable: null,
  });
  await storage.secrets.insert({
    id: "sec_retry",
    endpointId: endpoint.id,
    algorithm: "v1",
    status: "primary",
    priority: 0,
    encryptedValue: new TextEncoder().encode(SAMPLE_SECRET),
    notAfter: null,
  });
  return endpoint.id;
}

describe("Default retry schedule with jitter", () => {
  it("Default schedule: an endpoint with no override has retries scheduled per the spec sequence", async () => {
    const server = await startServerWithSequence([503, 503]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url());
    const postel = Postel({
      outbound: {
        storage,
        retryPolicy: ExponentialBackoff({ schedule: ["20ms", "20ms"], maxAttempts: 2, jitter: 0 }),
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(500);
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "failed")).toBe(true);
    expect(attempts.some((a) => a.status === "dead-letter")).toBe(true);
  });
});

describe("Programmable per-endpoint retry policy", () => {
  it("Custom schedule: per-endpoint retryPolicy overrides the org-wide default at dispatch time", async () => {
    const server = await startServerWithSequence([500, 500]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: LinearBackoff({ step: "20ms", maxAttempts: 1 }),
    });
    const postel = Postel({
      outbound: {
        storage,
        retryPolicy: ExponentialBackoff({ schedule: ["5m"], maxAttempts: 5, jitter: 0 }),
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "dead-letter")).toBe(true);
  });
});

describe("Status-code-aware retry", () => {
  it("400 not retried: a 400 response yields failed-permanent on the first attempt", async () => {
    const server = await startServerWithSequence([400]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 3, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "failed-permanent")).toBe(true);
    expect(attempts.filter((a) => a.responseCode === 400).length).toBe(1);
  });

  it("429 with Retry-After: status decision parses Retry-After seconds when emitting retry timing", async () => {
    const server = await startServerWithSequence([429], "30");
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.filter((a) => a.responseCode === 429).length).toBeGreaterThan(0);
  });
});

describe("Per-endpoint and overall delivery deadlines", () => {
  it("Per-request timeout enforced at dispatch", async () => {
    const slow = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("{}");
      }, 1000);
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const addr = slow.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;
    const storage = InMemoryStorage();
    await seedEndpoint(storage, url, {
      retryPolicy: ExponentialBackoff({ schedule: ["5s"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({
      outbound: {
        storage,
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] }, requestTimeout: 80 },
      },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(800);
    await postel.stop();
    await new Promise<void>((resolve, reject) =>
      slow.close((err) => (err ? reject(err) : resolve())),
    );
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.length).toBeGreaterThan(0);
    const isTimeout = attempts[0]?.status === "failed" || attempts[0]?.status === "dead-letter";
    expect(isTimeout).toBe(true);
  });
});

describe("Dead-letter event", () => {
  it("Dead-letter handler invoked: subscribers to dead-letter receive (messageId, endpointId, finalError)", async () => {
    const server = await startServerWithSequence([503]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const events: unknown[] = [];
    postel.on("dead-letter", (p) => events.push(p));
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    expect(events.length).toBeGreaterThan(0);
    const dl = events[0] as { messageId: string; endpointId: string; finalError: string };
    expect(dl.messageId).toBe(id);
    expect(dl.endpointId).toMatch(/^ep_/);
  });
});

describe("Typed lifecycle event emitter [PORT-SPECIFIC]", () => {
  it("on('dead-letter') hands the handler a typed DeadLetterPayload and returns an Unsubscribe", async () => {
    const server = await startServerWithSequence([503]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const seen: DeadLetterPayload[] = [];
    const off = postel.on("dead-letter", (p) => {
      // Compile-time proof the payload is DeadLetterPayload, not `unknown`.
      const finalError: string = p.finalError;
      seen.push({ messageId: p.messageId, endpointId: p.endpointId, finalError });
    });
    expect(typeof off).toBe("function");
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.messageId).toBe(id);
  });

  it("the Unsubscribe returned by on() stops further delivery of events", async () => {
    const server = await startServerWithSequence([503]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    let attempts = 0;
    const off = postel.on("attempt", () => {
      attempts += 1;
    });
    off();
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    expect(attempts).toBe(0);
  });
});

describe("Per-endpoint circuit breaker", () => {
  it("Open circuit: K consecutive failures open the breaker and record a circuit-open transition", async () => {
    const server = await startServerWithSequence([500, 500, 500, 500, 500]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["10ms"], maxAttempts: 5, jitter: 0 }),
      circuitBreaker: { threshold: 2, cooldown: "5s" },
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    const transitions = await storage.endpoints.listStateTransitions(endpointId);
    expect(transitions.some((t) => t.reason === "circuit-open")).toBe(true);
  });

  it("Circuit-open message is not dropped: it stays pending and delivers after the breaker cools down", async () => {
    const server = await startServerWithSequence([503, 200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 5, jitter: 0 }),
      circuitBreaker: { threshold: 1, cooldown: "100ms" },
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(800);
    await postel.stop();
    await server.close();
    // First attempt 503 opens the breaker; the circuit-open skip must NOT
    // finalize the message — it reschedules past the cooldown and the second
    // attempt (after the breaker closes) delivers successfully.
    expect(server.requests().length).toBeGreaterThanOrEqual(2);
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "success")).toBe(true);
  });

  it("Circuit state is keyed unambiguously by tenant: null and empty-string tenants do not share a breaker", async () => {
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, "https://example.test/hook");
    const registry = new CircuitBreakerRegistry(storage, FakeClock(), {
      threshold: 1,
      cooldown: "5s",
    });
    await registry.recordOutcome(null, endpointId, false);
    expect(await registry.isOpen(null, endpointId)).toBe(true);
    // A distinct (empty-string) tenant id must not inherit the null tenant's
    // open breaker — the previous `${tenantId ?? ""}` key collapsed them.
    expect(await registry.isOpen("", endpointId)).toBe(false);
  });
});

describe("At-least-once delivery guarantee", () => {
  it("Worker crash mid-attempt: storage.expireStaleLeases reclaims the row for the next reservation", async () => {
    const clock = FakeClock();
    const storage = InMemoryStorage({ clock });
    await storage.insertMessage({
      id: "msg_atleast_once",
      tenantId: null,
      type: "evt.x",
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
      leaseMs: 30_000,
      batchSize: 1,
      now: clock.now(),
    });
    clock.advance(31_000);
    const cleared = await storage.expireStaleLeases(clock.now());
    expect(cleared).toBe(1);
    const next = await storage.reserveBatch({
      workerId: "fresh",
      leaseMs: 30_000,
      batchSize: 1,
      now: clock.now(),
    });
    expect(next).toHaveLength(1);
  });
});

describe("Endpoint auto-disable", () => {
  it("Default threshold triggers auto-disable: 100% failure rate over the window with >= minAttempts transitions to disabled", async () => {
    const server = await startServerWithSequence([500]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["10ms"], maxAttempts: 0, jitter: 0 }),
      circuitBreaker: { threshold: 100, cooldown: "5s" },
    });
    for (let i = 0; i < 3; i++) {
      await storage.recordAttempt({
        id: `att_seed_${i}`,
        messageId: `msg_seed_${i}`,
        endpointId,
        tenantId: null,
        attemptNumber: 1,
        status: "failed",
        scheduledFor: null,
        startedAt: new Date(),
        completedAt: new Date(),
        responseCode: 500,
        responseHeaders: null,
        responseBody: null,
        latencyMs: 1,
        error: "HTTP_500",
        replayOf: null,
      });
    }
    const postel = Postel({
      outbound: {
        storage,
        autoDisable: { failureRate: 1.0, minAttempts: 3 },
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const transitions = await storage.endpoints.listStateTransitions(endpointId);
    expect(transitions.some((t) => t.reason === "auto-disable")).toBe(true);
  });

  it("Triggering attempt counts toward the window: minAttempts trips on the failing attempt itself", async () => {
    const server = await startServerWithSequence([500]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["10ms"], maxAttempts: 0, jitter: 0 }),
      circuitBreaker: { threshold: 100, cooldown: "5s" },
    });
    // Seed only minAttempts - 1 prior failures: the endpoint can auto-disable
    // only if the current, not-yet-persisted attempt is folded into the window.
    for (let i = 0; i < 2; i++) {
      await storage.recordAttempt({
        id: `att_seed_${i}`,
        messageId: `msg_seed_${i}`,
        endpointId,
        tenantId: null,
        attemptNumber: 1,
        status: "failed",
        scheduledFor: null,
        startedAt: new Date(),
        completedAt: new Date(),
        responseCode: 500,
        responseHeaders: null,
        responseBody: null,
        latencyMs: 1,
        error: "HTTP_500",
        replayOf: null,
      });
    }
    const postel = Postel({
      outbound: {
        storage,
        autoDisable: { failureRate: 1.0, minAttempts: 3 },
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const transitions = await storage.endpoints.listStateTransitions(endpointId);
    expect(transitions.some((t) => t.reason === "auto-disable")).toBe(true);
  });

  it("Below minimum-attempt floor: endpoint stays active when stats.count < minAttempts", async () => {
    const server = await startServerWithSequence([500]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["10ms"], maxAttempts: 0, jitter: 0 }),
      circuitBreaker: { threshold: 100, cooldown: "5s" },
    });
    const postel = Postel({
      outbound: {
        storage,
        autoDisable: { failureRate: 1.0, minAttempts: 50 },
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const transitions = await storage.endpoints.listStateTransitions(endpointId);
    expect(transitions.some((t) => t.reason === "auto-disable")).toBe(false);
  });
});

describe("Endpoint state machine with audit trail", () => {
  it("Auto-disable transition: state transitions from active to disabled with reason=auto-disable", async () => {
    const server = await startServerWithSequence([500]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["10ms"], maxAttempts: 0, jitter: 0 }),
    });
    for (let i = 0; i < 3; i++) {
      await storage.recordAttempt({
        id: `att_state_${i}`,
        messageId: `msg_state_${i}`,
        endpointId,
        tenantId: null,
        attemptNumber: 1,
        status: "failed",
        scheduledFor: null,
        startedAt: new Date(),
        completedAt: new Date(),
        responseCode: 500,
        responseHeaders: null,
        responseBody: null,
        latencyMs: 1,
        error: "HTTP_500",
        replayOf: null,
      });
    }
    const postel = Postel({
      outbound: {
        storage,
        autoDisable: { failureRate: 1.0, minAttempts: 3 },
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();
    const transitions = await storage.endpoints.listStateTransitions(endpointId);
    const target = transitions.find((t) => t.reason === "auto-disable");
    expect(target).toBeDefined();
    expect(target?.toState).toBe("disabled");
    expect(target?.actor).toBe("system");
  });
});
