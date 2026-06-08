# @postel/hono

> Hono routing facade + low-level gate for verifying inbound webhooks against [`@postel/core`](../../core).

## Why an adapter at all

Per the receiver capability spec ([Framework adapters preserve raw bytes](../../../../openspec/specs/receiver/spec.md)), framework integrations exist to guarantee that the bytes `verify()` sees are byte-identical to the bytes the receiver received. A bare `app.post(…, c => c.req.json())` route would re-serialize the body and break the signature; the adapter reads the request via `c.req.arrayBuffer()` so the raw bytes stay intact across the boundary.

## Routing facade

`HonoWebAdapter(postel, app)` binds to your app and registers gated routes by source key. The verified result is on `c.get("postel")`.

```ts
import { Hono } from "hono";
import { HonoWebAdapter, POSTEL_CONTEXT_KEY } from "@postel/hono";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const app = new Hono();
const hwa = HonoWebAdapter(postel, app);

hwa.inbound.vendor.post("/webhooks/vendor", (c) => {
  const { event } = c.get(POSTEL_CONTEXT_KEY);
  return c.json({ ok: true, type: event.type });
});

// when an outbound slot is configured:
hwa.outbound.bindJwks();                                                // GET /.well-known/webhooks-keys
hwa.admin.bindAdminRoutes("/admin", { authorize: (req) => check(req) });
```

The source key is type-checked against the sources you configured. On failure the gate short-circuits with the mapped HTTP status and your handler never runs; a non-`PostelError` bubbles as 5xx. The error→status policy and byte handling live in [`@postel/http`](../../http).

## Low-level primitives

The facade is sugar over `verifyWebhook(source, opts?)` (middleware gate) and `withWebhook(source, handler, opts?)` (gate + handler folded into one) — use them to attach the gate to your own routing.

```ts
import { verifyWebhook, withWebhook } from "@postel/hono";

app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (c) => c.json({ ok: true }));
```

## License

MIT
