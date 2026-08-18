#!/usr/bin/env node
//
// scripts/happy-path.mjs
//
// The other half of the atomic-outbox demo: commit-then-delivery. Runs the
// same business-write + send() transaction as the app's POST /api/orders
// route, lets it commit normally, and shows the in-process worker deliver
// the resulting webhook to a receiver — verified against this script's own
// JWKS, exactly like the Next.js app verifies against its own.
//
// Self-contained: spins up its own SQLite file and its own tiny HTTP server
// (JWKS + webhook receiver) on an ephemeral port, so it doesn't depend on
// `pnpm dev` already running.
//
// Usage: node scripts/happy-path.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  Ed25519V1a,
  ExponentialBackoff,
  InProcess,
  Keyset,
  Postel,
  PostelError,
} from "@postel/core";
import { PrismaStorage } from "@postel/prisma";
import { PrismaClient } from "../src/generated/prisma/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_DIR = resolve(ROOT, ".demo-tmp");
const DB_PATH = resolve(DB_DIR, "happy-path.db");
const DB_URL = `file:${DB_PATH}`;
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function resetDb() {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
}

function pushSchema() {
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function readHeaders(req) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
  }
  return out;
}

async function main() {
  resetDb();
  pushSchema();

  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  const storage = PrismaStorage({ prisma, dialect: "sqlite" });
  await storage.schemaVersion(); // migrate before the demo transaction opens

  const postel = Postel({
    inbound: {
      vendor: { verify: Keyset({ jwksUri: `${BASE_URL}/.well-known/webhooks-keys` }) },
    },
    outbound: {
      storage,
      signing: Ed25519V1a(),
      retryPolicy: ExponentialBackoff({ maxAttempts: 3 }),
      workers: InProcess({ concurrency: 1 }),
    },
  });

  let received;
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("receiver error:", err);
      res.writeHead(500).end();
    });
  });

  async function handleRequest(req, res) {
    const url = req.url ?? "/";
    if (url.startsWith("/.well-known/webhooks-keys")) {
      const jwks = await postel.outbound.keys.publicJwks();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    if (req.method === "POST" && url === "/webhooks/vendor") {
      const body = await readBody(req);
      try {
        const { event } = await postel.inbound.vendor.verify(body, readHeaders(req));
        received = event.data;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        const code = err instanceof PostelError ? err.code : "INTERNAL_ERROR";
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, code }));
      }
      return;
    }
    res.writeHead(404).end();
  }

  await new Promise((r) => server.listen(PORT, r));

  await postel.outbound.endpoints.create({
    url: `${BASE_URL}/webhooks/vendor`,
    types: ["order.created"],
    allowHttp: true,
    http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } },
  });

  await postel.start();

  console.log("committing business write + send() in one Prisma transaction...");
  const { order, messageId } = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { sku: "HAPPY-PATH", amountCents: 1_999 } });
    const result = await postel.outbound.send(
      { type: "order.created", data: { orderId: created.id, sku: created.sku } },
      { tx: /** @type {import("@postel/prisma").PrismaLike} */ (tx) },
    );
    return { order: created, messageId: result.id };
  });
  console.log(`committed: order ${order.id}, outbox message ${messageId} enqueued`);

  const deadline = Date.now() + 10_000;
  while (received === undefined && Date.now() < deadline) {
    await sleep(100);
  }

  await postel.stop();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
  rmSync(DB_DIR, { recursive: true, force: true });

  if (received === undefined) {
    console.error("FAIL: the webhook was never delivered within 10s");
    process.exit(1);
  }
  console.log("received on the webhook endpoint:", received);
  console.log("PASS: commit-then-delivery round trip verified");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
