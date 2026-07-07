import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type Clock,
  ExponentialBackoff,
  InMemoryStorage,
  InProcess,
  LinearBackoff,
  Postel,
  PostelError,
  type RetryStrategy,
} from "@postel/core";

function normalizeRetryPolicy(raw: unknown): RetryStrategy | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const obj = raw as {
    schedule?: ReadonlyArray<string | number>;
    step?: string | number;
    jitter?: number;
    maxAttempts?: number;
  };
  if (Array.isArray(obj.schedule)) {
    return ExponentialBackoff({
      schedule: obj.schedule,
      ...(obj.jitter !== undefined ? { jitter: obj.jitter } : {}),
      ...(obj.maxAttempts !== undefined ? { maxAttempts: obj.maxAttempts } : {}),
    });
  }
  if (obj.step !== undefined && obj.maxAttempts !== undefined) {
    return LinearBackoff({ step: obj.step, maxAttempts: obj.maxAttempts });
  }
  return undefined;
}

interface SenderHost {
  postel: ReturnType<typeof Postel<{ outbound: { storage: ReturnType<typeof InMemoryStorage> } }>>;
  storage: ReturnType<typeof InMemoryStorage>;
  endpointAliases: Map<string, string>;
  fixtures: Map<string, { algorithm: string; key_material: string }>;
  workersStarted: boolean;
  clock: Clock & { advance(ms: number): void };
}

// Wall-clock plus a control-plane offset: real time passes by default so a
// scheduled retry becomes due on its own (retry-schedule vectors assert the
// real inter-request gap via `arrived_within_ms`), while `/control/clock/advance`
// fast-forwards long waits (TTL expiry, overall deadlines) deterministically.
function controlClock(): Clock & { advance(ms: number): void } {
  let offsetMs = 0;
  return {
    now: () => new Date(Date.now() + offsetMs),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    advance: (ms: number) => {
      offsetMs += ms;
    },
  };
}

function buildPostel(
  storage: ReturnType<typeof InMemoryStorage>,
  clock: Clock,
  concurrency?: number,
): SenderHost["postel"] {
  return Postel({
    outbound: {
      storage,
      clock,
      http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      ...(concurrency !== undefined ? { workers: InProcess({ concurrency }) } : {}),
    },
  });
}

