## Why

The HTTP gate's dedup-ack (`opts.dedup` in `handleInbound`) records the webhook-id BEFORE invoking the adopter's `onVerified` handler. If the handler throws, the producer's retry is answered `2xx duplicate` — the event is acknowledged and permanently lost, because the id is already burned in the dedup adapter and the gate never gives it back. The transactional fix for this class of problem exists today, but only on the manual `postel.inbound.<source>.dedup(id, { tx })` path, and even that path doesn't wire `tx` through to any first-party adapter. The gate's own `dedup` option carries only a `ttl` (`@postel/http`'s `DedupAckOptions`), and the docs never warn adopters that a throwing handler burns the id.

## What Changes

- **Gate dedup releases the id when the handler throws.** `handleInbound` now wraps `onVerified` in a try/catch: on a fresh (non-duplicate) dedup record, if the handler throws, the gate calls a new best-effort `release(messageId)` on the dedup adapter before rethrowing, undoing the just-written record so the next retry is treated as unseen and reaches the handler again.
- **`DedupAdapter` gains an optional `release(messageId): Promise<void>`.** Implemented in all first-party adapters shipped in this repo — `InMemoryDedup`, `PgDedup`, `SqliteDedup`, `MysqlDedup` — so the gate's failure-recovery guarantee holds out of the box. An adapter that omits `release` keeps today's behavior (documented, not a regression: the gate simply cannot release what the adapter cannot delete).
- **Concurrent-duplicate window, analyzed and accepted:** the pre-handler dedup check stays atomic (`record()`'s existing compare-and-set), so two genuinely concurrent deliveries of the same id still see exactly one `duplicate: false` — unchanged from today. The new gap is narrower: if the winning delivery's handler later fails and its id is released, a concurrent duplicate that arrived *during* that handler's execution already received a `2xx duplicate` ack and will not itself retry. Recovery still happens because the *original* (failing) delivery got a 5xx and the producer's retry policy is defined against that response — the retry that matters reaches the handler again. This is documented as a known, bounded trade-off rather than solved with a transactional gate hook (see `design.md`).
- **Docs**: new "Delivery semantics of gate-level dedup" section on `docs/content/docs/inbound/deduplication.mdx` explaining the ordering, the release-on-failure behavior, and the concurrent-duplicate trade-off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`receiver`** — MODIFIED *Framework adapters offer optional dedup-acknowledgement*: specify that the dedup record MUST be released when the handler throws, add the release-capable-adapter conformance note, and add scenarios for handler failure and the bounded concurrent-duplicate window.

## Wire-format / DB-schema impact

None. No new HTTP status, header, or wire field; no new table or column — `release` deletes a row from the same dedup table `record()` already writes.

## Impact

- `@postel/core`: `DedupAdapter.release?` added to `types.ts`; `InMemoryDedup` (`strategies/dedup.ts`) implements it; `InboundSourceApi` (`inbound.ts`) exposes a bound `dedupRelease` alongside `dedup` when the source has a dedup adapter.
- `@postel/http`: `GateSource.dedupRelease?` added to `types.ts`; `handleInbound` wraps the handler call and releases on failure.
- `@postel/pg`, `@postel/sqlite`, `@postel/mysql`: `PgDedup`/`SqliteDedup`/`MysqlDedup` implement `release`.
- Docs: `docs/content/docs/inbound/deduplication.mdx` gains the delivery-semantics section.
- Tests: `@postel/core` (adapter `release` unit coverage) and `@postel/http` (`dedup-ack.test.ts` — handler-throw scenario) plus the new `receiver` spec scenarios.
