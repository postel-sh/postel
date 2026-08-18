# Show HN draft

Not for submission by an agent — the human submits this, once the [launch checklist](./checklist.md) dependency clears. Draft only.

## Title

```
Show HN: Postel – webhooks that roll back with your database transaction
```

Rejected alternatives, and why: generic "embeddable webhook library" framing is what the two flopped Show HNs (2 and 3 points) and at least five copycat repos already say — it reads as a commodity. The title above leads with the one property no competitor demos: the outbox row rolling back inside your own transaction.

## First comment

Two prior Show HNs for "self-hosted webhook sending/receiving" landed at 2 and 3 points this year — the pitch is commoditized; at least five zero-star clones of it exist on GitHub right now. So instead of re-pitching "webhooks as a feature," here's the one thing I haven't seen another webhook library do:

`postel.outbound.send()` runs inside the same database transaction as your business write. Kill the process mid-transaction — `kill -9`, no graceful shutdown — and the order row and the outbox message roll back together. Nothing half-commits, nothing gets silently dropped between "we wrote the order" and "we told the dispatcher about it." That gap is exactly where Svix, Hookdeck Outpost, Convoy, and a hand-rolled BullMQ worker all have to make an HTTP or Redis call *after* your commit — a separate step that can fail independently. Postel doesn't have that step, because there's nothing to call: it's a library, not a service.

The demo (GIF + asciinema in the [README](https://github.com/postel-sh/postel#readme), runnable yourself in [`examples/nextjs-prisma`](https://github.com/postel-sh/postel/tree/main/typescript/examples/nextjs-prisma) via `pnpm demo:crash` / `pnpm demo:happy-path`) shows exactly that: a Prisma transaction opens, writes an `Order`, calls `send()`, gets SIGKILLed mid-flight — and both the order and the outbox message are gone on reconnect. The same transaction left to commit delivers the webhook end to end.

It's [Standard Webhooks](https://www.standardwebhooks.com/) compliant on both ends (so anything that already verifies Svix-style signatures verifies Postel's), and that compliance is enforced by a cross-language test suite (`@postel/compliance`) rather than asserted — the same suite runs against every port as they land (Go, Python, Rust are next). Past that, raw request bytes are preserved end to end so signature verification never operates on a re-serialized body, and secret/key rotation is multi-key from day one (no "add key, remove key, hope nothing was mid-flight" race).

What it deliberately doesn't do: no separate dispatcher process, no required broker (Redis/RabbitMQ/Kafka), no customer-facing portal, no multi-region/five-nines SLA. If you need any of those, Svix or Hookdeck Outpost are the right tool — Postel is for when webhooks are a feature of your product, not the product. Longer version: [Is Postel for me?](https://postel.dev/docs/get-started/is-postel-for-me) and the [comparison page](https://postel.dev/docs/project/comparison).

TypeScript ships first (Postgres, MySQL, SQLite — standalone or through Prisma/Drizzle/Kysely/TypeORM/MikroORM). Repo, docs, and feedback all welcome — especially on where the transactional-outbox contract breaks down for your stack.
