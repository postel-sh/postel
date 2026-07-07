# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | Outbound surface untouched; no sender throw site migrates. |
| typescript-receiver | modified | Developer-configuration throw sites move from `MalformedHeader` to the new non-`PostelError` `ConfigurationError`; the inbound composition loop rethrows it immediately. Wire-parsing sites keep `MalformedHeader`. |
| go-sender (planned) | unchanged | |
| go-receiver (planned) | unchanged | The OUTCOME — configuration mistakes are not classifiable as wire errors and never map to a 4xx — is CONTRACT for every port. The `ConfigurationError` class name, its `code` string, and the exact migrated call sites are TypeScript-port mechanisms; other ports MAY surface configuration bugs through their own idioms (panic, distinct exception type, error kind), provided the HTTP-mappable error vocabulary excludes them. |
| python-receiver (planned) | unchanged | Same as go-receiver. |
| python-sender (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | Same as go-receiver. |
| wire-format | unchanged | Configuration errors never cross the wire; the `MALFORMED_HEADER` wire vocabulary is untouched. |
| db-schema | unchanged | |

## Lockstep / lag

No lockstep required. Planned ports MAY lag; when a port's receiver ships, its configuration-mistake failure mode MUST already sit outside the HTTP-mappable error set (this is a contract-freeze item — see #85, `breaking-if-deferred`).
