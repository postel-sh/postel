# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | |
| typescript-receiver | modified | `verify` accepts a named map in addition to `Verifier`/array; result gains `matchedVerifier` |
| go-sender (planned) | unaffected | |
| go-receiver (planned) | unaffected | mechanism (map vs array vs single) is TypeScript-port-specific; reporting "which verifier matched by a stable identifier" is CONTRACT once a port supports named composition |
| python-sender (planned) | unaffected | |
| python-receiver (planned) | unaffected | same CONTRACT obligation as go-receiver |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Only the TypeScript receiver changes now. Other ports MAY lag on the named-map mechanism, but once a port lets adopters compose more than one verifier, first-match-wins ordering and a way to identify which one matched are CONTRACT — a stable positional index at minimum, a name where the port's idiom supports one.
