// Stand-in for the reader's own modules: the extractor rewrites relative and
// "@/..." imports (./config.js, ./lib/postel, @/lib/postel, …) to this file.
// `postel` keeps the real instance types so calling a method that doesn't
// exist still fails the check.
import type { InboundSource, OutboundConfig, PostelInstance } from "@postel/core";

export declare const postel: PostelInstance<{
  inbound: Record<string, InboundSource & { dedup: import("@postel/core").DedupAdapter }>;
  outbound: OutboundConfig;
}>;

export declare const config: Record<string, string>;

// biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
export declare const myAdapter: any;
