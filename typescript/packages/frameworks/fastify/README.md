# @postel/fastify

> Fastify routing facade + raw-body plugin for verifying inbound webhooks against a configured Postel source.

```ts
import Fastify from "fastify";
import { fastifyPostel, FastifyWebAdapter } from "@postel/fastify";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

const app = Fastify();

// Register on the instance (or encapsulated scope) that serves webhooks — it
// captures every body as a raw Buffer so signatures verify byte-for-byte.
await app.register(fastifyPostel);

const fwa = FastifyWebAdapter(postel, app);

fwa.inbound.vendor.post(
  "/webhooks/vendor",
  async (req) => ({ ok: true, type: req.postel?.event.type }),
);

// when an outbound slot is configured:
fwa.outbound.bindJwks();                                                // GET /.well-known/webhooks-keys
fwa.admin.bindAdminRoutes("/admin", { authorize: (req) => check(req) });
```

`fastifyPostel` removes the built-in body parsers in its scope and installs a raw-Buffer parser — register it on a Fastify instance or encapsulated scope dedicated to webhook routes. The gate reads the exact received bytes, runs verification, maps `PostelError` to the right HTTP status, and sets the verified result on `req.postel`; a non-`PostelError` bubbles to Fastify's error handler (5xx). The error→status policy and byte handling live in [`@postel/http`](../../http).

## Low-level primitives

`verifyWebhook(source, opts?)` (preHandler), `withWebhook(source, handler, opts?)`, and the `fetchToFastify` Fetch→Fastify bridge remain exported for custom routing.

## License

MIT
