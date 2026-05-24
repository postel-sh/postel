# 0001 — Library shape: no service, no broker

- **Status**: Accepted
- **Date**: 2026-05-09
- **Decision drivers**: positioning, target persona reach, edge-runtime support, single-binary OSS use case, operational footprint

## Context

The webhook-delivery space has two dominant shapes: **services** (Svix, Hookdeck Outpost) that you stand up alongside your application, and **hand-rolled solutions** glued together on top of an existing job queue. Both have well-known trade-offs.

A service shape requires standing up a dispatcher process, a message broker (typically Redis), and operational tooling around them. It crosses a significant ops cliff — non-trivial setup, monitoring, on-call surface — for teams whose webhook traffic is a *feature* of their product, not the product itself.

A hand-rolled shape forces every team to reimplement signing, idempotency, raw-bytes preservation, key rotation, JWKS, replay, and dead-letter handling on top of their queue.

We also serve two specific personas that the service shape excludes outright:

- **Edge / serverless runtimes** (Cloudflare Workers, Vercel Edge, Deno Deploy, Bun). These environments can't reach a Redis instance natively and can't host a dispatcher process.
- **Single-binary OSS products** (Plausible-, Pocketbase-, Cal.com-style). These projects cannot ship a Redis dependency to their users.

## Decision

Postel is a **library only**. It runs inside the host application, against the host application's database, with no separate process and no broker dependency.

Concretely:

- **No global state, no implicit boot sequence.** The host calls `Postel({ db, ... })` to get an instance.
- **Workers run in-process by default.** A separate worker process pointing at the same DB is supported but optional.
- **No Redis, RabbitMQ, Kafka, or any message broker.** Persistence and worker coordination use the host's existing relational database (Postgres, MySQL, SQLite, …) directly.
  - Outbox is a SQL table, drained by workers using `FOR UPDATE SKIP LOCKED` (Postgres) or `BEGIN IMMEDIATE` (SQLite).
  - Low-latency dispatch on Postgres uses `LISTEN`/`NOTIFY`; SQLite polls.
  - Optional adapters for BullMQ, pg-boss, and similar host-supplied queues exist for hosts that already run one; none is a required dependency.
- **No customer-facing portal** as a packaged product. The library exposes admin HTTP handlers the host mounts on its own router; hosts build their own UI if they want one.
- **No managed service, no commercial entity** behind it.

## Consequences

- We compete on simplicity and ergonomics, not on operational independence or multi-region replication.
- Throughput is bounded by the host DB's IOPS budget, not a separate broker. Benchmarks publish per release.
- Receivers run on edge runtimes natively without polyfills or proxy services.
- Teams whose webhook traffic outgrows a single library instance graduate to Svix or similar — that handoff is acceptable and the docs name it explicitly.
- The library MUST be high-quality enough to be trusted at the heart of someone else's product.

## Alternatives considered

- **Service shape with optional embedding mode** — rejected. The two shapes have different operational ergonomics and trying to be both produces neither well.
- **Sidecar process** — rejected. A sidecar is a service in disguise; same operational cliff.
- **Redis as a required dependency** — rejected. Ops cliff for the B2B SaaS persona; impossible for edge / single-binary personas.
- **Embedded broker** (e.g., NATS embedded) — rejected. Still a separate moving part even if it lives in our process.
- **Cloud-specific queue-trigger model** — rejected. Couples the library to specific cloud-provider primitives and fails the multi-stack reach we need.
