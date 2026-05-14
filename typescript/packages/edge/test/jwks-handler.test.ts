import { describe, expect, it } from "vitest";

import { jwksHandler } from "../src/index.js";

const PUBLIC_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  alg: "EdDSA",
  kid: "k1",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};

describe("JWKS endpoint mounter", () => {
  describe("JWKS discovery extension", () => {
    it("Hono JWKS handler — GET returns a JWKS document with kid + alg + key material", async () => {
      const handler = jwksHandler({ keys: [PUBLIC_JWK] });
      const res = handler(new Request("https://x/.well-known/webhooks-keys", { method: "GET" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/jwk-set+json");

      const body = (await res.json()) as {
        keys: Array<{ kid?: string; alg?: string; x?: string; not_after?: string }>;
      };
      expect(body.keys).toHaveLength(1);
      const entry = body.keys[0];
      if (!entry) throw new Error("expected one JWK entry");
      expect(entry.kid).toBe("k1");
      expect(entry.alg).toBe("EdDSA");
      expect(entry.x).toBe(PUBLIC_JWK.x);
    });

    it("HEAD returns the same headers with no body", () => {
      const handler = jwksHandler({ keys: [PUBLIC_JWK] });
      const res = handler(new Request("https://x/.well-known/webhooks-keys", { method: "HEAD" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/jwk-set+json");
    });

    it("non-GET/HEAD methods return 405 method_not_allowed", () => {
      const handler = jwksHandler({ keys: [PUBLIC_JWK] });
      const res = handler(new Request("https://x/.well-known/webhooks-keys", { method: "POST" }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    });

    it("preserves the optional not_after field on each JWK", async () => {
      const handler = jwksHandler({
        keys: [{ ...PUBLIC_JWK, not_after: "2099-01-01T00:00:00Z" }],
      });
      const body = (await handler(new Request("https://x/.well-known/webhooks-keys")).json()) as {
        keys: Array<{ not_after?: string }>;
      };
      expect(body.keys[0]?.not_after).toBe("2099-01-01T00:00:00Z");
    });
  });
});

describe("JWKS publishes only public keys", () => {
  it("Private key absent — construction throws if a JWK has private fields", () => {
    expect(() =>
      jwksHandler({
        keys: [
          {
            ...PUBLIC_JWK,
            d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        ],
      }),
    ).toThrowError(/private key material/);
  });

  it("scrubs any other private field if it slipped through (defense in depth)", async () => {
    const handler = jwksHandler({
      keys: [
        {
          ...PUBLIC_JWK,
          // biome-ignore lint/suspicious/noExplicitAny: forcing a public-only JWK with an extra harmless field
        } as any,
      ],
    });
    const res = handler(new Request("https://x/.well-known/webhooks-keys"));
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    const entry = body.keys[0];
    if (!entry) throw new Error("expected one JWK entry");
    for (const field of ["d", "p", "q", "dp", "dq", "qi", "k"]) {
      expect(entry).not.toHaveProperty(field);
    }
  });
});
