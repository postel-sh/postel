import { describe, expect, it } from "vitest";
import { Ed25519V1a, InMemoryStorage, Postel } from "../src/index.js";
import { ed25519Kid } from "../src/internal/jwk.js";

// A loopback IP endpoint so public-API create() skips DNS resolution and clears
// the create-time URL/SSRF gate (mirrors dispatcher.test.ts).
const LOOPBACK = "http://127.0.0.1:65535/hook";
const allowLoopback = { ssrf: { allowedRanges: ["127.0.0.0/8"] } };

describe("Endpoint creation provisions the initial signing secret [PORT-SPECIFIC]", () => {
  it("v1a endpoint publishes its key via publicJwks with no prior rotation (per-endpoint signing)", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, http: allowLoopback } });

    const ep = await postel.outbound.endpoints.create({
      url: LOOPBACK,
      allowHttp: true,
      signing: Ed25519V1a(),
    });

    const secrets = await storage.secrets.listForEndpoint(ep.id);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.algorithm).toBe("v1a");
    expect(secrets[0]?.status).toBe("primary");
    const publicKey = secrets[0]?.publicKey;
    expect(publicKey).toBeInstanceOf(Uint8Array);
    if (!publicKey) throw new Error("expected a stored public key");

    const jwks = await postel.outbound.keys.publicJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]?.kid).toBe(await ed25519Kid(publicKey));
  });

  it("v1a endpoint publishes its key via publicJwks with no prior rotation (org-default signing)", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, signing: Ed25519V1a(), http: allowLoopback } });

    const ep = await postel.outbound.endpoints.create({ url: LOOPBACK, allowHttp: true });

    const secrets = await storage.secrets.listForEndpoint(ep.id);
    expect(secrets[0]?.algorithm).toBe("v1a");
    const jwks = await postel.outbound.keys.publicJwks();
    expect(jwks.keys).toHaveLength(1);
  });

  it("default HMAC secret on create: one primary v1 secret, excluded from publicJwks", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, http: allowLoopback } });

    const ep = await postel.outbound.endpoints.create({ url: LOOPBACK, allowHttp: true });

    const secrets = await storage.secrets.listForEndpoint(ep.id);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.algorithm).toBe("v1");
    expect(secrets[0]?.status).toBe("primary");
    expect(secrets[0]?.publicKey).toBeUndefined();

    const jwks = await postel.outbound.keys.publicJwks();
    expect(jwks.keys).toHaveLength(0);
  });

  it("opt out of provisioning: provisionSecret false writes no secret", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, signing: Ed25519V1a(), http: allowLoopback } });

    const ep = await postel.outbound.endpoints.create({
      url: LOOPBACK,
      allowHttp: true,
      provisionSecret: false,
    });

    const secrets = await storage.secrets.listForEndpoint(ep.id);
    expect(secrets).toHaveLength(0);
  });
});
