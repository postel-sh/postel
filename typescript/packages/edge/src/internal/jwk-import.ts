import { MalformedHeader, UnknownKeyId } from "../errors.js";
import type { Jwk } from "../types.js";

const ED25519 = { name: "Ed25519" } as const;

export async function importEd25519PublicKeyFromJwk(jwk: Jwk): Promise<CryptoKey> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") {
    throw new UnknownKeyId(
      `JWK kid "${jwk.kid}" is not an Ed25519 OKP key (kty="${jwk.kty}", crv="${jwk.crv ?? "<missing>"}")`,
    );
  }
  if (typeof jwk.x !== "string" || jwk.x.length === 0) {
    throw new MalformedHeader(`JWK kid "${jwk.kid}" is missing the "x" public-key field`);
  }
  return crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ED25519, false, [
    "verify",
  ]);
}
