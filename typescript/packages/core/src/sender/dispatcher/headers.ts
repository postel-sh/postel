import { importEd25519PrivateKey, signEd25519V1a } from "../../internal/ed25519.js";
import { KEY_ID_HEADER } from "../../internal/headers.js";
import { signHmacV1 } from "../../internal/hmac.js";
import { ed25519Kid } from "../../internal/jwk.js";
import { decodeSecret } from "../../internal/secret.js";
import type { EndpointRecord, EndpointSecretRecord } from "../../storage/types.js";

export interface SignedHeadersInput {
  readonly messageId: string;
  readonly timestampSeconds: number;
  readonly body: string;
  readonly secrets: ReadonlyArray<EndpointSecretRecord>;
  readonly version?: string | null;
}

export async function signAndBuildHeaders(
  input: SignedHeadersInput,
): Promise<Record<string, string>> {
  const tuples: string[] = [];
  let keyId: string | undefined;
  if (input.secrets.length === 0) throw new Error("endpoint has no primary signing secret");
  const canonical = new TextEncoder().encode(
    `${input.messageId}.${input.timestampSeconds}.${input.body}`,
  );
  // The caller passes only `primary` secrets (one per algorithm). Verifying /
  // expiring secrets exist for the receiver's rotation-overlap window and MUST
  // NOT be used for outbound signing.
  for (const sec of input.secrets) {
    const secretString = new TextDecoder().decode(sec.encryptedValue);
    const decoded = decodeSecret(secretString);
    if (sec.algorithm === "v1" && decoded.kind === "hmac") {
      const sig = await signHmacV1(decoded.bytes, canonical);
      tuples.push(`v1,${sig}`);
    } else if (sec.algorithm === "v1a" && decoded.kind === "ed25519-private") {
      const key = await importEd25519PrivateKey(decoded.bytes);
      const sig = await signEd25519V1a(key, canonical);
      tuples.push(`v1a,${sig}`);
      if (sec.publicKey) keyId = await ed25519Kid(sec.publicKey);
    }
  }
  if (tuples.length === 0) throw new Error("no usable primary signing secret");
  const headers: Record<string, string> = {
    "webhook-id": input.messageId,
    "webhook-timestamp": String(input.timestampSeconds),
    "webhook-signature": tuples.join(" "),
    "content-type": "application/json",
  };
  if (keyId !== undefined) headers[KEY_ID_HEADER] = keyId;
  if (input.version !== null && input.version !== undefined) {
    headers["webhook-version"] = input.version;
  }
  return headers;
}

export function resolveCustomHeaders(
  endpoint: EndpointRecord,
  message: unknown,
): Record<string, string> {
  const raw = endpoint.headers;
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "function") {
    return (raw as (ctx: { message: unknown }) => Record<string, string>)({ message });
  }
  return raw as Record<string, string>;
}
