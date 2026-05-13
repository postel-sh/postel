# standard-webhooks-compliance — delta spec

## MODIFIED Requirements

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
