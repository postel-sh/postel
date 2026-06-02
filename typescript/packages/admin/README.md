# @postel/admin

> Framework-agnostic admin HTTP router for Postel's outbound control plane.

`adminRouter(postel, { authorize })` returns a Web `(Request) => Promise<Response>` that maps REST routes to `postel.outbound.*` — endpoint CRUD, replay, reconcile, tenants, and key generation. Mount it in any framework: Hono natively, or Express/Fastify via `fetchToExpress` / `fetchToFastify`.

```ts
import { adminRouter } from "@postel/admin";
import { postel } from "./lib/postel";

const router = adminRouter(postel, {
  // boolean | { allow, status?, tenantId? } | Promise<...>
  authorize: (req) => verifyAdminToken(req.headers.get("authorization")),
});

// Hono (Fetch-native):
app.all("/admin/*", (c) => router(c.req.raw));
// Express:  app.use("/admin", fetchToExpress(router))
// Fastify:  app.all("/admin/*", fetchToFastify(router))
```

## Auth — default-deny

`authorize` is effectively required: with none configured, **every request returns 403** (and logs once). `authorize(req)` returns `boolean` or `{ allow, status?, tenantId? }`. A returned `tenantId` scopes every route to that tenant — lists and creates are constrained to it, and by-id routes return **404** for another tenant's resources (no existence leak). Run transport auth (bearer / mTLS) in front and pass `authorize: () => true` if you prefer.

## Routes

`GET/POST /endpoints` · `GET/PATCH/DELETE /endpoints/:id` · `POST /endpoints/:id/disable` · `POST /endpoints/:id/rotate-secret` · `POST /replay` · `POST /reconcile` · `POST /tenants/:id/rate-limit` · `DELETE /tenants/:id` · `POST /keys/{symmetric,asymmetric}`.

Errors map by `PostelError.code` (`ENDPOINT_NOT_FOUND`→404, `ENDPOINT_VALIDATION`→422, `ENDPOINT_DISABLED`/`IDEMPOTENCY_KEY_CONFLICT`→409, `MIGRATION_REQUIRED`→503); the JSON body carries `{ errorCode, error }`. Function-shaped endpoint options (`filter` / `transform` / callable `headers`) are code-only and not accepted over HTTP.

## License

MIT
