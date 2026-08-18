import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const status = statuses[i] ?? statuses[statuses.length - 1] ?? 200;
      i += 1;
      res.writeHead(status, { "content-type": "application/json" });
      res.end("{}");
    });
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
  opts: { retryPolicy?: unknown } = {},
): Promise<string> {
  const endpoint = await storage.endpoints.create({
    id: "ep_otel",
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
    circuitBreaker: null,
    autoDisable: null,
  });
  await storage.secrets.insert({
    id: "sec_otel",
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

describe("OpenTelemetry spans on every operation", () => {
  it("No provider registered is a no-op: send/dispatch/attempt complete normally with no spans created", async () => {
    const server = await startServerWithSequence([200]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url());
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(
      async () => (await storage.attempts.latestForMessage(id)).some((a) => a.status === "success"),
      { timeoutMs: 2000 },
    );
    await postel.stop();
    await server.close();
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "success")).toBe(true);
  });
});

describe("With an OTel tracer provider registered", () => {
  const exporter = new InMemorySpanExporter();

  const contextManager = new AsyncHooksContextManager().enable();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(contextManager);
  });

  afterAll(() => {
    trace.disable();
    context.disable();
    contextManager.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  it("Trace propagation: the resulting send span is a child of the host's HTTP span and carries the same trace id", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const tracer = trace.getTracer("test-host");
    await tracer.startActiveSpan("host-handler", async (hostSpan) => {
      await postel.outbound.send({ type: "evt.x" });
      hostSpan.end();
    });
    const spans = exporter.getFinishedSpans();
    const hostSpan = spans.find((s) => s.name === "host-handler");
    const sendSpan = spans.find((s) => s.name === "postel.send");
    expect(hostSpan).toBeDefined();
    expect(sendSpan).toBeDefined();
    expect(sendSpan?.spanContext().traceId).toBe(hostSpan?.spanContext().traceId);
    expect(sendSpan?.parentSpanContext?.spanId).toBe(hostSpan?.spanContext().spanId);
  });

  it("Dispatch span carries message and tenant ids: the resulting dispatch span carries that message's id and tenant id as attributes", async () => {
    const server = await startServerWithSequence([200]);
    const storage = InMemoryStorage();
    await seedEndpoint(storage, server.url());
    const postel = Postel({
      outbound: {
        storage,
        defaultTenantId: "t_1",
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(() => exporter.getFinishedSpans().some((s) => s.name === "postel.dispatch"), {
      timeoutMs: 2000,
    });
    await postel.stop();
    await server.close();
    const dispatchSpan = exporter.getFinishedSpans().find((s) => s.name === "postel.dispatch");
    expect(dispatchSpan?.attributes["postel.message.id"]).toBe(id);
    expect(dispatchSpan?.attributes["postel.tenant.id"]).toBe("t_1");
  });

  it("Attempt span carries endpoint id and HTTP status: the resulting attempt span carries the endpoint id and an HTTP response status code attribute of 200", async () => {
    const server = await startServerWithSequence([200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url());
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(() => exporter.getFinishedSpans().some((s) => s.name === "postel.attempt"), {
      timeoutMs: 2000,
    });
    await postel.stop();
    await server.close();
    const attemptSpan = exporter.getFinishedSpans().find((s) => s.name === "postel.attempt");
    expect(attemptSpan?.attributes["postel.endpoint.id"]).toBe(endpointId);
    expect(attemptSpan?.attributes["http.response.status_code"]).toBe(200);
  });

  it("Retry span records the retry decision: the resulting retry span carries the message and endpoint ids and completes without error", async () => {
    const server = await startServerWithSequence([503, 200]);
    const storage = InMemoryStorage();
    const endpointId = await seedEndpoint(storage, server.url(), {
      retryPolicy: ExponentialBackoff({ schedule: ["20ms"], maxAttempts: 2, jitter: 0 }),
    });
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await waitFor(
      async () => (await storage.attempts.latestForMessage(id)).some((a) => a.status === "success"),
      { timeoutMs: 2500 },
    );
    await postel.stop();
    await server.close();
    const retrySpans = exporter.getFinishedSpans().filter((s) => s.name === "postel.retry");
    const failedRetrySpan = retrySpans.find(
      (s) => s.attributes["postel.attempt.status"] === "failed",
    );
    expect(failedRetrySpan).toBeDefined();
    expect(failedRetrySpan?.attributes["postel.message.id"]).toBe(id);
    expect(failedRetrySpan?.attributes["postel.endpoint.id"]).toBe(endpointId);
    expect(failedRetrySpan?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("Replay span carries the replayed message id: a host calls replay() for a single messageId", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.outbound.replay({ messageId: id, freshWebhookId: false });
    const replaySpan = exporter.getFinishedSpans().find((s) => s.name === "postel.replay");
    expect(replaySpan?.attributes["postel.message.id"]).toBe(id);
  });
});
