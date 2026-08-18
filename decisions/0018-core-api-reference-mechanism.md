# 0018 — Full API reference: curated hand-written pages, not a generated TypeDoc pipeline

- **Status**: Accepted
- **Date**: 2026-08-18
- **Decision drivers**: VISION §6 requires a "full API reference"; `packages.mdx` currently ends with "read the source under `typescript/packages/core`"; a generated API page existed once and was deliberately dropped

## Context

A generated `@postel/core` API page shipped earlier in the docs site's life: raw TypeDoc output, built by `docs/scripts/build-api-reference.mjs` from `docs/typedoc.core.json`, wired into `predev`/`prebuild`. PR #73 (the docs content overhaul) removed it — see that PR's description: *"it was raw TypeDoc output that read as lower-quality next to the hand-written reference pages."* Every other reference page (`reference/errors.mdx`, `reference/http.mdx`) is hand-written prose with worked examples, grouped by concept, cross-linked into the narrative `inbound/` and `outbound/` sections. The generated page was flat, alphabetical, and carried raw TSDoc comments (or none) instead of the "why", "when", "recovery" framing the rest of the reference section uses.

Since then `packages.mdx` has closed the gap with a placeholder: *"For exact type signatures, ... read the source under `typescript/packages/core`."* That is the gap this change closes. The public surface has also grown substantially since the page was dropped — `@postel/core` now exports the outbound runtime (endpoints, keys, tenants, replay, reconcile, messages), five named provider verifiers, retry/rate-limit/worker/signing/KMS strategy factories, and the observability/pagination/event types — so whatever ships here has to stay legible at that size.

## Decision

Ship the reference as **curated, hand-written MDX pages**, in the same voice and structure as `reference/errors.mdx`, not a regenerated TypeDoc pipeline.

Four new pages under `docs/content/docs/reference/`, split by concept (not alphabetically, and not one page per source file):

- **`core.mdx`** ("Core API") — the `Postel()` / `definePostelConfig()` factories, `PostelConfig`, the lifecycle API (`start`/`stop`/`health`/`metrics`/`on`/`off`), observability config, pagination (`Page`/`CursorOptions`), the `Duration` grammar, and `Clock`.
- **`inbound.mdx`** ("Inbound API") — `InboundSource` config, `InboundApi`/`InboundSourceApi`, the bare `verify()` function, the `Verifier` interface and every verifier factory (`Secret`, `PublicKey`, `Keyset`, `Noop`, and the five named provider verifiers), JWKS (`jwksHandler`, `createJwksKeyset`, key types), dedup, and `signFixture`.
- **`outbound.mdx`** ("Outbound API") — `OutboundConfig` and its defaults interfaces, the full `OutboundApi` (`send`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `messages`), and every supporting type (`Endpoint`, `Message`, `DeliveryAttempt`, filters, tenant types).
- **`strategies.mdx`** ("Strategies") — the retry, rate-limit, worker, signing, and KMS strategy factories, with the config slots that throw `NotImplementedError` called out explicitly (they exist and are typed today; the runtime isn't there yet).

`reference/errors.mdx` already covers every `PostelError` subclass to this bar; the new pages link to it rather than re-describing error classes. `packages.mdx`'s "read the source" line is replaced with links to these four pages.

**Deliberately out of scope**: the `Storage` adapter SPI (`Storage`, `StoredMessage`, `EndpointRecord`, and the ~20 supporting types in `storage/types.ts`). It's a different audience — adapter authors, not webhook producers/consumers — and already has a narrative home (`storage/custom-adapters.mdx`, `storage/schema.mdx`). The issue scopes this pass to "factories, config, errors, outbound/inbound APIs, strategy factories"; the SPI follows the same curated pattern in a later pass if it needs one.

## Rationale

1. **Matches the established quality bar.** `errors.mdx` proves the pattern works at this project's standard: a hierarchy diagram, then per-class "code / thrown by / when / recovery / example" — not a signature dump. TypeDoc output can't produce that framing; it renders whatever TSDoc comment (often none) sits above the declaration.
2. **Groups by how someone reaches for it, not by file.** `outbound.ts` alone is 679 lines mixing config, the four sub-APIs, and a dozen supporting types. A generated page mirrors file/declaration order; a hand-written page groups `endpoints.*` together, `keys.*` together, etc. — matching how the narrative `outbound/*.mdx` pages already introduce these concepts.
3. **No new build-time machinery.** The dropped pipeline needed a TypeDoc config, a generation script, and `predev`/`prebuild` hooks — surface area that had to be understood, kept green, and (per the PR #73 record) still produced a page nobody wanted to keep. Plain MDX is what every other page in the site already is.
4. **The maintenance cost is the same cost AGENTS.md already imposes.** Rule 8 requires docs updates in the same PR as any change to `@postel/core`'s public surface. A hand-written reference page is one more file that rule covers — no different from updating `errors.mdx` when a new `PostelError` subclass ships.

## Consequences

- Four new pages in `docs/content/docs/reference/`, added to `reference/meta.json`'s `pages` array and linked from `reference/index.mdx`.
- `packages.mdx`'s `@postel/core` row and its closing "Every export" section point at the new pages instead of "read the source."
- Future edits to `@postel/core`'s public surface must hand-update the matching reference page — there is no generator to catch drift. This is the accepted trade-off from the Rationale, not an oversight.
- The `Storage` SPI reference remains a documented gap against a literal reading of "every exported symbol" (VISION §6 / issue #150's acceptance criterion talks about `@postel/core`'s public surface, not every exported type). If a future issue wants SPI-level reference too, it follows this same ADR's pattern rather than reopening the mechanism question.

## Alternatives considered

### Regenerate the TypeDoc pipeline, but with custom rendering/theming

Rejected for this pass. It would need a custom TypeDoc plugin or a post-processing step to reach the "why / when / recovery" framing `errors.mdx` sets as the bar — at that point the generator is producing a scaffold a human still has to hand-edit per symbol, which is most of the cost of hand-writing with none of the risk reduction (a generator half-fixed by hand still drifts the same way a hand-written page does, but with an extra build step in between). Worth revisiting only if the surface grows enough that hand-maintenance becomes the bottleneck — not the case at ~130 exported symbols across one package.

### One flat `core.mdx` page for the whole surface

Rejected. `outbound.ts`'s surface alone is large enough to want its own page with its own table of contents; folding it into one page would make the sidebar's in-page nav useless and mirror the "wall of signatures" problem this ADR is trying to avoid.
