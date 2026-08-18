<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/public/brand/postel-mark-dark.svg">
    <img alt="Postel" src="./docs/public/brand/postel-mark-light.svg" width="96" height="96">
  </picture>
</p>

<h1 align="center">Postel</h1>

<p align="center">
  <em>Be conservative in what you send, liberal in what you accept.</em><br>
  — Jon Postel, RFC 793
</p>

**Sending and receiving webhooks is easy. Doing it reliably and securely is hard** — retries, replay, signing, key rotation, idempotency, raw-bytes preservation. That's where Postel comes in: a polyglot library that handles those for you. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified end-to-end by the [`@postel/compliance`](compliance/README.md) test suite.

<p align="center">
  <img alt="Atomic-outbox demo: kill -9 mid-transaction rolls back the business write and the send() together, then the same transaction left to commit delivers the webhook" src="./docs/public/launch/atomic-outbox-demo.gif" width="760">
</p>

<p align="center"><sub>The business write and <code>send()</code> share one Prisma transaction — <code>kill -9</code> mid-flight rolls both back, nothing half-commits. Live in <a href="./typescript/examples/nextjs-prisma">examples/nextjs-prisma</a>: <code>pnpm demo:crash</code> / <code>pnpm demo:happy-path</code>. Raw <a href="./docs/public/launch/atomic-outbox-demo.cast">asciinema cast</a> alongside the GIF.</sub></p>

[Standard Webhooks](https://www.standardwebhooks.com/) compliant, sender + receiver, runs inside your application against your existing relational database (Postgres, MySQL, SQLite, …) — no separate service, no Redis, no message broker.

## Status

Pre-alpha, TypeScript-only. The TypeScript port has a working sender and receiver, 8 storage adapters, and a green [`@postel/compliance`](compliance/README.md) suite — but nothing has shipped a `1.0` yet and the public API can still change. Go, Python, and Rust ports haven't started. See [`VISION.md`](./VISION.md) for the top-level positioning, scope, and success criteria; detailed specs live under [`openspec/specs/`](./openspec/specs/) and [`specs/`](./specs/).

## Try it

```bash
pnpm add @postel/core @postel/hono
```

```ts
import { Postel, Secret } from "@postel/core";
import { HonoWebAdapter, POSTEL_CONTEXT_KEY } from "@postel/hono";

const postel = Postel({
  inbound: { stripe: { verify: Secret(process.env.STRIPE_SECRET) } },
});
const hwa = HonoWebAdapter(postel, app);

hwa.inbound.stripe.post("/webhooks/stripe", (c) => {
  const { event } = c.get(POSTEL_CONTEXT_KEY); // verified · raw bytes intact
  return c.json({ ok: true, type: event.type });
});

await postel.outbound.send({ type: "order.created", data: { id: 1 } });
```

Full docs, quickstart, and the framework/storage adapter list: **[postel.dev](https://postel.dev)**.

## Positioning

> **Svix is for when webhooks are your product.
> Postel is for when webhooks are a feature of your product.**

Postel does not compete with Svix or Hookdeck on customer-facing webhook portals, multi-region delivery, or 99.999% uptime SLAs. It targets a different audience: teams who want to add reliable outbound webhooks to an existing application without standing up a separate service, and single-binary OSS products that cannot run a Postgres + Redis + service sidecar in the first place.

Postel is a **library, not a service**. It will never have a hosted offering, never run a separate dispatcher process, never require Redis or a message broker, never ship a customer-facing portal as a packaged product. If you need any of that, use Svix or Hookdeck Outpost.

## Packages

TypeScript is the only port today. All packages below are published under `@postel/*`.

| Package | What it does |
|---|---|
| [`@postel/core`](typescript/packages/core) | Sender, receiver, types, and errors — the Postel TypeScript core. |
| [`@postel/http`](typescript/packages/http) | Framework-agnostic webhook HTTP core: verification gate, error-to-status policy, Fetch handler. |
| [`@postel/admin`](typescript/packages/admin) | Framework-agnostic admin HTTP handler builder. |
| [`@postel/express`](typescript/packages/frameworks/express) | Express middleware and admin handlers for the receiver. |
| [`@postel/fastify`](typescript/packages/frameworks/fastify) | Fastify plugin and admin handlers for the receiver. |
| [`@postel/hono`](typescript/packages/frameworks/hono) | Hono middleware and admin handlers for the receiver. |
| [`@postel/nestjs`](typescript/packages/frameworks/nestjs) | NestJS module, guard, and decorators that gate a route with a configured inbound source. |
| [`@postel/pg`](typescript/packages/storage/pg) | Standalone storage adapter — Postel owns the Postgres pool; zero-config drop-in. |
| [`@postel/mysql`](typescript/packages/storage/mysql) | Standalone storage adapter — Postel owns the MySQL pool; zero-config drop-in. |
| [`@postel/sqlite`](typescript/packages/storage/sqlite) | Standalone storage adapter — Postel owns the SQLite database; zero-config drop-in. |
| [`@postel/drizzle`](typescript/packages/storage/drizzle) | Storage adapter — host hands Postel a Drizzle instance (Postgres, MySQL, or SQLite). |
| [`@postel/kysely`](typescript/packages/storage/kysely) | Storage adapter — host hands Postel a Kysely query-builder instance. |
| [`@postel/prisma`](typescript/packages/storage/prisma) | Storage adapter — host hands Postel a PrismaClient instance. |
| [`@postel/typeorm`](typescript/packages/storage/typeorm) | Storage adapter — host hands Postel a TypeORM DataSource (Postgres, MySQL, or SQLite). |
| [`@postel/mikro-orm`](typescript/packages/storage/mikro-orm) | Storage adapter — host hands Postel a MikroORM EntityManager (Postgres, MySQL, or SQLite). |
| [`@postel/storage-helpers`](typescript/packages/storage/helpers) | Zero-DB-dependency helpers shared by every first-party and third-party storage adapter. |

## Specs (sources of truth)

| Layer | Source of truth | Format |
|---|---|---|
| Top-level positioning, scope, success criteria | [`VISION.md`](./VISION.md) | Markdown |
| Wire format | [`specs/wire-format/asyncapi.yaml`](./specs/wire-format/asyncapi.yaml) | AsyncAPI 3.0 |
| DB schema | [`specs/db-schema/0001_init.sql`](./specs/db-schema/0001_init.sql) | SQL DDL |
| Capability behaviors | [`openspec/specs/`](./openspec/specs/) | Markdown (per capability) |
| Architectural decisions | [`decisions/`](./decisions/) | Markdown ADRs |
| Behavioral oracle | [`@postel/compliance`](compliance/README.md) | Executable test suite |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the repository layout, dev environment setup ([mise](https://mise.jdx.dev)-based), the OpenSpec change workflow, the verification chain, and house conventions. Agentic tools (Claude Code, Codex, Cursor, Aider, Gemini, …) should also read [AGENTS.md](./AGENTS.md).

## Inspiration

Named after [Jon Postel](https://en.wikipedia.org/wiki/Jon_Postel), whose [Robustness Principle](https://en.wikipedia.org/wiki/Robustness_principle) (RFC 793, 1981) — *"be conservative in what you do, be liberal in what you accept from others"* — is the design philosophy this library embodies. Strict signing, deterministic timestamps, careful retry budgets on the way out; multi-secret tolerance, raw-bytes preservation, JWKS-based key discovery, helpful verifier errors on the way in.

## License

[MIT](./LICENSE)
