#!/usr/bin/env node
//
// typescript/scripts/reference-receiver.mjs
//
// Reference Standard Webhooks receiver built on top of `@postel/core`. Driven
// by the `@postel/compliance` suite as the v0.1.0 conformance gate per
// `openspec/specs/compliance/spec.md` "Suite identity" requirement.
//
// Routes:
//   POST /webhooks                         -- verify + optional dedup
//   GET  /.well-known/webhooks-keys        -- JWKS document (when configured)
//
// Configuration (env vars):
//   PORT                   -- listen port (default 8787)
//   POSTEL_SECRETS         -- comma-separated whsec_/whpk_ secrets (priority-ordered)
//   POSTEL_JWKS_KEYS       -- JSON-encoded JWKs array. Mounted at the well-known
//                             path AND used as an in-memory keyset for verify
//                             when the webhook-id carries a kid prefix.
//   POSTEL_DEDUP           -- "true" enables dedup; default off
//   POSTEL_DEDUP_TTL       -- TTL seconds (default 600)
//   POSTEL_DEDUP_PRESEED   -- comma-separated webhook-id prefixes that are
//                             reported as duplicate without consulting the
//                             dedup table (default "pre_seen_"; matches the
//                             compliance runner-receiver convention)
//   POSTEL_TOLERANCE       -- timestamp tolerance seconds (default 300)
//   POSTEL_NOW             -- ISO-8601 baseline; pins the verify clock for
//                             reproducible vector replay (otherwise wall-clock)
//
// Verdict signalling (consumed by the compliance runner):
//   verify success                 -> 200 {"ok":true,…}
//   dedup duplicate                -> 200 X-Postel-Dedup-Result: duplicate
//   PostelError (verify failure)   -> 400/4xx X-Postel-Verify-Error: <code>
//                                     and body {"error_code":"<code>"}

import { createServer } from "node:http";

import {
  PostelError,
  UnknownKeyId,
  dedup,
  inMemoryDedupAdapter,
  jwksHandler,
  verify,
} from "@postel/core";

const port = Number(process.env.PORT ?? 8787);
const secrets = (process.env.POSTEL_SECRETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const jwksKeys = process.env.POSTEL_JWKS_KEYS ? JSON.parse(process.env.POSTEL_JWKS_KEYS) : [];
const dedupEnabled = process.env.POSTEL_DEDUP === "true";
const dedupTtlSeconds = Number(process.env.POSTEL_DEDUP_TTL ?? "600");
const dedupPreseedPrefixes = (process.env.POSTEL_DEDUP_PRESEED ?? "pre_seen_")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const toleranceSeconds = Number(process.env.POSTEL_TOLERANCE ?? "300");
const fixedNow = process.env.POSTEL_NOW ? new Date(process.env.POSTEL_NOW) : undefined;
const nowFn = fixedNow ? () => fixedNow : () => new Date();

const dedupAdapter = inMemoryDedupAdapter({ now: nowFn });
const jwks = jwksKeys.length > 0 ? jwksHandler({ keys: jwksKeys }) : undefined;

function staticKeyset(keys, now) {
  return {
    async findByKid(kid) {
      const entry = keys.find((k) => k.kid === kid);
      if (!entry) return undefined;
      if (entry.not_after) {
        const expiry = Date.parse(entry.not_after);
        if (!Number.isNaN(expiry) && expiry <= now().getTime()) return undefined;
      }
      return entry;
    },
    async refresh() {},
  };
}

const keyset = jwksKeys.length > 0 ? staticKeyset(jwksKeys, nowFn) : undefined;

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

function extractKid(webhookId) {
  if (!webhookId) return undefined;
  const dot = webhookId.indexOf(".");
  if (dot <= 0) return undefined;
  const candidate = webhookId.slice(0, dot);
  if (!candidate.startsWith("kid_")) return undefined;
  return candidate;
}

function isPreSeeded(webhookId) {
  if (!webhookId) return false;
  return dedupPreseedPrefixes.some((p) => webhookId.startsWith(p));
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
  let messageId;
  try {
    const body = await readBody(req);
    const headers = readHeaders(req);
    messageId = headers["webhook-id"];

    const kid = extractKid(messageId);
    let verifyHeaders = headers;
    let target;
    if (kid && keyset) {
      target = keyset;
      verifyHeaders = { ...headers, "webhook-key-id": kid };
    } else if (secrets.length > 0) {
      target = secrets;
    } else if (keyset) {
      throw new UnknownKeyId("no kid prefix on webhook-id and no symmetric secrets configured");
    } else {
      throw new Error("reference-receiver: neither POSTEL_SECRETS nor POSTEL_JWKS_KEYS set");
    }

    result = await verify(body, verifyHeaders, target, {
      toleranceSeconds,
      now: nowFn,
    });

    if (dedupEnabled && messageId) {
      if (isPreSeeded(messageId)) {
        respond(
          res,
          200,
          { ok: true, type: result.event.type, duplicate: true },
          { "x-postel-dedup-result": "duplicate" },
        );
        return;
      }
      const dedupResult = await dedup(messageId, {
        ttl: dedupTtlSeconds,
        adapter: dedupAdapter,
      });
      if (dedupResult.duplicate) {
        respond(
          res,
          200,
          { ok: true, type: result.event.type, duplicate: true },
          { "x-postel-dedup-result": "duplicate" },
        );
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
