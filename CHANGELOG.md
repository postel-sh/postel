# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project (from 1.0 onward) adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Spec-driven development framework via upstream [OpenSpec](https://github.com/Fission-AI/OpenSpec) with the custom `postel-polyglot` schema.
- Capability specs under `openspec/specs/` covering sender, receiver, endpoint management, key management, retry policy, filtering & transformation, replay & reconciliation, multi-tenancy, observability, Standard Webhooks compliance, storage layer, distribution & packaging, and the TypeScript API surface.
- Canonical machine-readable artifacts: [`specs/wire-format/asyncapi.yaml`](specs/wire-format/asyncapi.yaml) (AsyncAPI 3.0) and [`specs/db-schema/0001_init.sql`](specs/db-schema/0001_init.sql).
- ADRs `0001`–`0007` capturing architectural decisions.
- `VISION.md` — top-level positioning, scope, success criteria.

### Changed

- **BREAKING (positioning)**: Postel is no longer described as a "TypeScript-first" library. The new positioning: "Postel is a polyglot webhooks library backed by solid, executable specs. TypeScript ships first; Go, Python, and Rust follow." See [`decisions/0007-polyglot-staged-rollout.md`](decisions/0007-polyglot-staged-rollout.md).

### Removed

- Monolithic `SPECIFICATION.md` (content fully redistributed into `VISION.md`, capability specs, ADRs, AsyncAPI, and SQL DDL).
