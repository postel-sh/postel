export type WebhookHeaders = Readonly<Record<string, string>>;

export interface WebhookEvent<TData = unknown> {
  readonly type: string;
  readonly timestamp?: string;
  readonly data?: TData;
}

export type Secret = string;

export interface VerifyOptions {
  readonly toleranceSeconds?: number;
  readonly now?: () => Date;
}

export interface VerifyResult<TData = unknown> {
  readonly event: WebhookEvent<TData>;
  readonly matchedSecretIndex: number;
}

export interface Jwk {
  readonly kid: string;
  readonly alg: string;
  readonly kty: string;
  readonly crv?: string;
  readonly x?: string;
  readonly not_after?: string;
  readonly [key: string]: unknown;
}

export interface Jwks {
  readonly keys: ReadonlyArray<Jwk>;
}

export interface KeysetOptions {
  readonly jwksUri: string;
  readonly refreshEvery?: number;
  readonly cacheTtl?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface Keyset {
  readonly findByKid: (kid: string) => Promise<Jwk | undefined>;
  readonly refresh: () => Promise<void>;
}

export type SecretOrKeyset = Secret | ReadonlyArray<Secret> | Keyset;

export interface JwksHandlerOptions {
  readonly keys: ReadonlyArray<Jwk>;
  readonly tenantId?: string;
}

export interface DedupOptions {
  readonly ttl: number | string;
  readonly adapter: DedupAdapter;
}

export interface DedupResult {
  readonly duplicate: boolean;
}

export interface DedupRecordOptions {
  readonly tx?: unknown;
}

export interface DedupAdapter {
  readonly record: (
    messageId: string,
    ttlSeconds: number,
    options?: DedupRecordOptions,
  ) => Promise<DedupResult>;
}

export interface SignFixtureOptions<TData = unknown> {
  readonly secret: Secret;
  readonly payload: WebhookEvent<TData>;
  readonly messageId?: string;
  readonly timestamp?: Date;
}

export interface SignedFixture {
  readonly headers: WebhookHeaders;
  readonly body: string;
}
