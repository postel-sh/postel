import { MalformedHeader } from "./errors.js";
import { isExpired } from "./internal/jwk.js";
import type { Jwk, Jwks, Keyset, KeysetOptions } from "./types.js";

const DEFAULT_CACHE_TTL_SECONDS = 5 * 60;
const DEFAULT_REFRESH_EVERY_SECONDS = 30 * 60;

interface CacheState {
  readonly fetchedAt: number;
  readonly keys: ReadonlyArray<Jwk>;
}

function isJwks(value: unknown): value is Jwks {
  if (value === null || typeof value !== "object") return false;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys);
}

export function createKeyset(options: KeysetOptions): Keyset {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new MalformedHeader("createKeyset: fetch is not available in this runtime");
  }
  const cacheTtlMs = (options.cacheTtl ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
  const refreshEveryMs = (options.refreshEvery ?? DEFAULT_REFRESH_EVERY_SECONDS) * 1000;
  const ttlMs = Math.min(cacheTtlMs, refreshEveryMs);

  let cache: CacheState | undefined;
  let inflight: Promise<CacheState> | undefined;

  async function fetchOnce(): Promise<CacheState> {
    const res = await fetcher(options.jwksUri);
    if (!res.ok) {
      throw new MalformedHeader(
        `createKeyset: JWKS fetch returned ${res.status} for ${options.jwksUri}`,
      );
    }
    const body = await res.json();
    if (!isJwks(body)) {
      throw new MalformedHeader(`createKeyset: JWKS at ${options.jwksUri} has no "keys" array`);
    }
    return { fetchedAt: Date.now(), keys: body.keys };
  }

  async function ensureFresh(): Promise<CacheState> {
    if (cache && Date.now() - cache.fetchedAt < ttlMs) return cache;
    if (inflight) return inflight;
    inflight = fetchOnce()
      .then((state) => {
        cache = state;
        return state;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  }

  return {
    async findByKid(kid: string): Promise<Jwk | undefined> {
      const state = await ensureFresh();
      const now = new Date();
      return state.keys.find((k) => k.kid === kid && !isExpired(k, now));
    },
    async refresh(): Promise<void> {
      const state = await fetchOnce();
      cache = state;
    },
  };
}
