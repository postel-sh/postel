## 1. Spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/compliance/spec.md` delta — ADD *Sender-side compliance driver mechanism*; ADD *v0.2.0 sender-side initial test scope*; MODIFY *Vector file schema*, *CLI surface*, *Two-layer architecture*; RENAME + MODIFY *v0.1.0 explicit out-of-scope* → *Out-of-scope behaviors at the current MINOR*.
- [ ] 1.3 Write `language-impact.md`.

## 2. Vector schema

- [ ] 2.1 Extend `compliance/schema/vector.schema.json` with `mode`, `triggers`, `mock_receiver`, `expected_requests` and the `$defs` for each. Keep the v0.1.0 vectors valid (strict superset).

## 3. Go runner extension

- [ ] 3.1 `compliance/cli/main.go` — add `--sender-control`, `--mock-receiver-host`, `--mock-receiver-port`; XOR validation with `--target`.
- [ ] 3.2 `compliance/cli/vector.go` — extend struct types for the new fields.
- [ ] 3.3 `compliance/cli/mockreceiver.go` (new file) — `MockReceiver`, `RequestRecorder`, `ResponseScript`. `httptest.NewServer`-based.
- [ ] 3.4 `compliance/cli/runner.go` — dispatch on `Mode`; add `executeSenderVector`.
- [ ] 3.5 `compliance/cli/signer.go` — add `VerifyHMACv1`, `VerifyEd25519v1a`.
- [ ] 3.6 `compliance/cli/runner_test.go` — `TestRun_SenderMode_AgainstStubDriver` proves the runner ↔ schema ↔ recorder pipeline composes without depending on the TS port.

## 4. First sender vectors

- [ ] 4.1 `compliance/vectors/sender/wire-output/hmac-v1-byte-stable.yaml` — single send, v1 HMAC signature verifies against fixture.
- [ ] 4.2 `compliance/vectors/sender/idempotency/duplicate-key-no-dispatch.yaml` — two sends same idempotencyKey, one outgoing request.

## 5. CHANGELOG

- [ ] 5.1 `compliance/CHANGELOG.md` — `[0.2.0]` heading with the contract set, vector enumeration, and the renamed out-of-scope list.

## 6. Validation + archive

- [ ] 6.1 `openspec validate add-sender-side-compliance-v02 --strict` green.
- [ ] 6.2 `mise run check:all` green.
- [ ] 6.3 `openspec archive add-sender-side-compliance-v02 -y` — applies the delta to the main compliance spec.
- [ ] 6.4 Re-run `openspec validate --all` green after archive.
