## Why

The library's brand identity is "Postel" — a single, declarative name. The TS factory is currently named `createPostel` following the `create*` prefix convention common to Drizzle and Better Auth. Switching to `Postel({ db })` (PascalCase callable, matching the pattern used by NextAuth, Auth.js, and Better Auth's *brand* name) makes the first line of every adopter's code read as the library's name itself rather than as a verbose factory.

This is a pre-1.0 cosmetic API change. Doing it now — before code lands in `@postel/core` and external adopters depend on it — costs nothing. Post-1.0 it would require a major bump for a purely aesthetic improvement.

The PascalCase identifier `Postel` is a callable factory function, not a class — adopters never write `new Postel(...)`. TypeScript convention reserves PascalCase for types/classes, but this is a well-established exception in the ecosystem (NextAuth, Auth.js, Better Auth) where the factory identifier doubles as the library's brand. Readers are not expected to be confused.

## What Changes

- Rename the public factory from `createPostel({ db, ...opts })` to `Postel({ db, ...opts })`.
- Update the `api-surface-typescript` capability's `createPostel factory returns the library instance` requirement: title becomes `Postel factory returns the library instance`; the requirement body and the `Type inference` scenario update their inline code from `createPostel(...)` to `Postel(...)`.
- Update `storage-layer`'s `Adapter matrix with three categories` requirement: the `Drop-in standalone usage` and `Drizzle host wraps its own db` scenarios update their example code from `createPostel({ adapter: ... })` to `Postel({ adapter: ... })`. The normative requirement body is unchanged.
- Update the adopter-facing example in `typescript/AGENTS.md` from `const postel = createPostel(...)` to `const postel = Postel(...)`.
- Update [`decisions/0012-package-granularity.md`](../../../decisions/0012-package-granularity.md), authored in the same PR cycle, to reference the new identifier.
- Update `scripts/spec-drift-deferred.txt` so the deferred entry tracks the new requirement title.

The `api-surface-typescript` spec's Purpose paragraph references `createPostel` once. OpenSpec delta semantics cover `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` but not the Purpose section. The Purpose-paragraph update happens at archive time as part of the same change.

ADRs 0001 and 0007 also reference `createPostel` in historical-decision prose. Per ADR convention these are not edited retroactively; this proposal is the audit trail for the identifier change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-surface-typescript`: the `createPostel factory returns the library instance` requirement is renamed to `Postel factory returns the library instance`; the requirement body and `Type inference` scenario update their inline code references. Other requirements are unchanged.
- `storage-layer`: two scenarios under the `Adapter matrix with three categories` requirement update their example code. The normative requirement statement and the third scenario (`Adapter category declared in package metadata`) are unchanged.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/api-surface-typescript/spec.md` — requirement renamed and body updated (applied via archive); Purpose paragraph also updated.
- `openspec/specs/storage-layer/spec.md` — two scenario bodies updated (applied via archive).
- `typescript/AGENTS.md` — one adopter-facing example updated.
- `scripts/spec-drift-deferred.txt` — deferred-list entry retitled to match the renamed requirement.
- `decisions/0012-package-granularity.md` — three identifier references updated.
- No code changes — no implementation of the factory exists yet at v0.1.0.
