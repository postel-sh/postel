#!/usr/bin/env node
//
// scripts/check-spec-drift.mjs
//
// Verify every "### Requirement: <name>" declared under openspec/specs/<cap>/spec.md
// is named in at least one test file. The check is loose (substring match on the
// requirement title) so agents have a clear forcing function: name the requirement
// in the test description and the check passes.
//
// Pre-implementation no-op: if no test files exist yet (typical at v0), the script
// emits an informational message and exits 0.
//
// Exit codes:
//   0 — no drift, or no test files yet
//   1 — at least one requirement is not covered

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SPEC_ROOT = "openspec/specs";
const PACKAGES_ROOT = "typescript/packages";
const TEST_RE = /\.test\.(ts|tsx|js|mjs|cjs)$/;
const REQUIREMENT_RE = /^### Requirement:\s+(.+?)\s*$/gm;

function walk(dir, accept) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p, accept));
    else if (accept(p)) out.push(p);
  }
  return out;
}

function collectRequirements() {
  const specFiles = walk(SPEC_ROOT, (p) => p.endsWith("/spec.md"));
  const reqs = [];
  for (const f of specFiles) {
    const content = readFileSync(f, "utf8");
    for (const m of content.matchAll(REQUIREMENT_RE)) {
      reqs.push({ name: m[1], file: f });
    }
  }
  return reqs;
}

function collectTestContent() {
  const testFiles = walk(PACKAGES_ROOT, (p) => TEST_RE.test(p));
  return {
    files: testFiles,
    content: testFiles.map((f) => readFileSync(f, "utf8")).join("\n\n"),
  };
}

function main() {
  const reqs = collectRequirements();
  const tests = collectTestContent();

  if (reqs.length === 0) {
    console.log("spec-drift: no requirements found under openspec/specs/. Nothing to check.");
    return 0;
  }

  if (tests.files.length === 0) {
    console.log(
      `spec-drift: ${reqs.length} requirement(s) waiting for tests; no test files exist yet.`,
    );
    console.log("           Skipping drift check (pre-implementation).");
    console.log(
      `           This step will activate automatically once ${PACKAGES_ROOT}/ contains tests.`,
    );
    return 0;
  }

  const drifted = reqs.filter((r) => !tests.content.includes(r.name));

  if (drifted.length > 0) {
    console.error(`spec-drift: ${drifted.length} requirement(s) have no matching test:`);
    for (const r of drifted) {
      console.error(`  - "${r.name}"  (${r.file})`);
    }
    console.error("");
    console.error("Add a test whose description (or a comment) names the requirement verbatim.");
    return 1;
  }

  console.log(
    `spec-drift: ok — ${reqs.length} requirement(s) covered across ${tests.files.length} test file(s).`,
  );
  return 0;
}

process.exit(main());
