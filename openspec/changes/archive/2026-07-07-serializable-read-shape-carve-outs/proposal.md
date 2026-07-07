# Serializable read-shape carve-outs for custom retry and http.fetch

## Why

The endpoint read shape introduced for #83 carves function-shaped options (`filter`, `transform`, callable `headers`) off the public `Endpoint`, but two function-carrying values slipped through: a `custom` retryPolicy carries a `compute` function (the in-memory adapter leaks the live function; DB adapters JSON-strip `compute` and return a value typed as a valid `RetryStrategy` that crashes when re-submitted), and `http.fetch` is a function that memory returns and DB adapters drop — a cross-adapter divergence either way.

## What Changes

- The `custom` retryPolicy joins the function-shaped carve-out: it reads back as `null` on the public endpoint shape; data-only strategies (`exponential`, `linear`) round-trip unchanged.
- The returned `http` field is the stored HTTP overrides minus the function-typed `fetch` key.
- Spec wording aligned with the implementation: carved-out `headers` (and now `retryPolicy`) "read back as `null`" — key present, value `null` — while `filter`/`transform` remain truly absent keys.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`endpoint-management`** — MODIFY *Endpoint CRUD*: extend the function-shaped carve-out to `custom` retry strategies and `http.fetch`, and state the null-vs-absent semantics precisely.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged — normalization happens in the public read projection, above storage.

## Impact

- `@postel/core`: `toPublicEndpoint` normalizes `retryPolicy` (custom → `null`) and `http` (drop `fetch`) so memory and DB adapters return identical shapes; `Endpoint.retryPolicy` is typed to the data-only strategy variants and `Endpoint.http` omits `fetch`.
- Tests: core read-shape test extended; storage testkit gains an endpoint field-value round-trip case run by every adapter.
- Docs: `outbound/endpoints.mdx` read-shape section updated.
