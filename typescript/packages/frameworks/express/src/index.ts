import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  EventOf,
  InboundSource,
  OutboundApi,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  type WebhookMethod,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import { headersFromNode, writeOutcomeToNodeRes, writeResponseToNodeRes } from "@postel/http/node";
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type RequestHandler,
  type Response as ExpressResponse,
} from "express";

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

// The gate sets the verified result on `req.postel`; a handler registered
// through the facade sees it as a non-optional, source-typed field.
type VerifiedRequest<TData> = ExpressRequest & { readonly postel: ComposedVerifyResult<TData> };
type ExpressVerifiedHandler<TData> = (
  req: VerifiedRequest<TData>,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

function setVerified(req: ExpressRequest, result: ComposedVerifyResult<unknown>): void {
  (req as { postel?: ComposedVerifyResult<unknown> }).postel = result;
}

/**
 * Read the verified webhook result off an Express request on the **primitive**
 * (`verifyWebhook`) path. Throws if the gate did not run. Pass `TData` to type
 * the payload. Routes registered through `ExpressWebAdapter(...).inbound.<source>.post`
 * receive a typed `req.postel` directly and don't need this.
 */
export function getVerified<TData = unknown>(req: ExpressRequest): ComposedVerifyResult<TData> {
  const result = (req as { postel?: ComposedVerifyResult<TData> }).postel;
  if (result === undefined) {
    throw new Error(
      "getVerified(): no verified webhook on the request — run verifyWebhook on this route first.",
    );
  }
  return result;
}

function rawBuffer(body: unknown): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(0);
}

function gate<TData>(
  source: GateSource<TData>,
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
          setVerified(req, outcome.context.result);
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
  source: GateSource<TData>,
  opts?: WebhookHandlerOptions<TData>,
): RequestHandler[] {
  return [RAW, gate(source, opts, (_req, _res, next) => next())];
}

export function withWebhook<TData = unknown>(
  source: GateSource<TData>,
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

export interface ExpressInboundRoute<TDefault = unknown> {
  /** Gate a route on an explicit body-bearing method (`POST` | `PUT` | `PATCH`). */
  on<TData = TDefault>(
    method: WebhookMethod,
    route: string,
    handler: ExpressVerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): ExpressInboundRoute<TDefault>;
  /** Gate a `POST` route — sugar for `on("POST", …)`. */
  post<TData = TDefault>(
    route: string,
    handler: ExpressVerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): ExpressInboundRoute<TDefault>;
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
  ? {
      readonly inbound: {
        readonly [K in keyof InboundSourcesOf<C>]: ExpressInboundRoute<
          EventOf<InboundSourcesOf<C>[K]>
        >;
      };
    }
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
        on(method, route, handler, opts) {
          const verb = method.toLowerCase() as "post" | "put" | "patch";
          app[verb](
            route,
            ...withWebhook(
              source,
              handler as RequestHandler,
              opts as WebhookHandlerOptions | undefined,
            ),
          );
          return builder;
        },
        post(route, handler, opts) {
          return builder.on("POST", route, handler, opts);
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
