import type { DedupAdapter, DedupRecordOptions, DedupResult } from "../types.js";

interface InMemoryEntry {
  readonly expiresAt: number;
}

export interface InMemoryDedupOptions {
  readonly now?: () => Date;
}

export function InMemoryDedup(options?: InMemoryDedupOptions): DedupAdapter {
  const store = new Map<string, InMemoryEntry>();
  const now = options?.now ?? (() => new Date());

  return {
    async record(
      messageId: string,
      ttlSeconds: number,
      _recordOptions?: DedupRecordOptions,
    ): Promise<DedupResult> {
      const currentMs = now().getTime();
      const existing = store.get(messageId);
      if (existing && existing.expiresAt > currentMs) {
        return { duplicate: true };
      }
      const expiresAt = currentMs + ttlSeconds * 1000;
      store.set(messageId, { expiresAt });
      if (store.size > 1024) {
        for (const [k, v] of store.entries()) {
          if (v.expiresAt <= currentMs) store.delete(k);
        }
      }
      return { duplicate: false };
    },
  };
}
