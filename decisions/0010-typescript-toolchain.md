# 0010 — TypeScript port toolchain

- **Status**: Accepted
- **Date**: 2026-05-13
- **Decision drivers**: contributor ergonomics, monorepo task orchestration, dual ESM+CJS publish discipline, low maintenance overhead, alignment with the TS ecosystem the target users already inhabit

## Context

[ADR 0006](0006-monorepo-layout.md) put the TypeScript port at `typescript/` as one of N sibling language roots. [ADR 0007](0007-storage-strategy.md) committed us to a Tier-1 adapter matrix that expands the package set to 18 published packages (`@postel/core`, `@postel/edge`, the storage adapters, framework adapters, and auxiliary packages — see [`distribution-packaging-typescript`](../openspec/specs/distribution-packaging-typescript/spec.md)).

That shape forces four toolchain decisions inside `typescript/`:

1. **Workspace manager** — how 18 packages share devDependencies and reference each other.
2. **Task runner** — how `pnpm typecheck` / `pnpm test` / `pnpm build` parallelize across packages and respect inter-package dependencies.
3. **Build tool** — every package must publish dual ESM + CJS with type definitions, unminified, with source maps. The library targets Node ≥ 20, Bun ≥ 1.0, Deno ≥ 2.0, and (for `@postel/edge`) Cloudflare Workers / Vercel Edge / Deno Deploy at ≤ 50 KB minified+gzipped.
4. **Lint + format + test runner** — the floor of dev-loop tooling.

This ADR records the choices and the alternatives considered, so the next contributor inherits the rationale and not just the configs.

## Decision

The TypeScript port uses:

| Concern | Tool | Version pin |
|---|---|---|
| Workspace manager | **pnpm workspaces** | `pnpm@10.x` via `packageManager` |
| Task runner | **Turborepo** | `turbo@2.x` |
| Build | **tsup** (esbuild-backed) | `tsup@8.x` |
| Lint + format | **Biome** | `@biomejs/biome@1.9.x` |
| Test runner | **Vitest** | `vitest@2.x` |
| TypeScript | **strict**, ES2022 target, NodeNext module resolution | `typescript@5.7.x` |

All TS-specific tooling lives inside `typescript/`. The repo root stays language-agnostic per [ADR 0006](0006-monorepo-layout.md); the top-level [`mise.toml`](../mise.toml) only delegates to `pnpm` inside `typescript/`.

### What the toolchain looks like in practice

```bash
# From the repo root:
mise run typecheck       # delegates to pnpm typecheck inside typescript/
mise run test            # delegates to pnpm test
mise run lint            # delegates to pnpm lint

# Or from inside typescript/:
pnpm install
pnpm typecheck           # turbo run typecheck → tsc --noEmit per package
pnpm test                # turbo run test → vitest run per package
pnpm build               # turbo run build → tsup per package (esm + cjs + dts)
pnpm lint                # biome check .
pnpm lint:fix            # biome check --write .
```

Per-package `package.json` `scripts` invoke the underlying tool directly (e.g., `"build": "tsup src/index.ts --format esm,cjs --dts --sourcemap --target es2022 --clean"`). Turbo orchestrates them at the workspace level with dependency-aware ordering and caching.

### Constraints the toolchain must satisfy

- **Dual ESM + CJS dual export with TypeScript types**, per `distribution-packaging-typescript` requirement *"ESM and CJS dual export, TypeScript types"*. tsup emits both `dist/index.js` (ESM) and `dist/index.cjs` (CJS) plus `dist/index.d.ts` from a single source.
- **Unminified, source-mapped publishes**, per requirement *"Published unminified for tooling readability"*. Consumers' bundlers minify; node_modules stays human-readable. tsup defaults to unminified; we pass `--sourcemap` explicitly.
- **Tree-shakeability**, per requirement *"Tree-shakeability"*. `@postel/core` must let bundlers eliminate worker / dispatcher / DB code from a `verify`-only import. Strict ESM output, `"sideEffects": false` where applicable (set per-package as code lands), and avoidance of barrel re-exports of internal modules.
- **`@postel/edge` bundle budget**, per the receiver capability — ≤ 50 KB minified+gzipped. Bundle-size CI enforcement comes when the package gains real code; the build tool needs to produce a measurable artifact, which tsup does.

