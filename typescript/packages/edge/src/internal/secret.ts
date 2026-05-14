import { MalformedHeader } from "../errors.js";
import { base64ToBytes } from "./base64.js";

export const HMAC_PREFIX = "whsec_";
export const ED_PRIVATE_PREFIX = "whsk_";
export const ED_PUBLIC_PREFIX = "whpk_";

export type SecretKind = "hmac" | "ed25519-private" | "ed25519-public";

export interface DecodedSecret {
  readonly kind: SecretKind;
  readonly bytes: Uint8Array;
}

export function decodeSecret(secret: string): DecodedSecret {
  if (secret.startsWith(HMAC_PREFIX)) {
    return { kind: "hmac", bytes: base64ToBytes(secret.slice(HMAC_PREFIX.length)) };
  }
  if (secret.startsWith(ED_PRIVATE_PREFIX)) {
    return {
      kind: "ed25519-private",
      bytes: base64ToBytes(secret.slice(ED_PRIVATE_PREFIX.length)),
    };
  }
  if (secret.startsWith(ED_PUBLIC_PREFIX)) {
    return {
      kind: "ed25519-public",
      bytes: base64ToBytes(secret.slice(ED_PUBLIC_PREFIX.length)),
    };
  }
  throw new MalformedHeader(
    `secret must start with "${HMAC_PREFIX}", "${ED_PRIVATE_PREFIX}", or "${ED_PUBLIC_PREFIX}"`,
  );
}
