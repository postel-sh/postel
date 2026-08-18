import { bytesToBase64 } from "../../internal/base64.js";
import { decodeSecret } from "../../internal/secret.js";
import type { SecretAlgorithm, SecretEncryption } from "../../storage/types.js";
import { generateAsymmetric, generateSymmetric } from "./generate.js";

export function newSecretId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sec_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

export interface NewSecretMaterial {
  readonly material: Uint8Array;
  readonly encryption: SecretEncryption;
  readonly publicKey?: Uint8Array;
}

// Only PlaintextKms passes the fail-fast construction gate in outbound.ts
// today, so every minted secret is "plaintext" until envelope encryption ships.
const ENCRYPTION: SecretEncryption = "plaintext";

export async function mintSecretMaterial(algorithm: SecretAlgorithm): Promise<NewSecretMaterial> {
  if (algorithm === "v1a") {
    const keypair = await generateAsymmetric();
    return {
      material: new TextEncoder().encode(keypair.private),
      encryption: ENCRYPTION,
      publicKey: decodeSecret(keypair.public).bytes,
    };
  }
  return { material: new TextEncoder().encode(generateSymmetric()), encryption: ENCRYPTION };
}
