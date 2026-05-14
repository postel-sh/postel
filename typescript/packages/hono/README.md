# @postel/hono

> Hono middleware and ad-hoc helper for verifying inbound webhooks against [`@postel/edge`](../edge).

Hono is the smallest of the framework adapters and the first one Postel ships at v0.1.0 — Express, Fastify, Bun, Deno, Next.js, SvelteKit, Astro, and Nitro adapters are deferred to later releases.

## Why an adapter at all

Per the receiver capability spec ([Framework adapters preserve raw bytes](../../../openspec/specs/receiver/spec.md)), framework integrations exist to guarantee that the bytes `verify()` sees are byte-identical to the bytes the receiver received. A bare `app.post(…, c => c.req.json())` route would re-serialize the body and break the signature; the adapter reads the request via `c.req.arrayBuffer()` so the raw bytes stay intact across the boundary.

## API

```ts
import { Hono } from "hono";
import { honoVerify, postelHono, POSTEL_CONTEXT_KEY } from "@postel/hono";

const app = new Hono();

// Style 1 — explicit helper, full control over error mapping
app.post("/webhooks", async (c) => {
  const result = await honoVerify(c, "whsec_...");
  return c.json({ ok: true, type: result.event.type });
});

// Style 2 — middleware; verified payload stashed on context
app.post("/webhooks", postelHono("whsec_..."), (c) => {
  const result = c.get(POSTEL_CONTEXT_KEY);
  return c.json({ ok: true, type: result.event.type });
});
```

The second argument is anything `verify()` accepts: a single `whsec_`-prefixed secret, a priority-ordered `string[]` (multi-secret rotation window), or a `Keyset` returned from `createKeyset` (JWKS-backed; lands in PR 4).

The third argument is the same `VerifyOptions` shape as `@postel/edge` — `toleranceSeconds`, `now`.

## License

MIT
