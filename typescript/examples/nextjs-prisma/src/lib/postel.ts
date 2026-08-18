import type { Prisma } from "@/generated/prisma";
import { Ed25519V1a, ExponentialBackoff, InProcess, Keyset, Postel } from "@postel/core";
import { type PrismaLike, PrismaStorage } from "@postel/prisma";
import { prisma } from "./prisma";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

export const vendorWebhookUrl = `${baseUrl}/api/webhooks/vendor`;
export const jwksUrl = `${baseUrl}/.well-known/webhooks-keys`;

// `PrismaStorage`'s declared `prisma` option is nominally `@prisma/client`'s
// own `PrismaClient` — but this schema (like every schema in this workspace)
// generates a project-local client (see prisma/schema.prisma's `output`) so
// pnpm's shared @prisma/client install isn't clobbered by whichever schema
// last ran `generate`. The two client classes are structurally identical
// (same raw-query surface) but not nominally the same type, so TS rejects a
// direct pass; deriving the expected type from `PrismaStorage` itself avoids
// depending on `@prisma/client`'s types at all.
type ExpectedPrismaClient = Parameters<typeof PrismaStorage>[0]["prisma"];
const storage = PrismaStorage({
  prisma: prisma as unknown as ExpectedPrismaClient,
  dialect: "sqlite",
});

export const postel = Postel({
  inbound: {
    vendor: { verify: Keyset({ jwksUri: jwksUrl }) },
  },
  outbound: {
    storage,
    signing: Ed25519V1a(),
    retryPolicy: ExponentialBackoff({ maxAttempts: 5 }),
    workers: InProcess({ concurrency: 2 }),
  },
});

// Prisma's interactive-transaction client (the `tx` a `$transaction` callback
// receives) structurally omits `$transaction` itself — nested transactions
// aren't a thing. `PrismaStorage` never calls `tx.$transaction` when a host
// tx is already supplied (see its `atomic()` helper), so the cast is safe.
export function asPostelTx(tx: Prisma.TransactionClient): PrismaLike {
  return tx as unknown as PrismaLike;
}

// Module-scoped guards so Next.js's per-request dev reloads don't spin up a
// second worker pool or migrate the schema from inside an open transaction
// (see the demo scripts for why migrating mid-transaction can hang).
const globalForPostel = globalThis as unknown as { postelStarted?: Promise<void> };

export function ensureStarted(): Promise<void> {
  if (!globalForPostel.postelStarted) {
    // Sequential, not `Promise.all`: `postel.start()` kicks off the worker
    // loop immediately, which calls back into the same storage and would
    // race the migration below (both see `migrated === false` and run the
    // DDL twice).
    globalForPostel.postelStarted = storage.schemaVersion().then(() => postel.start());
  }
  return globalForPostel.postelStarted;
}

export async function ensureDemoEndpoint() {
  const existing = await postel.outbound.endpoints.list({ limit: 1 });
  if (existing.items.length > 0) return existing.items[0];
  return postel.outbound.endpoints.create({
    url: vendorWebhookUrl,
    types: ["order.created"],
    allowHttp: true,
    // Loopback is in the default SSRF-blocked ranges — this app sends
    // webhooks to itself, so it opts back in explicitly rather than
    // disabling the guard globally.
    http: { ssrf: { allowedRanges: ["127.0.0.0/8", "::1/128"] } },
  });
}
