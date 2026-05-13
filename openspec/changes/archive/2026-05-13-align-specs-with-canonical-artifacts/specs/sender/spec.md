# sender — delta spec

## ADDED Requirements

### Requirement: Attempt status enum casing

The `attempts.status` column SHALL use **kebab-case** for all multi-word values to keep the enum visually uniform. The canonical set is: `pending`, `success`, `failed`, `failed-permanent`, `dead-letter`, `expired`, `filtered`, `skipped`, `ssrf-blocked`. The previously-used snake_case form (`ssrf_blocked`) is replaced by `ssrf-blocked` for casing consistency. When an outbound delivery is blocked by SSRF defense, the dispatcher MUST record the attempt with `status: 'ssrf-blocked'` AND a human-readable `error` field of `"SSRF_BLOCKED: <details>"` (the uppercase error code is separate from the column value, mirroring the receiver-side error-class convention).

#### Scenario: SSRF block records consistent casing

- **WHEN** an outbound delivery is blocked because the endpoint URL resolves to a disallowed IP range
- **THEN** the `attempts` row has `status = 'ssrf-blocked'` (kebab-case)
- **AND** the `error` field starts with `"SSRF_BLOCKED:"` (uppercase) and contains the resolved IP for debugging

#### Scenario: Other status values use kebab-case

- **WHEN** an attempt is recorded with a permanent failure (e.g., 4xx response other than 408/429)
- **THEN** the `attempts.status` value is `'failed-permanent'` (kebab-case), never `failed_permanent`
