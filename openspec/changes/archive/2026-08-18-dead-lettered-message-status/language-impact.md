# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `MessageStatus` gains `dead-lettered`; `dispatchMessage` finalization rule updated; all 8 storage adapters + testkit + admin pick it up generically. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Must adopt the same `dead-lettered` vocabulary and finalization rule when built (CONTRACT). |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Must adopt the same `dead-lettered` vocabulary and finalization rule when built (CONTRACT). |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | Message status is never carried on the wire to receivers. |
| db-schema | modified | `messages.status` stays a free-text column (no CHECK constraint, no column DDL); `_postel_meta.schema_version` bumps to document the new canonical vocabulary. |

## Lockstep / lag

The `MessageStatus` vocabulary and the dead-lettered finalization rule are CONTRACT (verified by `@postel/compliance` once that suite lands). Unbuilt ports (Go, Python, Rust) MUST implement this vocabulary and rule when they add sender/message-introspection support — no lag permitted for a capability they don't yet have.
