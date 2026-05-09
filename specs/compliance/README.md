# Compliance test suite

The behavioral source of truth for Postel.

## What it is

`@postel/compliance` is a vendor-neutral, executable test suite that verifies any HTTP receiver against the Standard Webhooks specification. It is the contract every Postel implementation — the TypeScript reference impl in this repo and any future language port — must satisfy to be considered conformant.

## Status

The package itself ships in this repo's monorepo (planned location: `packages/compliance/`). Until the implementation lands, this README is a placeholder pointing at the contract:

- **Wire format**: [`specs/wire-format/asyncapi.yaml`](../wire-format/asyncapi.yaml)
- **Capability behaviors**: [`openspec/specs/`](../../openspec/specs/)

## How ports use it

A port's CI MUST run the compliance suite against its own receiver implementation (and, where applicable, sender). The suite reports a per-test pass/fail breakdown. A port is "Postel-conformant" iff the suite reports 100% pass on the receiver, with a similar gate on sender for ports that include one.

## Why "behavioral oracle"

Markdown specs and AsyncAPI documents say what should happen. The compliance suite is what executes — it's the difference between documentation and a verifier. When markdown and the suite disagree, file a bug; the suite is treated as authoritative for behavior, the markdown as authoritative for intent.
