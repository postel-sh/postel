# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | In-memory `schemaVersion()` realigned to `4`. No behavior change — the in-memory record already holds the config fields. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | A Go SQL adapter MUST persist the `endpoints` delivery-config columns; the schema is shared. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same shared-schema requirement. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same shared-schema requirement. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | modified | New forward-only migration `0004_endpoint_config_columns.sql` adds `allow_http`, `max_inflight`, `http`, `circuit_breaker`, `auto_disable` to `endpoints`; bumps `schema_version` to `4`. Shared across all ports. |

## Lockstep / lag

CONTRACT-level DB-schema change. The `endpoints` delivery-config columns are part of the cross-port schema contract — every SQL-backed port adapter persists them. Forward-only and idempotent; ports adopt it as their SQL adapters land.
