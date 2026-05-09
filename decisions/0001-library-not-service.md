# 0001 — Library, not service

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: positioning (§1.3 of original spec), operational footprint, target persona reach

## Context

The webhook-delivery space has two dominant shapes: **services** (Svix, Hookdeck Outpost) that you stand up alongside your application, and **hand-rolled solutions** glued together on top of an existing job queue. Both have well-known trade-offs.

A service shape requires standing up a dispatcher process, a message broker (typically Redis), and operational tooling around them. It crosses a significant ops cliff — non-trivial setup, monitoring, on-call surface — for teams whose webhook traffic is a feature of their product, not the product itself.

A hand-rolled shape forces every team to reimplement signing, idempotency, raw-bytes preservation, key rotation, JWKS, replay, and dead-letter handling on top of their queue.

## Decision

Postel ships as a **library only**. It runs inside the host application, against the host application's database, with no separate process required by default.

Concretely:
- No global state, no implicit boot sequence — the host calls `createPostel({ db, ... })` to get an instance.
- Workers run in-process by default; a separate worker process pointing at the same DB is supported.
- No Redis, RabbitMQ, Kafka, or message broker is required.
- No customer-facing portal as a packaged product.
- No managed service, no commercial entity behind it.

## Consequences

- We compete on simplicity and ergonomics, not on operational independence or multi-region replication.
- Teams whose webhook traffic outgrows a single library instance will graduate to Svix or similar — that handoff is acceptable and the docs name it explicitly.
- The library MUST be high-quality enough to be trusted at the heart of someone else's product.

## Alternatives considered

- **Service shape with optional embedding mode** — rejected. The two shapes have different operational ergonomics and trying to be both produces neither well.
- **Sidecar process** — rejected. A sidecar is a service in disguise; same operational cliff.
