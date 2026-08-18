# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | |
| typescript-receiver | modified | new built-in `Verifier` factories `Shopify`, `Twilio`, `Slack` in `@postel/core` |
| go-receiver (planned) | unaffected | mechanism (factory names/home) is TypeScript-port-specific; correctly verifying real Shopify/Twilio/Slack-signed requests is CONTRACT once a port ships provider verifiers |
| python-receiver (planned) | unaffected | same CONTRACT obligation as go-receiver |
| rust-receiver (planned) | unaffected | same CONTRACT obligation as go-receiver |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Only the TypeScript receiver changes now. Other ports MAY lag on shipping `Shopify`/`Twilio`/`Slack` verifiers, but once a port does, the verified OUTCOME — accept a genuinely provider-signed request, reject a forged or (for Slack) stale one with the right error — is CONTRACT. The package/module home (`@postel/core` here) and factory naming are PORT-SPECIFIC.
