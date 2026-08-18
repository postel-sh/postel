#!/usr/bin/env node
//
// scripts/crash-demo.mjs
//
// Proves the atomic-outbox guarantee end to end: the business write (an
// `Order` row) and postel's `send()` share ONE Prisma transaction. This
// script spawns a child process that opens that transaction, creates the
// order, calls `send()`, prints a marker, and then hangs forever — so the
// transaction is guaranteed to still be open (uncommitted) no matter when
// the parent's SIGKILL actually lands. After the kill, a fresh connection to
// the same database file proves neither the business row nor the outbox
// message survived: the crash rolled back both together.
//
// Usage: node scripts/crash-demo.mjs

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Postel } from "@postel/core";
import { PrismaStorage } from "@postel/prisma";
import { PrismaClient } from "../src/generated/prisma/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_DIR = resolve(ROOT, ".demo-tmp");
const DB_PATH = resolve(DB_DIR, "crash-demo.db");
const DB_URL = `file:${DB_PATH}`;
const READY_MARKER = "READY_TO_DIE";

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

async function runChild() {
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  const storage = PrismaStorage({ prisma, dialect: "sqlite" });
  const postel = Postel({ outbound: { storage } });

  // Force the auto-migration (postel's own tables) now, on the root
  // connection — not from inside the transaction below, where it would
  // contend with the already-open write lock and hang for the wrong reason.
  await storage.schemaVersion();

  await prisma.$transaction(
    async (tx) => {
      const order = await tx.order.create({
        data: { sku: "CRASH-TEST", amountCents: 4_200 },
      });
      await postel.outbound.send(
        { type: "order.created", data: { orderId: order.id } },
        { tx: /** @type {import("@postel/prisma").PrismaLike} */ (tx) },
      );
      process.stdout.write(`${READY_MARKER}\n`);
      await new Promise(() => {}); // never resolves: the transaction must never commit
    },
    { timeout: 30_000 },
  );
}

async function verifyRollback() {
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  const [orderRow] = await prisma.$queryRawUnsafe('select count(*) as count from "Order"');
  const [messageRow] = await prisma.$queryRawUnsafe("select count(*) as count from messages");
  await prisma.$disconnect();

  const orders = Number(orderRow.count);
  const messages = Number(messageRow.count);
  console.log(`Order rows: ${orders}`);
  console.log(`outbox message rows: ${messages}`);

  if (orders !== 0 || messages !== 0) {
    console.error(
      "FAIL: the business write or the outbox message survived the crash — atomicity broke",
    );
    process.exit(1);
  }
  console.log("PASS: killed mid-transaction — the write and the send() rolled back together");
}

async function main() {
  if (process.argv[2] === "--child") {
    await runChild();
    return;
  }

  resetDb();
  pushSchema();

  console.log("spawning a child to open the transaction, write the order, and call send()...");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });

  await new Promise((readyResolve, reject) => {
    child.stdout?.on("data", (chunk) => {
      if (chunk.toString().includes(READY_MARKER)) readyResolve();
    });
    child.on("exit", (code) => {
      reject(new Error(`child exited before reaching the transaction (code ${code})`));
    });
    child.on("error", reject);
  });

  console.log("child is inside the open transaction — sending SIGKILL to its process group now");
  process.kill(-child.pid, "SIGKILL");
  await new Promise((exitResolve) => child.on("exit", exitResolve));

  await verifyRollback();
  rmSync(DB_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
