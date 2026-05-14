import type { DedupOptions, DedupResult } from "./types.js";

export function dedup(_messageId: string, _options: DedupOptions): Promise<DedupResult> {
  throw new Error("@postel/edge: dedup is not implemented in the v0.1.0 skeleton");
}
