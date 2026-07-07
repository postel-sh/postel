## MODIFIED Requirements

### Requirement: v0.2.0 sender-side initial test scope

The v0.2.0 corpus SHALL cover the following CONTRACT requirements via sender-mode vectors:

| Capability | Requirement |
|---|---|
| `sender` | Send is non-blocking and returns a SendResult |
| `sender` | Idempotent send by client-supplied key |
| `sender` | Late-binding fanout |
| `sender` | Per-message TTL |
| `sender` | Per-endpoint and overall delivery deadlines |
| `sender` | Per-endpoint custom HTTP headers |
| `sender` | SSRF protection on outbound delivery |
| `sender` | Attempt status enum casing |
| `retry-policy` | Default retry schedule with jitter |
| `retry-policy` | Programmable per-endpoint retry policy |
| `retry-policy` | Status-code-aware retry |
| `retry-policy` | Dead-letter event |
| `endpoint-management` | URL validation at create time |
| `endpoint-management` | Endpoint state machine with audit trail |
| `filtering-transformation` | Type filter with glob support |
| `filtering-transformation` | Channel filter |
| `standard-webhooks-compliance` | Compliant headers, signatures, payload structure, and prefixes by default |
| `multi-tenancy` | Tenant-scoped persistence |

The vector enumeration spans ~28 files across 10 sub-categories: `sender/wire-output/*` (4), `sender/idempotency/*` (2), `sender/fanout/*` (3), `sender/ttl/*` (2), `sender/retry-schedule/*` (4), `sender/deadlines/*` (2), `sender/ssrf-tls/*` (3), `sender/dead-letter/*` (2), `sender/filtering/*` (4), `sender/multi-tenancy/*` (2).

The `filtering-transformation` corpus covers the two filter shapes that the wire-driven control plane can express — type-glob and channel — each with a match and a no-match vector (`sender/filtering/{type-filter-glob-match,type-filter-glob-no-match,channel-filter-match,channel-filter-no-match}`). Three `filtering-transformation` CONTRACTs are intentionally NOT in this corpus and are deferred (see `Out-of-scope behaviors at the current MINOR`): "Late binding at dispatch time" needs a control-plane `update_endpoint` op (its new-endpoint facet stays covered by `sender/fanout/late-binding-new-endpoint`); "Transform produces body to send" and "Filter and transform errors fail closed" are code-side host-callback behaviors — a transform/predicate is a function, not JSON, so neither is expressible over the control plane — and stay covered by each port's unit suite. The contract-set table lists exactly the requirements some vector's `requirement` field names, so the enumeration scenario's union check holds.

#### Scenario: All v0.2.0 contracts and vectors enumerated

- **WHEN** the CLI is invoked with `--format json --sender-control <url>` and the suite is at version `0.2.x`
- **THEN** the output's test set matches the vector enumeration above (~28 vectors), no more and no less
- **AND** the union of the vectors' `requirement` fields equals the CONTRACT requirements in the contract-set table

#### Scenario: A port version v0.2.0 passes every sender vector

- **WHEN** the runner is pointed at a port's `@postel/compliance-driver`-equivalent at version `0.2.0`
- **THEN** every sender vector exits with `pass`
- **AND** any failure blocks the port's lockstep release per `Lockstep versioning with the @postel/* release train`
