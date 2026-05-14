import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENTRY = resolve(__dirname, "../src/index.ts");
const BUDGET_BYTES = 50 * 1024;

describe("Edge bundle size budget", () => {
  it("@postel/edge minified+gzipped bundle is at most 50 KB", async () => {
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      minify: true,
      format: "esm",
      target: "es2022",
      platform: "neutral",
      conditions: ["import", "module", "default"],
      write: false,
      logLevel: "silent",
      treeShaking: true,
    });
    const file = result.outputFiles?.[0];
    expect(file).toBeDefined();
    const gzipped = gzipSync(Buffer.from(file?.contents ?? new Uint8Array()));
    expect(gzipped.byteLength).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});

describe("Edge runtime portability", () => {
  it("@postel/edge bundles with platform: 'neutral' (no node:* imports leak)", async () => {
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "neutral",
      conditions: ["import", "module", "default"],
      write: false,
      logLevel: "silent",
    });
    expect(result.errors).toEqual([]);
    expect(result.outputFiles?.[0]?.text).toMatch(/crypto\.subtle/u);
  });
});
