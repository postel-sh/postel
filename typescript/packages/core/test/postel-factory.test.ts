import { describe, expect, it } from "vitest";

import {
  Postel,
  SignatureInvalid,
  createKeyset,
  inMemoryDedupAdapter,
  signFixture,
} from "../src/index.js";

const TEST_SECRET = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";
const FIXED_NOW = new Date("2026-05-14T10:00:30Z");

describe("Postel factory returns the library instance", () => {
  it("returns an instance carrying verify, dedup, and jwksHandler", () => {
    const postel = Postel();
    expect(typeof postel.verify).toBe("function");
    expect(typeof postel.dedup).toBe("function");
    expect(typeof postel.jwksHandler).toBe("function");
  });

  it("Type inference: postel.verify resolves a signed fixture end-to-end", async () => {
    const { body, headers } = await signFixture({
      secret: TEST_SECRET,
      payload: {
        type: "order.created",
        timestamp: "2026-05-14T10:00:00Z",
        data: { id: "order_42", amount_cents: 1999 },
      },
      timestamp: FIXED_NOW,
    });

    const postel = Postel();
    const result = await postel.verify<{ id: string; amount_cents: number }>(
      body,
      headers,
      TEST_SECRET,
      { now: () => FIXED_NOW },
    );

    expect(result.event.type).toBe("order.created");
    expect(result.event.data?.id).toBe("order_42");
    expect(result.matchedSecretIndex).toBe(0);
  });

  it("postel.dedup records and detects duplicates via the supplied adapter", async () => {
    const postel = Postel();
    const adapter = inMemoryDedupAdapter({ now: () => FIXED_NOW });

    const first = await postel.dedup("msg_factory_1", { ttl: "1h", adapter });
    const second = await postel.dedup("msg_factory_1", { ttl: "1h", adapter });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it("postel.jwksHandler returns a request handler that serves the JWK Set", async () => {
    const postel = Postel();
    const handler = postel.jwksHandler({
      keys: [{ kid: "key-1", alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "abc" }],
    });
    const response = handler(new Request("https://example.test/.well-known/jwks.json"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: ReadonlyArray<{ kid: string }> };
    expect(body.keys[0]?.kid).toBe("key-1");
  });
});

describe("@postel/core re-exports utilities, errors, and types", () => {
  it("createKeyset, inMemoryDedupAdapter, signFixture, and error classes resolve from @postel/core", () => {
    expect(typeof createKeyset).toBe("function");
    expect(typeof inMemoryDedupAdapter).toBe("function");
    expect(typeof signFixture).toBe("function");
    expect(SignatureInvalid.prototype).toBeInstanceOf(Error);
  });
});
