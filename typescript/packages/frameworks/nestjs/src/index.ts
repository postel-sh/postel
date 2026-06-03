import "reflect-metadata";
import {
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Module,
  type Type,
  createParamDecorator,
} from "@nestjs/common";
import type {
  ComposedVerifyResult,
  InboundApi,
  InboundSource,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import { type GateSource, type WebhookHandlerOptions, handleInbound } from "@postel/http";
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
  return new Uint8Array(0);
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

export function createPostelDecorators<const C extends PostelConfig>(
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
