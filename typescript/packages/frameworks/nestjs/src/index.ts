import "reflect-metadata";
import {
  type CallHandler,
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
  type Type,
  createParamDecorator,
} from "@nestjs/common";
import { ConfigurationError } from "@postel/core";
import type {
  ComposedVerifyResult,
  InboundApi,
  InboundSource,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import { type GateSource, type WebhookHandlerOptions, handleInbound } from "@postel/http";
import { type Observable, from, throwError } from "rxjs";
import { catchError, mergeMap } from "rxjs/operators";

export type { ComposedVerifyResult } from "@postel/core";
export type { WebhookContext, WebhookHandlerOptions } from "@postel/http";
import { headersFromNode } from "@postel/http/node";

export const POSTEL_INSTANCE = Symbol.for("postel:instance");

interface InboundCarrier {
  readonly inbound: Record<string, GateSource>;
}

interface PostelRequest {
  rawBody?: unknown;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  postel?: ComposedVerifyResult<unknown>;
  postelDedupRelease?: () => Promise<void>;
}

// biome-ignore lint/complexity/noStaticOnlyClass: a NestJS module is a class by framework contract
export class PostelModule {
  static forRoot(postel: InboundCarrier): DynamicModule {
    return {
      module: PostelModule,
      global: true,
      providers: [{ provide: POSTEL_INSTANCE, useValue: postel }],
      exports: [POSTEL_INSTANCE],
    };
  }
}
// Applied programmatically (not as `@Module(...)` syntax) so the source parses
// under TC39-decorator tooling; the runtime metadata is identical.
Module({})(PostelModule);

function toBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  // A bodyless request never populates `req.rawBody`/`req.body`; let verification
  // reject it as a malformed/missing-header 400 rather than blaming the integrator.
  if (body === undefined || body === null) return new Uint8Array(0);
  // Anything else — a parsed object — means the Nest app's global body parser
  // consumed the raw bytes before the guard ran (no `rawBody: true` at bootstrap).
  throw new ConfigurationError(
    "Postel's WebhookGuard received an already-parsed request body. NestJS's body parser " +
      "consumed the raw bytes before the guard ran, so the signature cannot be verified against " +
      "the original payload. Bootstrap the Nest app with `rawBody: true` (e.g. " +
      "`NestFactory.create(AppModule, { rawBody: true })`) so `req.rawBody` carries the " +
      "untouched bytes.",
  );
}

export function WebhookGuard(key: string, opts?: WebhookHandlerOptions): Type<CanActivate> {
  class PostelWebhookGuard implements CanActivate {
    constructor(private readonly postel: InboundCarrier) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const source = this.postel.inbound[key];
      if (!source) throw new Error(`WebhookGuard: no inbound source "${key}" configured`);
      const req = context.switchToHttp().getRequest<PostelRequest>();
      const outcome = await handleInbound(
        source,
        {
          rawBody: toBytes(req.rawBody ?? req.body),
          headers: headersFromNode(req.headers),
          method: req.method,
        },
        opts,
      );
      if (outcome.kind === "verified") {
        req.postel = outcome.context.result;
        const { messageId } = outcome.context;
        if (outcome.dedupRecorded && messageId !== undefined) {
          req.postelDedupRelease = () => source.dedupRelease?.(messageId) ?? Promise.resolve();
        }
        return true;
      }
      const body =
        outcome.kind === "error" ? (JSON.parse(outcome.body) as Record<string, unknown>) : {};
      throw new HttpException(body, outcome.status);
    }
  }
  Injectable()(PostelWebhookGuard);
  Inject(POSTEL_INSTANCE)(PostelWebhookGuard, undefined, 0);
  return PostelWebhookGuard;
}

/**
 * Releases the dedup record a `WebhookGuard` wrote when the route handler then
 * throws. A guard runs before the handler and cannot observe its failure, so
 * the release rides an interceptor: pair `@UseGuards(WebhookGuard("x", { dedup }))`
 * with `@UseInterceptors(WebhookReleaseInterceptor)` on dedup-gated routes.
 * Routes without dedup (or whose adapter has no `release`) pass through untouched.
 */
export class WebhookReleaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<PostelRequest>();
    const release = req.postelDedupRelease;
    if (!release) return next.handle();
    return next
      .handle()
      .pipe(
        catchError((err: unknown) =>
          from(release().catch(() => undefined)).pipe(mergeMap(() => throwError(() => err))),
        ),
      );
  }
}
Injectable()(WebhookReleaseInterceptor);

export const Event = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<PostelRequest>().postel?.event;
});

export const WebhookResult = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<PostelRequest>().postel;
});

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export function NestjsWebAdapter<const C extends PostelConfig>(
  _postel: PostelInstance<C> & { readonly inbound: InboundApi<InboundSourcesOf<C>> },
): {
  WebhookGuard<K extends keyof InboundSourcesOf<C>>(
    key: K,
    opts?: WebhookHandlerOptions,
  ): Type<CanActivate>;
} {
  return {
    WebhookGuard(key, opts) {
      return WebhookGuard(String(key), opts);
    },
  };
}
