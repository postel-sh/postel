# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Keyset invariants enforced (ms-precision columns, binary id collation on MySQL); reconcile/replay date validation; bounded single-query reconcile in adapters. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Future ports MUST store keyset-ordered `createdAt` at exactly millisecond precision and compare ids with a deterministic total order (byte order canonical) — both are CONTRACT per ADR 0015. A µs-writing port would silently break paginated walks against the shared schema. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | modified | `timestamptz(3)` pinned on keyset-ordered `created_at` (tenants / endpoints / messages); MySQL dialect pins `utf8mb4_bin`. Applied in-place to `0001_init.sql` and the helpers migrations — pre-1.0, same-milestone schema, no released deployment to migrate. |

## Lockstep / lag

The two invariants are CONTRACT because every port shares the same database: a single port violating either (µs timestamps, case-insensitive id comparison) corrupts pagination for all ports reading the same tables. The rejection of malformed `since` is CONTRACT at the outcome level (never a silent unbounded read); the error type (`TypeError` vs a port-idiomatic error) is the port mechanism.
