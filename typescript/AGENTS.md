# Postel — TypeScript port

> Per-language idioms for the TypeScript implementation. Read the repo-wide [AGENTS.md](../AGENTS.md) first — the workflow rules (spec is truth, OpenSpec for spec changes, 1:1 scenario-test mapping) apply here verbatim.

## Layout

```
typescript/
├── packages/                      # one folder per published @postel/* package
│   ├── core/                      # @postel/core
│   ├── edge/                      # @postel/edge
│   ├── standalone-pg/             # @postel/standalone-pg
│   ├── standalone-sqlite/         # @postel/standalone-sqlite
│   ├── drizzle/                   # @postel/drizzle
│   ├── prisma/                    # @postel/prisma
│   ├── kysely/                    # @postel/kysely
│   ├── storage-helpers/           # @postel/storage-helpers
│   ├── express/                   # @postel/express
│   ├── hono/                      # @postel/hono
│   ├── fastify/                   # @postel/fastify
│   ├── nextjs/                    # @postel/nextjs
│   ├── bun/                       # @postel/bun
│   ├── admin/                     # @postel/admin
│   ├── effect/                    # @postel/effect
│   ├── test/                      # @postel/test
│   └── cli/                       # @postel/cli
├── package.json                   # pnpm workspace root; private; not published
├── pnpm-workspace.yaml            # includes packages/* AND ../compliance
├── tsconfig.base.json             # strict, ES2022, NodeNext
├── turbo.json                     # build / test / lint / typecheck pipeline
├── biome.json                     # single-tool lint + format
└── AGENTS.md                      # this file
```

The 18-package map is normative — see [`openspec/specs/distribution-packaging-typescript/spec.md`](../openspec/specs/distribution-packaging-typescript/spec.md). Adding or removing a package requires an OpenSpec change against that capability.

### Why `@postel/compliance` lives outside `typescript/packages/`

`@postel/compliance` ships as one of the 18 npm packages in the map, but its source lives at the **repo root** in [`compliance/`](../compliance/) — not under `typescript/packages/`. Per [ADR 0006](../decisions/0006-monorepo-layout.md), the compliance suite is a shared cross-language asset: every port's CI invokes it, the contract is language-agnostic, and the runner implementation is allowed to migrate or be re-implemented later without affecting the contract. The TypeScript runner is the first implementation, so the package is wired into this workspace via `../compliance` in `pnpm-workspace.yaml` — same TS toolchain, same `@postel/compliance` npm identity, but its on-disk home reflects that it doesn't belong to any single port.

## Runtimes

`@postel/core`, framework adapters, and storage adapters target **Node ≥ 20 LTS**, **Bun ≥ 1.0**, and **Deno ≥ 2.0**. `@postel/edge` additionally targets Cloudflare Workers, Vercel Edge, and Deno Deploy — no Node built-ins, no Postgres / SQLite imports, ≤ 50 KB minified+gzipped.

Decisions:
- Choose Web APIs (`fetch`, `crypto.subtle`, `TextEncoder`) over Node-specific equivalents unless a package is Node-only by design.
- Storage and framework packages MAY use Node APIs; the `edge` package MAY NOT.
- Workers / dispatcher / DB code MUST be tree-shakeable away from the receiver entry point — importing `verify` from `@postel/core` MUST NOT pull in worker or DB modules.

## Module format and exports