### Per-package scripts

Each package's `package.json` carries the standard quartet:

```jsonc
"scripts": {
  "build": "tsup src/index.ts --format esm,cjs --dts --sourcemap --target es2022 --clean",
  "typecheck": "tsc --noEmit",
  "test": "vitest run --passWithNoTests",
  "clean": "rm -rf dist .turbo *.tsbuildinfo"
}
```

Turbo (`turbo.json`) ties them together with `dependsOn: ["^build"]` where appropriate and standard input/output globs for caching.

## Alternatives considered

### Workspace manager — pnpm vs npm vs Yarn vs Bun

- **pnpm** (chosen). Best disk efficiency through content-addressable store; strict default for peer dependencies; first-class workspaces; explicit hoisting model that avoids ghost-dependency surprises common with npm/yarn classic. The de-facto default for non-Bazel TS monorepos in 2024+ (Turborepo's own templates, Astro, Vue, Vite). Smooth interop with Turborepo. The `packageManager` field auto-installs the right version via corepack.
- **npm workspaces**. Ships with Node, no extra install. Weaker workspace UX, slower installs at our size, lockfile churn is noisier, and the lack of strict peer handling hides bugs we'd rather surface. Acceptable but inferior.
- **Yarn 4 (Berry)**. Plug'n'Play is technically interesting but breaks tools that expect a flat `node_modules` (lots of TS tooling still does). The `nodeLinker: node-modules` escape hatch works but at that point pnpm is a cleaner choice.
- **Bun workspaces**. Fast and pleasant. But Bun is one of three runtimes we must support, not the only one — using Bun as the workspace driver while testing against Node and Deno is awkward, and Bun's monorepo story (Sept 2024) is still maturing. Keep Bun as a runtime target via `@postel/bun`, not as the workspace manager.

### Task runner — Turborepo vs Nx vs custom shell

- **Turborepo** (chosen). Light-touch monorepo task runner with per-package config in `package.json`. Excellent caching (local and remote), dependency-aware task ordering, parallel execution, sensible defaults. Vendored by Vercel; the upstream momentum aligns with the rest of the TS-ecosystem tooling we've picked. Configures cleanly with pnpm workspaces.
- **Nx**. More opinionated, plugin-rich, comes with code generators. Stronger for orgs that adopt the Nx way end-to-end (project graphs, executors). Overkill at our package count and our explicit preference to keep tools shallow. Switching cost later is small if needed.
- **Custom shell + `pnpm -r --filter`**. No new tooling. Works at 5 packages; gets clumsy at 18 once you want dependency-aware ordering, parallelism, and caching. Reinventing Turbo poorly.
- **Bazel / Pants**. Already rejected at the repo level in [ADR 0006](0006-monorepo-layout.md).

### Build tool — tsup vs unbuild vs tsc vs Rollup vs esbuild-direct

- **tsup** (chosen). esbuild under the hood plus rollup-plugin-dts for declarations. One-line config; first-class dual ESM+CJS; reliable `.d.ts` emission; tree-shake-friendly; fast. The 80%-case TS library build tool — used by Mantine, tRPC, Drizzle, Vitest, Hono. Aligned with our consumer ecosystem.
- **unbuild** (UnJS). Similar in spirit. Less mainstream in non-Nuxt-adjacent communities. No technical objection; we go with the more-common tool to lower the surprise factor for outside contributors.
- **Plain `tsc`**. Emits ESM or CJS, not both atomically; dual-output requires either two tsconfigs and a post-merge step or a wrapper. Slower for larger packages. Acceptable for `@postel/cli` if it ever proves friction, but the tooling overhead of "tsc for some, tsup for others" exceeds the friction of "tsup everywhere".
- **Rollup directly**. Powerful but more config surface than we need. tsup is "Rollup + esbuild + sensible defaults" for the library-build case.
- **esbuild directly**. Fast and minimal. Doesn't emit declarations out of the box; you bolt on `tsc --emitDeclarationOnly` plus rollup-plugin-dts and end up reimplementing tsup. Skip.

### Lint + format — Biome vs ESLint + Prettier

- **Biome** (chosen). Single binary, Rust-implemented, sub-second feedback on the whole repo. Lints + formats + organizes imports out of the box. Stable as of 1.x; supersedes Rome. The ergonomic win at our scale is real: zero plugin sprawl, one config file, no Prettier-vs-ESLint conflict to mediate.
- **ESLint + Prettier**. The industry default for years; richer plugin ecosystem (typescript-eslint, plugin-jest, plugin-react). At our size and scope (library code, no UI), the ESLint plugin surface is more than we need. ESLint flat config is a churn point; the ecosystem hasn't fully settled. Biome covers the rules we actually want and stays out of the way.
- **Rationale for the choice over the more-mainstream ESLint + Prettier**: Biome's speed advantage compounds across 18 packages and N contributors. If we hit a rule Biome can't express (rare, but possible for typescript-eslint-only patterns), we add ESLint scoped to that one concern rather than flipping the entire toolchain.

### Test runner — Vitest vs Jest vs node:test vs Bun test

- **Vitest** (chosen). ESM-native, fast, Vite-powered, the de-facto modern TS test runner. Excellent watch mode, parallelism, snapshot, fixtures. Matches the runtimes our consumers use.
- **Jest**. Mature and feature-rich but ESM support is still rough; CJS-by-default conflicts with our ESM-first packages. Slower at scale.
- **`node:test`**. Standard-library test runner — appealing for a "no deps" stance. But the assertion ergonomics, watch mode, and fixture story are thinner than Vitest's; the friction shows up daily.
- **`bun test`**. Fast and pleasant. Same objection as "Bun workspaces" — Bun is one of three runtimes we must test against, not the test driver itself. We want to run the same tests under Node, Bun, and Deno where applicable; Vitest does that cleanly, `bun test` ties us to Bun-the-runtime.

## Consequences

- **Contributor onboarding** is `mise install` (root) → `cd typescript && pnpm install` → tests/typecheck/build run. No global tool installs beyond mise and Node.
- **CI pipelines** can rely on Turbo's cache for incremental builds; `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` are the four invocations the workflow files target.
- **Per-package configs stay thin.** A package's `package.json` carries scripts; `tsconfig.json` extends `tsconfig.base.json`; the build flags are inline. No per-package `tsup.config.ts` is needed for the common case. When a package needs to override (e.g., `@postel/edge` will likely want a minified-size-check variant), it adds a local `tsup.config.ts` and points its script at it.
- **Lockfile is `pnpm-lock.yaml`** at `typescript/pnpm-lock.yaml`. Committed.
- **Switching cost is low.** Each of these tools accepts roughly the same per-package shape (`src/index.ts`, `package.json` scripts, a tsconfig). Replacing tsup with unbuild, Turbo with Nx, or Biome with ESLint is a config-level migration rather than a structural one.

## Open questions

- **Changesets vs custom release pipeline.** Defer until the first release tag is cut. The current preference is [`changesets`](https://github.com/changesets/changesets) for the 18-package shared-major-version model, since [`distribution-packaging-typescript`](../openspec/specs/distribution-packaging-typescript/spec.md) requirement *"Shared major version across packages"* maps cleanly onto its fixed-bump mode. Final decision when a publish ADR lands.
- **Bundle-size CI enforcement** for `@postel/core` (≤ 250 KB) and `@postel/edge` (≤ 50 KB). Likely `size-limit` or a Turbo-pipelined post-build check. Lands when those packages gain code.
- **Whether to share a single Vitest config or keep per-package configs.** Vitest's workspace-config feature is mature; defer until tests actually exist.

## How this evolves

When a tool here proves friction in practice (slow turnaround, missing capability, ecosystem regression), open an ADR amendment with the symptom, the candidate replacement, and a migration plan. The toolchain is a tactical surface — these are the right defaults for 0.x; tactical replacements are expected and welcome as the port matures.
