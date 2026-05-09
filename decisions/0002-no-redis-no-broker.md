# 0002 — No Redis, no broker dependency

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: AR-1 (library, not framework), NFR-C-5, edge runtime support, single-binary OSS use case

## Context

Conventional outbound-webhook stacks rely on a message broker for the queue: Redis (Bull/BullMQ), RabbitMQ, Kafka, or proprietary equivalents. The broker provides retry scheduling, durable storage, and worker coordination.

For Postel's target personas (B2B SaaS adding webhooks as a feature, edge/serverless engineers, OSS single-binary maintainers), requiring Redis or any broker is the difference between "drop in a library" and "stand up another piece of infrastructure." Cloudflare Workers can't reach a Redis instance natively; OSS single-binary projects (Plausible, Pocketbase, Cal.com style) cannot ship a Redis dependency.

## Decision

The library SHALL NOT require Redis, RabbitMQ, Kafka, or any message broker. Persistence and worker coordination use the host's existing relational database (Postgres or SQLite) directly.

- Outbox is a SQL table, drained by workers using `FOR UPDATE SKIP LOCKED` (Postgres) or `BEGIN IMMEDIATE` (SQLite).
- Low-latency dispatch on Postgres uses `LISTEN`/`NOTIFY`; SQLite polls.
- Optional adapters for BullMQ and pg-boss exist for hosts that want to reuse an existing queue; neither is a required dependency.

## Consequences

- Postgres and SQLite are first-class; other RDBMSes plug in via the BYO storage interface.
- Throughput is bounded by the host DB's IOPS budget, not a separate broker. Benchmarks publish per release.
- Receivers run on edge runtimes natively without polyfills or proxy services.

## Alternatives considered

- **Redis as required dependency** — rejected for ops cliff and edge incompatibility.
- **Embedded broker (e.g., NATS embedded)** — rejected; adds a process even if embedded.
- **Cloud-only "queue trigger" model** — rejected; couples the library to specific cloud provider primitives.
