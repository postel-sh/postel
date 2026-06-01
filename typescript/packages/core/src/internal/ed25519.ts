import { base64ToBytes, bytesToBase64 } from "./base64.js";

const ALG = { name: "Ed25519" } as const;

// Fixed RFC 8410 PKCS8 prefix for an Ed25519 private key: the DER header that
// precedes the 32-byte seed (SEQUENCE { version, AlgorithmIdentifier, OCTET
// STRING { OCTET STRING seed } }).
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const ED25519_SEED_LENGTH = 32;

export async function importEd25519PublicKey(publicKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", publicKeyBytes as BufferSource, ALG, false, ["verify"]);
}

export async function importEd25519PrivateKey(privateKeyBytes: Uint8Array): Promise<CryptoKey> {
  // A 32-byte value is a raw Ed25519 seed — the cross-port wire form and the
  // `whsk_<seed>` encoding used by the compliance fixtures. Web Crypto only
  // imports private keys as PKCS8, so wrap the seed in the fixed DER prefix.
  // Anything longer is assumed to already be PKCS8 DER (e.g. the output of
  // generateAsymmetric()'s exportKey("pkcs8")).
  let pkcs8 = privateKeyBytes;
  if (privateKeyBytes.length === ED25519_SEED_LENGTH) {
    pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + ED25519_SEED_LENGTH);
    pkcs8.set(ED25519_PKCS8_PREFIX);
    pkcs8.set(privateKeyBytes, ED25519_PKCS8_PREFIX.length);
  }
  return crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, ALG, false, ["sign"]);
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
