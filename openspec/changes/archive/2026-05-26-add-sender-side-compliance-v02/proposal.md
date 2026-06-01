## Why

At v0.1.0 the [`compliance`](../../specs/compliance/spec.md) suite explicitly defers all sender-side tests — its `v0.1.0 explicit out-of-scope — sender-side behavior` requirement says these tests "SHALL land in subsequent MINOR (or MAJOR) releases as sender code lands and the architecture for 'drive a target sender' is designed. The current change does NOT prescribe that architecture." With the TypeScript sender now landing across PR-T1 … PR-T5, the suite needs a v0.2.0 architecture to gate it. Without sender-side compliance, a port at v0.2.0 has no executable oracle for the sender capability — the lockstep rule in *"Lockstep versioning with the @postel/* release train"* would still pass even if a port's sender produced byte-incompatible wire output.

## What Changes

- Introduce the **HTTP control-plane** mechanism the suite uses to drive any port's sender. Each port ships a thin server (the TypeScript port's lives in `@postel/compliance-driver`) exposing a fixed set of routes — `GET /control/info`, `POST /control/reset`, `POST /control/endpoints`, `POST /control/send`, `POST /control/workers/start`, `POST /control/clock/advance`, plus optional debug routes for vector authoring. The route set, JSON shapes, and semantics are CONTRACT (cross-port); bind host, port discovery, and process lifecycle are PORT-SPECIFIC.
- Extend the **vector file schema** with a `mode: "receiver" | "sender"` discriminator (default `receiver` — v0.1.0 vectors remain valid). Sender vectors carry `triggers[]` (ordered control-plane operations), `mock_receiver{}` (scripted responses for the embedded mock receiver), and `expected_requests[]` (length-exact assertions on the sender's outgoing HTTP).
- Extend the **CLI surface**: the runner gains `--sender-control <url>` (XOR with `--target`), `--mock-receiver-host` (default `127.0.0.1`), and `--mock-receiver-port` (default `0` = ephemeral). The flag set, semantics, exit-code rules, and output formats remain CONTRACT.
- Acknowledge in **Two-layer architecture** that sender-mode runners additionally embed a mock receiver and act as control-plane clients — runner source stays under top-level `compliance/`.
- Rename the existing `v0.1.0 explicit out-of-scope — sender-side behavior` requirement to `Out-of-scope behaviors at the current MINOR` so it's evergreen, and narrow the body to the v0.3+ residuals (full at-least-once crash-reclaim, multi-tenancy fairness statistics, advanced observability, full TLS-bad-cert matrix, reconciliation).
- Add a new `v0.2.0 sender-side initial test scope` requirement enumerating the CONTRACT set covered at v0.2.0 (~26 CONTRACT requirements across `sender`, `retry-policy`, `endpoint-management`, `filtering-transformation`, `standard-webhooks-compliance`, `multi-tenancy`) and the ~30-vector enumeration grouped by sub-category.
- The TS `@postel/compliance-driver` package is the first conformant driver — it has already landed (or will land alongside) PR-T5 of the TS sender track. Other ports (Go, Python, Rust) ship their own conformant driver if and when their senders land.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`compliance`**:
  - `Vector file schema` — body gains `mode` discriminator paragraph and the `triggers` / `mock_receiver` / `expected_requests` field definitions; new scenarios cover the new shape and backward compatibility with v0.1.0 vectors.
  - `CLI surface` — body gains `--sender-control` and mock-receiver-host/port flags; new scenarios cover XOR semantics with `--target`.
  - `Two-layer architecture — vectors + runner` — body acknowledges the embedded mock receiver as a runner-side CONTRACT side-channel.
  - **NEW**: `Sender-side compliance driver mechanism` — defines the six-route control-plane HTTP API (CONTRACT). Distribution / bind / lifecycle / language are PORT-SPECIFIC.
  - **NEW**: `v0.2.0 sender-side initial test scope` — enumerates the CONTRACT set and the ~30-vector corpus.
  - **RENAMED + MODIFIED**: `v0.1.0 explicit out-of-scope — sender-side behavior` → `Out-of-scope behaviors at the current MINOR`. Body narrowed to v0.3+ residuals.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/compliance/spec.md` — three requirement bodies modified, two new requirements added, one renamed.
- `compliance/schema/vector.schema.json` — schema additions for `mode`, `triggers`, `mock_receiver`, `expected_requests` and their `$defs`. Strict superset over v0.1.0 — existing vectors remain valid.
- `compliance/cli/main.go` — new flags + XOR validation.
- `compliance/cli/runner.go` — `executeVector` dispatches on `Mode`; new `executeSenderVector`.
- `compliance/cli/mockreceiver.go` — new file: embedded mock-receiver server + request recorder + scripted-response engine.
- `compliance/cli/signer.go` — gains `VerifyHMACv1` / `VerifyEd25519v1a`.
- `compliance/cli/vector.go` — struct extended with new fields.
- `compliance/vectors/sender/` — new directory; PR-C2 lands the full corpus, this change only requires the framework.
- `compliance/CHANGELOG.md` — `[0.2.0]` entry naming this change.
- `typescript/packages/compliance-driver/` — the first conformant driver. Its package addition has already been authored under [`add-postel-memory-and-compliance-driver-packages`](../../changes/archive/2026-05-26-add-postel-memory-and-compliance-driver-packages/proposal.md); the runtime implementation ships with the TS sender PR series.
