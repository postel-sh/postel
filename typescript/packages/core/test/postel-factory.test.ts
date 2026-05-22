import { describe, expect, it } from "vitest";

import type { DedupAdapter, DedupRecordOptions } from "../src/index.js";
import {
  Ed25519V1a,
  ExponentialBackoff,
  HmacV1,
  InMemoryDedup,
  InProcess,
  Keyset,
  MalformedHeader,
  NotImplementedError,
  Postel,
  PublicKey,
  Secret,
  SignatureInvalid,
  signFixture,
} from "../src/index.js";

const TEST_SECRET_A = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";
const TEST_SECRET_B = "whsec_ZGVtby1zZWNyZXQtYi1mb3ItcG9zdGVsLXRlc3Q=";
const FIXED_NOW = new Date("2026-05-21T10:00:30Z");
const PAYLOAD = {
  type: "order.created",
  timestamp: "2026-05-21T10:00:00Z",
  data: { id: "order_42", amount_cents: 1999 },
} as const;

describe("Postel factory returns the library instance", () => {
  it("Type inference for the outbound surface", () => {
    const postel = Postel({
      outbound: { storage: {}, signing: HmacV1() },
    });
    expect(typeof postel.outbound.send).toBe("function");
    expect(typeof postel.outbound.endpoints.create).toBe("function");
    expect(typeof postel.outbound.replay).toBe("function");
    // @ts-expect-error — inbound is not configured, must not exist on the type
    postel.inbound;
  });

  it("Type inference for the inbound surface", () => {
    const postel = Postel({
      inbound: { github: { verify: Secret(TEST_SECRET_A) } },
    });
    expect(typeof postel.inbound.github.verify).toBe("function");
    // @ts-expect-error — outbound is not configured, must not exist on the type
    postel.outbound;
    // @ts-expect-error — only "github" is configured
    postel.inbound.stripe;
  });

  it("lifecycle methods are always present", async () => {
    const postel = Postel({});
    expect(typeof postel.start).toBe("function");
    expect(typeof postel.stop).toBe("function");
    expect(typeof postel.health).toBe("function");
    const h = await postel.health();
    expect(h.ok).toBe(true);
  });
});

