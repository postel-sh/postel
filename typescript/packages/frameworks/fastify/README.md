# @postel/fastify

> Fastify plugin + preHandler that gates a route with a configured Postel inbound source.

```ts
import Fastify from "fastify";
import { fastifyPostel, verifyWebhook, fastifyAdapter } from "@postel/fastify";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const app = Fastify();

// Register on the instance (or encapsulated scope) that serves webhooks — it
// captures every body as a raw Buffer so signatures verify byte-for-byte.
await app.register(fastifyPostel);

app.post(
  "/webhooks/vendor",
  { preHandler: verifyWebhook(postel.inbound.vendor) },
  async (req) => ({ ok: true, type: req.postel?.event.type }),
);

// keyed form:
app.post(
  "/webhooks/github",
  { preHandler: fastifyAdapter(postel).verify("github") },
  async () => "ok",
);
```

`fastifyPostel` removes the built-in body parsers in its scope and installs a raw-Buffer parser — register it on a Fastify instance or encapsulated scope dedicated to webhook routes so it doesn't strip JSON parsing from your other routes. The preHandler reads the exact received bytes, runs verification, maps `PostelError` to the right HTTP status, and sets the verified result on `req.postel`; a non-`PostelError` bubbles to Fastify's error handler (5xx). The error→status policy and byte handling live in [`@postel/http`](../../http).

`withWebhook(source, handler)` / `fastifyAdapter(postel).guard(key, handler)` fold the gate and a route handler into one.

## License

MIT
