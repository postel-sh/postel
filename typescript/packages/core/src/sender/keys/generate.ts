import { bytesToBase64 } from "../../internal/base64.js";
import type { AsymmetricKeypair } from "../../outbound.js";

const HMAC_BYTES = 32;

export function generateSymmetric(): string {
  const bytes = new Uint8Array(HMAC_BYTES);
  crypto.getRandomValues(bytes);
  return `whsec_${bytesToBase64(bytes)}`;
}

export async function generateAsymmetric(): Promise<AsymmetricKeypair> {
  const keypair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const priv = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const pub = await crypto.subtle.exportKey("raw", keypair.publicKey);
  return {
    private: `whsk_${bytesToBase64(new Uint8Array(priv))}`,
    public: `whpk_${bytesToBase64(new Uint8Array(pub))}`,
  };
}
