import { base64ToBytes, bytesToBase64 } from "./base64.js";

const ALG = { name: "HMAC", hash: "SHA-256" } as const;

async function importHmacKey(secretBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secretBytes as BufferSource, ALG, false, usages);
}

export async function signHmacV1(secretBytes: Uint8Array, message: Uint8Array): Promise<string> {
  const key = await importHmacKey(secretBytes, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
  return bytesToBase64(sig);
}

export async function verifyHmacV1(
  secretBytes: Uint8Array,
  message: Uint8Array,
  signatureB64: string,
): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64ToBytes(signatureB64);
  } catch {
    return false;
  }
  const key = await importHmacKey(secretBytes, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signatureBytes as BufferSource, message as BufferSource);
}
