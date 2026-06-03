import type { Jwks } from "@postel/core";
import { describe, expect, it } from "vitest";

import { jwksFetchHandler } from "../src/index.js";

const JWKS: Jwks = {
  keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFyLXB1YmxpYy1rZXk", kid: "k1", alg: "EdDSA" }],
};

describe("JWKS endpoint mounter", () => {
  it("jwksFetchHandler serves the provider's current keys on GET", async () => {
    const handler = jwksFetchHandler(() => JWKS);
    const res = await handler(new Request("https://x/.well-known/webhooks-keys"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("jwk-set");
    const body = (await res.json()) as Jwks;
    expect(body.keys[0]?.kid).toBe("k1");
  });

  it("jwksFetchHandler reflects an updated key set on a later request", async () => {
    let current: Jwks = { keys: [] };
    const handler = jwksFetchHandler(() => current);
    const first = (await (await handler(new Request("https://x/k"))).json()) as Jwks;
    expect(first.keys).toHaveLength(0);
    current = JWKS;
    const second = (await (await handler(new Request("https://x/k"))).json()) as Jwks;
    expect(second.keys).toHaveLength(1);
  });

  it("jwksFetchHandler rejects non-GET with 405", async () => {
    const handler = jwksFetchHandler(() => JWKS);
    const res = await handler(
      new Request("https://x/.well-known/webhooks-keys", { method: "POST" }),
    );
    expect(res.status).toBe(405);
  });
});
