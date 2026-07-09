import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DedupAdapter, DedupRecordOptions, Verifier } from "../src/index.js";
import {
  ConfigurationError,
  Ed25519V1a,
  ExponentialBackoff,
  HmacV1,
  InMemoryDedup,
  InProcess,
  Keyset,
  NotImplementedError,
  Postel,
  PostelError,
  PublicKey,
  Secret,
  SignatureInvalid,
  definePostelConfig,
  signFixture,
  verify,
} from "../src/index.js";
import { InMemoryStorage } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const TEST_SECRET_A = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";
const TEST_SECRET_B = "whsec_ZGVtby1zZWNyZXQtYi1mb3ItcG9zdGVsLXRlc3Q=";
const FIXED_NOW = new Date("2026-05-21T10:00:30Z");
const PAYLOAD = {
  type: "order.created",
  timestamp: "2026-05-21T10:00:00Z",
  data: { id: "order_42", amount_cents: 1999 },
} as const;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

async function signEd25519(privateKey: CryptoKey, message: Uint8Array): Promise<string> {
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message as BufferSource),
  );
  return bytesToBase64(sig);
}

// Mirrors verify-keyset.test.ts's fixture builder — a real Ed25519 keypair,
// a v1a-signed payload, and the matching public JWK for a mocked JWKS fetch.
async function buildEd25519Fixture(kid: string, timestamp: Date) {
  const keypair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", keypair.publicKey)) as {
    kty: string;
    crv: string;
    x: string;
  };
  const messageId = `msg_${kid}_test`;
  const timestampSeconds = Math.floor(timestamp.getTime() / 1000).toString();
  const body = JSON.stringify(PAYLOAD);
  const canonical = new TextEncoder().encode(`${messageId}.${timestampSeconds}.${body}`);
  const signatureB64 = await signEd25519(keypair.privateKey, canonical);
  return {
    body,
    headers: {
      "webhook-id": messageId,
      "webhook-timestamp": timestampSeconds,
      "webhook-signature": `v1a,${signatureB64}`,
      "webhook-key-id": kid,
    },
    publicJwk: { ...publicJwk, kid, alg: "EdDSA" },
  };
}

function jwksFetcher(jwks: { keys: Array<Record<string, unknown>> }): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { "content-type": "application/jwk-set+json" },
    });
}

