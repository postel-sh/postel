## MODIFIED Requirements

### Requirement: Timestamp window enforcement

`verify` SHALL reject signatures whose `webhook-timestamp` header is older or further in the future than a configurable window (default 5 minutes per Standard Webhooks). The window SHALL be configurable as an integer number of seconds or as a duration string in the shared `"<integer><s|m|h|d>"` grammar (e.g. `"5m"`), and the current time SHALL come from an injectable clock so receivers can verify deterministically in tests.

#### Scenario: Stale timestamp

- **WHEN** the `webhook-timestamp` header is 10 minutes old and the window is 5 minutes
- **THEN** `verify` throws `TIMESTAMP_TOO_OLD`

#### Scenario: Duration-string window

- **WHEN** the window is configured as `"10m"` and the `webhook-timestamp` header is 9 minutes old
- **THEN** `verify` succeeds, identically to a window configured as `600` seconds

### Requirement: JWKS consumer

The library SHALL provide `createJwksKeyset({ jwksUri, refreshEvery, cacheTtl })` returning a `JwksKeyset` that auto-fetches, caches, and rotates a JWKS, performs `kid` lookup on incoming requests, and is usable as the `secretOrKeyset` argument to `verify`. The keyset constructor and the keyset type are named distinctly from any verifier-strategy factory (in the TypeScript port, `Keyset()` names the verifier factory), so a reader can tell the verifier, the keyset object, and the keyset type apart by name.

#### Scenario: kid lookup hit

- **WHEN** an incoming request carries `webhook-id` with a known `kid` and the keyset has cached that key
- **THEN** verification proceeds against that key
