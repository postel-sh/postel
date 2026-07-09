## Why

`BullMQ(queue: unknown)`, `PgBoss(boss: unknown)`, and `External(adapter: unknown)` are factories with untyped params and no dispatch runtime — configuring any of them already throws `NotImplementedError` at construction (`buildOutboundRuntime` treats every non-`in-process` `workers.kind` this way), per the locked decision from the M1 config audit (`archive/2026-06-30-config-honesty-audit`, generalizing the precedent workers already set). That decision and its outcome are correctly implemented, but the specs describing it have drifted from that reality in two ways:

- `sender`'s *Adapter mode for external job queues* requirement describes a working BullMQ adapter with no interim note, unlike its sibling requirements (*TLS verification by default*, *DNS rebinding protection*) that got an **Interim (TypeScript port)** note during the same audit.
- `api-surface-typescript`'s *Unimplemented config slots fail fast at construction* requirement generalizes "the existing `workers` behavior" in its prose, but its own enumerated slot list and scenario set never actually named `outbound.workers` — the flagship precedent is undocumented in the place that catalogs it.

Fixing the spec text is the actionable half of this change (per AGENTS.md rule 1: fix the spec via a change before/instead of touching working code that's already correct). The other stated part of issue #97 — typing `BullMQ`/`PgBoss`/`External`'s params and shipping their runtimes — is explicitly deferred ("ship complete later"); this change does not do that.

## What Changes

- `sender`: *Adapter mode for external job queues* gains an **Interim (TypeScript port)** note pointing at the `api-surface-typescript` fail-fast requirement, matching the pattern already used for TLS/DNS. The target-state scenario (BullMQ jobs invoking library dispatch) is unchanged — it documents intent, not current behavior, exactly like the DNS-pinning scenario it sits beside.
- `api-surface-typescript`: *Unimplemented config slots fail fast at construction* adds `outbound.workers` (`bullmq` / `pg-boss` / `external`) to its enumerated slot list and gains a scenario asserting all three throw `NotImplementedError` identically.
- Test parity: `BullMQ(...)` and `PgBoss(...)` get the same fail-fast assertion `External(...)` already had (only `External` was previously tested for the throw).
- No runtime or type changes — `BullMQ`/`PgBoss`/`External`'s `unknown` params and the fail-fast behavior are untouched, per the issue's own deferral.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sender`: MODIFIED "Adapter mode for external job queues" — adds the interim fail-fast note.
- `api-surface-typescript`: MODIFIED "Unimplemented config slots fail fast at construction" — adds `outbound.workers` to the slot list and a corresponding scenario.

## Wire-format / DB-schema impact

None.

## Impact

- `typescript/packages/core/test/keys-replay.test.ts` — adds `BullMQ`/`PgBoss` fail-fast tests alongside the existing `External` one, under the same "Adapter mode for external job queues" describe block.
- No `src/` changes: `strategies/workers.ts` and `outbound.ts`'s `buildOutboundRuntime` already implement the documented behavior correctly.
