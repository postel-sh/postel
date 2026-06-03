## MODIFIED Requirements

### Requirement: Lockstep versioning with the `@postel/*` release train

The compliance suite (vectors + runner) SHALL be published as a `MAJOR.MINOR` version and carry **no PATCH component**; every `@postel/*` port shares that `MAJOR.MINOR` line and extends it with its own `PATCH`. "Lockstep" governs the version *numbers*, not release *timing*: a port at version `X.Y.Z` claims conformance by passing the compliance suite at version `X.Y` end-to-end before release. The port's `PATCH` (`Z`) is its own bugfix space — every `X.Y.Z` for a fixed `X.Y` conforms to the same suite `X.Y`, and the suite never publishes a patch of its own. The suite's distribution channel (npm package, container image, source build, binary release) is open and PORT-SPECIFIC; the version coordination is CONTRACT regardless of channel.

The compliance suite is the **leading edge**. A new requirement lands in the suite as a MINOR bump (`X.Y` → `X.(Y+1)`) first; each port adopts it on its own schedule and, when it does, releases a port version on the matching `MAJOR.MINOR`. During the `0.x` line, release timing is **independent per artifact**: the suite's latest version MAY be ahead of any given port's latest release (e.g., the suite at `0.3` while the newest TypeScript release is still `0.2.4`). A port is never required to move to a new suite MINOR at the same time as the suite; it is only required to pass `compliance@X.Y` whenever it releases an `X.Y.Z`.

At each **MAJOR boundary** (`1.0` and every major thereafter), the suite and all `@postel/*` ports cut the major **together** as a coordinated release — this is where VISION §8's "release together" rule applies. Within a major, the suite's MINOR bumps and each port's MINOR/PATCH releases ship independently per artifact under the leading-edge model above.

There is no ADVISORY phase, no runway window, and no independent per-port suite: the corpus at version `X.Y` is what every conformant port releasing on `X.Y` MUST satisfy. New tests land in the suite MINOR where they first appear and are required of any port releasing on that `MAJOR.MINOR` or later. Pre-1.0 (`0.x`) lives under VISION §8's experimental-semantics regime: suite MINORs MAY break ports, and the OpenSpec change history is the canonical record.

Breaking modifications and test removals follow the MAJOR-bump rule that governs every `@postel/*` package; the runway-based evolution model sketched in [ADR 0009](../../../decisions/0009-compliance-suite-evolution.md) remains **Deferred** until a second independently-maintained port makes graduated adoption valuable.

**Conformance**: the shared `MAJOR.MINOR` suite line, the suite's no-PATCH rule, the `X.Y` version-match (a port `X.Y.Z` passes `compliance@X.Y`), and the coordinated MAJOR cut are CONTRACT (cross-port). The independence of pre-1.0 release *timing*, each port's `PATCH` cadence, the CI mechanism a port uses to verify conformance, and the suite's distribution channel are PORT-SPECIFIC.

#### Scenario: The compliance suite is versioned MAJOR.MINOR with no patch

- **WHEN** the compliance suite is published
- **THEN** its version is a `MAJOR.MINOR` (e.g., `0.2`, `1.0`) with no PATCH component
- **AND** a suite-side fix MAY rewrite the same `MAJOR.MINOR` in place, or bump MINOR/MAJOR if the change warrants it; the suite never carries a PATCH

#### Scenario: A port owns its PATCH line within a conformance MINOR

- **WHEN** a port ships a bugfix that does not change its conformance target
- **THEN** it releases a new PATCH `X.Y.(Z+1)` that still conforms to `compliance@X.Y`
- **AND** no new compliance-suite version is published for the port's patch

#### Scenario: Pre-1.0, the suite leads and ports converge on their own schedule

- **WHEN** the compliance suite releases a `0.Y` MINOR carrying a new requirement
- **THEN** `@postel/*` ports are NOT required to move to `0.Y` at the same time
- **AND** the suite's latest version MAY be ahead of a port still releasing on `0.(Y-1)`
- **AND** any port that releases an `0.Y.Z` MUST pass `compliance@0.Y` end-to-end before release

#### Scenario: Major boundary is a coordinated cut

- **WHEN** the suite cuts a MAJOR release (`1.0` or any later major)
- **THEN** every `@postel/*` port releases that major together as a coordinated release
- **AND** each port at `MAJOR.0.0` passes `compliance@MAJOR.0` end-to-end before release

#### Scenario: New tests are required at the version they ship

- **WHEN** a new test vector lands in the suite as part of MINOR `X.Y`
- **THEN** every port releasing on `X.Y` (at or after that MINOR) MUST pass the new test
- **AND** there is no opt-in, default-off, or grace-period mode for the test

#### Scenario: Breaking modification gates on MAJOR

- **WHEN** a test's expected behavior changes in a way incompatible with the prior version (a port passing the old test would now fail the new)
- **THEN** the change lands in a MAJOR release alongside the matching capability-spec update
- **AND** every `@postel/*` package and the suite bump MAJOR together

#### Scenario: Test removal in MAJOR

- **WHEN** a test is removed from the corpus
- **THEN** the removal lands in a MAJOR release
- **AND** the corresponding CONTRACT requirement in the capability spec becomes PORT-SPECIFIC or is removed in the same change

#### Scenario: Pre-1.0 breakage is allowed in MINORs

- **WHEN** a `0.x` suite MINOR introduces a behavior-changing test under the experimental-semantics regime
- **THEN** ports adapting to the new MINOR MAY need to ship code changes alongside the version bump
- **AND** this is documented in the OpenSpec change that authored the test, not in a separate runway timeline

#### Scenario: Distribution channel is open

- **WHEN** the suite is consumed by a port's CI
- **THEN** the consumption mechanism (npm install, container pull, binary download, repo checkout at a tagged commit) is the port's choice
- **AND** what matters is the suite version actually exercised, not how it was obtained
