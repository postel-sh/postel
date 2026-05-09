# Standard Webhooks compliance — delta spec

## ADDED Requirements

### Requirement: Compliant headers, signatures, payload structure, and prefixes by default

Outgoing deliveries SHALL use Standard Webhooks-compliant headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`), signature versions (`v1` for HMAC, `v1a` for Ed25519), payload structure (`type`, `timestamp`, `data`), and secret prefixes (`whsec_`, `whsk_`, `whpk_`).

#### Scenario: HMAC v1 outgoing

- **WHEN** a delivery is signed with a `whsec_`-prefixed key
- **THEN** the request carries `webhook-signature: v1,<base64>` and the standard id/timestamp headers

### Requirement: Wraps the official signing library

The library SHALL wrap the official `standardwebhooks` JS signing library where possible rather than reimplementing crypto.

#### Scenario: Signing crypto delegated

- **WHEN** the implementation produces a `v1` signature
- **THEN** the underlying primitive is the official library's signer

### Requirement: Versioning extension via webhook-version header

The library SHALL emit a `webhook-version` header when the host opts into the versioning extension. Receivers SHALL surface the version on `verify` results.

#### Scenario: Send v2

- **WHEN** the host calls `send({ ..., version: '2' })` with versioning enabled
- **THEN** the outgoing request carries `webhook-version: 2`
- **AND** the receiver's `verify` exposes `version === '2'`

### Requirement: JWKS discovery extension

The library SHALL define and serve a JWKS document at `/.well-known/webhooks-keys` that includes `kid`, `alg`, key material, and optional `not_after` for each entry. The shape MUST match the JWKS discovery extension spec.

#### Scenario: JWKS exposes not_after

- **WHEN** an asymmetric key has a scheduled retirement at time T
- **THEN** its JWKS entry includes `not_after: T`

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
