# Postel — nextjs-prisma example

> Runnable reference app: a minimal SaaS that sends and receives webhooks with [Postel](https://github.com/postel-sh/postel), centered on the atomic-outbox demo — a business write and `send()` sharing one Prisma transaction.

## What's here

- `POST /api/orders` — creates an `Order` row **and** calls `postel.outbound.send()` inside the same `prisma.$transaction`. Either both commit or neither does.
- `POST /api/webhooks/vendor` — receives that webhook back and verifies it against this app's own JWKS.
- `GET /.well-known/webhooks-keys` — this app's JWKS document (Ed25519 v1a signing; no shared secret to manage).
- `scripts/crash-demo.mjs` — kills the process mid-transaction and proves the rollback: neither the `Order` row nor the outbox message survives.
- `scripts/happy-path.mjs` — the same transaction left to commit normally, followed by delivery to a receiver: commit-then-delivery, end to end.

Storage is SQLite via `@postel/prisma` (`dialect: "sqlite"`) — zero external infra, so the round trip below runs offline.

## Quickstart

```bash
cp .env.example .env   # local SQLite path + base URL — no secrets, but .env itself stays gitignored
pnpm install
pnpm dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"sku": "WIDGET-1", "amountCents": 1999}'
```

The dev server logs the delivered webhook (`[webhooks/vendor] received order.created …`) within a second or two — that's the round trip: business write → commit → in-process worker → signed delivery → verified receipt.

## The atomic-outbox demo

```bash
pnpm demo:crash       # kills the process mid-transaction, proves the rollback
pnpm demo:happy-path  # same transaction, left to commit — then delivered
```

Both scripts are self-contained (their own SQLite file under `.demo-tmp/`, their own JWKS-backed receiver) — no dev server required.

`crash-demo.mjs` spawns a child process that opens the transaction, creates the order, calls `send()`, and then hangs forever, so the transaction is guaranteed to still be open no matter when the SIGKILL actually lands. The parent kills it, then reconnects and asserts both the `Order` row and the outbox message are absent.

## Consuming `@postel/*` today vs. once published

This example depends on `@postel/core` and `@postel/prisma` via the pnpm workspace protocol (`workspace:*`) because it lives inside the monorepo. Outside this repo, swap those for the published versions:

```diff
- "@postel/core": "workspace:*",
- "@postel/prisma": "workspace:*",
+ "@postel/core": "^0.x",
+ "@postel/prisma": "^0.x",
```

then `npm install` (or your package manager of choice) instead of relying on the workspace link.

## Gotchas

- Prisma's interactive-transaction client (`tx` inside `$transaction`) structurally omits `$transaction` itself, which `@postel/prisma`'s `PrismaLike` type declares. It's never called when a host `tx` is already supplied, so `src/lib/postel.ts` exports `asPostelTx()` — a documented cast, not a silent `any`.
- `PrismaStorage`'s auto-migration runs on the root Prisma client, not on an open `tx`. Both the app (`ensureStarted()`) and the demo scripts force it once, before opening the business transaction — running it from inside the transaction would contend with the same connection's write lock.

## License

MIT
