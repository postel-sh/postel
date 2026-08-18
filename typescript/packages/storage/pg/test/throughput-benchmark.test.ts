import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { InProcess, Postel } from "@postel/core";
import { describe, expect, it } from "vitest";

import type { PgPool } from "../src/index.js";
import { PgStorage } from "../src/index.js";

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Real-Postgres tier, same POSTEL_PG_TESTCONTAINERS gate as testcontainers.test.ts
// (Docker required). Covers `openspec/specs/sender/spec.md` "Worker throughput
// target" — the reference setup (4 in-process workers, one Postgres node)
// sustaining the published deliveries/sec floor. See `mise run bench` for the
// full benchmark this floor was measured against.
if (process.env.POSTEL_PG_TESTCONTAINERS) {
  describe("Worker throughput target", () => {
    it("Throughput benchmark: 4 in-process workers sustain the published deliveries/sec floor against real Postgres", async () => {
      const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
      const { Pool } = await import("pg");
      const container = await new PostgreSqlContainer("postgres:16-alpine").start();
      const pool = new Pool({ connectionString: container.getConnectionUri(), max: 20 });
      pool.on("error", () => {
        // See typescript/scripts/bench.mjs — an idle-client error left
        // unhandled here would crash the test process.
      });

      let delivered = 0;
      const server = createServer((req, res) => {
        req.on("data", () => {});
        req.on("end", () => {
          delivered += 1;
          res.writeHead(200);
          res.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const storage = PgStorage({ pool: pool as unknown as PgPool, autoMigrate: true });
        const postel = Postel({
          outbound: {
            storage,
            workers: InProcess({ concurrency: 4 }),
            http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
          },
        });
        await postel.outbound.endpoints.create({
          url: `http://127.0.0.1:${port}/hook`,
          allowHttp: true,
        });

        const TOTAL = 300;
        const FLOOR_PER_SEC = 100;
        await postel.start();
        const start = performance.now();
        for (let i = 0; i < TOTAL; i++) {
          await postel.outbound.send({ type: "bench.event", data: { i } });
        }
        await waitUntil(() => delivered >= TOTAL, 30_000);
        const elapsedSec = (performance.now() - start) / 1000;
        await postel.stop();

        expect(TOTAL / elapsedSec).toBeGreaterThanOrEqual(FLOOR_PER_SEC);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
        await pool.end();
        await container.stop();
      }
    }, 60_000);
  });
} else {
  describe.skip("Worker throughput target — set POSTEL_PG_TESTCONTAINERS=1 (Docker) to run", () => {
    it("skipped without Docker", () => {});
  });
}
