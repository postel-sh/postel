## 1. Vector schema — response_body_schema

- [x] 1.1 `compliance/schema/vector.schema.json`: add `expected.response_body_schema` (object, opaque embedded schema).
- [x] 1.2 `compliance/cli/vector.go`: add `VectorExpected.ResponseBodySchema map[string]interface{}`.
- [x] 1.3 `compliance/cli/runner.go`: after classifying the observed verdict, when `response_body_schema` is present, parse the response body as JSON and validate it against the embedded schema (compiled inline via the existing `santhosh-tekuri/jsonschema/v5` dependency); failure fails the vector independently of the outcome check.
- [x] 1.4 Go tests: schema accepts/rejects `response_body_schema`; runner test proving a body that violates the embedded schema fails even when `outcome` matches.

## 2. Vector schema — concurrency / outcomes multiset

- [x] 2.1 `compliance/schema/vector.schema.json`: add top-level `concurrency` (integer ≥ 2, receiver mode only) and `expected.outcomes` (array, same length as `concurrency`); conditional requiring `outcomes` instead of `outcome`/`error_code` when `concurrency` is set.
- [x] 2.2 `compliance/cli/vector.go`: add `Vector.Concurrency int` and `VectorExpected.Outcomes []string`.
- [x] 2.3 `compliance/cli/runner.go`: when `Concurrency > 1`, sign `input` once and fire it `Concurrency` times concurrently (goroutines + wait), collect one `ObservedVerdict` per response, compare the sorted multiset against the sorted `expected.Outcomes`.
- [x] 2.4 `compliance/cli/runner.go`: add `TestResult.ObservedSet []ObservedVerdict` for the multiset case; `compliance/cli/format.go`: render it in text/TAP/JUnit output alongside the existing singular `Observed`.
- [x] 2.5 Go tests: schema accepts/rejects the new fields and their conditional; runner test proving a `concurrency: 2` vector against a stub dedup receiver passes with `outcomes: [accept, duplicate]` and fails on a non-conformant stub.

## 3. Strengthen the two stand-in vectors

- [x] 3.1 `compliance/vectors/jwks/public-only.yaml`: add `response_body_schema` asserting no JWK in `keys[]` carries a private-key field (`d`, `k`); rewrite the description to drop the "structural stand-in" framing.
- [x] 3.2 `compliance/vectors/receiver/dedup/concurrent-atomicity.yaml`: rewrite as `concurrency: 2` against a fresh id with `expected.outcomes: [accept, duplicate]`; rewrite the description to drop the "single-request stand-in" framing.

## 4. Compliance-driver: selectable storage backend

- [x] 4.1 `typescript/packages/compliance-driver/package.json`: add `@postel/pg` + `pg` (dependencies), `@testcontainers/postgresql` + `@types/pg` (devDependencies, for the new gated script).
- [x] 4.2 `typescript/packages/compliance-driver/src/server.ts`: `DriverServerOptions` gains `storage?: "memory" | "pg"` and `pgConnectionString?: string`. `newHost` becomes async; pg mode constructs `PgStorage` over a shared `pg.Pool`, `TRUNCATE`s the real tables on `/control/reset` instead of rebuilding an in-memory host, migrates once at startup.
- [x] 4.3 `typescript/packages/compliance-driver/src/cli.ts`: read `--storage`/`--pg-url` flags and `POSTEL_COMPLIANCE_STORAGE`/`POSTEL_COMPLIANCE_PG_URL` env vars (flag wins), default `memory`.
- [x] 4.4 `typescript/packages/compliance-driver/test/server.test.ts`: unit-test the flag/env resolution (no DB required); existing memory-mode tests unchanged.

## 5. Pg schema-conformance CI tier

- [x] 5.1 `typescript/packages/compliance-driver/scripts/pg-conformance.mjs` (new, Docker-gated on `POSTEL_PG_TESTCONTAINERS`): start a Postgres testcontainer, start the built driver in pg mode, run the built Go compliance binary's sender corpus against it, assert zero failures, then assert column shape (`information_schema.columns`) and row-level enum vocabularies for `tenants`/`endpoints`/`endpoint_secrets`/`messages`/`attempts`/`endpoint_state_transitions`/`postel_received_messages` against `specs/db-schema/0001_init.sql` + migrations.
- [x] 5.2 `mise.toml`: new `compliance:sender:pg:ts` task wiring `compliance:build` + driver build + the script above.
- [x] 5.3 `.github/workflows/compliance-suite.yml`: new job running the task (Docker available by default on `ubuntu-latest`); not added to `preflight`/`check:all` (Docker-gated, mirrors `@postel/pg`'s own testcontainers tier).

## 6. Docs

- [x] 6.1 `compliance/README.md`: drop stale "InMemoryStorage only" framing if present; note the pg schema-conformance tier.
- [x] 6.2 `compliance/CHANGELOG.md`: record the two additive schema fields and the narrowed `storage-layer` deferral under the current version.

## 7. Verification

- [x] 7.1 `mise run compliance:vet && mise run compliance:test` (Go).
- [x] 7.2 `pnpm -C typescript --filter @postel/compliance-driver build && pnpm -C typescript --filter @postel/compliance-driver test`.
- [x] 7.3 `mise run compliance:receiver:ts && mise run compliance:sender:ts` (existing corpus still green against the reference receiver / in-memory driver).
- [x] 7.4 `POSTEL_PG_TESTCONTAINERS=1 mise run compliance:sender:pg:ts` locally (Docker required) — the new tier.
- [x] 7.5 `mise run check:all` at the repo root.
