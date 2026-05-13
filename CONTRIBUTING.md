# Contributing to Postel

This guide covers the repository layout, dev environment setup, and the workflow rules every change follows. Agentic tools (Claude Code, Codex, Cursor, Aider, Gemini, …) should additionally read [AGENTS.md](./AGENTS.md), which is the canonical agent guidance file with the same rules.

## Repository layout

Polyglot monorepo with per-language top-level directories. See [`decisions/0006-monorepo-layout.md`](./decisions/0006-monorepo-layout.md) for the full rationale.

```
postel/
├── specs/                # shared: wire format, DB schema, compliance contract
├── openspec/             # spec-driven dev spine (active changes + main specs)
├── decisions/            # ADRs
├── compliance/           # @postel/compliance — executable test suite every port must
│                         # pass; lives at root (not in typescript/) because it's a
│                         # cross-language asset (ADR 0006). TS runner is first impl.
├── typescript/           # TS port root (pnpm workspace; toolchain in ADR 0010)
│   ├── packages/
│   │   ├── core/  edge/
│   │   ├── standalone-pg/  standalone-sqlite/
│   │   ├── drizzle/  prisma/  kysely/  storage-helpers/
│   │   ├── express/  hono/  fastify/  nextjs/  bun/
│   │   └── admin/  effect/  test/  cli/
│   ├── package.json      # workspace root; private; not published
│   ├── pnpm-workspace.yaml  # packages/* + ../compliance
│   ├── tsconfig.base.json
│   ├── turbo.json
│   ├── biome.json
│   └── AGENTS.md         # TS-port idioms (host-tx pattern, error hierarchy)
├── go/  python/  rust/   # future
├── AGENTS.md             # canonical agent guidance (cross-agent standard)
├── CLAUDE.md             # @AGENTS.md import (Claude Code expands inline)
├── mise.toml             # tool versions + repo-level tasks
└── scripts/              # repo-level scripts (spec-drift checker, …)
```

## Getting started

This repo uses [mise](https://mise.jdx.dev) to manage tool versions (Node, the OpenSpec CLI) and orchestrate repo-level tasks. After [installing mise](https://mise.jdx.dev/getting-started.html):

```bash
mise trust                 # one-time; accepts this repo's mise.toml
mise install               # installs Node 20 and the OpenSpec CLI binary
cd typescript && pnpm install && cd ..  # set up the TS workspace
mise run check:all         # runs the spec-level CI gate locally
```

The TS toolchain (pnpm workspaces + Turbo + tsup + Biome + Vitest) is documented in [`decisions/0010-typescript-toolchain.md`](./decisions/0010-typescript-toolchain.md). Per-language idioms live in [`typescript/AGENTS.md`](./typescript/AGENTS.md).

The `openspec` binary is on PATH after `mise install`. You can call it directly:

```bash
openspec list --specs        # show all capabilities + requirement counts
openspec show <cap>          # display a capability spec
openspec validate --all      # validate every spec + active change
```

## Workflow rules

### 1. Spec is the source of truth

Implement against the spec. If the spec is wrong, ambiguous, or incomplete, fix it via an OpenSpec change first, then resume implementation. Never silently work around the spec.

### 2. Spec changes flow through OpenSpec

Never edit `openspec/specs/<cap>/spec.md` directly. Open a change:

```bash
openspec new change <kebab-name>   # creates the change folder
# author proposal.md, language-impact.md, specs/<cap>/spec.md, tasks.md
openspec validate <change-name>    # check artifact completeness
# implement the tasks
openspec archive <name> -y         # auto-syncs delta specs into main specs
```

### 3. Every change declares its language impact

The project-local `postel` OpenSpec schema **requires** a `language-impact.md` artifact on every change, naming which language ports are affected. This is the polyglot dimension's structural enforcement — a port-adding change literally cannot be archived without declaring its impact.

### 4. Tests are scenarios, 1:1

Every `### Requirement` and `#### Scenario` in a capability spec MUST map to a test that names the requirement. CI fails if a requirement has no matching test (`scripts/check-spec-drift.mjs`). This is mechanical, not creative — the scenarios are already in WHEN/THEN form.

### 5. Verification chain before commit

```bash
mise run check:all
```

Runs `openspec validate --all`, the custom-schema validation, and the spec-test traceability check (`scripts/check-spec-drift.mjs`). All three must be green before opening a PR. Each language port has its own test/lint/build verification chain inside its language root — run those too when you touch that port.

### 6. Compliance suite is the behavioral gate

PRs touching the sender/receiver path must keep `@postel/compliance` green. When the package lands, this becomes the deciding signal — not unit tests. Any future language port is "Postel-conformant" iff this suite reports 100% pass.

## Per-capability implementation loop

For each capability you implement:

1. Read `openspec/specs/<cap>/spec.md` end-to-end.
2. Translate every `#### Scenario` into a test case in the relevant language root (e.g., `typescript/packages/<pkg>/test/<cap>.test.ts`). The test description should include the requirement title verbatim so the spec-drift check passes.
3. Implement the **simplest** code in the relevant language root that makes all tests pass. No extras.
4. Run the verification chain. Iterate until green.
5. Open a PR via `gh pr create`. Reference the capability spec.

If you discover the spec is incomplete or wrong: stop, open an OpenSpec change to fix it, archive it, then resume. Don't sneak spec edits into the implementation PR.

## House conventions

- **Conventional commits** (`feat:`, `fix:`, `chore:`, `spec:`, `docs:`). One logical change per PR; don't bundle unrelated edits.
- **Postgres dialect in DDL files**, SQLite variants commented inline.
- **No top-level `package.json`.** Language-specific tooling lives inside each language root (`typescript/`, `go/`, …).
- **No release-side commands.** Don't run `npm publish`, `cargo publish`, `pip upload`, or similar — releases are gated through CI on tagged commits, not authored from a working tree.

## What NOT to do

- Don't over-implement. Add only what scenarios require.
- Don't add features not specified.
- Don't write tests that don't trace back to a scenario.
- Don't bypass the OpenSpec workflow for capability-spec changes.
- Don't add explanatory comments — well-named identifiers handle that.
- Don't push to `main`. PRs only.

## When in doubt

Re-read the relevant capability spec. If the answer isn't there, the spec needs an update — open an OpenSpec change. For per-language idioms, also consult `<lang>/AGENTS.md` (once each language root exists).
