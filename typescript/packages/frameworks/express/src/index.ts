import type {
  ComposedVerifyResult,
  InboundApi,
  InboundSource,
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

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export function expressAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C> & { readonly inbound: InboundApi<InboundSourcesOf<C>> },
): {
  verify<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    opts?: WebhookHandlerOptions<TData>,
  ): RequestHandler[];
  guard<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    handler: RequestHandler,
    opts?: WebhookHandlerOptions<TData>,
  ): RequestHandler[];
  jwks(provider: JwksProvider): RequestHandler;
} {
  return {
    verify(key, opts) {
      return verifyWebhook(postel.inbound[key], opts);
    },
    guard(key, handler, opts) {
      return withWebhook(postel.inbound[key], handler, opts);
    },
    jwks(provider) {
      return (req, res, next) => {
        const request = new Request(`http://local${req.url ?? "/"}`, { method: req.method });
        jwksFetchHandler(provider)(request)
          .then((response) => writeResponseToNodeRes(res, response))
          .catch(next);
      };
    },
  };
}
