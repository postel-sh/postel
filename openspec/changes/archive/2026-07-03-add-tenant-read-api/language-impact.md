# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Adds the outbound read surface `outbound.tenants.{get,list}`, backed by new `Storage.tenants.list` / widened `Storage.tenants.get` (implemented across all TS adapters) and admin `GET /tenants`, `GET /tenants/:id` routes. Reads only — no dispatch/signing change. |
| typescript-receiver | unchanged | Inbound verify/dedup untouched. |
| go-sender (planned) | unchanged | A future sender port MUST expose an equivalent read (a tenant is retrievable by id, and tenants are listable in a bounded, paginated, newest-first order) — that OUTCOME is CONTRACT. The method names (`tenants.get` / `.list`), the `Storage` operation names, the cursor-pagination mechanism, and the `RateLimitStrategy` shape are TypeScript-port mechanisms; other ports MAY surface the reads and rate-limit configuration through their own idioms. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | Reads only; `metadata.rateLimit` gains an additive `kind` key. |
| db-schema | unchanged | Reads existing `tenants` columns; no new columns. |

## Lockstep / lag

The CONTRACT addition is the read OUTCOME: a tenant is retrievable by id, and tenants are listable in a bounded, newest-first, paginated order. Any sender port SHALL provide this before it can claim tenant-observability parity, but MAY lag until it implements a sender. The TypeScript method surface, the `Storage.tenants.get` / `Storage.tenants.list` operation shape, the keyset-cursor mechanism, and the `RateLimitStrategy` kind-discriminated-union shape are reference-implementation mechanisms a port MAY vary.
