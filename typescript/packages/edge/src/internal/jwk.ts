import { MalformedHeader } from "../errors.js";
import type { Jwk } from "../types.js";

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "k"] as const;

export function hasPrivateMaterial(jwk: unknown): boolean {
  if (jwk === null || typeof jwk !== "object") return false;
  const record = jwk as Record<string, unknown>;
  for (const field of PRIVATE_JWK_FIELDS) {
    if (field in record && record[field] !== undefined && record[field] !== "") {
      return true;
    }
  }
  return false;
}

export function assertPublicOnly(jwk: Jwk): void {
  if (hasPrivateMaterial(jwk)) {
    throw new MalformedHeader(
      `JWK with kid "${jwk.kid}" carries private key material; refusing to publish via JWKS`,
    );
  }
}

export function publicView(jwk: Jwk): Jwk {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(jwk)) {
    if ((PRIVATE_JWK_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out as unknown as Jwk;
}

export function isExpired(jwk: Jwk, now: Date): boolean {
  if (!jwk.not_after) return false;
  const expiry = Date.parse(jwk.not_after);
  if (Number.isNaN(expiry)) return false;
  return now.getTime() >= expiry;
}
