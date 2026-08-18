// Extracts every ```ts / ```tsx code block from docs/content/docs/**/*.mdx
// into gen/*.ts modules so `tsc` can check them against the real workspace
// packages. A fence tagged `nocheck` in its meta string is skipped — reserve
// that for deliberately foreign code (another library's "before" example,
// pseudo-declarations that shadow real types, deps we don't install).
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..", "..", "docs", "content", "docs");
const outDir = join(here, "gen");

function mdxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return mdxFiles(full);
    return name.endsWith(".mdx") ? [full] : [];
  });
}

const FENCE = /^```(ts|tsx|typescript)\b([^\n]*)\n([\s\S]*?)^```/gm;

// Index of the first line after the leading import block (multi-line imports
// included: a line starting an import runs until one ends with `";`).
function findImportEnd(lines) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("//")) {
      i += 1;
    } else if (line.startsWith("import ") || line.startsWith("import{")) {
      while (i < lines.length && !lines[i].trimEnd().endsWith(";")) i += 1;
      i += 1;
    } else {
      break;
    }
  }
  return i;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let emitted = 0;
let skipped = 0;
for (const file of mdxFiles(docsRoot)) {
  const rel = relative(docsRoot, file);
  // Reference pages are curated type listings (pseudo-declarations per
  // ADR 0018), not runnable code — scripts/check-reference-drift.mjs guards
  // them by diffing export names instead.
  if (rel.startsWith("reference/")) continue;
  const text = readFileSync(file, "utf8");
  let match = FENCE.exec(text);
  let n = 0;
  while (match !== null) {
    const [, lang, meta, body] = match;
    n += 1;
    if (/\bnocheck\b/.test(meta)) {
      skipped += 1;
    } else {
      const line = text.slice(0, match.index).split("\n").length;
      const slug = rel.replace(/\.mdx$/, "").replaceAll("/", "__");
      const ext = lang === "tsx" ? "tsx" : "ts";
      const header = `// ${rel}:${line} (snippet ${n})\n`;
      // Docs snippets import from the reader's own files ("./config.js",
      // "@/lib/postel", …) — rewrite those to the typed stub module.
      const rewritten = body.replaceAll(
        /from "(?:@\/|\.{1,2}\/)[^"]*"/g,
        'from "../stubs/host.js"',
      );
      // Fragments lifted from inside a handler use `await`/`return` at the
      // top level: hoist the imports and wrap the rest in an async IIFE.
      // Snippets that export (route files) stay top-level as written.
      let content;
      if (/^export /m.test(rewritten)) {
        content = `${rewritten}\nexport {};\n`;
      } else {
        const lines = rewritten.split("\n");
        const importEnd = findImportEnd(lines);
        const imports = lines.slice(0, importEnd).join("\n");
        const rest = lines.slice(importEnd).join("\n");
        content = `${imports}\nvoid (async () => {\n${rest}\n});\nexport {};\n`;
      }
      // Force module scope so identical top-level names across snippets never
      // collide, while ambient globals from globals.d.ts stay visible.
      writeFileSync(join(outDir, `${slug}.${n}.${ext}`), `${header}${content}`);
      emitted += 1;
    }
    match = FENCE.exec(text);
  }
}

console.log(`docs-snippets: emitted ${emitted} snippet(s), skipped ${skipped} (nocheck)`);
