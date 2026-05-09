# Postel

> Be conservative in what you send, liberal in what you accept.
> — Jon Postel, RFC 793

**Postel is a polyglot webhook delivery library backed by solid, executable specs.** The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified end-to-end by an executable compliance test suite.

[Standard Webhooks](https://www.standardwebhooks.com/) compliant, sender + receiver, runs inside your application against your existing Postgres or SQLite database — no separate service, no Redis, no message broker.

## Status

Pre-alpha. Specification stage. See [`VISION.md`](./VISION.md) for the top-level positioning, scope, and success criteria. Detailed specs live under [`openspec/specs/`](./openspec/specs/) and [`specs/`](./specs/).

## Repository layout

Polyglot monorepo with per-language top-level directories. See [`decisions/0010-monorepo-layout.md`](./decisions/0010-monorepo-layout.md) for the full rationale.

```
postel/
├── specs/                # shared: wire format, DB schema
├── openspec/             # spec-driven dev spine (active changes + main specs)
├── decisions/            # ADRs
├── compliance/           # executable test suite every port must pass (planned)
├── typescript/           # TS port root (follow-up PR)
├── go/  python/  rust/   # future
├── AGENTS.md             # canonical agent guidance (cross-agent standard)
├── CLAUDE.md             # @AGENTS.md import (Claude Code expands inline)
├── mise.toml             # tool versions + repo-level tasks
└── scripts/              # repo-level scripts (spec-drift checker, …)
```

## Getting started

This repo uses [mise](https://mise.jdx.dev) to manage tool versions (Node, the OpenSpec CLI) and orchestrate repo-level tasks. After [installing mise](https://mise.jdx.dev/getting-started.html):

```bash
mise trust          # one-time; accepts this repo's mise.toml
mise install        # installs Node 20 and the OpenSpec CLI binary
mise run check:all  # runs the spec-level CI gate locally
```

The `openspec` binary is on PATH after `mise install`. You can call it directly:

```bash
openspec list --specs        # show all capabilities + requirement counts
openspec show <cap>          # display a capability spec
openspec validate --all      # validate every spec + active change
```

## Contributing

**Read [AGENTS.md](./AGENTS.md)** first — it has the workflow rules in detail. Agentic tools (Claude Code, Codex, Cursor, Aider, Gemini, …) should follow them too. `CLAUDE.md` is a one-line `@AGENTS.md` import for Claude Code; other agents read `AGENTS.md` directly. Single source of truth, zero drift.

### Spec changes flow through OpenSpec

Never edit `openspec/specs/<cap>/spec.md` directly. Open a change:

```bash
openspec new change <kebab-name>   # creates the change folder
# author proposal.md, language-impact.md, specs/<cap>/spec.md, tasks.md
openspec validate <change-name>    # check artifact completeness
# implement the tasks
openspec archive <name> -y         # auto-syncs delta specs into main specs
```

### Every change declares its language impact

The project-local `postel` OpenSpec schema **requires** a `language-impact.md` artifact on every change, naming which language ports are affected. This is the polyglot dimension's structural enforcement — a port-adding change literally cannot be archived without declaring its impact.

### Verification chain before commit

```bash
mise run check:all
```

Runs `openspec validate --all`, the custom-schema validation, and the spec-test traceability check (`scripts/check-spec-drift.mjs`). All three must be green before opening a PR.

### House conventions

- **Conventional commits** (`feat:`, `fix:`, `chore:`, `spec:`, `docs:`).
- **One logical change per PR.** Don't bundle unrelated edits.
- **Postgres dialect in DDL files**, SQLite variants commented inline.
- **No top-level `package.json`.** Language-specific tooling lives inside each language root (`typescript/`, `go/`, …).

## Positioning

> **Svix is for when webhooks are your product.
> Postel is for when webhooks are a feature of your product.**

Postel does not compete with Svix or Hookdeck on customer-facing webhook portals, multi-region delivery, or 99.999% uptime SLAs. It targets a different audience: teams who want to add reliable outbound webhooks to an existing application without standing up a separate service, and teams whose runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy, Bun, single-binary OSS products) cannot run a Postgres + Redis + service sidecar in the first place.

Postel is a **library, not a service**. It will never have a hosted offering, never run a separate dispatcher process, never require Redis or a message broker, never ship a customer-facing portal as a packaged product. If you need any of that, use Svix or Hookdeck Outpost.

## Specs (sources of truth)

| Layer | Source of truth | Format |
|---|---|---|
| Top-level positioning, scope, success criteria | [`VISION.md`](./VISION.md) | Markdown |
| Wire format | [`specs/wire-format/asyncapi.yaml`](./specs/wire-format/asyncapi.yaml) | AsyncAPI 3.0 |
| DB schema | [`specs/db-schema/0001_init.sql`](./specs/db-schema/0001_init.sql) | SQL DDL |
| Capability behaviors | [`openspec/specs/`](./openspec/specs/) | Markdown (per capability) |
| Architectural decisions | [`decisions/`](./decisions/) | Markdown ADRs |
| Behavioral oracle | `@postel/compliance` (planned) | Executable test suite |

Spec changes flow through [OpenSpec](https://github.com/Fission-AI/OpenSpec) using the project-local `postel` schema. Every change includes a `language-impact.md` artifact declaring which language ports are affected.

## Inspiration

Named after [Jon Postel](https://en.wikipedia.org/wiki/Jon_Postel), whose [Robustness Principle](https://en.wikipedia.org/wiki/Robustness_principle) (RFC 793, 1981) — *"be conservative in what you do, be liberal in what you accept from others"* — is the design philosophy this library embodies. Strict signing, deterministic timestamps, careful retry budgets on the way out; multi-secret tolerance, raw-bytes preservation, JWKS-based key discovery, helpful verifier errors on the way in.

## License

To be determined before 1.0 (MIT or Apache-2.0).
