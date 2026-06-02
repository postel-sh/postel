# @postel/http

> Framework-agnostic webhook HTTP core for Postel — the verification **gate** that every framework adapter binds to.

`@postel/http` turns a configured inbound source (`postel.inbound.<source>`) plus an incoming request into a normalized outcome: verify the raw bytes, map any `PostelError` to an HTTP status, optionally dedup-acknowledge, and hand a verified result to your handler. The policy lives here once, so `@postel/hono`, `@postel/express`, `@postel/fastify`, and `@postel/nestjs` stay thin and never re-derive the error→status table.

## Surface

```ts
import { handleInbound, fetchWebhook } from "@postel/http";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

// Web Fetch handler — Hono, Bun, Deno, Next.js Route Handlers, …
const handler = fetchWebhook(postel.inbound.vendor, {
  onVerified: async ({ event }) => {
    await handleOrder(event);
  },
});

export const POST = (req: Request) => handler(req);
```

- `handleInbound(source, { rawBody, headers, method }, opts)` → a `WebhookOutcome` (`verified` | `duplicate` | `error`). The single pipeline every binding shares.
- `fetchWebhook(source, opts)` → `(req: Request) => Promise<Response>`, built on `handleInbound`.
- `statusForError(err)` / `errorBody(err)` — the canonical `PostelError` → HTTP-status policy.
- `@postel/http/node` — `writeOutcomeToNodeRes(res, outcome)` + `headersFromNode(headers)` for Node `req`/`res` frameworks.

## Behavior

- Verification failures map to HTTP status by `PostelError.code`: `SIGNATURE_INVALID` / `TIMESTAMP_TOO_OLD` / `MALFORMED_HEADER` / `RAW_BYTES_MISMATCH_DETECTED` → 400, `UNKNOWN_KEY_ID` → 401. Anything that is not a `PostelError` (e.g. `NotImplementedError`) propagates so the framework yields 5xx.
- Dedup-ack is opt-in (`opts.dedup`) and runs **after** verification: a confirmed duplicate returns `2xx` with `X-Postel-Dedup-Result: duplicate` and your handler does not run.
- Raw bytes are passed to `verify` unchanged — no JSON re-serialization between receipt and verification.

## License

MIT
