#!/usr/bin/env node
//
// scripts/check-edge-bundle.mjs
//
// Bundle-size and runtime-portability gate for @postel/edge.
//
// Covers two CONTRACT requirements from `openspec/specs/receiver/spec.md`:
//   - "Edge bundle size budget" — ≤ 50 KB minified+gzipped
//   - "Edge runtime portability" — Web Crypto only; no `node:*` imports
//
// The script bundles `typescript/packages/edge/src/index.ts` from source using
// esbuild with `platform: "neutral"` so any leaked `node:*` import surfaces as
// a hard build error rather than a silent externalization. It then minifies
// + gzips the bundled output and fails if the resulting size exceeds the
// budget.
//
// Exit codes:
//   0 — bundle within budget; no portability violations
//   1 — bundle exceeds budget or has portability violations

import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const TS_ROOT = resolve(REPO_ROOT, "typescript");
const EDGE_ENTRY = resolve(TS_ROOT, "packages/edge/src/index.ts");
const BUDGET_BYTES = 50 * 1024;

const requireFromTs = createRequire(resolve(TS_ROOT, "package.json"));

async function loadEsbuild() {
  try {
    return requireFromTs("esbuild");
  } catch (err) {
    console.error("check-edge-bundle: cannot resolve esbuild from typescript/.");
    console.error("                   run `pnpm install` inside typescript/ first.");
    console.error(String(err));
    process.exit(1);
  }
}

async function bundleEdge(esbuild) {
  return esbuild.build({
    entryPoints: [EDGE_ENTRY],
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
}

function fmtBytes(n) {
  return `${(n / 1024).toFixed(2)} KB`;
}

async function main() {
  const esbuild = await loadEsbuild();

  let result;
  try {
    result = await bundleEdge(esbuild);
  } catch (err) {
    console.error("check-edge-bundle: bundling @postel/edge failed.");
    console.error("                   this likely means @postel/edge imports a `node:*`");
    console.error("                   module — Edge runtime portability requires Web APIs only.");
    console.error("");
    console.error(err.message ?? String(err));
    process.exit(1);
  }

  const file = result.outputFiles?.[0];
  if (!file) {
    console.error("check-edge-bundle: esbuild produced no output file. unexpected.");
    process.exit(1);
  }

  const minified = Buffer.from(file.contents);
  const gzipped = gzipSync(minified);
  const minSize = minified.byteLength;
  const gzSize = gzipped.byteLength;

  const headroom = BUDGET_BYTES - gzSize;
  const within = gzSize <= BUDGET_BYTES;

  console.log("check-edge-bundle: @postel/edge");
  console.log(`  minified:        ${fmtBytes(minSize)}`);
  console.log(`  minified+gzip:   ${fmtBytes(gzSize)}`);
  console.log(`  budget:          ${fmtBytes(BUDGET_BYTES)}`);
  console.log(`  headroom:        ${fmtBytes(headroom)}`);

  if (!within) {
    console.error("");
    console.error(`FAIL: @postel/edge exceeds the 50 KB minified+gzipped budget.`);
    console.error(`      see openspec/specs/receiver/spec.md → "Edge bundle size budget".`);
    process.exit(1);
  }

  console.log("ok");
  process.exit(0);
}

main().catch((err) => {
  console.error("check-edge-bundle: unexpected error");
  console.error(err);
  process.exit(1);
});
