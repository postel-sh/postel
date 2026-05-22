import { inMemoryDedupAdapter } from "@postel/edge";
import type { DedupAdapter, InMemoryDedupOptions } from "@postel/edge";

export function InMemoryDedup(options?: InMemoryDedupOptions): DedupAdapter {
  return inMemoryDedupAdapter(options);
}
