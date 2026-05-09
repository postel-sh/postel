# Language impact

This is a structural / documentation migration — no language code is being written or changed. It establishes the polyglot-aware spec framework that future port-adding changes will flow through.

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | No code yet; the TS reference impl will be authored in subsequent changes against the new capability specs |
| typescript-receiver | unchanged | Same as above |
| go-sender (planned) | unchanged | Future change `add-go-sender` will introduce capability `api-surface-go` |
| go-receiver (planned) | unchanged | Future change `add-go-receiver-sdk` will introduce capability `api-surface-go` |
| python-sender (planned) | unchanged | Roadmap, post-Go |
| python-receiver (planned) | unchanged | Roadmap, post-Go |
| wire-format | unchanged | `specs/wire-format/asyncapi.yaml` is a NEW skeleton for the existing Standard Webhooks-compliant wire format; no spec change |
| db-schema | unchanged | `specs/db-schema/0001_init.sql` is a NEW canonical DDL file for the existing schema design; no spec change |

## Lockstep / lag

No lockstep concerns — this is a documentation / process change. Subsequent changes that add language ports MUST declare lockstep / lag explicitly in their own `language-impact.md`.
