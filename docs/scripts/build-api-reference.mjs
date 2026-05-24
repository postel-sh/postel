#!/usr/bin/env node
/**
 * Runs TypeDoc against each `@postel/*` package whose API reference is
 * rendered on the docs site, and post-processes the output so it renders
 * cleanly in Fumadocs (frontmatter, optional preamble).
 *
 *   ../typescript/packages/core/src/index.ts  ->  content/docs/api/core/index.mdx
 *
 * Re-runnable: deletes each output dir first so stale exports don't linger.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, "..");

const PACKAGES = [
  {
    name: "core",
    config: "typedoc.core.json",
    title: "@postel/core",
    description:
      "Public API of @postel/core — the Postel({ inbound, outbound }) factory, Verifier strategies (Secret, PublicKey, Keyset), dedup helpers, JWKS consumer, signing fixtures, and the PostelError hierarchy. Generated from source via TypeDoc.",
    preamble: [
      "> **Status: 0.0.0 — sender runtime not yet shipped.** Receiver runtime works today through `postel.inbound.<source>.verify` and `postel.inbound.<source>.dedup`. Sender runtime (`postel.outbound.*`) lands in v0.2.0+. Until then, every `outbound` method below is fully typed but throws `NotImplementedError` at runtime.",
      "",
    ].join("\n"),
  },
];

for (const pkg of PACKAGES) {
  const outDir = resolve(docsRoot, `content/docs/api/${pkg.name}`);
  rmSync(outDir, { recursive: true, force: true });

  const typedoc = spawnSync(
    process.execPath,
    [resolve(docsRoot, "node_modules/typedoc/bin/typedoc"), "--options", pkg.config],
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
    `title: "${pkg.title}"`,
    `description: "${pkg.description}"`,
    "---",
    "",
    "",
  ].join("\n");

  const body = pkg.preamble ? `${pkg.preamble}\n${text}` : text;

  writeFileSync(indexFile, frontmatter + body);
  console.log("[build-api-reference] wrote", indexFile);
}
