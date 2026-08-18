# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `@postel/compliance-driver` gains a pg-backed storage mode used only by the new CI tier; `@postel/pg` itself is unchanged. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | will inherit the strengthened vectors and the two new vector-schema fields once it ships a compliance driver / receiver. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | no migration; the new CI tier reads the existing `specs/db-schema/` migrations, it doesn't change them. |

## Lockstep / lag

The two vector-schema field additions (`expected.response_body_schema`, `concurrency`/`expected.outcomes`) are CONTRACT per the compliance capability's "Schema field addition" scenario: any runner (the Go `compliance/cli` today; a future re-implementation) MUST support them going forward, but existing vectors that don't use them remain valid — non-breaking, no lag required. The pg CI tier itself is PORT-SPECIFIC mechanism; other ports MAY prove DB-schema conformance a different way when they ship a sender.
