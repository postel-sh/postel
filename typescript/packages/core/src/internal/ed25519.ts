import { base64ToBytes, bytesToBase64 } from "./base64.js";

const ALG = { name: "Ed25519" } as const;

export async function importEd25519PublicKey(publicKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", publicKeyBytes as BufferSource, ALG, false, ["verify"]);
}

export async function importEd25519PrivateKey(privateKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", privateKeyBytes as BufferSource, ALG, false, ["sign"]);
}

export async function signEd25519V1a(privateKey: CryptoKey, message: Uint8Array): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, privateKey, message as BufferSource));
  return bytesToBase64(sig);
}

export async function verifyEd25519V1a(
  publicKey: CryptoKey,
  message: Uint8Array,
  signatureB64: string,
): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64ToBytes(signatureB64);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    ALG,
    publicKey,
    signatureBytes as BufferSource,
    message as BufferSource,
  );
}
