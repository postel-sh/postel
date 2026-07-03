export type RateLimitStrategy = { readonly kind: "fixed"; readonly perSecond: number };

export interface FixedRateOptions {
  readonly perSecond: number;
}

export function FixedRate(options: FixedRateOptions): RateLimitStrategy {
  return { kind: "fixed", perSecond: options.perSecond };
}
