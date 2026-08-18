# @postel/core

> Sender, receiver, types, and errors — the Postel TypeScript core.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the `@postel/compliance` test suite.

## Shape

Both the receiver and the sender ship in this package. Receiver-only consumers configure just `inbound`; sender-only consumers configure just `outbound` — conditional types mean `postel.outbound` / `postel.inbound` only exist on the instance if you configured them.

```ts
import {
  Postel,
  Secret,
  Keyset,
  InMemoryDedup,
  InMemoryStorage,
  HmacV1,
  ExponentialBackoff,
  InProcess,
} from "@postel/core";

const postel = Postel({
  observability: { logger },

  // Receiver
  inbound: {
    github: { verify: Secret(process.env.GH_SECRET!), dedup: InMemoryDedup() },
    stripe: { verify: Keyset({ jwksUri: "https://api.stripe.com/.well-known/jwks.json" }) },
  },

  // Sender — swap InMemoryStorage() for a durable adapter (@postel/pg, @postel/sqlite, …) in production
  outbound: {
    storage: InMemoryStorage(),
    signing: HmacV1(),                // org-wide default; overridable per endpoint
    retryPolicy: ExponentialBackoff({ maxAttempts: 8 }),
    workers: InProcess({ concurrency: 4 }),
  },
});

// Verify + dedup an inbound request:
const { event, matchedVerifierIndex } = await postel.inbound.github.verify(body, headers);
await postel.inbound.github.dedup(event.id, { ttl: "1h" });

// Register an endpoint and send:
await postel.outbound.endpoints.create({ url: "https://customer.example.com/webhooks", types: ["order.*"] });
await postel.outbound.send({ type: "order.created", data: order }, { tx });

// Lifecycle:
await postel.start();
const health = await postel.health();
await postel.stop();
```

See the [Quickstart](https://postel.dev/docs/get-started/quickstart) for the full walkthrough, or [Inbound](https://postel.dev/docs/inbound) / [Outbound](https://postel.dev/docs/outbound) for each half in depth.

## Configuration model

**Two independent sub-namespaces, both optional.** `postel.outbound` and `postel.inbound` only exist on the returned instance type if you configured them. Receiver-only consumers configure just `inbound`; outbound-only consumers configure just `outbound`. Conditional types enforce this at compile time.

```ts
const inboundOnly = Postel({ inbound: { github: { verify: Secret(s) } } });
// @ts-expect-error — outbound was not configured
inboundOnly.outbound;
```

**Strategy pattern for composable plug-points.** Verifiers, signing schemes, retry policies, worker backends, and KMS providers are all factory functions returning tagged config objects. Same shape across the API:

| Slot | Factories |
|---|---|
| `inbound.<source>.verify` | `Secret(s)`, `PublicKey(pk)`, `Keyset({ jwksUri })` — or an array for multi-verifier composition |
| `inbound.<source>.dedup` | `InMemoryDedup()` here; `PgDedup(...)`, `SqliteDedup(...)`, `MysqlDedup(...)` from the storage adapter packages |
| `outbound.signing` | `HmacV1()`, `Ed25519V1a()` |
| `outbound.retryPolicy` | `ExponentialBackoff({})`, `LinearBackoff({})`, `Custom({})` |
| `outbound.workers` | `InProcess({})`, `BullMQ(queue)`, `PgBoss(boss)`, `External(adapter)` |
| `outbound.kms` | `AwsKms({})`, `GcpKms({})`, `Vault({})`, `PlaintextKms()` |

**Multi-verifier composition** supports both HMAC rotation windows and cross-scheme (HMAC → Ed25519/JWKS) migration:

```ts
inbound: {
  vendor: { verify: [Secret(NEW_HMAC), Secret(OLD_HMAC)] },              // rotation
  api:    { verify: [Secret(LEGACY_HMAC), Keyset({ jwksUri: NEW })] },   // scheme migration
}
```

First match wins; `verify` returns `matchedVerifierIndex` so adopters can monitor migration progress.

**Per-endpoint overrides for outbound defaults.** `signing`, `retryPolicy`, `circuitBreaker`, `autoDisable`, and `http` are configured org-wide on `outbound.*` and overridable on each `endpoints.create({...})` call. Resolution: per-endpoint > org default > library default.

## What's not in this package

- Framework adapters (Express, Hono, Fastify, Next.js, Bun, …) — separate packages.
- Storage adapters (Drizzle, Prisma, Kysely, pg, sqlite, node-postgres, …) — separate packages.
- KMS adapter implementations — `AwsKms`, `GcpKms`, `Vault` are config-only strategy factories today; the runtime that actually calls out to a KMS provider hasn't landed yet.
- Effect-TS layer — deferred past 1.0 until a real Effect adopter drives the layer shape.

## License

MIT
