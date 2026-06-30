## MODIFIED Requirements

### Requirement: TLS verification by default

Outbound deliveries SHALL verify TLS certificates by default. Disabling TLS verification per endpoint MUST require an explicit opt-in flag and MUST emit a warning.

**Interim (TypeScript port):** TLS-on is the runtime default (Node `fetch` verifies certificates), so the default behavior holds today. The per-endpoint opt-out path (`http.tls`, e.g. `{ verify: false }`) is not yet wired; configuring `http.tls` at the org level or as a per-endpoint override therefore throws `NotImplementedError` rather than silently leaving verification on. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Default TLS

- **WHEN** an endpoint has no TLS opt-out
- **THEN** the dispatcher uses standard TLS verification and rejects invalid certificates

### Requirement: DNS rebinding protection

For each delivery attempt, the dispatcher SHALL resolve the endpoint hostname once and pin the resolved IP for the duration of the connection. Re-resolution mid-connection MUST NOT change the target IP.

**Interim (TypeScript port):** the dispatcher validates every resolved address against the SSRF policy, but connection-time IP pinning has not shipped. The `http.dns` config slot (e.g. `{ pinResolution: true }`) is not yet wired; configuring it throws `NotImplementedError` rather than advertising a guarantee the runtime does not yet provide. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Pinned IP

- **WHEN** a delivery resolves `hooks.example.com` to `203.0.113.10` and starts a connection
- **THEN** the connection uses `203.0.113.10` even if DNS subsequently changes
