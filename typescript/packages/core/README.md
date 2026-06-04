# @postel/core

> Sender, receiver, types, and errors — the Postel TypeScript core.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the `@postel/compliance` test suite.

## Status

**0.0.0** — receiver runtime works through the new factory; sender runtime lands in v0.2.0+. Calling any `postel.outbound.*` method throws `NotImplementedError` until then. Types are complete on both sides so adopters can wire up against the eventual shape today.

`NotImplementedError` is **intentionally outside** the `PostelError` hierarchy — it describes library state ("this method's runtime hasn't shipped in your installed version"), not webhook semantics. Adopters who write `if (err instanceof PostelError) return 4xx` will *not* catch it, which is correct: a `NotImplementedError` is a programming/version error and should bubble as a 5xx (or fail-fast in development). It still carries a stable `code: "NOT_IMPLEMENTED"` for adopters who explicitly want to discriminate it.

## Shape

```ts
import {
  Postel,
  Secret,
  PublicKey,
  Keyset,
  InMemoryDedup,
  HmacV1,
  ExponentialBackoff,
  InProcess,
  AwsKms,
} from "@postel/core";

const postel = Postel({
  observability: { logger, otel },

  // Sender — types ship today, runtime in v0.2.0+
  outbound: {
    storage: DrizzleStorage(db),      // implements Storage
    signing: HmacV1(),                // org-wide default; overridable per endpoint
    retryPolicy: ExponentialBackoff(),
    workers: InProcess({ concurrency: 4 }),
    kms: AwsKms({ keyId: "arn:aws:kms:..." }),
    http: { tls: { verify: true }, requestTimeout: "30s" },
  },

  // Receiver — fully functional
  inbound: {
    github: { verify: Secret(process.env.GH_SECRET!), dedup: InMemoryDedup() },
    stripe: { verify: Keyset({ jwksUri: "https://api.stripe.com/.well-known/jwks.json" }) },
    api:    { verify: [Secret(LEGACY_HMAC), Keyset({ jwksUri: NEW_JWKS })] },
  },
});

// Verify (today):
const { event, matchedVerifierIndex } = await postel.inbound.github.verify(body, headers);

// Dedup (today):
await postel.inbound.github.dedup(event.id, { ttl: "1h" });

// Send (v0.2.0+ — throws NotImplementedError until then):
await postel.outbound.send({ type: "order.created", data: order }, { tx });

// Lifecycle (always available):
await postel.start();
const health = await postel.health();
await postel.stop();
```

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
| `inbound.<source>.dedup` | `InMemoryDedup()`, `DrizzleDedup(db)`, `PostgresDedup(db)`, `RedisDedup(redis)`, ... |
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
- KMS adapter implementations — wired via the `AwsKms`, `GcpKms`, `Vault` strategy factories; runtime lands with sender in v0.2.0+.
- Effect-TS layer — deferred past 1.0 until a real Effect adopter drives the layer shape.

## License

MIT
