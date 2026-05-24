## REMOVED Requirements

### Requirement: Edge bundle size budget

**Reason**: The receiver-only `@postel/edge` package is being deleted; the verify path now lives in `@postel/core` as a tree-shakeable export and no longer carves out a dedicated edge sub-bundle. A bundle-size budget for `@postel/edge` no longer has a target. The general core bundle budget remains in `distribution-packaging-typescript`'s `Core bundle budget` requirement. If demand for an edge-runtime sub-bundle resurfaces, a future change can reintroduce a portability requirement targeted at actual user need.

### Requirement: Edge runtime portability

**Reason**: The project no longer targets Cloudflare Workers, Vercel Edge, Deno Deploy, or Cloudflare Pages as first-class deployment substrates. The receiver code currently uses Web Crypto and would still run on Node-equivalent runtimes that ship Web Crypto, but this is incidental rather than contracted. Without an adopter exercising the edge-runtime claim, contracting it via the spec is dead weight. A future change MAY reintroduce runtime-portability requirements if and when demand appears.
