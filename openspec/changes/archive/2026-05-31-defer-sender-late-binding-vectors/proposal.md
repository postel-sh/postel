## Why

The two `sender/late-binding/*` vectors added to the v0.2.0 corpus couldn't actually exercise late binding without a control-plane `update_endpoint` operation (you can't mutate a registered endpoint's config mid-retry otherwise). A prior review round reactively added `update_endpoint` to the cross-port compliance control plane to make them coherent — but that expands a CONTRACT surface every future port (Go, Python, Rust) must implement, and it was added for vectors the Go runner's sender-mode engine cannot even execute yet (it's still a stub). That's premature: it locks cross-port contract before the execution path is real, against the "defer honestly until exercised" direction already taken for DNS-rebinding and dispatch-time SSRF.

This change backs that out. `update_endpoint` is removed from the control plane, and the two late-binding vectors are deferred from the v0.2.0 corpus. The `filtering-transformation` "Late binding at dispatch time" behavior remains covered by the `@postel/core` unit suite (the dispatcher re-reads endpoint config per attempt) and, at the corpus level, by `sender/fanout/late-binding-new-endpoint` (an endpoint created after `send()` is picked up at dispatch). The dedicated late-binding-via-config-update vectors land when the Go sender-mode runner executes and the full sender-compliance control surface is designed deliberately.

## What Changes

- Drop `sender/late-binding/*` (2 vectors) from the v0.2.0 corpus → ~28 vectors across 10 sub-categories.
- Remove the `filtering-transformation` / "Late binding at dispatch time" row from the v0.2.0 contract-set table (no corpus vector covers it after the deferral; the unit suite still does).
- Add late-binding-via-endpoint-update to the deferred list in `Out-of-scope behaviors at the current MINOR`, noting it needs an `update_endpoint` control-plane op + an executing sender-mode runner.
- Code (carried by the same PR, not this spec change): remove the `update_endpoint` trigger from the vector schema and Go runner struct, remove the `/control/endpoints/update` driver route + its test, delete the two vector files. The `http`-config forwarding on register and the per-request-timeout vector's `http.requestTimeout` stay (independently correct).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`compliance`**:
  - `v0.2.0 sender-side initial test scope` — contract-set table drops the late-binding-at-dispatch row; enumeration becomes ~28 vectors / 10 sub-categories (no `late-binding/*`); the "All v0.2.0 contracts and vectors enumerated" scenario count updated.
  - `Out-of-scope behaviors at the current MINOR` — adds late-binding-via-endpoint-update as deferred (needs `update_endpoint` + executing runner).

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/compliance/spec.md` — two requirements modified.
- `compliance/schema/vector.schema.json`, `compliance/cli/vector.go` — `update_endpoint` / `target` removed.
- `typescript/packages/compliance-driver/src/server.ts` + test — update route + its test removed.
- `compliance/vectors/sender/late-binding/` — deleted.
- `compliance/CHANGELOG.md` — enumeration updated to ~28 / 10 sub-categories.
