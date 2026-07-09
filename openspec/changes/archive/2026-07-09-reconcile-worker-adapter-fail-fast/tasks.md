## 1. Spec reconciliation

- [x] 1.1 `sender/spec.md`: add the **Interim (TypeScript port)** note to "Adapter mode for external job queues", matching the pattern used by "TLS verification by default" / "DNS rebinding protection".
- [x] 1.2 `api-surface-typescript/spec.md`: add `outbound.workers` to the enumerated slot list in "Unimplemented config slots fail fast at construction"; add the "Non-in-process worker strategies fail fast" scenario.

## 2. Test parity

- [x] 2.1 `typescript/packages/core/test/keys-replay.test.ts`: add `BullMQ(...)` and `PgBoss(...)` fail-fast assertions alongside the existing `External(...)` one, in the same "Adapter mode for external job queues" describe block.

## 3. Verification

- [x] 3.1 Run `mise run check:all` at the repo root.
- [x] 3.2 Run the `@postel/core` test/lint/typecheck/build chain — confirm no source changes were needed (the fail-fast behavior was already correct).
