# Distribution and packaging — delta spec

## ADDED Requirements

### Requirement: Spec-test traceability is enforced in CI

Every `### Requirement` declared under `openspec/specs/<capability>/spec.md` SHALL be covered by at least one test that names it (e.g., the requirement title appears in a `describe`/`test`/`it` block, or in a comment immediately above the test). CI MUST fail when a requirement has no matching test, so requirements cannot be silently dropped during implementation.

#### Scenario: Drift detected fails CI

- **WHEN** a contributor adds a new `### Requirement: Foo` to a capability spec without adding a test that names "Foo"
- **THEN** the `check:spec-drift` CI step exits non-zero
- **AND** the failure message lists the requirement name and the spec file it came from

#### Scenario: Pre-implementation no-op

- **WHEN** the spec-drift check runs and there are no test files yet (e.g., `packages/` is empty)
- **THEN** the check emits an informational message and exits 0
- **AND** no requirement is reported as drifted

#### Scenario: New port extends the check

- **WHEN** a future change adds a non-TypeScript port (e.g., Go)
- **THEN** that change MUST extend `scripts/check-spec-drift.mjs` (or add a sibling script wired into the same CI step) to also walk that port's test files
