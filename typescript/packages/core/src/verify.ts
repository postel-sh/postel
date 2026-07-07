import { systemClock } from "./clock.js";
import {
  ConfigurationError,
  MalformedHeader,
  SignatureInvalid,
  TimestampTooOld,
  UnknownKeyId,
} from "./errors.js";
import { importEd25519PublicKey, verifyEd25519V1a } from "./internal/ed25519.js";
import { bodyToText, parseEvent } from "./internal/event.js";
import {
  ID_HEADER,
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  readHeader,
  requireHeader,
} from "./internal/headers.js";
import { verifyHmacV1 } from "./internal/hmac.js";
import { importEd25519PublicKeyFromJwk } from "./internal/jwk-import.js";
import { isExpired } from "./internal/jwk.js";
import { ED_PRIVATE_PREFIX, ED_PUBLIC_PREFIX, decodeSecret } from "./internal/secret.js";
import { type ParsedSignature, parseSignatureHeader } from "./internal/signature.js";
import type {
  JwksKeyset,
  SecretOrJwksKeyset,
  SecretValue,
  VerifyOptions,
  VerifyResult,
  WebhookHeaders,
} from "./types.js";

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function isKeyset(value: SecretOrJwksKeyset): value is JwksKeyset {
  return typeof value === "object" && value !== null && "findByKid" in value;
}

function isSecret(value: unknown): value is SecretValue {
  return typeof value === "string";
}

function normalizeSecrets(input: SecretOrJwksKeyset): ReadonlyArray<SecretValue> {
  if (isSecret(input)) return [input];
  if (Array.isArray(input) && input.every(isSecret)) {
    if (input.length === 0) {
      throw new ConfigurationError("verify: empty secret array");
    }
    return input;
  }
  throw new ConfigurationError("verify: secretOrKeyset is not a string, string[], or JwksKeyset");
}

function enforceTimestampWindow(tsHeader: string, toleranceSeconds: number, now: () => Date): void {
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || ts <= 0 || !Number.isInteger(ts)) {
    throw new MalformedHeader(`Invalid ${TIMESTAMP_HEADER}: not a positive integer`);
  }
  const drift = Math.abs(Math.floor(now().getTime() / 1000) - ts);
  if (drift > toleranceSeconds) {
    throw new TimestampTooOld(
      `${TIMESTAMP_HEADER} drift ${drift}s exceeds tolerance ${toleranceSeconds}s`,
    );
  }
}

async function verifyWithSecrets<TData>(
  secrets: ReadonlyArray<SecretValue>,
  tuples: ReadonlyArray<ParsedSignature>,
  canonical: Uint8Array,
  bodyText: string,
): Promise<VerifyResult<TData> | undefined> {
  for (let secretIndex = 0; secretIndex < secrets.length; secretIndex++) {
    const secret = secrets[secretIndex] as SecretValue;
    const decoded = decodeSecret(secret);
    if (decoded.kind === "ed25519-private") {
      throw new ConfigurationError(
        `verify: receiver-side secrets must not carry the ${ED_PRIVATE_PREFIX} prefix (use ${ED_PUBLIC_PREFIX} or a JwksKeyset)`,
      );
    }
    for (const tuple of tuples) {
      if (tuple.version === "v1" && decoded.kind === "hmac") {
        if (await verifyHmacV1(decoded.bytes, canonical, tuple.raw)) {
          return { event: parseEvent<TData>(bodyText), matchedSecretIndex: secretIndex };
        }
      }
      if (tuple.version === "v1a" && decoded.kind === "ed25519-public") {
        const key = await importEd25519PublicKey(decoded.bytes);
        if (await verifyEd25519V1a(key, canonical, tuple.raw)) {
          return { event: parseEvent<TData>(bodyText), matchedSecretIndex: secretIndex };
        }
      }
    }
  }
  return undefined;
}

async function verifyWithKeyset<TData>(
  keyset: JwksKeyset,
  kid: string,
  tuples: ReadonlyArray<ParsedSignature>,
  canonical: Uint8Array,
  bodyText: string,
  now: Date,
): Promise<VerifyResult<TData>> {
  const jwk = await keyset.findByKid(kid);
  if (!jwk || isExpired(jwk, now)) {
    throw new UnknownKeyId(`kid "${kid}" not found in keyset`);
  }
  const publicKey = await importEd25519PublicKeyFromJwk(jwk);
  for (const tuple of tuples) {
    if (tuple.version !== "v1a") continue;
    if (await verifyEd25519V1a(publicKey, canonical, tuple.raw)) {
      return { event: parseEvent<TData>(bodyText), matchedSecretIndex: 0 };
    }
  }
  throw new SignatureInvalid(`No v1a tuple verified against kid "${kid}"`);
}

export async function verify<TData = unknown>(
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
  secretOrKeyset: SecretOrJwksKeyset,
  options?: VerifyOptions,
): Promise<VerifyResult<TData>> {
  const messageId = requireHeader(headers, ID_HEADER);
  const timestamp = requireHeader(headers, TIMESTAMP_HEADER);
  const signatureHeader = requireHeader(headers, SIGNATURE_HEADER);

  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const clock = options?.clock ?? systemClock;
  const now = () => clock.now();
  enforceTimestampWindow(timestamp, tolerance, now);

  const tuples = parseSignatureHeader(signatureHeader);
  const bodyText = bodyToText(rawBody);
  const canonical = new TextEncoder().encode(`${messageId}.${timestamp}.${bodyText}`);

  if (isKeyset(secretOrKeyset)) {
    const kid = readHeader(headers, KEY_ID_HEADER);
    if (!kid) {
      throw new MalformedHeader(
        `verify with a JwksKeyset requires the ${KEY_ID_HEADER} header to identify which key to use`,
      );
    }
    return verifyWithKeyset<TData>(secretOrKeyset, kid, tuples, canonical, bodyText, now());
  }

  const secrets = normalizeSecrets(secretOrKeyset);
  const result = await verifyWithSecrets<TData>(secrets, tuples, canonical, bodyText);
  if (result) return result;

  throw new SignatureInvalid(
    `No signature tuple in ${SIGNATURE_HEADER} matched any provided secret (tried ${secrets.length} secret(s), ${tuples.length} tuple(s))`,
  );
}
