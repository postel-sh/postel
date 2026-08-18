export type RateLimitStrategy = { readonly kind: "fixed"; readonly perSecond: number };

export interface FixedRateOptions {
  readonly perSecond: number;
}

export function FixedRate(options: FixedRateOptions): RateLimitStrategy {
  return { kind: "fixed", perSecond: options.perSecond };
}

// Decodes a tenant's stored `metadata.rateLimit` into a `RateLimitStrategy`.
// "fixed" is the only kind today; a bare legacy `{ perSecond }` (written
// before the `kind` tag existed) or an unrecognized `kind` also decodes as
// fixed rather than being dropped, since `perSecond` is the only field that
// ever mattered for dispatch throttling.
export function decodeRateLimitStrategy(raw: unknown): RateLimitStrategy | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; perSecond?: unknown };
  if (typeof obj.perSecond !== "number") return null;
  return FixedRate({ perSecond: obj.perSecond });
}
