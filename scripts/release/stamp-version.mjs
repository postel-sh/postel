#!/usr/bin/env node
//
// scripts/release/stamp-version.mjs
//
// Set every @postel/* package.json under typescript/packages to <version>.
// Run in CI immediately before `pnpm publish` for a `ts/vX.Y.Z` release: the
// version comes from the release tag and is injected into the ephemeral build
// tree — it is NOT committed (the repo's package.json versions stay at 0.0.0).
// See decisions/0014-release-and-versioning-flow.md.
//
// Usage: node scripts/release/stamp-version.mjs <semver>

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = join(ROOT, "typescript", "packages");
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VERSION_RE = /("version":\s*")[^"]*(")/;

const version = process.argv[2];
if (!version || !SEMVER_RE.test(version)) {
  console.error(`usage: stamp-version.mjs <semver>\n  got: ${version ?? "(nothing)"}`);
  process.exit(1);
}

let stamped = 0;
for (const pkgPath of findPackageJsons(PACKAGES_DIR)) {
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  if (typeof pkg.name !== "string" || !pkg.name.startsWith("@postel/")) continue;
  if (pkg.version === version) continue;
  writeFileSync(pkgPath, raw.replace(VERSION_RE, `$1${version}$2`));
  console.log(`stamped ${version}: ${relative(ROOT, pkgPath)}`);
  stamped += 1;
}
console.log(`\nstamped ${stamped} @postel/* package(s) to ${version} (ephemeral — do not commit).`);

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
