# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | In-memory `schemaVersion()` realigned to the canonical version (`3`). No reservation-behavior change — the in-memory `MessageRow` already tracks attempt / scheduled / replay state. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | A Go SQL adapter MUST persist the `messages` dispatch-state columns; the schema is shared. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same shared-schema requirement. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same shared-schema requirement. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | modified | New forward-only migration `0003_message_dispatch_columns.sql` adds `attempt_number`, `scheduled_for`, `replay_of` to `messages` and bumps `schema_version` to `3`. Shared across all ports. |

## Lockstep / lag

CONTRACT-level DB-schema change. The `messages` dispatch-state columns are part of the cross-port schema contract — every SQL-backed port adapter persists them, and `reserveBatch` reads them back into a `ReservedMessage`. The migration is forward-only and idempotent; ports adopt it as their SQL adapters land. No port can claim a SQL-backed `Storage` adapter without these columns.
