# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Adds the outbound read surface `outbound.messages.{get,attempts,list}`, backed by new `Storage.getMessage` / `Storage.listMessages` (implemented across all TS adapters) and admin `GET /messages`, `/messages/:id`, `/messages/:id/attempts` routes. Reads only — no dispatch/signing change. |
| typescript-receiver | unchanged | Inbound verify/dedup untouched. |
| go-sender (planned) | unchanged | A future sender port MUST expose an equivalent read (a message + its attempt history are retrievable, and messages are listable/filterable) — that OUTCOME is CONTRACT. The method names (`messages.get` / `.attempts` / `.list`) and the `Storage` operation names are TypeScript-port mechanisms; other ports MAY surface the reads through their own idioms. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | Reads only. |
| db-schema | unchanged | Reads existing `messages` / `attempts` columns; no new columns. |

## Lockstep / lag

The CONTRACT addition is the read OUTCOME: a message and its delivery-attempt history are retrievable, and messages are listable/filterable by tenant / type / status / time. Any sender port SHALL provide this before it can claim delivery-observability parity, but MAY lag until it implements a sender. The TypeScript method surface, the `Storage.getMessage` / `Storage.listMessages` operation shape, and the admin route paths are reference-implementation mechanisms a port MAY vary.
