# @postel/express

> Express routing facade + middleware gate for verifying inbound webhooks against a configured Postel source.

```ts
import express from "express";
import { ExpressWebAdapter } from "@postel/express";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const app = express();
const ewa = ExpressWebAdapter(postel, app);

// each route mounts express.raw() + the gate; your handler stays normal:
ewa.inbound.vendor.post("/webhooks/vendor", (req, res) => {
  res.json({ ok: true, type: req.postel?.event.type });
});

// when an outbound slot is configured:
ewa.outbound.bindJwks();                                                // GET /.well-known/webhooks-keys
ewa.admin.bindAdminRoutes("/admin", { authorize: (req) => check(req) });
```

Each gated route mounts `express.raw({ type: () => true })` for you (don't put `express.json()` ahead of it), reads the exact received bytes, runs the verifier(s) you configured, maps `PostelError` to the right HTTP status, and sets the verified result on `req.postel`. On failure the handler never runs; a non-`PostelError` is forwarded to `next(err)`. The error→status policy and byte handling live in [`@postel/http`](../../http).

## Low-level primitives

`verifyWebhook(source, opts?)` (returns `[express.raw(...), gate]`), `withWebhook(source, handler, opts?)`, and the `fetchToExpress` Fetch→Express bridge remain exported for custom routing.

## License

MIT
