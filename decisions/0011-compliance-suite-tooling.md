# 0011 — Compliance suite tooling: Go runner + YAML vectors

- **Status**: Accepted
- **Date**: 2026-05-14
- **Decision drivers**: cross-port portability of the test corpus, single-binary distributability for any port language, byte-exact reproducibility of test vectors, ease of CI integration for non-Node ports, authoring ergonomics for vector files, alignment with `compliance/` being language-open per [ADR 0006](0006-monorepo-layout.md)

## Context

The `compliance` capability spec (created via OpenSpec change `define-compliance-suite-v01-scope`, merged in [PR #4](https://github.com/postel-sh/postel/pull/4)) is intentionally **language-open** about the runner and **format-open** about the vectors — both decisions deferred to the change that introduces the first runner. This ADR is that change.

The spec already settles:
- **Two layers**: language-agnostic test vectors + a runner that consumes them and drives a target HTTP receiver.
- **Lockstep versioning** with the rest of the `@postel/*` release train.
- **Vector file schema** as a CONTRACT requirement (every vector declares `id`, `requirement`, `description`, `input`, `secrets`, `signature_mode`, `expected`; time templating via `{{now±<duration>}}`; test keys under `compliance/vectors/_keys/`).
- **CLI surface** (CONTRACT): `--target`, `--format <json|tap|junit>`, `--now`, non-zero exit on failure.
- **Distribution channel is PORT-SPECIFIC** — open.

Three implementation decisions remain. This ADR makes them.

## Decision

### 1. Vector file format: **YAML 1.2 (safe subset)**

Vectors are authored as YAML files under `compliance/vectors/<category>/<vector-id>.yaml`. Constraints:

- **Safe subset only**: scalars, sequences, mappings. No anchors, no aliases, no custom tags, no merge keys. Parsers run in safe mode (no arbitrary-type construction).
- **Explicit quoting for ambiguous strings**: anything that could be misread as boolean (`yes`/`no`/`on`/`off`/country codes), number, or other type gets explicit quotes. Critical for our schema: `webhook-timestamp`, `webhook-version`, signature-component strings.
- **JSON-Schema validation in CI**: the parsed in-memory structure is validated against a canonical JSON Schema. The validator treats YAML and JSON-after-parse identically.

### 2. Runner implementation: **Go**

The runner is implemented in Go and lives at `compliance/cli/` (Go module + main package). It is **not** an `@postel/*` npm package — it ships as a versioned binary, not as a Node library.

### 3. Distribution: **tagged GitHub releases with per-OS binaries**

Each suite release tags `compliance-v<X.Y.Z>` on `main` (separate tag namespace from the TS `@postel/*` packages so semver tooling doesn't conflict, but the `X.Y.Z` is lockstep with the `@postel/*` train per [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md)'s lockstep requirement). The tag triggers a CI job that cross-compiles per-OS binaries (`linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`) and attaches them as release assets. Port CIs consume the suite via download (`curl + tar + chmod + run`) or by checking out the repo at the tag.

## Consequences

- **Authoring ergonomics**: contributors write YAML, not JSON. Multi-line block scalars (`|`) help with long base64 bodies; comments help with intent annotations. PR review of a vector is meaningfully easier than reviewing equivalent JSON.
- **Cross-language portability**: every port can read YAML via a canonical safe-subset library (`gopkg.in/yaml.v3`, `pyyaml.safe_load`, `serde_yaml`, `js-yaml`). The schema-after-parse is the cross-port contract; the on-disk format is identical bytes for every consumer.
- **Distribution UX**: a port CI in any language pulls one binary and runs it. No Node install, no `npm install`, no language-specific package manager involvement. Single-platform CIs can pin a specific `compliance-v0.1.0` linux/amd64 asset.
- **Schema-validation discipline**: YAML's looser syntax demands a CI validator. We need a JSON Schema for vectors (lands in the same PR as this ADR or the next). Without it, typos in field names ship silently.
- **Two artifact namespaces**: `@postel/<pkg>@X.Y.Z` for the TS-port packages, `compliance-v<X.Y.Z>` for the suite binary. The lockstep CONTRACT means `X.Y.Z` matches across both at release; the tag-naming difference exists to keep semver tooling (Changesets, npm publish) operating on the TS namespace without confusion.
- **Go expertise becomes a maintainer prerequisite**: contributors to the runner need Go. Vector authors don't. The runner is intentionally small (HTTP + crypto + YAML + assert), so the bar is low.
- **The `0010-typescript-toolchain.md` ADR is unaffected**: it covers the TS port (sender, receiver, edge, framework adapters), not the compliance runner. The runner being Go doesn't change anything about how the TS port is built or published.

## Alternatives considered

### Vector format

- **JSON**. Universally trivial to parse; every language has stdlib JSON. Rejected for authoring ergonomics — JSON requires quoted keys, no comments, no multi-line scalars. The cross-language portability benefit is real but small (the YAML alternative also has every-language libraries; we just constrain to a safe subset). YAML wins on the human-touch surface, which is where the format is read most often.
- **Gherkin (Cucumber-family scenarios)**. Considered for natural-language readability. Rejected: byte-exact reproducibility gets obscured behind English paraphrases; cross-language portability requires step-definition bindings per runner language (not just data parsing); the capability specs already give us the readable narrative at the spec layer via `#### Scenario:` blocks. The auto-generated Gherkin doc view of YAML vectors is a future option that pays the readability benefit without paying the portability cost.
- **TOML**. Less common for nested data; less readable than YAML for deeply structured records; no tooling advantage over YAML. Rejected.
- **HCL** (HashiCorp Configuration Language). Niche, ties us to HashiCorp's parsers. Rejected.

### Runner language

- **TypeScript**. Close second. Zero context switch from the rest of the repo; existing `standardwebhooks` npm library could be vendored for byte-identical signature production. Rejected for two reasons: (1) ties the suite to the Node ecosystem the user explicitly wants to decouple from (per PR #4's language-decoupling work); (2) distribution requires Node on the consumer's CI, which is friction for Go/Python/Rust port maintainers. TS remains the right call *for the TS port itself* (per [ADR 0010](0010-typescript-toolchain.md)) — just not for the compliance suite.
- **Rust**. Same single-binary win as Go, faster, but slower to author by hand and crypto/HTTP libs are less stdlib-native. The runner is genuinely simple work (HTTP + JSON + crypto); Rust's strengths aren't decisive here. Rejected for ergonomics; reconsider if the runner ever grows substantially.
- **Python**. Easy to author, lightweight, but distribution requires a Python interpreter on the consumer. Same downside as TS for non-Python ports. Rejected.
- **Bun-compiled single-file TS binary**. Interesting middle ground (TS familiarity + single binary). Rejected: younger toolchain, less proven for redistributable CI artifacts, and still ties the contributor experience to the TS ecosystem.

### Distribution

- **npm package** (`@postel/compliance`). Considered. Rejected for the same reason as TS-runner: non-Node ports shouldn't need npm to run conformance. Could be re-added as an alternative install channel later (a thin npm wrapper that downloads the right Go binary on `postinstall`).
- **Container image** (`ghcr.io/postel-sh/compliance:X.Y.Z`). Considered as a complement. Useful for hermetic CI; add as a follow-up artifact once the binary-release flow is working. Out of scope for the v0.1.0 cut.
- **Single combined "everything" tarball**. Vectors + binary in one tarball, downloaded per release. Considered for hermeticity (vectors and runner versions can't drift). Rejected as overkill: the runner consumes vectors from the repo at the tagged commit, and CIs typically check out at the tag anyway. The simple per-OS binary plus the repo-tagged vectors gives the same guarantee with less ceremony.

## Relationship to other ADRs

- [ADR 0006 — Monorepo layout](0006-monorepo-layout.md): the runner source lives at `compliance/cli/` per ADR 0006's "compliance/ at top level" decision. The Go module sits inside `compliance/`, sibling to `compliance/vectors/`.
- [ADR 0008 — Conformance levels](0008-conformance-levels.md): what the suite tests is CONTRACT. This ADR doesn't change that — it just decides how the suite is implemented.
- [ADR 0009 — Compliance suite evolution policy](0009-compliance-suite-evolution.md): Deferred. The lockstep policy from `compliance/spec.md` governs the suite's versioning today; this ADR's distribution decision (`compliance-v<X.Y.Z>` tags) is the concrete release mechanism for lockstep.
- [ADR 0010 — TypeScript port toolchain](0010-typescript-toolchain.md): covers the TS port (`@postel/core`, `@postel/edge`, etc.). Unrelated to this ADR — different language, different toolchain, different consumer set. The two ADRs coexist cleanly.

## How this closes

The compliance capability spec is updated in the same PR as this ADR to:

1. Rename `JSON files` → `YAML files` in the architecture and vector-file-schema requirements (six targeted edits; the on-disk format changes, the in-memory schema is unchanged).
2. Add a "YAML safe subset" scenario to the vector-file-schema requirement codifying the format constraints from this ADR's Decision section 1.
3. Add a "JSON Schema validation in CI" scenario to the same requirement.

Vector files at `compliance/vectors/<category>/<id>.yaml` and key fixtures at `compliance/vectors/_keys/*.yaml` start landing in subsequent PRs (Track A per the v0.1.0 plan), once this ADR merges and the Go runner skeleton at `compliance/cli/` is scaffolded.
