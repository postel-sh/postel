import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// typescript/packages — this test lives at packages/core/test/.
const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function findPackageDirs(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(root, name);
    if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, "package.json"))) out.push(p);
    out.push(...findPackageDirs(p));
  }
  return out;
}

// A package whose `src/index.ts` exports nothing but the `__postelPackage` name
// marker has no claimable runtime surface — a pre-alpha placeholder.
function isPlaceholder(pkgDir: string): boolean {
  const entry = join(pkgDir, "src", "index.ts");
  if (!existsSync(entry)) return false;
  const exportLines = readFileSync(entry, "utf8")
    .split("\n")
    .filter((l) => /^\s*export\b/.test(l));
  return exportLines.length > 0 && exportLines.every((l) => l.includes("__postelPackage"));
}

function readPkg(pkgDir: string): { name: string; private?: boolean } {
  return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
}

describe("Empty placeholder packages are pre-alpha and unpublished [PORT-SPECIFIC]", () => {
  const placeholders = findPackageDirs(PACKAGES_ROOT).filter(isPlaceholder).map(readPkg);
  const placeholderNames = placeholders.map((p) => p.name).sort();

  it("the detected placeholder set is exactly the reserved names", () => {
    expect(placeholderNames).toEqual([
      "@postel/bun",
      "@postel/cli",
      "@postel/effect",
      "@postel/nextjs",
      "@postel/test",
    ]);
  });

  it("every placeholder package is private (excluded from the published set)", () => {
    const leaked = placeholders.filter((p) => p.private !== true).map((p) => p.name);
    expect(leaked).toEqual([]);
  });
});