describe("Postel factory returns the library instance", () => {
  it("Type inference for the outbound surface", () => {
    const postel = Postel({
      outbound: { storage: InMemoryStorage(), signing: HmacV1() },
    });
    expect(typeof postel.outbound.send).toBe("function");
    expect(typeof postel.outbound.endpoints.create).toBe("function");
    expect(typeof postel.outbound.replay).toBe("function");
    // @ts-expect-error — inbound is not configured, must not exist on the type
    postel.inbound;
  });

  it("Outbound read surface is present: messages.{get,attempts,list}", () => {
    const postel = Postel({ outbound: { storage: InMemoryStorage() } });
    expect(typeof postel.outbound.messages.get).toBe("function");
    expect(typeof postel.outbound.messages.attempts).toBe("function");
    expect(typeof postel.outbound.messages.list).toBe("function");
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
  it("Strongly-typed event: postel.outbound.send<TData> returns a SendResult at runtime", async () => {
    interface OrderCreated {
      readonly id: string;
      readonly amount_cents: number;
    }
    const postel = Postel({ outbound: { storage: InMemoryStorage() } });
    const { id } = await postel.outbound.send<OrderCreated>({
      type: "order.created",
      data: { id: "order_42", amount_cents: 1999 },
    });
    expect(id).toMatch(/^msg_/);
  });
});

describe("Outbound event schema registry", () => {
  it("Registered event type is typed and validated: data is checked against the schema output type", async () => {
    const postel = Postel({
      outbound: {
        storage: InMemoryStorage(),
        events: { "user.created": z.object({ id: z.string() }) },
      },
    });
    const { id } = await postel.outbound.send({ type: "user.created", data: { id: "u_1" } });
    expect(id).toMatch(/^msg_/);
    // Compile-time proof: `data` is checked against the registered schema's
    // output type for this literal `type` — if `EventDataOf` resolved to
    // `unknown`, the mismatched shape below would type-check.
    // @ts-expect-error — "user.created" is registered as { id: string }; total isn't a field
    postel.outbound.send({ type: "user.created", data: { total: 42 } }).catch(() => {});
  });

  it("send<TData> explicit override still compiles for a registered key", async () => {
    interface CustomShape {
      readonly custom: true;
    }
    const postel = Postel({
      outbound: {
        storage: InMemoryStorage(),
        events: { "user.created": z.object({ id: z.string() }) },
      },
    });
    // Explicit override bypasses the registry's static typing, but runtime
    // validation still runs by `event.type`, independent of the generic used —
    // `custom` doesn't satisfy the registered schema, so this still rejects.
    await expect(
      postel.outbound.send<CustomShape>({ type: "user.created", data: { custom: true } }),
    ).rejects.toThrow();
  });
});

describe("All writes accept an optional transaction parameter", () => {
  it("Transactional create: outbound.endpoints.create accepts { tx }", () => {
    const postel = Postel({ outbound: { storage: InMemoryStorage() } });
    // The create signature is what's exercised by the type system; runtime
    // validation against a real URL lives in dispatcher.test.ts under the
    // "Endpoint CRUD" requirement description. Confirm the method shape here.
    expect(typeof postel.outbound.endpoints.create).toBe("function");
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
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), tolerance: 600, clock: fixedClock(FIXED_NOW) },
      },
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
          clock: fixedClock(FIXED_NOW),
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
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    await expect(
      postel.inbound.vendor.verify(fixture.body, fixture.headers),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("No-match always surfaces SignatureInvalid, with the last verifier's error attached as cause", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    // Headers have webhook-key-id but the JWKS uri won't resolve — Keyset verifier
    // throws an error (UnknownKeyId or fetch error). The wire is HMAC-signed so
    // the Secret(TEST_SECRET_B) also won't match. The contract requires the loop
    // to surface SignatureInvalid for "no verifier matched", with the last
    // verifier's error preserved on `cause` for diagnostics.
    const headersWithKid = { ...fixture.headers, "webhook-key-id": "unknown-kid" } as Record<
      string,
      string
    >;
    const postel = Postel({
      inbound: {
        vendor: {
          verify: [Secret(TEST_SECRET_B), Keyset({ jwksUri: "https://example.invalid/jwks" })],
          tolerance: 600,
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    try {
      await postel.inbound.vendor.verify(fixture.body, headersWithKid);
      throw new Error("verify should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureInvalid);
      expect((err as SignatureInvalid).code).toBe("SIGNATURE_INVALID");
      expect((err as SignatureInvalid).cause).toBeDefined();
    }
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

  it("[Keyset, Secret] falls through to Secret when an HMAC request lacks webhook-key-id", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: {
        api: {
          verify: [
            Keyset({ jwksUri: "https://example.test/.well-known/jwks.json" }),
            Secret(TEST_SECRET_A),
          ],
          tolerance: 600,
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    const result = await postel.inbound.api.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifierIndex).toBe(1);
    expect(result.event.type).toBe("order.created");
  });

  it("PublicKey verifier factory produces a Verifier exposing a verify method", () => {
    const v = PublicKey("whpk_demo");
    expect(typeof v.verify).toBe("function");
  });

  it("ConfigurationError from a verifier is rethrown, not swallowed into SignatureInvalid", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const misconfiguredVerifier: Verifier = {
      verify: (rawBody, headers, options) => verify(rawBody, headers, [], options),
    };
    let laterVerifierTried = false;
    const trackingVerifier: Verifier = {
      verify: async () => {
        laterVerifierTried = true;
        return { event: { type: "should.not.match" }, matchedSecretIndex: 0 };
      },
    };
    const postel = Postel({
      inbound: {
        vendor: {
          verify: [misconfiguredVerifier, trackingVerifier],
          tolerance: 600,
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    try {
      await postel.inbound.vendor.verify(fixture.body, fixture.headers);
      throw new Error("verify should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect(err).not.toBeInstanceOf(SignatureInvalid);
    }
    expect(laterVerifierTried).toBe(false);
  });

  it("An inbound source configured with no verifiers throws ConfigurationError", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: { vendor: { verify: [], tolerance: 600, clock: fixedClock(FIXED_NOW) } },
    });
    await expect(
      postel.inbound.vendor.verify(fixture.body, fixture.headers),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("Named-map verifier reports the matched name", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_B,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const postel = Postel({
      inbound: {
        vendor: {
          verify: { current: Secret(TEST_SECRET_A), legacy: Secret(TEST_SECRET_B) },
          tolerance: 600,
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    const result = await postel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifier).toBe("legacy");
    expect(result.matchedVerifierIndex).toBe(1);
  });

  it("Named-map verifier composes with cross-scheme migration", async () => {
    const fixture = await buildEd25519Fixture("k-alpha", FIXED_NOW);
    const postel = Postel({
      inbound: {
        api: {
          verify: {
            hmac: Secret(TEST_SECRET_A),
            jwks: Keyset({
              jwksUri: "https://example.test/.well-known/jwks.json",
              fetch: jwksFetcher({ keys: [fixture.publicJwk] }),
            }),
          },
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    const result = await postel.inbound.api.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifier).toBe("jwks");
    expect(result.matchedVerifierIndex).toBe(1);
    expect(result.event.type).toBe("order.created");
  });

  it("Array and single-verifier forms carry no matchedVerifier key", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const arrayPostel = Postel({
      inbound: {
        vendor: { verify: [Secret(TEST_SECRET_A)], tolerance: 600, clock: fixedClock(FIXED_NOW) },
      },
    });
    const arrayResult = await arrayPostel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect("matchedVerifier" in arrayResult).toBe(false);

    const singlePostel = Postel({
      inbound: {
        vendor: { verify: Secret(TEST_SECRET_A), tolerance: 600, clock: fixedClock(FIXED_NOW) },
      },
    });
    const singleResult = await singlePostel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect("matchedVerifier" in singleResult).toBe(false);
  });

  it("Named-map ConfigurationError rethrow", async () => {
    const fixture = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const misconfiguredVerifier: Verifier = {
      verify: (rawBody, headers, options) => verify(rawBody, headers, [], options),
    };
    const postel = Postel({
      inbound: {
        vendor: {
          verify: { broken: misconfiguredVerifier },
          tolerance: 600,
          clock: fixedClock(FIXED_NOW),
        },
      },
    });
    await expect(
      postel.inbound.vendor.verify(fixture.body, fixture.headers),
    ).rejects.toBeInstanceOf(ConfigurationError);
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
    const postel = Postel({ outbound: { storage: InMemoryStorage() } });
    // @ts-expect-error — inbound not configured
    expect(postel.inbound).toBeUndefined();
    expect(typeof postel.outbound.send).toBe("function");
  });

  it("Both configured: outbound and inbound both present", () => {
    const postel = Postel({
      outbound: { storage: InMemoryStorage() },
      inbound: { github: { verify: Secret(TEST_SECRET_A) } },
    });
    expect(typeof postel.outbound.send).toBe("function");
    expect(typeof postel.inbound.github.verify).toBe("function");
    expect(typeof postel.start).toBe("function");
  });
});

describe("Outbound defaults are overridable per endpoint", () => {
  it("Per-endpoint retry override: outbound.endpoints.create accepts retryPolicy override (type-level)", () => {
    const postel = Postel({
      outbound: {
        storage: InMemoryStorage(),
        retryPolicy: ExponentialBackoff(),
        workers: InProcess({ concurrency: 4 }),
        signing: Ed25519V1a(),
      },
    });
    // Type-level surface — runtime behavior covered in dispatcher.test.ts via SSRF-permitted URLs.
    expect(typeof postel.outbound.endpoints.create).toBe("function");
    const _retryOverride = ExponentialBackoff({ schedule: ["1m", "5m"], maxAttempts: 2 });
    expect(_retryOverride.kind).toBe("exponential");
  });

  it("Per-endpoint request-timeout override: outbound.endpoints.create accepts http.requestTimeout override (type-level)", () => {
    const postel = Postel({
      outbound: { storage: InMemoryStorage(), http: { requestTimeout: "30s" } },
    });
    // Wired http sub-fields are overridable per endpoint; the unwired tls/dns
    // knobs fail fast instead — see config-audit.test.ts.
    expect(typeof postel.outbound.endpoints.create).toBe("function");
    const opts = { url: "https://customer.example.test/hook", http: { requestTimeout: "5s" } };
    expect(opts.http.requestTimeout).toBe("5s");
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
    let captured: {
      messageId?: string;
      ttlSeconds?: number;
      options?: DedupRecordOptions | undefined;
    } = {};
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

  it("dedup passes undefined options when no tx is provided (not { tx: undefined })", async () => {
    let captured: { options?: DedupRecordOptions | undefined } = {};
    const capturingAdapter: DedupAdapter = {
      async record(_messageId, _ttlSeconds, options) {
        captured = { options };
        return { duplicate: false };
      },
    };
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: capturingAdapter, dedupTtl: "1h" },
      },
    });
    await postel.inbound.github.dedup("msg_no_tx");
    expect(captured.options).toBeUndefined();
  });

  it("dedup throws ConfigurationError for an invalid ttl string", async () => {
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: InMemoryDedup() },
      },
    });
    await expect(
      postel.inbound.github.dedup("msg_bad_ttl", { ttl: "garbage" }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("dedup throws ConfigurationError when ttl is missing entirely", async () => {
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: InMemoryDedup() },
      },
    });
    await expect(postel.inbound.github.dedup("msg_no_ttl")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it("dedup() is absent from the type when dedup is explicitly set to undefined", () => {
    const postel = Postel({
      inbound: {
        github: { verify: Secret(TEST_SECRET_A), dedup: undefined },
      },
    });
    expect(typeof postel.inbound.github.verify).toBe("function");
    // @ts-expect-error — dedup: undefined is not a DedupAdapter; method must not exist on the type
    postel.inbound.github.dedup;
  });
});

describe("Strategy factories", () => {
  it("strategies are config objects (no runtime work at construction)", () => {
    expect(typeof Secret("whsec_x").verify).toBe("function");
    expect(typeof PublicKey("whpk_x").verify).toBe("function");
    expect(HmacV1().kind).toBe("hmac-v1");
    expect(Ed25519V1a().kind).toBe("ed25519-v1a");
    expect(ExponentialBackoff().kind).toBe("exponential");
    expect(InProcess().kind).toBe("in-process");
  });
});

describe("NotImplementedError is intentionally outside the PostelError hierarchy", () => {
  it("NotImplementedError extends Error directly (not PostelError) and carries code 'NOT_IMPLEMENTED'", () => {
    const err = new NotImplementedError("postel.example");
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PostelError);
    expect(err.code).toBe("NOT_IMPLEMENTED");
  });
});

describe("`definePostelConfig` preserves literal config inference [PORT-SPECIFIC]", () => {
  it("keeps inbound/outbound on the instance type for a separately-declared config", () => {
    const inboundConfig = definePostelConfig({
      inbound: { github: { verify: Secret(TEST_SECRET_A) } },
    });
    const p1 = Postel(inboundConfig);
    expect(typeof p1.inbound.github.verify).toBe("function");
    // @ts-expect-error — outbound is not configured, must not exist on the type
    p1.outbound;

    const outboundConfig = definePostelConfig({ outbound: { storage: InMemoryStorage() } });
    const p2 = Postel(outboundConfig);
    expect(typeof p2.outbound.send).toBe("function");
    // @ts-expect-error — inbound is not configured, must not exist on the type
    p2.inbound;
  });
});

describe("Health check endpoint", () => {
  it("Healthy state: an outbound instance reports ok:true with outbox depth and worker count", async () => {
    const postel = Postel({ outbound: { storage: InMemoryStorage() } });
    const h = await postel.health();
    expect(h.ok).toBe(true);
    expect(h.outboxDepth).toBe(0);
    expect(typeof h.workerCount).toBe("number");
  });

  it("Storage probe failure reports unhealthy without rejecting", async () => {
    const storage = InMemoryStorage();
    storage.outboxDepth = async () => {
      throw new Error("connection refused");
    };
    const postel = Postel({ outbound: { storage } });
    const h = await postel.health();
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/storage probe failed/);
  });

  it("Outbox-depth threshold breach reports unhealthy while still returning the depth", async () => {
    const postel = Postel({
      outbound: { storage: InMemoryStorage() },
      observability: { health: { maxOutboxDepth: 0 } },
    });
    await postel.outbound.send({ type: "evt.x" });
    const h = await postel.health();
    expect(h.ok).toBe(false);
    expect(h.outboxDepth).toBeGreaterThan(0);
    expect(h.reason).toMatch(/maxOutboxDepth/);
  });
});
