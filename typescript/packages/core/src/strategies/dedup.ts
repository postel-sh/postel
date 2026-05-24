import { inMemoryDedupAdapter } from "../dedup.js";
import type { InMemoryDedupOptions } from "../dedup.js";
import type { DedupAdapter } from "../types.js";

export function InMemoryDedup(options?: InMemoryDedupOptions): DedupAdapter {
  return inMemoryDedupAdapter(options);
}
