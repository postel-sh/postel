export type KmsStrategy =
  | { readonly kind: "aws-kms"; readonly keyId: string }
  | { readonly kind: "gcp-kms"; readonly keyName: string }
  | { readonly kind: "vault"; readonly transitPath: string; readonly keyName: string }
  | { readonly kind: "plaintext"; readonly allowInProduction: boolean };

export interface AwsKmsOptions {
  readonly keyId: string;
}

export function AwsKms(options: AwsKmsOptions): KmsStrategy {
  return { kind: "aws-kms", keyId: options.keyId };
}

export interface GcpKmsOptions {
  readonly keyName: string;
}

export function GcpKms(options: GcpKmsOptions): KmsStrategy {
  return { kind: "gcp-kms", keyName: options.keyName };
}

export interface VaultOptions {
  readonly transitPath: string;
  readonly keyName: string;
}

export function Vault(options: VaultOptions): KmsStrategy {
  return { kind: "vault", transitPath: options.transitPath, keyName: options.keyName };
}

export interface PlaintextKmsOptions {
  readonly allowInProduction?: boolean;
}

export function PlaintextKms(options?: PlaintextKmsOptions): KmsStrategy {
  return { kind: "plaintext", allowInProduction: options?.allowInProduction ?? false };
}
