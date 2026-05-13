# standard-webhooks-compliance Specification

## Purpose

Conformance with the [Standard Webhooks](https://www.standardwebhooks.com/) wire format — header set (`webhook-id`, `webhook-timestamp`, `webhook-signature`), signature versions (`v1` HMAC, `v1a` Ed25519), payload structure, and secret prefixes (`whsec_`, `whsk_`, `whpk_`) — plus three Postel-proposed extensions: versioning (`webhook-version`), JWKS discovery at `/.well-known/webhooks-keys`, and IETF-alignment compatibility on the receiver side. The canonical machine-readable form lives at [`specs/wire-format/asyncapi.yaml`](../../../specs/wire-format/asyncapi.yaml); the executable conformance contract is `@postel/compliance`.
## Requirements
### Requirement: Compliant headers, signatures, payload structure, and prefixes by default

Outgoing deliveries SHALL use Standard Webhooks-compliant headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`), signature versions (`v1` for HMAC, `v1a` for Ed25519), payload structure (`type`, `timestamp`, `data`), and secret prefixes (`whsec_`, `whsk_`, `whpk_`).

#### Scenario: HMAC v1 outgoing

- **WHEN** a delivery is signed with a `whsec_`-prefixed key
- **THEN** the request carries `webhook-signature: v1,<base64>` and the standard id/timestamp headers

### Requirement: Wraps the official signing library

The library's signature production MUST be byte-identical to the official [`standardwebhooks`](https://www.npmjs.com/package/standardwebhooks) JS library across the test-vector suite published by the Standard Webhooks project (and replicated under `compliance/`). Whether the implementation literally wraps the upstream library or reimplements the primitive is at the implementer's discretion — what matters is verifiable interop, not the call graph.

#### Scenario: Interop test vectors

- **WHEN** the implementation signs every test vector from the Standard Webhooks reference suite
- **THEN** each produced signature is byte-identical to the upstream library's output for the same inputs
- **AND** every signature also verifies successfully against the upstream verifier

### Requirement: Versioning extension via webhook-version header

The library SHALL emit a `webhook-version` header when the host opts into the versioning extension. Receivers SHALL surface the version on `verify` results.

#### Scenario: Send v2

- **WHEN** the host calls `send({ ..., version: '2' })` with versioning enabled
- **THEN** the outgoing request carries `webhook-version: 2`
- **AND** the receiver's `verify` exposes `version === '2'`

### Requirement: JWKS discovery extension

This capability is the **canonical source** for the JWKS shape used by Postel's asymmetric signing extension. The library SHALL define and serve a JWKS document at `/.well-known/webhooks-keys` (or `/tenants/:id/.well-known/webhooks-keys` in multi-tenant deployments). Each JWK entry MUST include:

- `kid` — stable key identifier referenced by the `webhook-signature` header's `kid` parameter.
- `alg` — signature algorithm; currently `EdDSA` for the `v1a` signature version.
- key material — the standard JWK fields for the algorithm (e.g., `crv`, `x` for Ed25519).
- `not_after` — OPTIONAL ISO-8601 timestamp at which this key stops being valid for verification; absent fields mean indefinite validity.

Other capabilities reference this shape rather than redefining it:

- `key-management` mounts the handler and rotates keys but defers JWKS field semantics to this requirement.
- `receiver` consumes the JWKS but defers field semantics to this requirement.
- The machine-readable wire fragment lives at [`specs/wire-format/asyncapi.yaml`](../../../specs/wire-format/asyncapi.yaml).

#### Scenario: JWKS exposes not_after

- **WHEN** an asymmetric key has a scheduled retirement at time T
- **THEN** its JWKS entry includes `not_after: T` (ISO-8601)

#### Scenario: Other specs cross-reference this requirement

- **WHEN** a contributor changes the JWKS field set (e.g., adds a new field)
- **THEN** the change is made here in `standard-webhooks-compliance`
- **AND** `key-management` and `receiver` automatically inherit the change without their own edits

### Requirement: IETF-alignment compatibility mode on the receiver

When IETF compatibility is enabled on the receiver side, `verify` SHALL accept either Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) or IETF-aligned headers (`Content-Digest`, `Idempotency-Key`).

#### Scenario: IETF headers accepted

- **WHEN** a request carries `Content-Digest` and `Idempotency-Key` and IETF mode is on
- **THEN** `verify` succeeds without requiring the Standard Webhooks header set

### Requirement: Compliance test suite

The library SHALL ship a vendor-neutral compliance test suite as a separate artifact (`@postel/compliance`). The suite MUST verify any HTTP receiver against the Standard Webhooks spec. The library's own implementation MUST pass its own suite in CI.

#### Scenario: Run suite against own implementation

- **WHEN** CI runs `@postel/compliance` against a receiver built with `@postel/edge`
- **THEN** the suite reports 100% pass

#### Scenario: Run suite against a third-party receiver

- **WHEN** a user points the suite at any HTTP receiver claiming Standard Webhooks compliance
- **THEN** the suite reports a per-test pass/fail breakdown without library coupling