function newHost(): SenderHost {
  const clock = controlClock();
  const storage = InMemoryStorage({ clock });
  return {
    postel: buildPostel(storage, clock),
    storage,
    endpointAliases: new Map(),
    fixtures: new Map(),
    workersStarted: false,
    clock,
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface DriverServerOptions {
  readonly port?: number;
  readonly host?: string;
}

export interface DriverServer {
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

export async function startDriver(options: DriverServerOptions = {}): Promise<DriverServer> {
  let host = newHost();
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;
        const method = req.method ?? "GET";

        if (method === "GET" && path === "/control/info") {
          send(res, 200, {
            port_name: "typescript",
            port_version: "0.2.0-dev",
            suite_compat: "0.2",
            mock_receiver_required: true,
          });
          return;
        }

        if (method === "POST" && path === "/control/reset") {
          if (host.workersStarted) {
            await host.postel.stop();
          }
          host = newHost();
          send(res, 200, {});
          return;
        }

        if (method === "POST" && path === "/control/endpoints") {
          const body = (await readJson(req)) as {
            url: string;
            types?: string[];
            channels?: string[];
            signing?: { fixture_id?: string };
            retryPolicy?: unknown;
            headers?: Record<string, string>;
            http?: unknown;
            allowHttp?: boolean;
            tenantId?: string;
            as?: string;
          };
          const retryPolicy = normalizeRetryPolicy(body.retryPolicy);
          const ep = await host.postel.outbound.endpoints.create({
            url: body.url,
            // Fixtures own the signing material below; auto-minting a secret here
            // would add a second signature that no compliance vector expects.
            provisionSecret: false,
            ...(body.types !== undefined ? { types: body.types } : {}),
            ...(body.channels !== undefined ? { channels: body.channels } : {}),
            ...(retryPolicy !== undefined ? { retryPolicy } : {}),
            ...(body.headers !== undefined ? { headers: body.headers } : {}),
            ...(body.http !== undefined ? { http: body.http as never } : {}),
            ...(body.allowHttp !== undefined ? { allowHttp: body.allowHttp } : {}),
            ...(body.tenantId !== undefined ? { tenantId: body.tenantId } : {}),
          });
          if (body.signing?.fixture_id !== undefined) {
            const fixture = host.fixtures.get(body.signing.fixture_id);
            if (fixture) {
              await host.storage.secrets.insert({
                id: `sec_${ep.id}`,
                endpointId: ep.id,
                algorithm: fixture.algorithm === "ed25519" ? "v1a" : "v1",
                status: "primary",
                priority: 0,
                encryptedValue: new TextEncoder().encode(fixture.key_material),
                notAfter: null,
              });
            }
          }
          if (body.as !== undefined) host.endpointAliases.set(body.as, ep.id);
          send(res, 200, { endpointId: ep.id });
          return;
        }

        if (method === "POST" && path === "/control/send") {
          const body = (await readJson(req)) as {
            type: string;
            data?: unknown;
            channels?: string[];
            idempotencyKey?: string;
            ttl?: string;
            tenantId?: string;
          };
          const event: {
            type: string;
            data?: unknown;
            channels?: string[];
            idempotencyKey?: string;
            ttl?: string;
            tenantId?: string;
          } = { type: body.type };
          if (body.data !== undefined) event.data = body.data;
          if (body.channels !== undefined) event.channels = body.channels;
          if (body.idempotencyKey !== undefined) event.idempotencyKey = body.idempotencyKey;
          if (body.ttl !== undefined) event.ttl = body.ttl;
          if (body.tenantId !== undefined) event.tenantId = body.tenantId;
          const { id: messageId } = await host.postel.outbound.send(event);
          send(res, 200, { messageId });
          return;
        }

        if (method === "POST" && path === "/control/workers/start") {
          if (!host.workersStarted) {
            const body = (await readJson(req)) as { concurrency?: number };
            if (body.concurrency !== undefined) {
              // Rebuild the outbound runtime with the requested worker count over
              // the same storage/clock (no dispatch happens until start()).
              host.postel = buildPostel(host.storage, host.clock, body.concurrency);
            }
            await host.postel.start();
            host.workersStarted = true;
          }
          send(res, 200, {});
          return;
        }

        if (method === "POST" && path === "/control/clock/advance") {
          const body = (await readJson(req)) as { to_iso8601?: string; ms?: number };
          if (body.to_iso8601 !== undefined) {
            const target = new Date(body.to_iso8601);
            const delta = target.getTime() - host.clock.now().getTime();
            if (delta > 0) host.clock.advance(delta);
          } else if (body.ms !== undefined) {
            host.clock.advance(body.ms);
          }
          send(res, 200, {});
          return;
        }

        if (method === "POST" && path === "/control/keys/install") {
          const body = (await readJson(req)) as {
            id: string;
            algorithm: string;
            key_material: string;
          };
          host.fixtures.set(body.id, {
            algorithm: body.algorithm,
            key_material: body.key_material,
          });
          send(res, 200, {});
          return;
        }

        const match = /^\/control\/messages\/(.+)$/.exec(path);
        if (method === "GET" && match) {
          const messageId = match[1] as string;
          const attempts = await host.storage.attempts.latestForMessage(messageId);
          send(res, 200, { attempts });
          return;
        }

        send(res, 404, { error: "not_found" });
      } catch (err) {
        if (err instanceof PostelError) {
          // Validation / protocol failures map to a 4xx the runner classifies as
          // a structured reject — not an internal server error.
          res.setHeader("X-Postel-Verify-Error", err.code);
          send(res, 422, { error_code: err.code, error: err.message });
          return;
        }
        send(res, 500, { error: (err as Error).message });
      }
    })();
  });

  const port = options.port ?? 0;
  const bindHost = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(port, bindHost, resolve));
  const addr = server.address() as AddressInfo;
  const finalPort = addr.port;
  return {
    port: finalPort,
    url: `http://${bindHost}:${finalPort}`,
    stop: async () => {
      // Always close the HTTP server, even if stopping the workers rejects, so
      // stop() can't hang or leak an unhandled rejection; surface either failure.
      try {
        if (host.workersStarted) await host.postel.stop();
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
      }
    },
  };
}
