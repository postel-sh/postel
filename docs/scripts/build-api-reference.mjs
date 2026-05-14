#!/usr/bin/env node
/**
 * Runs TypeDoc against `@postel/edge` and post-processes the output so it
 * renders cleanly in Fumadocs (frontmatter, link cleanup).
 *
 *   ../typescript/packages/edge/src/index.ts  ->  content/docs/api/edge/index.mdx
 *
 * Re-runnable: deletes the output dir first so stale exports don't linger.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, "..");
const outDir = resolve(docsRoot, "content/docs/api/edge");

rmSync(outDir, { recursive: true, force: true });

const typedoc = spawnSync(
  process.execPath,
  [resolve(docsRoot, "node_modules/typedoc/bin/typedoc")],
  { cwd: docsRoot, stdio: "inherit" },
);
if (typedoc.status !== 0) process.exit(typedoc.status ?? 1);

const indexFile = resolve(outDir, "index.mdx");
let text = readFileSync(indexFile, "utf8");

// Drop the first H1 — Fumadocs uses the frontmatter title.
const firstNewline = text.indexOf("\n");
if (text.startsWith("# ") && firstNewline !== -1) {
  text = text.slice(firstNewline + 1).replace(/^\n+/, "");
}

const frontmatter = [
  "---",
  'title: "@postel/edge"',
  'description: "Public API of @postel/edge — verify, createKeyset, jwksHandler, dedup, signFixture, and the structured error classes. Generated from source via TypeDoc."',
  "---",
  "",
  "",
].join("\n");

writeFileSync(indexFile, frontmatter + text);

console.log("[build-api-reference] wrote", indexFile);
