import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  InboundSource,
  OutboundApi,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import { headersFromNode, writeOutcomeToNodeRes, writeResponseToNodeRes } from "@postel/http/node";
import express, { type RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      postel?: ComposedVerifyResult<unknown>;
    }
  }
}

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

function rawBuffer(body: unknown): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(0);
}

function gate<TData>(
  source: GateSource,
  opts: WebhookHandlerOptions<TData> | undefined,
  onVerified: RequestHandler,
): RequestHandler {
  return (req, res, next) => {
    handleInbound<TData>(
      source,
      { rawBody: rawBuffer(req.body), headers: headersFromNode(req.headers), method: req.method },
      opts,
    )
      .then((outcome) => {
        if (outcome.kind === "verified") {
          req.postel = outcome.context.result;
          onVerified(req, res, next);
          return;
        }
        writeOutcomeToNodeRes(res, outcome);
      })
      .catch(next);
  };
}

const RAW: RequestHandler = express.raw({ type: () => true });

export function verifyWebhook<TData = unknown>(
  source: GateSource,
  opts?: WebhookHandlerOptions<TData>,
): RequestHandler[] {
  return [RAW, gate(source, opts, (_req, _res, next) => next())];
}

export function withWebhook<TData = unknown>(
  source: GateSource,
  handler: RequestHandler,
  opts?: WebhookHandlerOptions<TData>,
): RequestHandler[] {
  return [RAW, gate(source, opts, handler)];
}

export function fetchToExpress(handler: (req: Request) => Promise<Response>): RequestHandler {
  return (req, res, next) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const init: RequestInit = { method: req.method, headers: headersFromNode(req.headers) };
      if (buffer.length > 0) init.body = buffer;
      const request = new Request(`http://local${req.originalUrl ?? req.url ?? "/"}`, init);
      handler(request)
        .then((response) => writeResponseToNodeRes(res, response))
        .catch(next);
    });
    req.on("error", next);
  };
}

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export interface ExpressInboundRoute {
  post<TData = unknown>(
    route: string,
    handler: RequestHandler,
    opts?: WebhookHandlerOptions<TData>,
  ): ExpressInboundRoute;
}

export interface ExpressOutboundBindings {
  bindJwks(route?: string, provider?: JwksProvider): void;
}

export interface ExpressAdminBindings {
  bindAdminRoutes(prefix: string, opts: AdminRouterOptions): void;
}

type ExpressWebAdapter<C extends PostelConfig> = (C extends {
  readonly inbound: Record<string, InboundSource>;
}
  ? { readonly inbound: { readonly [K in keyof InboundSourcesOf<C>]: ExpressInboundRoute } }
  : object) &
  (C extends { readonly outbound: object }
    ? { readonly outbound: ExpressOutboundBindings; readonly admin: ExpressAdminBindings }
    : object);

export function ExpressWebAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C>,
  app: ReturnType<typeof express>,
): ExpressWebAdapter<C> {
  const p = postel as unknown as {
    readonly inbound?: Record<string, GateSource>;
    readonly outbound?: OutboundApi;
  };
  const result: {
    inbound?: Record<string, ExpressInboundRoute>;
    outbound?: ExpressOutboundBindings;
    admin?: ExpressAdminBindings;
  } = {};

  if (p.inbound) {
    const inbound: Record<string, ExpressInboundRoute> = {};
    for (const key of Object.keys(p.inbound)) {
      const source = p.inbound[key] as GateSource;
      const builder: ExpressInboundRoute = {
        post(route, handler, opts) {
          app.post(route, ...withWebhook(source, handler, opts));
          return builder;
        },
      };
      inbound[key] = builder;
    }
    result.inbound = inbound;
  }

  if (p.outbound) {
    const outbound = p.outbound;
    result.outbound = {
      bindJwks(route = WELL_KNOWN_JWKS, provider = () => outbound.keys.publicJwks()) {
        app.get(route, (req, res, next) => {
          const request = new Request(`http://local${req.url ?? "/"}`, { method: req.method });
          jwksFetchHandler(provider)(request)
            .then((response) => writeResponseToNodeRes(res, response))
            .catch(next);
        });
      },
    };
    result.admin = {
      bindAdminRoutes(prefix, opts) {
        app.use(prefix, fetchToExpress(adminRouter({ outbound }, opts)));
      },
    };
  }

  return result as ExpressWebAdapter<C>;
}