describe("Public function signatures match Standard Webhooks event shape", () => {
  it("Strongly-typed event: postel.outbound.send<TData> compiles and throws NOT_IMPLEMENTED at runtime", async () => {
    interface OrderCreated {
      readonly id: string;
      readonly amount_cents: number;
    }
    const postel = Postel({ outbound: { storage: {} } });
    await expect(
      postel.outbound.send<OrderCreated>({
        type: "order.created",
        data: { id: "order_42", amount_cents: 1999 },
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("All writes accept an optional transaction parameter", () => {
  it("Transactional create: outbound.endpoints.create accepts { tx }", async () => {
    const postel = Postel({ outbound: { storage: {} } });
    const fakeTx = { mock: true };
    await expect(
      postel.outbound.endpoints.create({ url: "https://example.com/hook" }, { tx: fakeTx }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("Inbound dedup inside a transaction: dedup accepts { tx }", async () => {
    const postel = Postel({
      inbound: {
        github: {
          verify: Secret(TEST_SECRET_A),
          dedup: InMemoryDedup({ now: () => FIXED_NOW }),
          dedupTtl: "1h",
        },
      },
    });
    const result = await postel.inbound.github.dedup("msg_tx_1", { tx: { mock: true } });
    expect(result.duplicate).toBe(false);
  });
});

describe("Verifier strategy composition", () => {
  it("Single verifier is equivalent to a one-element array", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: { github: { verify: Secret(TEST_SECRET_A), tolerance: 600, now: () => FIXED_NOW } },
    });
    const result = await postel.inbound.github.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifierIndex).toBe(0);
    expect(result.event.type).toBe("order.created");
  });

  it("HMAC rotation via verifier array: old secret matches at index 1", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_B,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: {
        vendor: {
          verify: [Secret(TEST_SECRET_A), Secret(TEST_SECRET_B)],
          tolerance: 600,
          now: () => FIXED_NOW,
        },
      },
    });
    const result = await postel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifierIndex).toBe(1);
  });

  it("No verifier matches throws SignatureInvalid", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: {
        vendor: {
          verify: [Secret(TEST_SECRET_B)],
          tolerance: 600,
          now: () => FIXED_NOW,
        },
      },
    });
    await expect(
      postel.inbound.vendor.verify(fixture.body, fixture.headers),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Cross-scheme migration: array can mix Secret and Keyset shapes (type-level)", () => {
    const postel = Postel({
      inbound: {
        api: {
          verify: [
            Secret(TEST_SECRET_A),
            Keyset({ jwksUri: "https://example.test/.well-known/jwks.json" }),
          ],
        },
      },
    });
    expect(typeof postel.inbound.api.verify).toBe("function");
  });

  it("PublicKey verifier factory produces a tagged Verifier object", () => {
    const v = PublicKey("whpk_demo");
    expect(v.kind).toBe("public-key");
  });
});

describe("Conditional optionality of outbound and inbound", () => {
  it("Inbound-only consumer: postel.outbound is a TypeScript error", () => {
    const postel = Postel({
      inbound: { github: { verify: Secret(TEST_SECRET_A) } },
    });
    // @ts-expect-error — outbound not configured
    expect(postel.outbound).toBeUndefined();
    expect(typeof postel.inbound.github.verify).toBe("function");
  });

  it("Outbound-only consumer: postel.inbound is a TypeScript error", () => {
    const postel = Postel({ outbound: { storage: {} } });
    // @ts-expect-error — inbound not configured
    expect(postel.inbound).toBeUndefined();
    expect(typeof postel.outbound.send).toBe("function");
  });

  it("Both configured: outbound and inbound both present", () => {
    const postel = Postel({
      outbound: { storage: {} },
      inbound: { github: { verify: Secret(TEST_SECRET_A) } },
    });
    expect(typeof postel.outbound.send).toBe("function");
    expect(typeof postel.inbound.github.verify).toBe("function");
    expect(typeof postel.start).toBe("function");
  });
});

describe("Outbound defaults are overridable per endpoint", () => {
  it("Per-endpoint retry override: outbound.endpoints.create accepts retryPolicy override", async () => {
    const postel = Postel({
      outbound: {
        storage: {},
        retryPolicy: ExponentialBackoff(),
        workers: InProcess({ concurrency: 4 }),
        signing: Ed25519V1a(),
      },
    });
    await expect(
      postel.outbound.endpoints.create({
        url: "https://customer.example.test/hook",
        retryPolicy: ExponentialBackoff({ schedule: ["1m", "5m"], maxAttempts: 2 }),
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("Per-endpoint TLS opt-out: outbound.endpoints.create accepts http.tls override", async () => {
    const postel = Postel({
      outbound: { storage: {}, http: { tls: { verify: true } } },
    });
    await expect(
      postel.outbound.endpoints.create({
        url: "https://customer.example.test/hook",
        http: { tls: { verify: false } },
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("Inbound dedup wiring", () => {
  it("dedup detects duplicates within TTL", async () => {
    const postel = Postel({
      inbound: {
        github: {
          verify: Secret(TEST_SECRET_A),
          dedup: InMemoryDedup({ now: () => FIXED_NOW }),
          dedupTtl: "1h",
        },
      },
    });
    const first = await postel.inbound.github.dedup("msg_dup_1");
    const second = await postel.inbound.github.dedup("msg_dup_1");
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it("dedup uses explicit ttl over default", async () => {
    const postel = Postel({
      inbound: {
        github: {
          verify: Secret(TEST_SECRET_A),
          dedup: InMemoryDedup({ now: () => FIXED_NOW }),
        },
      },
    });
    const result = await postel.inbound.github.dedup("msg_explicit_ttl", { ttl: "5m" });
    expect(result.duplicate).toBe(false);
  });

  it("dedup threads tx through to the adapter so it can participate in host transactions", async () => {
    let captured: { messageId?: string; ttlSeconds?: number; options?: DedupRecordOptions } = {};
    const capturingAdapter: DedupAdapter = {
      async record(messageId, ttlSeconds, options) {
        captured = { messageId, ttlSeconds, options };
        return { duplicate: false };
      },
    };
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: capturingAdapter, dedupTtl: "1h" },
      },
    });
    const fakeTx = { mock: true };
    await postel.inbound.github.dedup("msg_tx_thread", { tx: fakeTx });
    expect(captured.messageId).toBe("msg_tx_thread");
    expect(captured.ttlSeconds).toBe(3600);
    expect(captured.options?.tx).toBe(fakeTx);
  });

  it("dedup throws MalformedHeader for an invalid ttl string", async () => {
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: InMemoryDedup() },
      },
    });
    await expect(
      postel.inbound.github.dedup("msg_bad_ttl", { ttl: "garbage" }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("dedup throws MalformedHeader when ttl is missing entirely", async () => {
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: InMemoryDedup() },
      },
    });
    await expect(postel.inbound.github.dedup("msg_no_ttl")).rejects.toBeInstanceOf(MalformedHeader);
  });
});

describe("Strategy factories", () => {
  it("strategies are tagged config objects (no runtime work at construction)", () => {
    expect(Secret("whsec_x").kind).toBe("secret");
    expect(PublicKey("whpk_x").kind).toBe("public-key");
    expect(HmacV1().kind).toBe("hmac-v1");
    expect(Ed25519V1a().kind).toBe("ed25519-v1a");
    expect(ExponentialBackoff().kind).toBe("exponential");
    expect(InProcess().kind).toBe("in-process");
  });
});
