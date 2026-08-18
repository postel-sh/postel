## Why

The sender-mode compliance oracle only ever exercises `InMemoryStorage`, so AGENTS.md's claim — "Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the compliance test suite" — is one-third true: wire format yes, behaviors partially, DB schema not at all. Two vectors are also admitted structural stand-ins rather than the real check they describe: `jwks/public-only` asserts only HTTP 200 (not "no private key material"), and `receiver/dedup/concurrent-atomicity` sends a single request instead of a true concurrent duplicate pair. Closes #149.

## What Changes

- The `@postel/compliance-driver` (TS) gains a selectable storage backend: `InMemoryStorage` (default, unchanged) or `@postel/pg` behind an explicit flag/env var. `/control/reset` truncates the real tables instead of rebuilding an in-memory host when Postgres-backed.
- A new CI tier runs the existing v0.2 sender corpus against the pg-backed driver (real Postgres via testcontainers) and additionally asserts the resulting rows' shape (columns present, enum-valued columns hold only documented values) against `specs/db-schema/0001_init.sql` + its migrations. This is a **schema-conformance check riding the existing corpus**, not a new per-adapter behavioral vector matrix — the latter stays deferred (see `compliance` capability delta below).
- The vector file schema gains two additive, non-breaking fields:
  - `expected.response_body_schema` (receiver mode): an embedded JSON Schema the response body must satisfy, in addition to the `outcome` check. Lets a vector assert response-body shape, not just verdict.
  - `concurrency` (receiver mode, top-level) + `expected.outcomes` (a same-length multiset, replacing singular `outcome`/`error_code` when `concurrency` is set): fires the same signed request N times concurrently and checks the unordered multiset of observed verdicts. Needed for verdicts that are only meaningful under a race (dedup atomicity).
- `jwks/public-only` gains a `response_body_schema` that structurally forbids private-key fields (`d`, `k`) on every JWK in the document.
- `receiver/dedup/concurrent-atomicity` becomes a true concurrent-duplicate vector: `concurrency: 2` against one fresh id, `expected.outcomes: [accept, duplicate]`.
- `compliance/README.md` and the two vectors' own descriptions are updated to stop describing themselves as stand-ins.

The change is **CONTRACT** for the two schema-field additions (every conformant runner must support them per the existing "Schema field addition" scenario) and **PORT-SPECIFIC** for the pg CI tier's mechanism (a port MAY prove DB-schema conformance a different way; what's CONTRACT is that some port-owned CI proves it before claiming the AGENTS.md line).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `compliance`: MODIFIED `Vector file schema` (adds `response_body_schema` and `concurrency`/`outcomes`); MODIFIED `Out-of-scope behaviors at the current MINOR` (narrows the `storage-layer` deferral: row/column schema-conformance for the pg adapter is now proven in CI; the full per-adapter behavioral vector matrix stays deferred).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged (no migration; the new CI tier reads the existing `specs/db-schema/` migrations as its oracle, it doesn't change them).

## Impact

- `compliance/schema/vector.schema.json`, `compliance/cli/{vector,runner,schema,format}.go` (+ tests) — new schema fields and their execution semantics.
- `compliance/vectors/jwks/public-only.yaml`, `compliance/vectors/receiver/dedup/concurrent-atomicity.yaml` — strengthened.
- `compliance/README.md` — drop the "stand-in" framing once the real checks land.
- `typescript/packages/compliance-driver/{src/server.ts,src/cli.ts,package.json}` — selectable storage backend.
- `typescript/packages/compliance-driver/scripts/pg-conformance.mjs` (new) — testcontainers-gated script: runs the sender corpus against the pg-backed driver, then asserts row/column shape against `specs/db-schema/`.
- `mise.toml` — new `compliance:sender:pg:ts` task.
- `.github/workflows/compliance-suite.yml` — new CI job wiring the task in (Docker-gated, own job, not part of the local `preflight`/`check:all` default path — mirrors how `@postel/pg`'s own testcontainers tier stays out of default `pnpm test`).
