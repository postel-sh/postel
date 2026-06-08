# @postel/nestjs

> NestJS module + guard + decorators that gate a route with a configured Postel inbound source.

```ts title="main.ts"
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// rawBody:true exposes req.rawBody so signatures verify byte-for-byte.
const app = await NestFactory.create(AppModule, { rawBody: true });
await app.listen(3000);
```

```ts title="app.module.ts"
import { Module } from "@nestjs/common";
import { PostelModule } from "@postel/nestjs";
import { postel } from "./lib/postel"; // Postel({ inbound: { vendor: { verify: Secret(...) } } })

@Module({ imports: [PostelModule.forRoot(postel)], controllers: [WebhooksController] })
export class AppModule {}
```

```ts title="webhooks.controller.ts"
import { Controller, Post, UseGuards } from "@nestjs/common";
import { WebhookGuard, Event } from "@postel/nestjs";
import type { WebhookEvent } from "@postel/core";

@Controller("webhooks")
export class WebhooksController {
  @Post("vendor")
  @UseGuards(WebhookGuard("vendor"))
  handle(@Event() event: WebhookEvent) {
    return { ok: true, type: event.type };
  }
}
```

`WebhookGuard(key)` reads the raw request body (`req.rawBody`, falling back to `req.body`), runs the verifier(s) you configured on that source, and on success sets the verified result on the request — `@Event()` and `@WebhookResult()` read it. On failure it throws an `HttpException` with the mapped status; a non-`PostelError` (e.g. a programming bug) propagates so Nest yields a 5xx. The error→status policy and byte handling live in [`@postel/http`](../../http).

For compile-time-checked source keys, call `NestjsWebAdapter(postel)` once and use its `WebhookGuard` (its `key` argument is narrowed to your configured source names).

## License

MIT
