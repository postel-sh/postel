import { describe, expect, it } from "vitest";

import { UnknownKeyId, createJwksKeyset, verify } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const NOW = new Date("2026-05-14T14:30:00Z");

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

async function buildEd25519Fixture(kid: string) {
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
  const timestampSeconds = Math.floor(NOW.getTime() / 1000).toString();
  const payload = {
    type: "order.shipped",
    timestamp: "2026-05-14T14:29:55Z",
    data: { orderId: "ord_42" },
  };
  const body = JSON.stringify(payload);
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

describe("JWKS consumer", () => {
  it("verify with a Keyset resolves the kid and verifies the v1a signature", async () => {
    const fixture = await buildEd25519Fixture("k-alpha");
    const keyset = createJwksKeyset({
      jwksUri: "https://example/jwks",
      fetch: jwksFetcher({ keys: [fixture.publicJwk] }),
    });

    const result = await verify(fixture.body, fixture.headers, keyset, { clock: fixedClock(NOW) });
    expect(result.event.type).toBe("order.shipped");
  });

  it("verify with a Keyset throws UnknownKeyId when the kid is not in the JWKS", async () => {
    const fixture = await buildEd25519Fixture("k-alpha");
    const other = await buildEd25519Fixture("k-other");
    const keyset = createJwksKeyset({
      jwksUri: "https://example/jwks",
      fetch: jwksFetcher({ keys: [other.publicJwk] }),
    });

    await expect(
      verify(fixture.body, fixture.headers, keyset, { clock: fixedClock(NOW) }),
    ).rejects.toBeInstanceOf(UnknownKeyId);
  });

  it("verify with a Keyset throws when the webhook-key-id header is missing", async () => {
    const fixture = await buildEd25519Fixture("k-alpha");
    const { "webhook-key-id": _kid, ...headers } = fixture.headers;
    const keyset = createJwksKeyset({
      jwksUri: "https://example/jwks",
      fetch: jwksFetcher({ keys: [fixture.publicJwk] }),
    });
    await expect(
      verify(fixture.body, headers, keyset, { clock: fixedClock(NOW) }),
    ).rejects.toMatchObject({
      code: "MALFORMED_HEADER",
    });
  });
});
