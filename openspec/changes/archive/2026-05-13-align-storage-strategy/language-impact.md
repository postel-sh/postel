# Language impact

This change is a spec refactor — no runtime behavior changes, no code yet. It reframes the storage-layer requirements to match the accepted [Storage strategy ADR](../../../decisions/0007-storage-strategy.md). The same adapter-matrix pattern will apply to every language port; the spec is language-agnostic.

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | No code yet; the TS reference impl will be authored against the refined spec |
| typescript-receiver | unchanged | Same |
| go-sender (planned) | unchanged | Future Go change introduces Go-equivalent adapters (e.g., `@postel/go-pgx`, `@postel/go-gorm`) under the same matrix |
| go-receiver (planned) | unchanged | Same |
| python-sender (planned) | unchanged | Future Python change introduces Python-equivalent adapters (e.g., `@postel/py-psycopg`, `@postel/py-sqlalchemy`) |
| python-receiver (planned) | unchanged | Same |
| wire-format | unchanged | |
| db-schema | unchanged | Canonical DDL stays unchanged; what changes is per-adapter delivery |

## Lockstep / lag

No lockstep concerns. Each future language port introduces its own `Storage` interface implementation following this matrix. The contract is the same across languages — the compliance suite enforces parity.
