import { MalformedHeader } from "./errors.js";
import { bytesToBase64 } from "./internal/base64.js";
import { signHmacV1 } from "./internal/hmac.js";
import { HMAC_PREFIX, decodeSecret } from "./internal/secret.js";
import type { SignFixtureOptions, SignedFixture } from "./types.js";

function randomMessageId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `msg_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

export async function signFixture<TData = unknown>(
  options: SignFixtureOptions<TData>,
): Promise<SignedFixture> {
  const decoded = decodeSecret(options.secret);
  if (decoded.kind !== "hmac") {
    throw new MalformedHeader(
      `signFixture: only ${HMAC_PREFIX}-prefixed HMAC secrets are supported in the v0.1.0 helper`,
    );
  }

  const messageId = options.messageId ?? randomMessageId();
  const timestampSeconds = Math.floor(
    (options.timestamp ?? new Date()).getTime() / 1000,
  ).toString();
  const body = JSON.stringify(options.payload);
  const canonical = new TextEncoder().encode(`${messageId}.${timestampSeconds}.${body}`);
  const signatureB64 = await signHmacV1(decoded.bytes, canonical);

  return {
    headers: {
      "webhook-id": messageId,
      "webhook-timestamp": timestampSeconds,
      "webhook-signature": `v1,${signatureB64}`,
    },
    body,
  };
}
