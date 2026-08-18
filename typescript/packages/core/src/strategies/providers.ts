import { systemClock } from "../clock.js";
import { MalformedHeader, SignatureInvalid, TimestampTooOld } from "../errors.js";
import { bodyToText } from "../internal/event.js";
import { requireHeader } from "../internal/headers.js";
import { constantTimeEqual } from "../internal/timing.js";
import type { VerifyOptions, VerifyResult, WebhookEvent, WebhookHeaders } from "../types.js";
import type { Verifier } from "./verify.js";

const STRIPE_SIGNATURE_HEADER = "Stripe-Signature";
const GITHUB_SIGNATURE_HEADER = "X-Hub-Signature-256";
const GITHUB_EVENT_HEADER = "X-GitHub-Event";
const DEFAULT_STRIPE_TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/u.test(hex)) {
    throw new Error(`invalid hex string: "${hex}"`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha256(secret: string, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
}

async function matchesDigest(
  secret: string,
  message: Uint8Array,
  candidateHex: string,
): Promise<boolean> {
  let candidateBytes: Uint8Array;
  try {
    candidateBytes = hexToBytes(candidateHex);
  } catch {
    return false;
  }
  const digest = await hmacSha256(secret, message);
  return constantTimeEqual(digest, candidateBytes);
}

function parseEventBody(
  bodyText: string,
  errorContext: string,
): { type?: unknown; data?: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (cause) {
    throw new MalformedHeader(`${errorContext}: body is not valid JSON`, { cause });
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new MalformedHeader(`${errorContext}: body must be a JSON object`);
  }
  return parsed as { type?: unknown; data?: unknown };
}

export function Stripe(secret: string, options?: VerifyOptions): Verifier {
  return {
    verify: async (rawBody, headers: WebhookHeaders): Promise<VerifyResult> => {
      const header = requireHeader(headers, STRIPE_SIGNATURE_HEADER);

      let timestamp: string | undefined;
      const v1Signatures: string[] = [];
      for (const token of header.split(",")) {
        const eq = token.indexOf("=");
        if (eq <= 0) continue;
        const key = token.slice(0, eq).trim();
        const value = token.slice(eq + 1).trim();
        if (key === "t") timestamp = value;
        else if (key === "v1") v1Signatures.push(value);
      }
      if (!timestamp || v1Signatures.length === 0) {
        throw new MalformedHeader(
          `${STRIPE_SIGNATURE_HEADER} must contain "t=<unix>" and at least one "v1=<hex>"`,
        );
      }
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || ts <= 0 || !Number.isInteger(ts)) {
        throw new MalformedHeader(`${STRIPE_SIGNATURE_HEADER}: invalid "t" value`);
      }

      const clock = options?.clock ?? systemClock;
      const tolerance = options?.toleranceSeconds ?? DEFAULT_STRIPE_TOLERANCE_SECONDS;
      const drift = Math.abs(Math.floor(clock.now().getTime() / 1000) - ts);
      if (drift > tolerance) {
        throw new TimestampTooOld(
          `${STRIPE_SIGNATURE_HEADER} drift ${drift}s exceeds tolerance ${tolerance}s`,
        );
      }

      const bodyText = bodyToText(rawBody);
      const canonical = new TextEncoder().encode(`${timestamp}.${bodyText}`);

      let matched = false;
      for (const candidate of v1Signatures) {
        if (await matchesDigest(secret, canonical, candidate)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        throw new SignatureInvalid(
          `No v1 signature in ${STRIPE_SIGNATURE_HEADER} matched the configured secret`,
        );
      }

      const body = parseEventBody(bodyText, "Stripe event");
      if (typeof body.type !== "string") {
        throw new MalformedHeader("Stripe event: body missing string `type` field");
      }
      const event: WebhookEvent = { type: body.type, data: body.data };
      return { event, matchedSecretIndex: 0 };
    },
  };
}

export function GitHub(secret: string): Verifier {
  return {
    verify: async (rawBody, headers: WebhookHeaders): Promise<VerifyResult> => {
      const header = requireHeader(headers, GITHUB_SIGNATURE_HEADER);
      const eventType = requireHeader(headers, GITHUB_EVENT_HEADER);

      const prefix = "sha256=";
      if (!header.startsWith(prefix)) {
        throw new MalformedHeader(`${GITHUB_SIGNATURE_HEADER} must start with "${prefix}"`);
      }
      const candidate = header.slice(prefix.length);

      const bodyText = bodyToText(rawBody);
      const canonical = new TextEncoder().encode(bodyText);
      if (!(await matchesDigest(secret, canonical, candidate))) {
        throw new SignatureInvalid(
          `${GITHUB_SIGNATURE_HEADER} did not match the configured secret`,
        );
      }

      const body = parseEventBody(bodyText, "GitHub event");
      const event: WebhookEvent = { type: eventType, data: body };
      return { event, matchedSecretIndex: 0 };
    },
  };
}
