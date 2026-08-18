#!/usr/bin/env node
//
// typescript/scripts/bench.mjs
//
// Sender benchmark harness for issue #143 — measures the two numbers the
// sender spec claims (openspec/specs/sender/spec.md "Send latency budget" and
// "Worker throughput target") against a real reference setup: a single
// Postgres node (via testcontainers) and 4 in-process workers
// (`InProcess({ concurrency: 4 })`), dispatching to a local mock HTTP
// receiver that always returns 200 immediately.
//
// Methodology:
//   1. Latency: fire BENCH_LATENCY_SENDS concurrent `send()` calls, record
//      wall-clock time per call, report p50/p95/p99 added latency.
//   2. Throughput: with dispatch running, enqueue BENCH_THROUGHPUT_SENDS
//      events back-to-back and measure deliveries/sec at the mock receiver
//      from first to last delivery.
//
// Machine assumptions: whatever machine runs `mise run bench` — this is a
// local/CI-runner number, not a controlled-hardware SLA. The printed report
// states the assumptions inline (Node version, CPU count) so numbers are
// comparable across runs.
//
// Env vars:
//   BENCH_LATENCY_SENDS      -- concurrent send() calls for the latency run (default 10000)
//   BENCH_THROUGHPUT_SENDS   -- events enqueued for the throughput run (default 20000)
//   BENCH_JSON_OUT           -- if set, path to write the machine-readable JSON report

import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus } from "node:os";

import { InProcess, Postel, PostelError } from "@postel/core";
import { PgStorage } from "@postel/pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

const LATENCY_SENDS = Number(process.env.BENCH_LATENCY_SENDS ?? 10_000);
const THROUGHPUT_SENDS = Number(process.env.BENCH_THROUGHPUT_SENDS ?? 20_000);

function percentile(sortedMs, p) {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(idx, 0)];
}

async function startMockReceiver() {
  const deliveryTimestamps = [];
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      deliveryTimestamps.push(performance.now());
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    deliveryTimestamps,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function waitUntil(predicate, { timeoutMs, intervalMs = 25 }) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  console.log(`postel sender benchmark — node ${process.version}, ${cpus().length} logical CPUs`);
  console.log(
    "reference setup: 1 Postgres node (testcontainers postgres:16-alpine), 4 in-process workers",
  );

  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 20 });
  // pg.Pool emits "error" on an idle client's connection failure; unhandled,
  // that's an uncaught exception that kills the whole benchmark run.
  pool.on("error", (err) => console.error("pg pool idle-client error:", err.message));
  const storage = PgStorage({ pool, autoMigrate: true });
  const receiver = await startMockReceiver();

  try {
    const postel = Postel({
      outbound: {
        storage,
        workers: InProcess({ concurrency: 4 }),
        http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
      },
    });
    await postel.outbound.endpoints.create({ url: receiver.url, allowHttp: true });

    // --- Latency: added overhead of send() itself, no dispatch running yet.
    const latenciesMs = [];
    await Promise.all(
      Array.from({ length: LATENCY_SENDS }, async (_, i) => {
        const t0 = performance.now();
        await postel.outbound.send({ type: "bench.event", data: { i } });
        latenciesMs.push(performance.now() - t0);
      }),
    );
    latenciesMs.sort((a, b) => a - b);
    const latencyReport = {
      sends: LATENCY_SENDS,
      p50Ms: percentile(latenciesMs, 50),
      p95Ms: percentile(latenciesMs, 95),
      p99Ms: percentile(latenciesMs, 99),
    };

    // --- Throughput: dispatch running, drain a fresh batch of events.
    await postel.start();
    const throughputStart = performance.now();
    for (let i = 0; i < THROUGHPUT_SENDS; i++) {
      await postel.outbound.send({ type: "bench.event", data: { i } });
    }
    await waitUntil(() => receiver.deliveryTimestamps.length >= THROUGHPUT_SENDS, {
      timeoutMs: 120_000,
    });
    const throughputEnd = receiver.deliveryTimestamps[receiver.deliveryTimestamps.length - 1];
    const wallSeconds = (throughputEnd - throughputStart) / 1000;
    const throughputReport = {
      deliveries: THROUGHPUT_SENDS,
      wallSeconds,
      deliveriesPerSec: THROUGHPUT_SENDS / wallSeconds,
    };
    await postel.stop();

    const report = {
      node: process.version,
      cpus: cpus().length,
      postgres: "postgres:16-alpine (testcontainers)",
      workers: 4,
      latency: latencyReport,
      throughput: throughputReport,
    };

    console.log("\n--- Send latency (added overhead, concurrent send() calls) ---");
    console.log(
      `sends=${latencyReport.sends} p50=${latencyReport.p50Ms.toFixed(2)}ms p95=${latencyReport.p95Ms.toFixed(2)}ms p99=${latencyReport.p99Ms.toFixed(2)}ms`,
    );
    console.log("\n--- Delivery throughput (sustained, 4 in-process workers) ---");
    console.log(
      `deliveries=${throughputReport.deliveries} wall=${throughputReport.wallSeconds.toFixed(2)}s throughput=${throughputReport.deliveriesPerSec.toFixed(1)} deliveries/sec`,
    );

    if (process.env.BENCH_JSON_OUT) {
      await writeFile(process.env.BENCH_JSON_OUT, JSON.stringify(report, null, 2));
      console.log(`\nwrote ${process.env.BENCH_JSON_OUT}`);
    }
  } finally {
    await receiver.close();
    await pool.end();
    await container.stop();
  }
}

main().catch((err) => {
  console.error(err instanceof PostelError ? err.message : err);
  process.exitCode = 1;
});
