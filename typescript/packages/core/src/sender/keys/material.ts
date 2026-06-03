import { bytesToBase64 } from "../../internal/base64.js";
import { decodeSecret } from "../../internal/secret.js";
import type { SecretAlgorithm } from "../../storage/types.js";
import { generateAsymmetric, generateSymmetric } from "./generate.js";

export function newSecretId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sec_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

export interface NewSecretMaterial {
  readonly encryptedValue: Uint8Array;
  readonly publicKey?: Uint8Array;
}

export async function mintSecretMaterial(algorithm: SecretAlgorithm): Promise<NewSecretMaterial> {
  if (algorithm === "v1a") {
    const keypair = await generateAsymmetric();
    return {
      encryptedValue: new TextEncoder().encode(keypair.private),
      publicKey: decodeSecret(keypair.public).bytes,
    };
  }
  return { encryptedValue: new TextEncoder().encode(generateSymmetric()) };
}
