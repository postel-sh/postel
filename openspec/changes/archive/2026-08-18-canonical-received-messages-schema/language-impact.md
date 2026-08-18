# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | |
| typescript-receiver | modified | `pg` and `sqlite` `Storage.dedup()` gain the `expires_at` index already present on their standalone dedup-adapter siblings; no behavioral change. |
| go-sender (planned) | unchanged | |
| go-receiver (planned) | unchanged | Must implement `postel_received_messages` per the canonical shape (CONTRACT: table + column shape; the mechanism — auto-migrate vs. host-owned migration — stays PORT-SPECIFIC) once built. |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | Same obligation as go-receiver once built. |
| wire-format | unchanged | Dedup state is never carried on the wire. |
| db-schema | modified | New canonical `postel_received_messages` table + `expires_at` index (`0007_received_messages_dedup_table.sql`). |

## Lockstep / lag

The `postel_received_messages` shape is now CONTRACT (the dedup *behavior* already was; this closes the schema-documentation gap). Unbuilt ports (Go, Python, Rust) MUST implement this table shape when they add receiver/dedup support — no lag permitted for a capability they don't yet have.
