#!/usr/bin/env node
//
// scripts/release/stamp-version.mjs
//
// Single writer for a Postel release version. Stamps one X.Y.Z into every
// artifact that VISION.md §8 requires to share MAJOR.MINOR — the Go compliance
// suite version const, the compliance CHANGELOG, and every @postel/* package.json
// under typescript/packages. Because one process sets all of them from one input,
// the npm packages and the Go suite cannot drift out of lockstep.
//
// Usage:
//   node scripts/release/stamp-version.mjs <version>           write mode
//   node scripts/release/stamp-version.mjs <version> --check   assert-only, no writes
//
// The --check mode is the CI lockstep guard (decisions/0014): it fails the
// release if the tagged version is not already stamped across every artifact.
//
// Exit codes:
//   0 — stamped, or (in --check) every artifact already matches <version>
//   1 — bad version, no matching CHANGELOG section, or (in --check) a mismatch

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const RUNNER_GO = join(ROOT, "compliance", "cli", "runner.go");
const CHANGELOG = join(ROOT, "compliance", "CHANGELOG.md");
const PACKAGES_DIR = join(ROOT, "typescript", "packages");

const [, , versionArg, ...flags] = process.argv;
const check = flags.includes("--check");

if (!versionArg || !SEMVER_RE.test(versionArg)) {
  fail(`usage: stamp-version.mjs <semver> [--check]\n  got: ${versionArg ?? "(nothing)"}`);
}
const version = versionArg;

const mismatches = [];
const writes = [];

stampGoConst();
stampChangelog();
stampPackages();

if (check) {
  if (mismatches.length > 0) {
    console.error(`lockstep: ${mismatches.length} artifact(s) not at ${version}:`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`lockstep: every artifact is at ${version}`);
  process.exit(0);
}

if (writes.length === 0) {
  console.log(`nothing to do — every artifact is already at ${version}`);
  process.exit(0);
}
for (const w of writes) {
  writeFileSync(w.path, w.next);
  console.log(`stamped ${version}: ${relative(ROOT, w.path)}`);
}
console.log(`\nstamped ${writes.length} file(s). Next: review the diff, then \`mise run release:gate\`.`);

function stampGoConst() {
  const re = /(const SuiteVersion = ")([^"]*)(")/;
  const src = readFileSync(RUNNER_GO, "utf8");
  const m = src.match(re);
  if (!m) fail(`no 'const SuiteVersion = "..."' in ${relative(ROOT, RUNNER_GO)}`);
  if (m[2] === version) return;
  if (check) {
    mismatches.push(`${relative(ROOT, RUNNER_GO)}: SuiteVersion="${m[2]}"`);
    return;
  }
  writes.push({ path: RUNNER_GO, next: src.replace(re, `$1${version}$3`) });
}

function stampChangelog() {
  const src = readFileSync(CHANGELOG, "utf8");
  const released = new RegExp(`^## \\[${escapeRe(version)}\\]`, "m");
  if (check) {
    if (!released.test(src)) {
      mismatches.push(`${relative(ROOT, CHANGELOG)}: no released '## [${version}]' section`);
    }
    return;
  }
  if (released.test(src)) return;
  const unreleased = new RegExp(`^## \\[Unreleased[^\\]]*${escapeRe(version)}[^\\]]*\\]`, "m");
  if (!unreleased.test(src)) {
    fail(
      `${relative(ROOT, CHANGELOG)}: no '## [Unreleased — ${version}]' section to release.\n` +
        "  Stage the release notes under that heading before stamping.",
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  writes.push({ path: CHANGELOG, next: src.replace(unreleased, `## [${version}] - ${date}`) });
}

function stampPackages() {
  const versionRe = /("version":\s*")[^"]*(")/;
  for (const pkgPath of findPackageJsons(PACKAGES_DIR)) {
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    if (typeof pkg.name !== "string" || !pkg.name.startsWith("@postel/")) continue;
    if (pkg.version === version) continue;
    if (check) {
      mismatches.push(`${relative(ROOT, pkgPath)}: ${pkg.name}@${pkg.version}`);
      continue;
    }
    writes.push({ path: pkgPath, next: raw.replace(versionRe, `$1${version}$2`) });
  }
}

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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
