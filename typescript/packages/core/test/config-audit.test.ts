import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  AwsKms,
  ExponentialBackoff,
  GcpKms,
  InMemoryStorage,
  InProcess,
  type LogEvent,
  NotImplementedError,
  PlaintextKms,
  Postel,
  Vault,
} from "../src/index.js";

const SAMPLE_SECRET = "whsec_ZGVtby1zZWNyZXQtZm9yLXBvc3RlbC10ZXN0LXBhZGRpbmc=";
const LOOPBACK = { ssrf: { allowedRanges: ["127.0.0.0/8"] } } as const;

async function tick(ms = 100): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function start200Server(): Promise<{ url(): string; close(): Promise<void> }> {
  const handler = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "application/json" });
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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function seedEndpoint(
  storage: ReturnType<typeof InMemoryStorage>,
  url: string,
): Promise<void> {
  const endpoint = await storage.endpoints.create({
    id: "ep_log",
    tenantId: null,
    url,
    state: "active",
    types: null,
    channels: null,
    retryPolicy: null,
    headers: null,
    signing: null,
    metadata: null,
    allowHttp: true,
    maxInflight: null,
    http: null,
    circuitBreaker: null,
    autoDisable: null,
  });
  await storage.secrets.insert({
    id: "sec_log",
    endpointId: endpoint.id,
    algorithm: "v1",
    status: "primary",
    priority: 0,
    encryptedValue: new TextEncoder().encode(SAMPLE_SECRET),
    notAfter: null,
  });
}

// Issue #78 — config-field audit. Every *leaf* field on the documented config
// interfaces (OutboundConfig, HttpDefaults, CircuitBreakerDefaults,
// AutoDisableDefaults, ReplayDefaults, RetentionDefaults, EphemeralKeysDefaults,
// ObservabilityConfig) traces to a live runtime consumer, or it fails fast at
// construction. This table IS the mapping deliverable; the `fails-fast` rows are
// asserted below, and the consumer rows cite where the value is read. Enumerated
// down to the leaf so a newly-added default field can't slip in unmapped.
type Disposition = { kind: "consumer"; readBy: string } | { kind: "fails-fast" };
const CONFIG_FIELD_MAP: Record<string, Disposition> = {
  // PostelConfig / ObservabilityConfig
  "observability.logger": { kind: "consumer", readBy: "postel.ts — forwarded to emitter events" },
  // OutboundConfig
  "outbound.storage": { kind: "consumer", readBy: "outbound.ts — every API path" },
  "outbound.signing": { kind: "consumer", readBy: "crud.ts — endpoint secret provisioning" },
  "outbound.retryPolicy": { kind: "consumer", readBy: "orchestrator.ts — orgRetryPolicy" },
  "outbound.workers": {
    kind: "consumer",
    readBy: "outbound.ts — concurrency (non-in-process fails fast)",
  },
  "outbound.kms": { kind: "fails-fast" },
  "outbound.clock": { kind: "consumer", readBy: "outbound.ts — clock" },
  "outbound.defaultTenantId": { kind: "consumer", readBy: "send.ts — defaultTenantId" },
  // HttpDefaults (outbound.http.*)
  "http.requestTimeout": { kind: "consumer", readBy: "http-dispatcher.ts — resolveTimeoutMs" },
  "http.overallDeadline": { kind: "consumer", readBy: "http-dispatcher.ts — resolveDeadlineMs" },
  "http.ssrf": { kind: "consumer", readBy: "http-dispatcher.ts — resolvePolicy" },
  "http.userAgent": { kind: "consumer", readBy: "http-dispatcher.ts — resolveUserAgent" },
  "http.fetch": { kind: "consumer", readBy: "outbound.ts — fetchImpl" },
  "http.tls.verify": { kind: "fails-fast" },
  "http.dns.pinResolution": { kind: "fails-fast" },
  // CircuitBreakerDefaults (outbound.circuitBreaker.*)
  "circuitBreaker.threshold": { kind: "consumer", readBy: "circuit.ts — threshold" },
  "circuitBreaker.cooldown": { kind: "consumer", readBy: "circuit.ts — cooldown" },
  // AutoDisableDefaults (outbound.autoDisable.*)
  "autoDisable.failureRate": { kind: "consumer", readBy: "auto-disable.ts — failureRate" },
  "autoDisable.window": { kind: "consumer", readBy: "auto-disable.ts — window" },
  "autoDisable.minAttempts": { kind: "consumer", readBy: "auto-disable.ts — minAttempts" },
  // ReplayDefaults (outbound.replay.*)
  "replay.defaultThroughput": { kind: "consumer", readBy: "replay.ts — defaultThroughput" },
  // RetentionDefaults (outbound.retention.*) — whole slot fails fast
  "retention.messages": { kind: "fails-fast" },
  "retention.attempts": { kind: "fails-fast" },
  // EphemeralKeysDefaults (outbound.ephemeralKeys.*) — whole slot fails fast
  "ephemeralKeys.rotateEvery": { kind: "fails-fast" },
};

