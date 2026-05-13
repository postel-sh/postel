# Language impact

Pure spec refactor — no runtime behavior changes, no code yet. Each item aligns a capability spec with its canonical artifact (DDL, ADR, AsyncAPI). The same alignments will apply to future language ports as they author their own `api-surface-<lang>` capabilities.

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | No code yet; future TS impl honors the corrected state vocabulary + casing |
| typescript-receiver | unchanged | Future TS impl honors the corrected dedup-adapter framing |
| go-sender (planned) | unchanged | Will inherit the same state vocabulary and casing conventions when its port lands |
| go-receiver (planned) | unchanged | Same |
| python-sender (planned) | unchanged | Same |
| python-receiver (planned) | unchanged | Same |
| wire-format | unchanged | AsyncAPI doc already consistent; no edits |
| db-schema | unchanged here | `attempts.status` casing normalization (`ssrf_blocked` → `ssrf-blocked`) is recorded as spec intent; the DDL migration happens when storage code lands |

## Lockstep / lag

No lockstep concerns. The state vocabulary, status casing, and naming conventions established here become contracts that every future port honors via the compliance suite.
