import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ExponentialBackoff, Postel } from "../src/index.js";
import { InMemoryStorage } from "../src/index.js";
import { waitFor } from "./wait-for.js";

const SAMPLE_SECRET = "whsec_ZGVtby1zZWNyZXQtZm9yLXBvc3RlbC10ZXN0LXBhZGRpbmc=";

interface MockServer {
  url(): string;
  close(): Promise<void>;
}

async function startServerWithSequence(statuses: number[]): Promise<MockServer> {
  let i = 0;
  const handler = (_req: IncomingMessage, res: ServerResponse): void => {
    const status = statuses[i] ?? statuses[statuses.length - 1] ?? 200;
    i += 1;
    res.writeHead(status, { "content-type": "application/json" });
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
  opts: { retryPolicy?: unknown; circuitBreaker?: unknown } = {},
): Promise<string> {
  const endpoint = await storage.endpoints.create({
    id: "ep_metrics",
    tenantId: null,
    url,
    state: "active",
    types: null,
    channels: null,
    filter: null,
    retryPolicy: opts.retryPolicy ?? null,
    headers: null,
    signing: null,
    metadata: null,
    allowHttp: true,
    maxInflight: null,
    http: null,
    circuitBreaker: opts.circuitBreaker ?? null,
    autoDisable: null,
  });
  await storage.secrets.insert({
    id: "sec_metrics",
    endpointId: endpoint.id,
    algorithm: "v1",
    status: "primary",
    priority: 0,
    material: new TextEncoder().encode(SAMPLE_SECRET),
    encryption: "plaintext",
    notAfter: null,
  });
  return endpoint.id;
}

const LOOPBACK = { ssrf: { allowedRanges: ["127.0.0.0/8"] } };

// `labels` is an index-signature type; a non-literal key sidesteps both tsc's
// noPropertyAccessFromIndexSignature and biome's useLiteralKeys.
function label(
  sample: { readonly labels: Readonly<Record<string, string>> },
  key: string,
): string | undefined {
  return sample.labels[key];
}

describe("Prometheus metrics", () => {
  it('Outbox depth metric: webhook_outbox_depth{tenant_id="t_42"} reads 42', async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    for (let i = 0; i < 42; i += 1) {
      await postel.outbound.send({ type: "evt.x", tenantId: "t_42" });
    }
    const snapshot = await postel.metrics();
    const sample = snapshot.webhook_outbox_depth.find((s) => label(s, "tenant_id") === "t_42");
    expect(sample?.value).toBe(42);
  });

  it("Send counter increments per event type: postel.metrics() reports webhook_send_total as 2 for {tenant_id: t_1, event_type: order.created}", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    await postel.outbound.send({ type: "order.created", tenantId: "t_1" });
    await postel.outbound.send({ type: "order.created", tenantId: "t_1" });
    const snapshot = await postel.metrics();
    const sample = snapshot.webhook_send_total.find(
      (s) => label(s, "tenant_id") === "t_1" && label(s, "event_type") === "order.created",
    );
    expect(sample?.value).toBe(2);
  });

  it("Attempt duration histogram observes dispatch latency: postel.metrics() reports a webhook_attempt_duration_seconds sample for the endpoint", async () => {
    const server = await startServerWithSequence([200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url());
    const postel = Postel({ outbound: { storage, http: LOOPBACK } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(
      async () => (await storage.attempts.latestForMessage(id)).some((a) => a.status === "success"),
      { timeoutMs: 2000 },
    );
    await postel.stop();
    await server.close();
    const snapshot = await postel.metrics();
    const sample = snapshot.webhook_attempt_duration_seconds.find(
      (s) => label(s, "endpoint_id") === endpointId,
    );
    expect(sample?.count).toBeGreaterThanOrEqual(1);
    expect(sample?.sum).toBeGreaterThanOrEqual(0);
  });

  it("Success ratio reflects attempt outcomes: postel.metrics() reports webhook_attempt_success_ratio as 0.75 for that endpoint", async () => {
    const server = await startServerWithSequence([503, 200, 200, 200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({ outbound: { storage, http: LOOPBACK } });
    const statuses: string[] = [];
    postel.on("attempt", (p) => statuses.push(p.status));
    await postel.start();
    for (let i = 0; i < 4; i += 1) {
      await postel.outbound.send({ type: "evt.x" });
      await waitFor(() => statuses.length > i, { timeoutMs: 2000 });
    }
    await postel.stop();
    await server.close();
    const snapshot = await postel.metrics();
    const sample = snapshot.webhook_attempt_success_ratio.find(
      (s) => label(s, "endpoint_id") === endpointId,
    );
    expect(sample?.value).toBe(0.75);
  });

  it("Dead-letter counter increments on exhaustion: postel.metrics() reports webhook_dead_letter_total incremented by 1 for that endpoint", async () => {
    const server = await startServerWithSequence([503]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 1, jitter: 0 }),
    });
    const postel = Postel({ outbound: { storage, http: LOOPBACK } });
    const deadLetters: unknown[] = [];
    postel.on("dead-letter", (p) => deadLetters.push(p));
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(() => deadLetters.length > 0, { timeoutMs: 2000 });
    await postel.stop();
    await server.close();
    const snapshot = await postel.metrics();
    const sample = snapshot.webhook_dead_letter_total.find(
      (s) => label(s, "endpoint_id") === endpointId,
    );
    expect(sample?.value).toBe(1);
  });

  it("Circuit state gauge reflects open/close transitions: postel.metrics() reports webhook_endpoint_circuit_state as 1 while open and 0 once closed", async () => {
    const server = await startServerWithSequence([503, 200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 5, jitter: 0 }),
      circuitBreaker: { threshold: 1, cooldown: "100ms" },
    });
    const postel = Postel({ outbound: { storage, http: LOOPBACK } });
    const opens: unknown[] = [];
    postel.on("circuit-open", (p) => opens.push(p));
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(() => opens.length > 0, { timeoutMs: 2000 });
    const midSnapshot = await postel.metrics();
    const openSample = midSnapshot.webhook_endpoint_circuit_state.find(
      (s) => label(s, "endpoint_id") === endpointId,
    );
    expect(openSample?.value).toBe(1);

    await waitFor(
      async () => (await storage.attempts.latestForMessage(id)).some((a) => a.status === "success"),
      { timeoutMs: 4000 },
    );
    await postel.stop();
    await server.close();
    const finalSnapshot = await postel.metrics();
    const closedSample = finalSnapshot.webhook_endpoint_circuit_state.find(
      (s) => label(s, "endpoint_id") === endpointId,
    );
    expect(closedSample?.value).toBe(0);
  });

  it("No outbound configured reports empty metrics: postel.metrics() resolves with every metric array empty rather than rejecting", async () => {
    const postel = Postel({});
    const snapshot = await postel.metrics();
    expect(snapshot).toEqual({
      webhook_send_total: [],
      webhook_attempt_duration_seconds: [],
      webhook_attempt_success_ratio: [],
      webhook_dead_letter_total: [],
      webhook_outbox_depth: [],
      webhook_endpoint_circuit_state: [],
    });
  });
});
