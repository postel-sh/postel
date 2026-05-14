## Why

The v0.1.0 compliance corpus enumerates five vectors whose verdict is "the request was a duplicate" — `signature-v1/replay-within-window`, `signature-v1a/replay-within-window`, and the three `receiver/dedup/*` vectors. The current `expected` schema admits only `accept` and `reject:<error_code>`. The receiver capability spec's structured-error vocabulary (SIGNATURE_INVALID, TIMESTAMP_TOO_OLD, MALFORMED_HEADER, UNKNOWN_KEY_ID, RAW_BYTES_MISMATCH_DETECTED) is *verify-error*-only; dedup detection happens *after* verify succeeds and has no error code defined. Without a verdict outcome for "duplicate detected", these five vectors cannot be authored against the existing schema, and ports cannot prove they implement dedup at the HTTP boundary.

## What Changes

- Extend `expected.outcome` enum from `{accept, reject}` to `{accept, reject, duplicate}`. The new `duplicate` outcome means "verify succeeded but the dedup helper reported the message id as already seen".
- Define the runner ↔ receiver HTTP convention for the new outcome: HTTP `2xx` plus a response header `X-Postel-Dedup-Result: duplicate`. Without the header, `2xx` continues to mean `accept` (per the existing convention). This keeps the convention header-additive — non-dedup-aware receivers see no behavior change.
- Update the canonical JSON Schema at `compliance/schema/vector.schema.json` to reflect the new enum.
- Update the runner's `ClassifyResponse` to map the new HTTP signal to the new verdict.
- The five previously-blocked vectors land in the same PR cycle as this change.

The change is **CONTRACT** — every conformant port's runner MUST classify the `X-Postel-Dedup-Result: duplicate` header into the `duplicate` outcome. Receivers that implement dedup MUST emit this header on duplicate receipt; receivers that do not implement dedup are non-conformant against `0.1.x` (the spec already calls dedup a CONTRACT requirement).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `compliance`: the *Vector file schema* requirement's `expected` shape gains a third outcome variant; the *CLI surface* requirement is unaffected.

## Wire-format / DB-schema impact

Wire-format: unchanged (`X-Postel-Dedup-Result` is a runner ↔ receiver test convention header, not part of the public Standard Webhooks delivery format).
DB-schema: unchanged.

## Impact

- `openspec/specs/compliance/spec.md` — modified `Vector file schema` requirement.
- `compliance/schema/vector.schema.json` — outcome enum extended.
- `compliance/cli/driver.go` — `ClassifyResponse` reads the new header.
- `compliance/cli/runner.go` — `verdictMatches` honors the new outcome.
- `compliance/cli/runner_test.go` — stub receiver demonstrates the convention.
- `compliance/vectors/{signature-v1,signature-v1a,receiver/dedup}/*.yaml` — five new vectors.
