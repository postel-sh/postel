#!/usr/bin/env node
//
// scripts/check-spec-drift.mjs
//
// Verify every "### Requirement: <name>" declared under openspec/specs/<cap>/spec.md
// is named in at least one test file. The check is loose (substring match on the
// requirement title) so agents have a clear forcing function: name the requirement
// in the test description and the check passes.
//
// Deferred coverage is tracked in scripts/spec-drift-deferred.txt — one
// requirement title per line, lines starting with `#` are comments. As tests for
// a requirement land, remove its entry from that file. By 1.0 the file is empty.
//
// Pre-implementation no-op: if no test files exist yet (typical at v0), the script
// emits an informational message and exits 0.
//
// Exit codes:
//   0 — no drift, or no test files yet
//   1 — at least one non-deferred requirement is not covered
//   1 — the deferred-list cites a requirement that no longer exists

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SPEC_ROOT = "openspec/specs";
const PACKAGES_ROOT = "typescript/packages";
const DEFERRED_FILE = "scripts/spec-drift-deferred.txt";
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

function loadDeferred() {
  if (!existsSync(DEFERRED_FILE)) return new Set();
  const raw = readFileSync(DEFERRED_FILE, "utf8");
  const out = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+$/, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    out.add(trimmed);
  }
  return out;
}

function main() {
  const reqs = collectRequirements();
  const tests = collectTestContent();
  const deferred = loadDeferred();

  if (reqs.length === 0) {
    console.log("spec-drift: no requirements found under openspec/specs/. Nothing to check.");
    return 0;
  }

  const reqNames = new Set(reqs.map((r) => r.name));
  const orphanDeferrals = [...deferred].filter((d) => !reqNames.has(d));
  if (orphanDeferrals.length > 0) {
    console.error(
      `spec-drift: ${orphanDeferrals.length} entry in ${DEFERRED_FILE} cites a requirement that no longer exists:`,
    );
    for (const d of orphanDeferrals) console.error(`  - "${d}"`);
    console.error("");
    console.error(`Remove the orphaned line(s) from ${DEFERRED_FILE} or restore the requirement.`);
    return 1;
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

  const inScope = reqs.filter((r) => !deferred.has(r.name));
  const deferredCount = reqs.length - inScope.length;
  const drifted = inScope.filter((r) => !tests.content.includes(r.name));

  if (drifted.length > 0) {
    console.error(`spec-drift: ${drifted.length} requirement(s) have no matching test:`);
    for (const r of drifted) {
      console.error(`  - "${r.name}"  (${r.file})`);
    }
    console.error("");
    console.error("Add a test whose description (or a comment) names the requirement verbatim.");
    console.error(`If the requirement is deferred to a later release, add it to ${DEFERRED_FILE}.`);
    return 1;
  }

  const covered = inScope.length;
  console.log(
    `spec-drift: ok — ${covered} in-scope requirement(s) covered across ${tests.files.length} test file(s); ${deferredCount} deferred.`,
  );
  return 0;
}

process.exit(main());
