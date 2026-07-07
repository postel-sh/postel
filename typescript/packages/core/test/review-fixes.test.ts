import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ExponentialBackoff, Postel } from "../src/index.js";

import { InMemoryStorage } from "../src/index.js";

const SAMPLE_SECRET = "whsec_ZGVtby1zZWNyZXQtZm9yLXBvc3RlbC10ZXN0LXBhZGRpbmc=";

interface Rec {
  status: number;
  path: string | undefined;
}

async function startServer(
  responder: (path: string | undefined) => number,
): Promise<{ url(): string; hits(): Rec[]; close(): Promise<void> }> {
  const hits: Rec[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const status = responder(req.url);
    hits.push({ status, path: req.url });
    res.writeHead(status, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: () => `http://127.0.0.1:${addr.port}`,
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function insertSecret(
  storage: ReturnType<typeof InMemoryStorage>,
  endpointId: string,
): Promise<void> {
  await storage.secrets.insert({
    id: `sec_${endpointId}`,
    endpointId,
    algorithm: "v1",
    status: "primary",
    priority: 0,
    encryptedValue: new TextEncoder().encode(SAMPLE_SECRET),
    notAfter: null,
  });
}

async function tick(ms = 150): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("Late-binding fanout", () => {
  it("a succeeded endpoint is not re-delivered while a sibling endpoint retries", async () => {
    const ok = await startServer(() => 200);
    let flakyHits = 0;
    const flakySrv = await startServer(() => {
      flakyHits += 1;
      return flakyHits >= 2 ? 200 : 503;
    });

    const storage = InMemoryStorage();
    const epOk = await storage.endpoints.create({
      id: "ep_ok",
      tenantId: null,
      url: ok.url(),
      state: "active",
      types: ["evt.x"],
      channels: null,
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 3, jitter: 0 }),
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: true,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await insertSecret(storage, epOk.id);
    const epFlaky = await storage.endpoints.create({
      id: "ep_flaky",
      tenantId: null,
      url: flakySrv.url(),
      state: "active",
      types: ["evt.x"],
      channels: null,
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 3, jitter: 0 }),
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: true,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await insertSecret(storage, epFlaky.id);

    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await ok.close();
    await flakySrv.close();

    // The healthy endpoint must receive exactly one delivery even though the
    // flaky endpoint forced the message to stay pending across a retry.
    expect(ok.hits().length).toBe(1);
    const attempts = await storage.attempts.latestForMessage(id);
    const okAttempts = attempts.filter((a) => a.endpointId === epOk.id);
    expect(okAttempts.length).toBe(1);
    expect(okAttempts[0]?.status).toBe("success");
  });

  it("a filtered endpoint records one attempt, not one per sibling retry", async () => {
    const flakySrv = await startServer(() => 503);
    const storage = InMemoryStorage();
    const epFiltered = await storage.endpoints.create({
      id: "ep_filtered",
      tenantId: null,
      url: flakySrv.url(),
      state: "active",
      types: ["other.event"],
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
    await insertSecret(storage, epFiltered.id);
    const epFlaky = await storage.endpoints.create({
      id: "ep_flaky",
      tenantId: null,
      url: flakySrv.url(),
      state: "active",
      types: ["evt.x"],
      channels: null,
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 3, jitter: 0 }),
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: true,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await insertSecret(storage, epFlaky.id);
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    await flakySrv.close();

    const attempts = await storage.attempts.latestForMessage(id);
    const filtered = attempts.filter(
      (a) => a.endpointId === epFiltered.id && a.status === "filtered",
    );
    // The flaky sibling forced several reservations; the filtered endpoint must
    // be re-evaluated each time but recorded only once.
    expect(filtered.length).toBe(1);
    const flakyAttempts = attempts.filter((a) => a.endpointId === epFlaky.id);
    expect(flakyAttempts.length).toBeGreaterThan(1);
  });

  it("a disabled endpoint receives no HTTP delivery and records a skipped attempt", async () => {
    const server = await startServer(() => 200);
    const storage = InMemoryStorage();
    const ep = await storage.endpoints.create({
      id: "ep_disabled",
      tenantId: null,
      url: server.url(),
      state: "disabled",
      types: ["evt.x"],
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
    await insertSecret(storage, ep.id);
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(250);
    await postel.stop();
    await server.close();
    expect(server.hits().length).toBe(0);
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "skipped" && a.error === "ENDPOINT_DISABLED")).toBe(
      true,
    );
  });
});

describe("Transform produces body to send", () => {
  it("a transform configured via endpoints.create reshapes the outgoing body", async () => {
    let received: unknown;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200);
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}/hook`;

    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const ep = await postel.outbound.endpoints.create({
      url,
      types: ["order.created"],
      allowHttp: true,
      transform: (event) => ({ summary: `order ${(event as { data: { id: string } }).data.id}` }),
    });
    await insertSecret(storage, ep.id);
    await postel.outbound.send({ type: "order.created", data: { id: "ord_9" } });
    await postel.start();
    await tick(300);
    await postel.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    expect(received).toEqual({ summary: "order ord_9" });
  });

  it("a predicate filter configured via endpoints.create suppresses non-matching events", async () => {
    const server = await startServer(() => 200);
    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const ep = await postel.outbound.endpoints.create({
      url: server.url(),
      types: ["order.created"],
      allowHttp: true,
      filter: (event) => (event as { data?: { vip?: boolean } }).data?.vip === true,
    });
    await insertSecret(storage, ep.id);
    await postel.outbound.send({ type: "order.created", data: { vip: false } });
    await postel.start();
    await tick(250);
    await postel.stop();
    await server.close();
    expect(server.hits().length).toBe(0);
  });
});

describe("URL validation at create time", () => {
  it("updating an endpoint to an http:// URL without allowHttp is rejected", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const ep = await postel.outbound.endpoints.create({
      url: "https://example.com/hook",
    });
    await expect(
      postel.outbound.endpoints.update(ep.id, { url: "http://example.com/hook" }),
    ).rejects.toThrow(/HTTPS-required/);
  });
});

describe("Per-message TTL", () => {
  it("a numeric ttl is interpreted as seconds, not milliseconds", async () => {
    const server = await startServer(() => 200);
    const storage = InMemoryStorage();
    const ep = await storage.endpoints.create({
      id: "ep_ttl_secs",
      tenantId: null,
      url: server.url(),
      state: "active",
      types: ["evt.x"],
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
    await insertSecret(storage, ep.id);
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    // ttl: 60 must mean 60 seconds. If it were 60ms the message would expire
    // before the worker (which starts ~tens of ms later) ever dispatches it.
    const { id } = await postel.outbound.send({ type: "evt.x", ttl: 60 });
    await postel.start();
    await tick(250);
    await postel.stop();
    await server.close();
    expect(server.hits().length).toBe(1);
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "expired")).toBe(false);
    expect(attempts.some((a) => a.status === "success")).toBe(true);
  });
});

describe("SSRF protection on outbound delivery", () => {
  it("an ssrf-blocked attempt is retried (message stays pending) until the schedule is exhausted", async () => {
    const storage = InMemoryStorage();
    // Inserted directly (bypassing create-time validation) so the block happens
    // at dispatch. No allowlist → 10.0.0.5 is refused on every attempt.
    const ep = await storage.endpoints.create({
      id: "ep_ssrf_retry",
      tenantId: null,
      url: "http://10.0.0.5/hook",
      state: "active",
      types: ["evt.x"],
      channels: null,
      retryPolicy: ExponentialBackoff({ schedule: ["50ms"], maxAttempts: 2, jitter: 0 }),
      headers: null,
      signing: null,
      metadata: null,
      allowHttp: true,
      maxInflight: null,
      http: null,
      circuitBreaker: null,
      autoDisable: null,
    });
    await insertSecret(storage, ep.id);
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(400);
    await postel.stop();
    const attempts = await storage.attempts.latestForMessage(id);
    // First attempt ssrf-blocked, then a retry, then dead-letter on exhaustion —
    // proving the message was NOT finalized after the first ssrf-blocked.
    expect(attempts.filter((a) => a.status === "ssrf-blocked").length).toBeGreaterThanOrEqual(1);
    expect(attempts.some((a) => a.status === "dead-letter")).toBe(true);
  });
});
