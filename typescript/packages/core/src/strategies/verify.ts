import { createKeyset } from "@postel/edge";
import type { Keyset as EdgeKeyset, KeysetOptions } from "@postel/edge";

export type Verifier =
  | { readonly kind: "secret"; readonly value: string }
  | { readonly kind: "public-key"; readonly value: string }
  | { readonly kind: "keyset"; readonly keyset: EdgeKeyset };

export function Secret(value: string): Verifier {
  return { kind: "secret", value };
}

export function PublicKey(value: string): Verifier {
  return { kind: "public-key", value };
}

export function Keyset(opts: KeysetOptions): Verifier {
  return { kind: "keyset", keyset: createKeyset(opts) };
}
