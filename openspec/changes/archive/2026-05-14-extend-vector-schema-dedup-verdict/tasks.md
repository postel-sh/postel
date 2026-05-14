## 1. Schema + runner updates

- [x] 1.1 Extend `expected.outcome` enum in `compliance/schema/vector.schema.json` to include `duplicate`.
- [x] 1.2 Update `compliance/cli/driver.go` — `ClassifyResponse` reads `X-Postel-Dedup-Result: duplicate` on 2xx and emits the `duplicate` verdict.
- [x] 1.3 Update `compliance/cli/runner.go` — `verdictMatches` honors the new outcome (no `error_code` required).
- [x] 1.4 Update `compliance/cli/format.go` — text / TAP / JUnit / JSON output formatters surface the new outcome.
- [x] 1.5 Update `compliance/cli/runner_test.go` — `stubReceiver` emits the dedup header on second receipt of the same `webhook-id`.

## 2. Vectors

- [x] 2.1 `compliance/vectors/receiver/dedup/first-receipt.yaml` — first call with a fresh id, accept.
- [x] 2.2 `compliance/vectors/receiver/dedup/duplicate-receipt.yaml` — second call with the same id within TTL, duplicate.
- [x] 2.3 `compliance/vectors/receiver/dedup/concurrent-atomicity.yaml` — request the runner sends as one of a concurrent pair; receiver MUST classify exactly one of the pair as non-duplicate, the other as duplicate.
- [x] 2.4 `compliance/vectors/signature-v1/replay-within-window.yaml` — same id as `signature-v1/valid.yaml`, second receipt, duplicate.
- [x] 2.5 `compliance/vectors/signature-v1a/replay-within-window.yaml` — same id as `signature-v1a/valid.yaml`, second receipt, duplicate.

## 3. CHANGELOG + verification

- [x] 3.1 Check off `receiver/dedup/*` row and the deferred `replay-within-window` lines in `compliance/CHANGELOG.md`.
- [x] 3.2 `mise run check:all` green.
- [x] 3.3 `cd compliance/cli && go test ./...` green.
- [x] 3.4 `openspec validate extend-vector-schema-dedup-verdict --strict` green.
- [x] 3.5 `openspec archive extend-vector-schema-dedup-verdict -y` after the PR merges.
