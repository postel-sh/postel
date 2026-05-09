# distribution-packaging Specification

## Purpose
TBD - created by archiving change migrate-specification-md. Update Purpose after archive.
## Requirements
### Requirement: Package map

The library SHALL be distributed as the following npm packages: `@postel/core`, `@postel/edge`, `@postel/postgres`, `@postel/sqlite`, `@postel/express`, `@postel/hono`, `@postel/fastify`, `@postel/nextjs`, `@postel/bun`, `@postel/admin`, `@postel/effect`, `@postel/test`, `@postel/compliance`, `@postel/cli`. Each MUST have a single, documented purpose.

#### Scenario: Importing edge does not pull core

- **WHEN** a Cloudflare Worker imports only `@postel/edge`
- **THEN** the bundle does not include sender, worker, or DB code

### Requirement: Core bundle budget

`@postel/core` SHALL ship at ≤ 250 KB minified+gzipped. CI MUST enforce this budget on every build.

#### Scenario: Core size enforced in CI

- **WHEN** a change increases `@postel/core` to 280 KB minified+gzipped
- **THEN** the bundle-size CI check fails

### Requirement: Tree-shakeability

The library SHALL be tree-shakeable. Importing `verify` MUST NOT pull in worker or DB code.

#### Scenario: verify is standalone

- **WHEN** a consumer's bundler tree-shakes `import { verify } from '@postel/core'`
- **THEN** the resulting bundle excludes the worker, dispatcher, and DB adapters

### Requirement: ESM and CJS dual export, TypeScript types

Each package SHALL ship dual ESM + CJS entry points with TypeScript 5+ type definitions. Node ≥ 20 LTS, Bun ≥ 1.0, and Deno ≥ 2.0 MUST be supported.

#### Scenario: CJS require works

- **WHEN** a Node 20 CJS project does `const { send } = require('@postel/core')`
- **THEN** the import succeeds and types are available via `@types`

### Requirement: Published unminified for tooling readability

Packages SHALL be published unminified (the consumer's bundler is responsible for minification). Source maps MUST be published.

#### Scenario: Unminified read

- **WHEN** a consumer opens `node_modules/@postel/core/dist/index.js`
- **THEN** the source is human-readable (not minified)

### Requirement: Strict SemVer from 1.0

From 1.0 onward, all `@postel/*` packages SHALL follow strict SemVer. No breaking changes in minor or patch releases.

#### Scenario: Patch is non-breaking

- **WHEN** consumers upgrade from `1.2.3` to `1.2.4`
- **THEN** their existing code compiles and runs unchanged

### Requirement: Shared major version across packages

All `@postel/*` packages SHALL share a major version. Breaking changes MUST be released across the package set together.

#### Scenario: 2.0 release

- **WHEN** `@postel/core` releases `2.0.0`
- **THEN** every other `@postel/*` package also releases `2.0.0` in the same release

### Requirement: DB schema version embedded in metadata table

The library SHALL maintain a `_postel_meta` table containing the DB schema version. The library MUST refuse to run against a DB whose schema version is incompatible with the library version.

#### Scenario: Mismatched schema

- **WHEN** the library is at schema v3 and the DB is at schema v1
- **THEN** the library fails fast at startup with a clear message indicating which migration to run

### Requirement: Forward-only migrations supporting two majors

DB migrations SHALL be forward-only. The library MUST be able to read state written by older library versions for at least the previous two major versions.

#### Scenario: Read 1.x state from 3.x

- **WHEN** a 3.x library starts against a DB last touched by a 1.x library
- **THEN** the migration path runs cleanly forward; no data is lost

### Requirement: Six-month deprecation period

Public APIs marked deprecated SHALL remain functional for at least six months before removal. Removals MUST coincide with a major version bump.

#### Scenario: Deprecation lifecycle

- **WHEN** a public API is marked `@deprecated` in a minor release
- **THEN** it remains functional in subsequent minor releases for at least 6 months and is only removed at the next major

### Requirement: Wire format spec versioning

Outgoing requests MAY include a `webhook-spec-version` header indicating the wire-format spec generation. Future spec changes MUST use this header so existing endpoints continue to function.

#### Scenario: Old endpoint receives new spec

- **WHEN** an existing endpoint receives a request with a future `webhook-spec-version`
- **THEN** the endpoint can ignore the new fields and continue verifying as before

