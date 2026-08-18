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
const SHOPIFY_SIGNATURE_HEADER = "X-Shopify-Hmac-Sha256";
const SHOPIFY_TOPIC_HEADER = "X-Shopify-Topic";
const TWILIO_SIGNATURE_HEADER = "X-Twilio-Signature";
const TWILIO_EVENT_TYPE = "twilio.webhook";
const SLACK_SIGNATURE_HEADER = "X-Slack-Signature";
const SLACK_TIMESTAMP_HEADER = "X-Slack-Request-Timestamp";
const DEFAULT_SLACK_TOLERANCE_SECONDS = 300;

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

async function hmac(
  secret: string,
  message: Uint8Array,
  hash: "SHA-256" | "SHA-1",
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
}

async function hmacSha256(secret: string, message: Uint8Array): Promise<Uint8Array> {
  return hmac(secret, message, "SHA-256");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function isValidBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(value) && bytesToBase64(base64ToBytes(value)) === value;
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

async function matchesDigestBase64(
  secret: string,
  message: Uint8Array,
  candidateBase64: string,
  hash: "SHA-256" | "SHA-1" = "SHA-256",
): Promise<boolean> {
  if (!isValidBase64(candidateBase64)) return false;
  const digest = await hmac(secret, message, hash);
  return constantTimeEqual(digest, base64ToBytes(candidateBase64));
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

export function Shopify(secret: string): Verifier {
  return {
    verify: async (rawBody, headers: WebhookHeaders): Promise<VerifyResult> => {
      const candidate = requireHeader(headers, SHOPIFY_SIGNATURE_HEADER);
      const topic = requireHeader(headers, SHOPIFY_TOPIC_HEADER);
      if (!isValidBase64(candidate)) {
        throw new MalformedHeader(`${SHOPIFY_SIGNATURE_HEADER} must be valid base64`);
      }

      const bodyText = bodyToText(rawBody);
      const canonical = new TextEncoder().encode(bodyText);
      if (!(await matchesDigestBase64(secret, canonical, candidate))) {
        throw new SignatureInvalid(
          `${SHOPIFY_SIGNATURE_HEADER} did not match the configured secret`,
        );
      }

      const body = parseEventBody(bodyText, "Shopify event");
      const event: WebhookEvent = { type: topic, data: body };
      return { event, matchedSecretIndex: 0 };
    },
  };
}

function parseFormBody(bodyText: string): Record<string, string> {
  const params = new URLSearchParams(bodyText);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

function twilioCanonicalString(url: string, bodyText: string): string {
  const params = new URLSearchParams(bodyText);
  const sortedKeys = [...params.keys()].sort();
  return sortedKeys.reduce((acc, key) => acc + key + (params.get(key) ?? ""), url);
}

export function Twilio(authToken: string, url: string): Verifier {
  return {
    verify: async (rawBody, headers: WebhookHeaders): Promise<VerifyResult> => {
      const candidate = requireHeader(headers, TWILIO_SIGNATURE_HEADER);

      const bodyText = bodyToText(rawBody);
      const canonical = new TextEncoder().encode(twilioCanonicalString(url, bodyText));
      if (!(await matchesDigestBase64(authToken, canonical, candidate, "SHA-1"))) {
        throw new SignatureInvalid(
          `${TWILIO_SIGNATURE_HEADER} did not match the configured authToken/url`,
        );
      }

      const event: WebhookEvent = { type: TWILIO_EVENT_TYPE, data: parseFormBody(bodyText) };
      return { event, matchedSecretIndex: 0 };
    },
  };
}

export function Slack(signingSecret: string, options?: VerifyOptions): Verifier {
  return {
    verify: async (rawBody, headers: WebhookHeaders): Promise<VerifyResult> => {
      const candidate = requireHeader(headers, SLACK_SIGNATURE_HEADER);
      const timestamp = requireHeader(headers, SLACK_TIMESTAMP_HEADER);

      const prefix = "v0=";
      if (!candidate.startsWith(prefix)) {
        throw new MalformedHeader(`${SLACK_SIGNATURE_HEADER} must start with "${prefix}"`);
      }
      const candidateHex = candidate.slice(prefix.length);

      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || ts <= 0 || !Number.isInteger(ts)) {
        throw new MalformedHeader(`${SLACK_TIMESTAMP_HEADER}: invalid value`);
      }

      const clock = options?.clock ?? systemClock;
      const tolerance = options?.toleranceSeconds ?? DEFAULT_SLACK_TOLERANCE_SECONDS;
      const drift = Math.abs(Math.floor(clock.now().getTime() / 1000) - ts);
      if (drift > tolerance) {
        throw new TimestampTooOld(
          `${SLACK_TIMESTAMP_HEADER} drift ${drift}s exceeds tolerance ${tolerance}s`,
        );
      }

      const bodyText = bodyToText(rawBody);
      const canonical = new TextEncoder().encode(`v0:${timestamp}:${bodyText}`);
      if (!(await matchesDigest(signingSecret, canonical, candidateHex))) {
        throw new SignatureInvalid(
          `${SLACK_SIGNATURE_HEADER} did not match the configured signing secret`,
        );
      }

      const body = parseEventBody(bodyText, "Slack event");
      if (typeof body.type !== "string") {
        throw new MalformedHeader("Slack event: body missing string `type` field");
      }
      const event: WebhookEvent = { type: body.type, data: body };
      return { event, matchedSecretIndex: 0 };
    },
  };
}
