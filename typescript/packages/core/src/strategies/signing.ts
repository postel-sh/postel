export type SigningStrategy =
  | { readonly kind: "hmac-v1"; readonly alsoSign?: ReadonlyArray<SigningStrategy> }
  | { readonly kind: "ed25519-v1a"; readonly alsoSign?: ReadonlyArray<SigningStrategy> };

export interface SigningOptions {
  readonly alsoSign?: ReadonlyArray<SigningStrategy>;
}

export function HmacV1(options?: SigningOptions): SigningStrategy {
  return options?.alsoSign ? { kind: "hmac-v1", alsoSign: options.alsoSign } : { kind: "hmac-v1" };
}

export function Ed25519V1a(options?: SigningOptions): SigningStrategy {
  return options?.alsoSign
    ? { kind: "ed25519-v1a", alsoSign: options.alsoSign }
    : { kind: "ed25519-v1a" };
}
