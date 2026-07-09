## ADDED Requirements

### Requirement: Multi-verifier failures are aggregated [PORT-SPECIFIC]

When an inbound source composes several verifiers and none match, the rejected `postel.inbound.<source>.verify(...)` error SHALL expose **every** verifier's failure, not only the last one. In the TypeScript port the thrown error carries `errors: ReadonlyArray<{ verifierIndex: number; error: Error }>` — one entry per verifier that rejected, in configuration order — and its `cause` is a standard `AggregateError` wrapping the same underlying errors. This makes "which verifier rejected and why" a property read rather than archaeology.

When **every** verifier rejects with `MalformedHeader` (a wire-format failure — missing/unparsable signing headers, a malformed signature tuple, or a malformed event envelope), the composition loop SHALL surface `MalformedHeader` itself rather than `SignatureInvalid`; both map to HTTP 400 at the gate, so this is a diagnostic refinement, not a wire-status change. Otherwise the loop SHALL surface `SignatureInvalid`. `TimestampTooOld` and `ConfigurationError` keep their existing behavior: the loop rethrows them immediately rather than aggregating them.

**Conformance**: PORT-SPECIFIC. The `errors` array shape, the `AggregateError` cause, and the unanimous-`MalformedHeader` surfacing are TypeScript-port diagnostics; both the aggregated and the collapsed outcomes map to the same HTTP 400, so the compliance suite does not distinguish them. The durable intent — a multi-verifier rejection is diagnosable down to the individual verifier — is shared; other ports expose it through their own idioms. The composition ordering and `matchedVerifierIndex` remain CONTRACT under *Verifier strategy composition*.

#### Scenario: Every verifier failure is exposed

- **WHEN** a source configures two verifiers that both reject a request with distinct errors and `postel.inbound.<source>.verify(...)` is awaited
- **THEN** the rejected error's `errors` has one `{ verifierIndex, error }` entry per verifier in configuration order
- **AND** the error's `cause` is an `AggregateError` wrapping the same underlying errors

#### Scenario: Non-unanimous failures surface as SignatureInvalid

- **WHEN** at least one verifier rejects with `SignatureInvalid` and no verifier matches
- **THEN** `postel.inbound.<source>.verify(...)` rejects with `SignatureInvalid`
- **AND** `errors` still lists every verifier's failure

#### Scenario: Unanimous MalformedHeader surfaces as MalformedHeader

- **WHEN** every configured verifier rejects the request with `MalformedHeader`
- **THEN** `postel.inbound.<source>.verify(...)` rejects with `MalformedHeader` rather than `SignatureInvalid`
- **AND** `errors` lists each verifier's `MalformedHeader`

### Requirement: Consumed raw body surfaces a descriptive configuration error [PORT-SPECIFIC]

A framework gate reads the raw request bytes to verify. When those bytes have already been consumed by an upstream body parser (the single most common webhook integration mistake — e.g. a global `express.json()` registered before the webhook route), the gate MUST NOT feed an empty or re-serialized body into verification, because that degrades into a misleading `SIGNATURE_INVALID`. Instead the gate SHALL throw a descriptive `ConfigurationError` that names the likely cause and points at body-parser ordering. Because `ConfigurationError` is outside the `PostelError` hierarchy, it is not mapped to a 4xx by the gate's status table; it bubbles as a 5xx (integrator bug), distinct from a client signature failure.

**Conformance**: PORT-SPECIFIC. The consumed-body hazard is specific to frameworks whose body parsers consume the request stream (Express/Node body-parser ordering); the `ConfigurationError` mechanism is a reference-implementation ergonomic. Other ports guard their own equivalent hazards through their own idioms. The compliance suite does not exercise adopter middleware ordering.

#### Scenario: Body-parser ordering yields a descriptive error, not a signature failure

- **WHEN** an Express app registers a global body parser (`express.json()`) before a gate-protected webhook route, so the gate sees a non-`Buffer` `req.body`
- **THEN** the gate raises a `ConfigurationError` whose message points at body-parser ordering
- **AND** the failure surfaces as a 5xx, not a `SIGNATURE_INVALID` 400
