import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const { InMemoryStorage, Postel } = await import("../src/index.js");

interface MockServer {
  port: number;
  requestCount(): number;
  close(): Promise<void>;
}

async function startMockServer(): Promise<MockServer> {
  let count = 0;
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    count++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("DNS rebinding protection", () => {
  afterEach(() => {
    lookupMock.mockReset();
  });

  it("Pinned IP: a hostname re-resolved after the SSRF check still reaches the originally checked address", async () => {
    const server = await startMockServer();
    // Endpoint creation and dispatch each run their own SSRF check (2 real
    // lookups). Any lookup beyond that would only happen if the connection
    // re-resolved the hostname instead of using the pinned IP — simulate a
    // rebind by pointing it at an address nothing listens on.
    lookupMock
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValue([{ address: "203.0.113.254", family: 4 }]);

    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    const endpoint = await postel.outbound.endpoints.create({
      url: `http://pin-test.invalid:${server.port}/hook`,
      allowHttp: true,
      types: ["evt.x"],
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();

    expect(server.requestCount()).toBe(1);
    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "success")).toBe(true);
    expect(endpoint.id).toBeTruthy();
  });
});
