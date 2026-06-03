import { describe, expect, it } from "vitest";
import { InMemoryStorage, Postel } from "../src/index.js";
import { ed25519Kid, hasPrivateMaterial } from "../src/internal/jwk.js";
import { decodeSecret } from "../src/internal/secret.js";
import { signAndBuildHeaders } from "../src/sender/dispatcher/headers.js";
import { generateAsymmetric } from "../src/sender/keys/generate.js";

function emptyEndpoint(id: string) {
  return {
    id,
    tenantId: null,
    url: "https://example.test/hook",
    state: "active" as const,
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
  };
}

describe("Current public signing keys are retrievable", () => {
  it("publicJwks returns the active v1a public keys as JWKs with a deterministic kid and no private material", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const keypair = await generateAsymmetric();
    const publicRaw = decodeSecret(keypair.public).bytes;

    const ep = await storage.endpoints.create(emptyEndpoint("ep_1"));
    await storage.secrets.insert({
      id: "sec_1",
      endpointId: ep.id,
      algorithm: "v1a",
      status: "primary",
      priority: 0,
      encryptedValue: new TextEncoder().encode(keypair.private),
      publicKey: publicRaw,
      notAfter: null,
    });

    const jwks = await postel.outbound.keys.publicJwks();
    expect(jwks.keys).toHaveLength(1);
    const jwk = jwks.keys[0];
    expect(jwk?.kty).toBe("OKP");
    expect(jwk?.crv).toBe("Ed25519");
    expect(jwk?.alg).toBe("EdDSA");
    expect(jwk?.kid).toBe(await ed25519Kid(publicRaw));
    expect(hasPrivateMaterial(jwk)).toBe(false);
  });

  it("publicJwks excludes symmetric (v1) secrets", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const ep = await storage.endpoints.create(emptyEndpoint("ep_hmac"));
    await storage.secrets.insert({
      id: "sec_hmac",
      endpointId: ep.id,
      algorithm: "v1",
      status: "primary",
      priority: 0,
      encryptedValue: new TextEncoder().encode("whsec_aGVsbG8td29ybGQtc2VjcmV0LXBhZGRpbmc="),
      notAfter: null,
    });
    const jwks = await postel.outbound.keys.publicJwks();
    expect(jwks.keys).toHaveLength(0);
  });
});

describe("Outbound asymmetric signatures carry a key id", () => {
  it("a v1a signature stamps webhook-key-id equal to the published JWK kid", async () => {
    const keypair = await generateAsymmetric();
    const publicRaw = decodeSecret(keypair.public).bytes;
    const headers = await signAndBuildHeaders({
      messageId: "msg_1",
      timestampSeconds: 1000,
      body: JSON.stringify({ type: "order.created" }),
      secrets: [
        {
          id: "sec_1",
          endpointId: "ep_1",
          algorithm: "v1a",
          status: "primary",
          priority: 0,
          encryptedValue: new TextEncoder().encode(keypair.private),
          publicKey: publicRaw,
          notAfter: null,
          createdAt: new Date("2026-05-14T13:00:00Z"),
        },
      ],
    });
    expect(headers["webhook-signature"]).toMatch(/^v1a,/);
    expect(headers["webhook-key-id"]).toBe(await ed25519Kid(publicRaw));
  });

  it("an HMAC (v1) signature carries no webhook-key-id", async () => {
    const headers = await signAndBuildHeaders({
      messageId: "msg_2",
      timestampSeconds: 1000,
      body: JSON.stringify({ type: "order.created" }),
      secrets: [
        {
          id: "sec_2",
          endpointId: "ep_1",
          algorithm: "v1",
          status: "primary",
          priority: 0,
          encryptedValue: new TextEncoder().encode("whsec_aGVsbG8td29ybGQtc2VjcmV0LXBhZGRpbmc="),
          notAfter: null,
          createdAt: new Date("2026-05-14T13:00:00Z"),
        },
      ],
    });
    expect(headers["webhook-key-id"]).toBeUndefined();
  });
});