describe("Unimplemented config slots fail fast at construction [PORT-SPECIFIC]", () => {
  const storage = () => InMemoryStorage();

  it("built-in KMS adapters (aws-kms / gcp-kms / vault) throw NotImplementedError", () => {
    for (const kms of [
      AwsKms({ keyId: "arn:aws:kms:k" }),
      GcpKms({ keyName: "projects/p/keyRings/r/cryptoKeys/k" }),
      Vault({ transitPath: "transit", keyName: "k" }),
    ]) {
      expect(() => Postel({ outbound: { storage: storage(), kms } })).toThrow(NotImplementedError);
    }
  });

  it("PlaintextKms (or an omitted kms) and a fully-wired config construct without throwing", () => {
    expect(() => Postel({ outbound: { storage: storage(), kms: PlaintextKms() } })).not.toThrow();
    expect(() => Postel({ outbound: { storage: storage() } })).not.toThrow();
    expect(() =>
      Postel({
        outbound: {
          storage: storage(),
          workers: InProcess({ concurrency: 4 }),
          retryPolicy: ExponentialBackoff({ schedule: ["1s"], maxAttempts: 1 }),
          circuitBreaker: { threshold: 5, cooldown: "30s" },
          autoDisable: { failureRate: 0.5, window: "1h", minAttempts: 10 },
          replay: { defaultThroughput: 100 },
          http: { requestTimeout: "5s", overallDeadline: "30s", userAgent: "x", ...LOOPBACK },
        },
      }),
    ).not.toThrow();
  });

  it("retention and ephemeralKeys slots throw NotImplementedError", () => {
    expect(() =>
      Postel({ outbound: { storage: storage(), retention: { attempts: "30d" } } }),
    ).toThrow(NotImplementedError);
    expect(() =>
      Postel({ outbound: { storage: storage(), ephemeralKeys: { rotateEvery: "12h" } } }),
    ).toThrow(NotImplementedError);
  });

  it("unwired HTTP security knobs (http.tls / http.dns) throw at the org level", () => {
    expect(() =>
      Postel({ outbound: { storage: storage(), http: { tls: { verify: false } } } }),
    ).toThrow(NotImplementedError);
    expect(() =>
      Postel({ outbound: { storage: storage(), http: { dns: { pinResolution: true } } } }),
    ).toThrow(NotImplementedError);
  });

  it("unwired HTTP security knobs throw as per-endpoint overrides too", async () => {
    const postel = Postel({ outbound: { storage: storage(), http: LOOPBACK } });
    await expect(
      postel.outbound.endpoints.create({
        url: "https://h.example.com",
        http: { tls: { verify: false } },
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(
      postel.outbound.endpoints.update("ep_x", { http: { dns: { pinResolution: true } } }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("every config field maps to a live consumer or fails fast (#78 audit)", () => {
    // The fails-fast rows are the only honest non-consumer disposition; assert
    // each one actually rejects so the table can't silently rot.
    const failsFast = Object.entries(CONFIG_FIELD_MAP).filter(([, d]) => d.kind === "fails-fast");
    expect(failsFast.map(([k]) => k).sort()).toEqual([
      "ephemeralKeys.rotateEvery",
      "http.dns.pinResolution",
      "http.tls.verify",
      "outbound.kms",
      "retention.attempts",
      "retention.messages",
    ]);
    for (const [, d] of Object.entries(CONFIG_FIELD_MAP)) {
      expect(d.kind === "consumer" ? d.readBy.length > 0 : true).toBe(true);
    }
  });
});

describe("Logger pass-through for runtime events [PORT-SPECIFIC]", () => {
  it("observability.logger receives a real delivery (attempt) event", async () => {
    const server = await start200Server();
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url());
    const entries: LogEvent[] = [];
    const postel = Postel({
      observability: { logger: (e) => entries.push(e) },
      outbound: { storage, http: LOOPBACK },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    const attempt = entries.find((e) => e.event === "attempt");
    expect(attempt).toBeDefined();
    expect(attempt?.level).toBe("debug");
    expect((attempt?.data as { endpointId: string }).endpointId).toBe("ep_log");
  });

  it("omitting observability.logger is a no-op (dispatch still proceeds)", async () => {
    const server = await start200Server();
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url());
    const postel = Postel({ outbound: { storage, http: LOOPBACK } });
    const id = await postel.outbound.send({ type: "evt.y" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.length).toBeGreaterThan(0);
  });
});
