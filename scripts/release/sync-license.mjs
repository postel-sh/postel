#!/usr/bin/env node
//
// scripts/release/sync-license.mjs
//
// Copy the repo-root LICENSE into every publishable @postel/* package so npm
// ships a license file alongside each package (each package's `files` lists
// "LICENSE"). The copies are gitignored — the root LICENSE is the only source
// of truth. Run before `pnpm publish`; the release workflow does this in CI.
//
// A package is "publishable" when it is an @postel/* package that is NOT marked
// `"private": true`. Private placeholders and internal packages are skipped.

import { copyFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LICENSE = join(ROOT, "LICENSE");
const PACKAGES_DIR = join(ROOT, "typescript", "packages");

let copied = 0;
for (const pkgPath of findPackageJsons(PACKAGES_DIR)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (typeof pkg.name !== "string" || !pkg.name.startsWith("@postel/")) continue;
  if (pkg.private === true) continue;
  const dest = join(dirname(pkgPath), "LICENSE");
  copyFileSync(LICENSE, dest);
  console.log(`license: ${relative(ROOT, dest)}`);
  copied += 1;
}
console.log(`\nstaged LICENSE into ${copied} publishable package(s).`);

function findPackageJsons(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findPackageJsons(full));
    else if (entry === "package.json") out.push(full);
  }
  return out;
}
