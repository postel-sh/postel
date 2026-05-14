#!/usr/bin/env node
//
// typescript/scripts/reference-receiver.mjs
//
// Reference Standard Webhooks receiver built on top of `@postel/edge`. Driven
// by the `@postel/compliance` suite as the v0.1.0 conformance gate per
// `openspec/specs/compliance/spec.md` "Suite identity" requirement.
//
// Routes:
//   POST /webhooks                         -- verify + optional dedup
//   GET  /.well-known/webhooks-keys        -- JWKS document (when configured)
//
// Configuration (env vars):
//   PORT                 -- listen port (default 8787)
//   POSTEL_SECRETS       -- comma-separated whsec_/whpk_ secrets (priority-ordered)
//   POSTEL_JWKS_KEYS     -- JSON-encoded JWKs array for the JWKS endpoint
//   POSTEL_JWKS_URI      -- when set, verify() uses createKeyset against this URI
//   POSTEL_DEDUP         -- "true" enables dedup; default off
//   POSTEL_DEDUP_TTL     -- TTL seconds (default 600)
//   POSTEL_TOLERANCE     -- timestamp tolerance seconds (default 300)
//   POSTEL_NOW           -- ISO-8601 baseline; pins the verify clock for
//                           reproducible vector replay (otherwise wall-clock)
//
// 4xx responses carry `X-Postel-Verify-Error: <code>` and a JSON body
// `{ "error_code": "<code>" }`. The compliance runner consumes either form.

import { createServer } from "node:http";

import {
  PostelError,
  createKeyset,
  dedup,
  inMemoryDedupAdapter,
  jwksHandler,
  verify,
} from "@postel/edge";

const port = Number(process.env.PORT ?? 8787);
const secrets = (process.env.POSTEL_SECRETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const jwksKeys = process.env.POSTEL_JWKS_KEYS ? JSON.parse(process.env.POSTEL_JWKS_KEYS) : [];
const dedupEnabled = process.env.POSTEL_DEDUP === "true";
const dedupTtlSeconds = Number(process.env.POSTEL_DEDUP_TTL ?? "600");
const toleranceSeconds = Number(process.env.POSTEL_TOLERANCE ?? "300");
const fixedNow = process.env.POSTEL_NOW ? new Date(process.env.POSTEL_NOW) : undefined;

const dedupAdapter = inMemoryDedupAdapter();
const jwks = jwksKeys.length > 0 ? jwksHandler({ keys: jwksKeys }) : undefined;
const keyset = process.env.POSTEL_JWKS_URI
  ? createKeyset({ jwksUri: process.env.POSTEL_JWKS_URI })
  : undefined;

function readHeaders(req) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) out[key] = value.join(", ");
    else if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

function respond(res, status, body, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function respondError(res, code, status = 400) {
  respond(res, status, { error_code: code }, { "x-postel-verify-error": code });
}

async function handleJwks(req, res) {
  if (!jwks) {
    respondError(res, "NOT_CONFIGURED", 404);
    return;
  }
  const webReq = new Request(`http://internal${req.url}`, { method: req.method });
  const webRes = jwks(webReq);
  const headers = Object.fromEntries(webRes.headers.entries());
  const body = webRes.body ? await webRes.text() : "";
  res.writeHead(webRes.status, headers);
  res.end(body);
}

async function handleWebhook(req, res) {
  let result;
  try {
    const body = await readBody(req);
    const headers = readHeaders(req);
    const target = keyset && headers["webhook-key-id"] ? keyset : secrets;
    if (!keyset && secrets.length === 0) {
      throw new Error("no secrets configured: set POSTEL_SECRETS or POSTEL_JWKS_URI");
    }
    result = await verify(body, headers, target, {
      toleranceSeconds,
      ...(fixedNow ? { now: () => fixedNow } : {}),
    });
    if (dedupEnabled) {
      const dedupResult = await dedup(headers["webhook-id"], {
        ttl: dedupTtlSeconds,
        adapter: dedupAdapter,
      });
      if (dedupResult.duplicate) {
        respondError(res, "DUPLICATE", 409);
        return;
      }
    }
  } catch (err) {
    if (err instanceof PostelError) {
      respondError(res, err.code);
    } else {
      console.error("[reference-receiver] non-PostelError:", err);
      respondError(res, "INTERNAL_ERROR", 500);
    }
    return;
  }
  respond(res, 200, {
    ok: true,
    type: result.event.type,
    matchedSecretIndex: result.matchedSecretIndex,
  });
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/.well-known/webhooks-keys")) {
    handleJwks(req, res).catch((err) => {
      console.error("[reference-receiver] jwks handler error", err);
      respondError(res, "INTERNAL_ERROR", 500);
    });
    return;
  }
  if (req.method === "POST" && (url === "/" || url === "/webhooks")) {
    handleWebhook(req, res).catch((err) => {
      console.error("[reference-receiver] webhook handler error", err);
      respondError(res, "INTERNAL_ERROR", 500);
    });
    return;
  }
  respondError(res, "NOT_FOUND", 404);
});

server.listen(port, () => {
  console.log(`reference-receiver: listening on http://127.0.0.1:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
