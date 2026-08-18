# Design — gate dedup ordering vs. a throwing handler

## Context

`handleInbound` (`@postel/http`) records the webhook-id in the configured dedup adapter, THEN invokes `opts.onVerified`. If the handler throws — the common case for a 5xx, e.g. a downstream write fails — the id is already recorded. The producer's retry (which webhook producers issue precisely because the first attempt got a non-2xx) is met with `2xx duplicate` and the handler never runs again. The event is silently and permanently lost. Issue #129 asks for one of two fixes: move the record to *after* the handler succeeds, or expose a transactional hook through the gate's `dedup` options so the record and the handler's business work commit together.

## Goals / Non-Goals

**Goals**
- A handler that throws MUST NOT permanently burn the webhook-id; the next retry MUST reach the handler again.
- Keep the existing atomic-record guarantee for genuinely concurrent deliveries of the same id (`record()`'s compare-and-set) — don't trade a known, tested guarantee for an unbounded new race.
- Land entirely inside the framework-agnostic gate (`@postel/http` + the `DedupAdapter` contract it depends on) — the gate has no notion of the adopter's own business transaction, so the fix can't assume one exists.

**Non-Goals**
- Achieving exactly-once processing under true concurrent duplicate delivery (two requests for the same id in flight at once). That is a separate, narrower problem, analyzed below and left as a documented trade-off.
- Wiring `tx` pass-through into the first-party `PgDedup`/`SqliteDedup`/`MysqlDedup` adapters for the *manual* `postel.inbound.<source>.dedup(id, { tx })` path. That path already accepts an opaque `tx` for adopters supplying their own tx-aware adapter; none of the shipped adapters route it to a client-scoped transaction today. That's a pre-existing, separate gap from #129's evidence (which is scoped to `handle-inbound.ts` and `types.ts`) and is out of scope here.

## Decisions

- **Record before the handler stays; release on failure is new.** Rejected the literal "record-after-success" reading (defer the `record()` call itself until after the handler returns) because the pre-handler check is what lets the gate skip re-invoking the handler for an already-completed delivery (the entire point of the feature, and an existing `receiver` scenario: "the same webhook-id arrives a second time within the TTL … the handler is NOT invoked"). Deferring `record()` to after the handler removes that pre-check entirely — every retry, not just concurrent ones, would re-run the handler, which is a strictly worse outcome than today's bug. Keeping `record()` before the handler (unchanged) and adding a compensating `release()` on failure preserves the skip-on-duplicate guarantee for the common sequential-retry case while still satisfying the acceptance criterion.
- **`release` is a new optional `DedupAdapter` method, not a `tx`/hook surface on the gate.** A transactional hook (option B in the issue) would require the gate to open a transaction that both the dedup record and the adopter's arbitrary `onVerified` callback participate in. `onVerified` is framework-agnostic and may not touch a database at all (it could call an external API, enqueue a job, anything) — the gate has no business transaction to offer it. Building one would mean either (a) forcing adopters into a specific storage's transaction API at the gate boundary, coupling `@postel/http` to a storage backend it doesn't otherwise depend on, or (b) it degrades to exactly the manual `.dedup(id, { tx })` pattern that already exists for adopters who both need strict atomicity and are willing to wire their own transaction — which remains available and is unaffected by this change. `release()` gets the required outcome (handler failure never permanently burns the id) without either cost.
- **`release` is optional and best-effort.** The gate calls `source.dedupRelease?.(messageId)` in a try/catch that never masks the original handler error — a release failure (adapter down, network blip) still surfaces the real 5xx to the caller, at the cost of leaving the id recorded (today's behavior) for that one instance. Adapters that don't implement `release` (a custom third-party adapter) silently keep today's behavior rather than throwing a new error — no regression, and the gap is named in docs.
- **Implemented in all four first-party adapters** (`InMemoryDedup`, `PgDedup`, `SqliteDedup`, `MysqlDedup`) so the fix is real for every adapter this repo ships, not just in-memory. Each adapter's `release` is a straightforward delete keyed on `message_id` against the same table `record()` already owns — no new table, no new column, no migration.

## Concurrent-duplicate window — analyzed

Sequence for two deliveries of the same id, `A` (original) and `B` (concurrent duplicate), arriving while `A`'s handler is still running:

1. `A` calls `dedup()` first, `record()` is atomic → `A` gets `duplicate: false`, `B` gets `duplicate: true`. `B` responds `2xx duplicate` immediately and never runs the handler — unchanged from today, still race-safe (the `receiver` spec's "Concurrent dedup calls" scenario is untouched).
2. `A`'s handler throws. The gate calls `release(messageId)`, deleting the record.
3. `A`'s request itself gets the handler's error (propagates as the caller's own 5xx, exactly as before this change).

The gap: `B` already answered its caller with `2xx duplicate` in step 1, before `A`'s failure was known. If `B`'s caller and `A`'s caller are the *same* retrying producer following normal webhook semantics (retry on non-2xx), the producer retries because of `A`'s 5xx, not because of `B`'s 2xx — that retry lands after `release()` has run and reaches the handler again, satisfying the acceptance criterion. Data loss requires a producer that sent two *literally concurrent* deliveries of the same id AND never retries the one that received the 5xx — a narrower and less common failure mode than "any handler throw permanently loses the event," which is what #129 reports. This is accepted and documented rather than closed, because closing it fully requires a non-mutating pre-check (`peek`) added across every `DedupAdapter` implementation — a materially larger change than the bug it would prevent justifies here.

## Risks / Trade-offs

- *Risk:* adopters using a custom third-party `DedupAdapter` without `release` see no improvement. → *Mitigation:* documented; `release` is additive and optional, so existing custom adapters keep compiling and keep today's (bug-present) behavior until they add it.
- *Risk:* an unconditional `DELETE WHERE message_id = ?` can delete a *different, legitimate* record if the original record's TTL expires and a brand-new delivery re-records the same id WHILE the original (very slow, now-failing) handler is still in flight — `release()` would then wipe out the new delivery's fresh record. → *Mitigation:* accepted, not closed. TTLs are chosen to be much larger than handler latency (the docs already recommend 24h–7d, i.e. hours-to-days vs. a handler that runs in seconds-to-minutes), so a handler outliving the TTL is already a misconfiguration outside this fix's scope. Closing this fully would need a per-write token (e.g. `DELETE … WHERE message_id = ? AND recorded_at = ?`) threaded through every adapter — deferred until it's an observed problem rather than a theoretical one.

## Open Questions

None blocking.
