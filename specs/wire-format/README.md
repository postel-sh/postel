# Wire format

The canonical, machine-readable wire-format spec for Postel lives in [`asyncapi.yaml`](asyncapi.yaml) (AsyncAPI 3.0).

## Scope

This document covers **byte-level wire details only**:

- Header set (`webhook-id`, `webhook-timestamp`, `webhook-signature`, plus extensions)
- Signature versions (`v1` HMAC-SHA256, `v1a` Ed25519)
- Payload structure (`type`, `timestamp`, `data`, `channels`)
- Secret prefixes (`whsec_`, `whsk_`, `whpk_`)
- Spec extensions (versioning, JWKS discovery, IETF compatibility)

## Not in scope

Operational behavior is deliberately NOT modeled here. Each of the following lives in its own capability spec under `openspec/specs/<capability>/`:

- Retry policy and backoff schedules → `openspec/specs/retry-policy/`
- Fanout from one event to N endpoints → `openspec/specs/sender/`
- Circuit breaker / endpoint auto-disable → `openspec/specs/retry-policy/`, `openspec/specs/endpoint-management/`
- Replay and reconciliation → `openspec/specs/replay-reconciliation/`
- Multi-tenancy isolation → `openspec/specs/multi-tenancy/`

If you find yourself wanting to add a `retries:` or `circuitBreaker:` field to AsyncAPI: don't. Open a change to the relevant capability spec instead.

## Source of truth for ports

A community port is "Standard Webhooks-compliant" iff it passes the executable compliance suite (`@postel/compliance`). The AsyncAPI document above is the human- and machine-readable reference; the suite is the verifier.

## Updating

Wire-format changes flow through OpenSpec. A change that modifies the wire format MUST attach a `wire-format-delta.yaml` artifact (an AsyncAPI fragment showing additions/modifications). On archive, the fragment is reconciled into this `asyncapi.yaml` file.
