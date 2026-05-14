import { MalformedHeader, SignatureInvalid, TimestampTooOld, UnknownKeyId } from "./errors.js";
import { importEd25519PublicKey, verifyEd25519V1a } from "./internal/ed25519.js";
import { bodyToText, parseEvent } from "./internal/event.js";
import {
  ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  requireHeader,
} from "./internal/headers.js";
import { verifyHmacV1 } from "./internal/hmac.js";
import { ED_PRIVATE_PREFIX, ED_PUBLIC_PREFIX, decodeSecret } from "./internal/secret.js";
import { parseSignatureHeader } from "./internal/signature.js";
import type {
  Keyset,
  Secret,
  SecretOrKeyset,
  VerifyOptions,
  VerifyResult,
  WebhookHeaders,
} from "./types.js";

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function isKeyset(value: SecretOrKeyset): value is Keyset {
  return typeof value === "object" && value !== null && "findByKid" in value;
}

function isSecret(value: unknown): value is Secret {
  return typeof value === "string";
}

function normalizeSecrets(input: SecretOrKeyset): ReadonlyArray<Secret> {
  if (isSecret(input)) return [input];
  if (Array.isArray(input) && input.every(isSecret)) {
    if (input.length === 0) {
      throw new MalformedHeader("verify: empty secret array");
    }
    return input;
  }
  throw new MalformedHeader("verify: secretOrKeyset is not a string, string[], or Keyset");
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

export async function verify<TData = unknown>(
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
  secretOrKeyset: SecretOrKeyset,
  options?: VerifyOptions,
): Promise<VerifyResult<TData>> {
  const messageId = requireHeader(headers, ID_HEADER);
  const timestamp = requireHeader(headers, TIMESTAMP_HEADER);
  const signatureHeader = requireHeader(headers, SIGNATURE_HEADER);

  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options?.now ?? (() => new Date());
  enforceTimestampWindow(timestamp, tolerance, now);

  const tuples = parseSignatureHeader(signatureHeader);
  const bodyText = bodyToText(rawBody);
  const canonical = new TextEncoder().encode(`${messageId}.${timestamp}.${bodyText}`);

  if (isKeyset(secretOrKeyset)) {
    throw new UnknownKeyId(
      "verify with a Keyset is not implemented in the v0.1.0 skeleton (lands in PR 4)",
    );
  }

  const secrets = normalizeSecrets(secretOrKeyset);
  for (let secretIndex = 0; secretIndex < secrets.length; secretIndex++) {
    const secret = secrets[secretIndex] as Secret;
    const decoded = decodeSecret(secret);
    if (decoded.kind === "ed25519-private") {
      throw new MalformedHeader(
        `verify: receiver-side secrets must not carry the ${ED_PRIVATE_PREFIX} prefix (use ${ED_PUBLIC_PREFIX} or a Keyset)`,
      );
    }
    for (const tuple of tuples) {
      if (tuple.version === "v1" && decoded.kind === "hmac") {
        if (await verifyHmacV1(decoded.bytes, canonical, tuple.raw)) {
          return {
            event: parseEvent<TData>(bodyText),
            matchedSecretIndex: secretIndex,
          };
        }
      }
      if (tuple.version === "v1a" && decoded.kind === "ed25519-public") {
        const key = await importEd25519PublicKey(decoded.bytes);
        if (await verifyEd25519V1a(key, canonical, tuple.raw)) {
          return {
            event: parseEvent<TData>(bodyText),
            matchedSecretIndex: secretIndex,
          };
        }
      }
    }
  }

  throw new SignatureInvalid(
    `No signature tuple in ${SIGNATURE_HEADER} matched any provided secret (tried ${secrets.length} secret(s), ${tuples.length} tuple(s))`,
  );
}
