# standard-webhooks-compliance — delta spec

## MODIFIED Requirements

### Requirement: Wraps the official signing library

The library's signature production MUST be byte-identical to the official [`standardwebhooks`](https://www.npmjs.com/package/standardwebhooks) JS library across the test-vector suite published by the Standard Webhooks project (and replicated under `compliance/`). Whether the implementation literally wraps the upstream library or reimplements the primitive is at the implementer's discretion — what matters is verifiable interop, not the call graph.

#### Scenario: Interop test vectors

- **WHEN** the implementation signs every test vector from the Standard Webhooks reference suite
- **THEN** each produced signature is byte-identical to the upstream library's output for the same inputs
- **AND** every signature also verifies successfully against the upstream verifier