Every package ships **dual ESM + CJS** with TypeScript types, built by [tsup](https://tsup.egoist.dev):

```jsonc
// package.json (per-package)
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md"]
}
```

Packages are published **unminified** with source maps. The consumer's bundler minifies; node_modules stays human-readable for debugging.

## Storage adapters: the host-tx passthrough pattern

This is the single load-bearing pattern in the TS port. See [ADR 0007](../decisions/0007-storage-strategy.md) for the full rationale.

Every adapter is a thin shim over the host's existing DB client. Every write operation on the `Storage` interface accepts an optional `tx` parameter; when the host opens a transaction, that handle flows through to Postel's writes so the outbox insert commits or rolls back atomically with the host's business writes:

```ts
import { postelDrizzle } from "@postel/drizzle";
import { db } from "./db";

const postel = createPostel({ adapter: postelDrizzle(db) });

await db.transaction(async (tx) => {
  await tx.insert(orders).values({ /* ... */ });
  await postel.send({ type: "order.created", data: { /* ... */ } }, { tx });
});
```

Adapter authoring rules:

1. **Never open your own connection.** The host hands you `db` (or `tx`). Use it verbatim.
2. **Pass `tx` through every write operation.** If the caller provides one, the adapter MUST execute against it; otherwise execute against the long-lived handle.
3. **Declare your category in `package.json`** under `postel.adapter.category` (one of `standalone | client | orm`). Standalone adapters own a connection; client and orm adapters do not.
4. **Declare capabilities at construction time.** `capabilities.notify`, `capabilities.subscribe`, `capabilities.transactional`, `capabilities.streaming`. The worker scheduler reads these and degrades gracefully when something's absent.
5. **Operation-shaped, not CRUD.** Hot-path primitives (`reserveBatch`, `insertOrReuseByIdempotencyKey`, streaming `rangeQuery`) can't be expressed cleanly as generic CRUD.

## Error class hierarchy

Per [`api-surface-typescript`](../openspec/specs/api-surface-typescript/spec.md), every public failure mode throws a typed class derived from `PostelError`. Each subclass has:

- A **PascalCase class name** (e.g., `SignatureInvalid`, `TimestampTooOld`).
- A stable **`code` property** in SCREAMING_SNAKE_CASE matching the cross-port error vocabulary in the `receiver` spec (e.g., `SIGNATURE_INVALID`, `TIMESTAMP_TOO_OLD`).
- Discoverable via `instanceof` AND via `err.code === "X"` checks.

The canonical class ↔ code mapping lives in the capability spec — adding a new error class adds both names atomically. Drift between the class table and the receiver error-code list is a bug.

Never discriminate errors by message string. Class identity and the stable `code` are the only public contracts.

## Workflow inside this port

```bash
cd typescript
pnpm install            # set up workspace + devDependencies
pnpm typecheck          # turbo run typecheck across all packages
pnpm test               # turbo run test (vitest)
pnpm lint               # biome check .
pnpm lint:fix           # biome check --write .
pnpm build              # turbo run build (tsup; ESM + CJS + types)
```

Top-level mise tasks delegate to these (`mise run typecheck`, `mise run test`, `mise run lint`, `mise run build`).

For the spec ↔ test ↔ implementation loop, follow the parent [AGENTS.md](../AGENTS.md) §"Per-capability implementation loop". Test descriptions MUST include the requirement title verbatim — `scripts/check-spec-drift.mjs` greps test files for that string.

## House conventions

- **Strict TypeScript only.** No `any`, no `@ts-ignore`, no `as unknown as`. If the types don't line up, fix the types — don't escape them.
- **No barrel re-exports of internal modules.** Each package's `src/index.ts` exports only the public surface; everything else is internal.
- **No emojis** in code, commit messages, or PRs unless the user explicitly asks.
- **No explanatory comments.** Well-named identifiers carry the meaning. Only comment a hidden invariant, a workaround for a specific bug, or a non-obvious constraint.
- **One logical change per PR.** Don't bundle unrelated edits.
- **No release-side commands.** `npm publish` is gated through CI on tagged commits — never from a working tree.

## When in doubt

Re-read the capability spec under [`openspec/specs/<cap>/spec.md`](../openspec/specs/). If the answer isn't there, the spec needs an update — open an OpenSpec change. The toolchain decisions are recorded in [ADR 0010 — TypeScript toolchain](../decisions/0010-typescript-toolchain.md).
