# @postel/nextjs

> Next.js Route Handler bindings for verifying inbound webhooks against [`@postel/core`](../../core).

## Why an adapter at all

Per the receiver capability spec ([Framework adapters preserve raw bytes](../../../../openspec/specs/receiver/spec.md)), framework integrations exist to guarantee that the bytes `verify()` sees are byte-identical to the bytes the receiver received. Next.js Route Handlers already receive a Web `Request`, so `@postel/http`'s `fetchWebhook` works with zero adapter — this package is ergonomic sugar over it: typed `inbound.<source>.post` bindings, a `bindJwks()` route, and an admin router binding, each returning the exact function shape a route file exports.

## Routing facade

`NextjsWebAdapter(postel)` returns Route Handlers keyed by HTTP method — App Router route files export those directly.

```ts title="app/api/webhooks/vendor/route.ts"
import { NextjsWebAdapter } from "@postel/nextjs";
import { postel } from "@/lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const nwa = NextjsWebAdapter(postel);

export const { POST } = nwa.inbound.vendor.post((result) => {
  return Response.json({ ok: true, type: result.event.type });
});
```

```ts title="app/.well-known/webhooks-keys/route.ts"
import { NextjsWebAdapter } from "@postel/nextjs";
import { postel } from "@/lib/postel";

export const { GET } = NextjsWebAdapter(postel).outbound.bindJwks();
```

```ts title="app/admin/[...path]/route.ts"
import { NextjsWebAdapter } from "@postel/nextjs";
import { postel } from "@/lib/postel";

export const { GET, POST, PUT, PATCH, DELETE } = NextjsWebAdapter(postel).admin.bindAdminRoutes({
  authorize: (req) => check(req),
});
```

The source key is type-checked against the sources you configured, and `result` is typed to that source's schema output. On failure the gate short-circuits with the mapped HTTP status and your handler never runs; a non-`PostelError` bubbles as 5xx. The error→status policy and byte handling live in [`@postel/http`](../../http).

## Low-level primitive

The facade is sugar over `withWebhook(source, handler, opts?)` — use it to gate a route file by hand without the facade.

```ts
import { withWebhook } from "@postel/nextjs";
import { postel } from "@/lib/postel";

export const POST = withWebhook(postel.inbound.vendor, (result) =>
  Response.json({ ok: true, type: result.event.type }),
);
```

## License

MIT
