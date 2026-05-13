# 0006 — Polyglot monorepo layout

- **Status**: Accepted
- **Date**: 2026-05-11
- **Decision drivers**: spec ↔ port lockstep, compliance gate as the binding contract, single contributor mental model, atomic cross-language changes, ecosystem fit per language

## Context

[ADR 0005](0005-polyglot-staged-rollout.md) commits us to maintaining ports across TypeScript, Go, Python, and Rust, each gated on the compliance test suite. That decision raises an immediate structural question: do all the ports live in one repository or in sibling repositories?

The answer drives:
- Where shared specs (wire format, DB schema, capability behaviors, ADRs) live relative to language implementations.
- How the compliance suite is invoked from each language's CI.
- How a wire-format or schema change is delivered (one PR vs. N coordinated PRs).
- How contributors orient themselves to the project.

## Decision

Single monorepo with per-language top-level directories. Symmetric layout. No language-specific tooling at the root.

```
postel/
├── specs/                # shared (wire format, DB schema, compliance spec)
├── openspec/             # shared change/spec management
├── decisions/            # shared ADRs (this file lives here)
├── compliance/           # ONE implementation of the suite, invoked by every port's CI
├── typescript/           # TS port root (lands in a follow-up PR)
│   ├── packages/
│   │   ├── core/  edge/  postgres/  sqlite/  ...
│   ├── package.json      # workspaces — only TS tooling lives here, not at the root
│   └── AGENTS.md         # TS-idiomatic implementation guidance
├── go/                   # future
│   ├── go.mod
│   ├── receiver/  sender/
│   └── AGENTS.md
├── python/               # future
│   ├── pyproject.toml
│   └── AGENTS.md
├── rust/                 # future
│   ├── Cargo.toml
│   └── AGENTS.md
├── AGENTS.md             # repo-wide agent guidance (cross-agent standard)
├── CLAUDE.md             # @AGENTS.md import (Claude Code expands inline)
├── mise.toml             # tool versions + repo-level tasks
└── README.md
```

Key choices:

