#!/usr/bin/env node
//
// scripts/check-reference-drift.mjs
//
// Verify every symbol a public package exports from its src/index.ts is at
// least *named* in that package's reference page(s) under
// docs/content/docs/reference/. This is the drift gate ADR 0018 traded away
// when it chose curated reference pages over a generator: a new export that
// never gets written up (drain(), a new option type) fails CI instead of
// silently missing from the docs.
//
// Deliberately-undocumented exports live in scripts/reference-drift-exempt.txt
// (one `package :: ExportName` per line, `#` comments) — e.g. the storage SPI
// types ADR 0018 scopes out of the core reference. An exempt entry whose
// export no longer exists is itself a failure, so the file can't rot.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = [
  {
    name: "@postel/core",
    entry: "typescript/packages/core/src/index.ts",
    pages: [
      "reference/core.mdx",
      "reference/inbound.mdx",
      "reference/outbound.mdx",
      "reference/strategies.mdx",
      "reference/errors.mdx",
    ],
  },
  {
    name: "@postel/http",
    entry: "typescript/packages/http/src/index.ts",
    pages: ["reference/http.mdx"],
  },
  {
    name: "@postel/http (node)",
    entry: "typescript/packages/http/src/node.ts",
    pages: ["reference/http.mdx"],
  },
  {
    name: "@postel/effect",
    entry: "typescript/packages/effect/src/index.ts",
    pages: ["reference/effect.mdx"],
  },
  {
    name: "@postel/admin",
    entry: "typescript/packages/admin/src/index.ts",
    pages: ["reference/admin.mdx"],
  },
];

function exportNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}/g)) {
    for (const rawPart of match[1].split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const asMatch = /\bas\s+(\w+)\s*$/.exec(part);
      const name = asMatch ? asMatch[1] : part.replace(/^type\s+/, "").trim();
      if (/^\w+$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/gm,
  )) {
    names.add(match[1]);
  }
  return names;
}

function loadExempt() {
  const exempt = new Set();
  const text = readFileSync(join(root, "scripts", "reference-drift-exempt.txt"), "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    exempt.add(line);
  }
  return exempt;
}

const exempt = loadExempt();
const seenExempt = new Set();
const missing = [];

for (const pkg of PACKAGES) {
  const names = exportNames(readFileSync(join(root, pkg.entry), "utf8"));
  const corpus = pkg.pages
    .map((page) => readFileSync(join(root, "docs", "content", "docs", page), "utf8"))
    .join("\n");
  for (const name of names) {
    const key = `${pkg.name} :: ${name}`;
    if (exempt.has(key)) {
      seenExempt.add(key);
      continue;
    }
    if (!new RegExp(`\\b${name}\\b`).test(corpus)) {
      missing.push({ pkg: pkg.name, name, pages: pkg.pages });
    }
  }
}

const stale = [...exempt].filter((key) => !seenExempt.has(key));

if (missing.length > 0) {
  console.error("reference drift: exported but never named in the reference pages:\n");
  for (const m of missing) {
    console.error(`  ${m.pkg} :: ${m.name}  (expected in ${m.pages.join(" or ")})`);
  }
  console.error(
    "\nDocument the export on its reference page, or add a `package :: Name` line to scripts/reference-drift-exempt.txt with a reason.",
  );
}
if (stale.length > 0) {
  console.error("reference drift: exempt entries whose export no longer exists:\n");
  for (const key of stale) console.error(`  ${key}`);
}
if (missing.length > 0 || stale.length > 0) process.exit(1);
console.log("reference drift: every export is named in the reference pages.");
