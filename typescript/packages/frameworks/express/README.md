# @postel/express

> Express middleware that gates a route with a configured Postel inbound source.

```ts
import express from "express";
import { verifyWebhook, expressAdapter } from "@postel/express";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const app = express();

// verifyWebhook mounts express.raw() + the gate; your handler stays normal:
app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (req, res) => {
  res.json({ ok: true, type: req.postel?.event.type });
});

// or bind by source key (type-checked against the sources you configured):
app.post("/webhooks/github", expressAdapter(postel).verify("github"), (_req, res) => res.send("ok"));
```

The gate mounts `express.raw({ type: () => true })` for you (don't put `express.json()` ahead of it), reads the exact received bytes, runs the verifier(s) you configured, maps `PostelError` to the right HTTP status, and sets the verified result on `req.postel`. On failure the handler never runs; a non-`PostelError` is forwarded to `next(err)` (your error middleware / 500). The error→status policy and byte handling live in [`@postel/http`](../../http).

`withWebhook(source, handler)` folds the gate and a single handler into one; `expressAdapter(postel).guard(key, handler)` is the keyed form.

## License

MIT