1. **`typescript/` at the same level as `go/`, `python/`, `rust/`.** Symmetric. Each language root carries its own ecosystem conventions inside (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`).

2. **No top-level `package.json`.** A polyglot repo's root must be language-agnostic. NPM-specific tooling lives inside `typescript/`. Top-level commands (running OpenSpec, drift checks, etc.) are organized via [mise](https://mise.jdx.dev) — a polyglot tool/task runner. `mise.toml` at root declares tool versions (Node, OpenSpec CLI) and tasks (`spec:validate`, `check:spec-drift`).

3. **`compliance/` at top level**, not under TS packages. It's a shared cross-language asset. The first implementation lives in TypeScript (Node CLI), invoked by every port's CI. The contract is language-agnostic; the implementation can move or be re-implemented later without affecting the contract.

4. **`AGENTS.md` is canonical agent guidance** (cross-agent standard). `CLAUDE.md` is a one-line `@AGENTS.md` import so Claude Code sees the same content. Per-language `AGENTS.md` files inside each language root cover ecosystem-specific implementation guidance.

5. **Per-language CODEOWNERS** — `/typescript/  @postel-sh/typescript-maintainers`, `/go/  @postel-sh/go-maintainers`, etc.

6. **Per-language CI path filters** — a `typescript/` PR doesn't trigger Go CI. Shared spec changes trigger all language jobs.

## Why monorepo

- **Spec ↔ port lockstep.** A wire-format change can update the AsyncAPI spec AND the ports in one PR, with the compliance suite gating the whole thing in CI. That's the entire point of the spec-first / executable-oracle setup.
- **Atomic cross-language changes.** When the wire format gains an extension (e.g., `webhook-version`), the same PR updates the AsyncAPI doc, the TS code, and (eventually) the Go code.
- **Single contributor mental model.** Newcomers see "this is Postel" in one place.
- **Direct precedent**: [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) — our closest comparator — uses exactly this shape: `javascript/`, `python/`, `go/`, `rust/`, `ruby/`, `csharp/`, `kotlin/`, `php/`, `elixir/` as sibling top-level dirs plus `spec/` at root. Ships 9+ languages, run by a small team.

## Tooling at the root: mise

`mise.toml` is the repo-level "where do I start?" file. It declares:

- **Tool versions**: Node, the OpenSpec CLI binary, future per-language toolchains (Go, Python, Rust).
- **Tasks**: `mise run spec:validate`, `mise run check:spec-drift`, etc. — language-agnostic.

After `mise install`, the OpenSpec CLI is on PATH; no top-level `package.json` or `node_modules/` needed. Local node module footprint stays scoped to `typescript/` once that lands.

## Agent guidance: AGENTS.md canonical, CLAUDE.md as import

The agent ecosystem has fragmented conventions: Claude Code reads `CLAUDE.md`, Codex/Cursor and friends are converging on `AGENTS.md`. Rather than maintain duplicated content:

- **`AGENTS.md`** holds the canonical guidance.
- **`CLAUDE.md`** is a one-liner `@AGENTS.md` — Claude Code's import syntax that expands the referenced file inline. Single source of truth, zero drift.

Per-language `AGENTS.md` files inside each language root handle ecosystem-specific idioms (Go conventions, Python style, etc.). The top-level `AGENTS.md` sets cross-language workflow rules (spec is truth, scenarios = tests, OpenSpec for spec changes).

## Alternatives considered

### Repo organization

- **Polyrepo** (sibling repos per language; OpenTelemetry / gRPC / Sentry SDK pattern) — wins when each language has its own maintainer community wanting full release autonomy. Costs spec/port sync friction: a wire-format change needs N coordinated PRs across N repos. Not worth it for our scale or for keeping ports honest against an executable oracle. Revisit only if maintainer pressure justifies it.

- **Bazel / Nx / Pants polyglot monorepo** — heavy tooling that natively supports polyglot builds and queries. Overkill at our size. Steep learning curve turns away contributors. Would replace mise's role; reconsider only if the per-language CI surface becomes unmanageable with simple path filters.

- **TS packages at the top, others as nested siblings** (the proposal we're refining) — naming asymmetry (`packages/` is TS-specific; `go/` is language-named). Better to make TS one of N siblings under explicitly named language roots.

### Root task runner

- **mise** — polyglot tool manager + task runner. Manages Node version AND installs the OpenSpec CLI as a binary; declares tasks in `mise.toml`. Best fit for a polyglot repo. **Chosen.**
- **`Makefile`** — universal, no tool to install. Weak at managing tool versions; `make` syntax is a known papercut for contributors who don't use it daily.
- **`just`** — modern Make replacement. Better syntax but doesn't manage tool versions.
- **`task` (go-task)** — YAML task runner. Similar to mise but no tool management.

mise wins by being the only one that ALSO manages tool versions, which keeps "what Node version does this repo expect" out of prose and into machine-checkable config.

## Consequences

- The current [`distribution-packaging`](../openspec/specs/distribution-packaging/spec.md) capability spec is TS-only (npm package names, ESM+CJS dual export). It will be renamed to `distribution-packaging-typescript` via an OpenSpec change before the first TypeScript code lands. Each language port introduces its own `distribution-packaging-<lang>` capability (Go modules, Python wheels, Rust crates).
- The existing `api-surface-typescript` capability is already structured correctly for this model.
- `compliance/` lives at repo root; its implementation can start in TypeScript but the contract stays language-agnostic.
- Repo-wide `AGENTS.md` + per-language `AGENTS.md` becomes the canonical agent-guidance model.
- `mise.toml` is the entry point. Newcomers run `mise install` to set up the toolchain.
- No top-level `package.json`. The agent permission allowlist (`.claude/settings.json`) gains `Bash(mise:*)`.

## Open questions

- **`compliance/` location**: top level vs. `specs/compliance/` (under the language-agnostic shared specs folder). Current preference: top level, since it's executable code that ports interact with, not just docs. Final call when the suite is actually implemented.
- **Per-language release tagging**: do we use `ts/v1.0.0`, `go/v1.0.0` git tags (Changesets-style monorepo releasing) or a single repo-wide version? Defer until the second port ships.
- **CI organization**: one workflow file per language vs. one `ci.yml` with parallel jobs and path filters. Defer until the second port ships.

## How to close this ADR

1. Confirm the layout via maintainer review.
2. Move status to "Accepted"; the PR that introduces the `typescript/` directory (likely the first PR after this one merges) carries the move of any TS-related files into it.
3. Open the OpenSpec change `rename-distribution-packaging` to handle the capability split before the first TypeScript code lands.
