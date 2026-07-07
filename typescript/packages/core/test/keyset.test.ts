import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJwksKeyset } from "../src/index.js";

const K1 = {
  kty: "OKP",
  crv: "Ed25519",
  alg: "EdDSA",
  kid: "k1",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};
const K2 = {
  kty: "OKP",
  crv: "Ed25519",
  alg: "EdDSA",
  kid: "k2",
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/jwk-set+json" },
  });
}

function mockFetch(responses: Array<{ keys: unknown }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(jsonResponse(r));
  return fn;
}

describe("JWKS consumer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-05-14T14:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("kid lookup hit", () => {
    it("auto-fetches the JWKS on first findByKid call and returns the matching key", async () => {
      const fetcher = mockFetch([{ keys: [K1] }]);
      const keyset = createJwksKeyset({ jwksUri: "https://example/jwks", fetch: fetcher });

      const found = await keyset.findByKid("k1");
      expect(found?.kid).toBe("k1");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("caches the JWKS for the configured TTL", async () => {
      const fetcher = mockFetch([{ keys: [K1] }, { keys: [K1, K2] }]);
      const keyset = createJwksKeyset({
        jwksUri: "https://example/jwks",
        fetch: fetcher,
        cacheTtl: 60,
      });

      await keyset.findByKid("k1");
      await keyset.findByKid("k1");
      expect(fetcher).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_001);
      await keyset.findByKid("k2");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("returns undefined for an unknown kid (verify maps this to UNKNOWN_KEY_ID)", async () => {
      const fetcher = mockFetch([{ keys: [K1] }]);
      const keyset = createJwksKeyset({ jwksUri: "https://example/jwks", fetch: fetcher });
      expect(await keyset.findByKid("missing")).toBeUndefined();
    });

    it("refresh() forces a fetch even within the TTL window", async () => {
      const fetcher = mockFetch([{ keys: [K1] }, { keys: [K2] }]);
      const keyset = createJwksKeyset({ jwksUri: "https://example/jwks", fetch: fetcher });
      await keyset.findByKid("k1");
      await keyset.refresh();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(await keyset.findByKid("k2")).toBeDefined();
    });

    it("treats a key past its not_after as not present (rotation honored)", async () => {
      const fetcher = mockFetch([{ keys: [{ ...K1, not_after: "2020-01-01T00:00:00Z" }] }]);
      const keyset = createJwksKeyset({ jwksUri: "https://example/jwks", fetch: fetcher });
      expect(await keyset.findByKid("k1")).toBeUndefined();
    });

    it("dedupes concurrent fetches into one in-flight request", async () => {
      const fetcher = mockFetch([{ keys: [K1] }]);
      const keyset = createJwksKeyset({ jwksUri: "https://example/jwks", fetch: fetcher });
      const [a, b] = await Promise.all([keyset.findByKid("k1"), keyset.findByKid("k1")]);
      expect(a?.kid).toBe("k1");
      expect(b?.kid).toBe("k1");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});
