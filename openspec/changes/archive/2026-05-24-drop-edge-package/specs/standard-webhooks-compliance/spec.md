## MODIFIED Requirements

### Requirement: Compliance test suite

The library SHALL ship a vendor-neutral compliance test suite as a separate artifact (`@postel/compliance`). The suite MUST verify any HTTP receiver against the Standard Webhooks spec. The library's own implementation MUST pass its own suite in CI.

#### Scenario: Run suite against own implementation

- **WHEN** CI runs `@postel/compliance` against a receiver built with `@postel/core`
- **THEN** the suite reports 100% pass

#### Scenario: Run suite against a third-party receiver

- **WHEN** a user points the suite at any HTTP receiver claiming Standard Webhooks compliance
- **THEN** the suite reports a per-test pass/fail breakdown without library coupling
