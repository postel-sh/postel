#!/usr/bin/env node
//
// scripts/check-spec-drift.mjs
//
// Verify every "#### Scenario: <name>" declared under a requirement in
// openspec/specs/<cap>/spec.md is named in at least one test file, OR the
// requirement is cited by a vector in the compliance corpus. Matching is
// scenario-level: a requirement with three scenarios where only one is
// tested is drift, even though the requirement's title shows up in a test
// description somewhere.
//
// Coverage sources:
//   - typescript/packages/**/*.test.{ts,tsx,js,mjs,cjs} — substring match of
//     the scenario title in the concatenated test source.
//   - compliance/cli/**/*_test.go — same substring match, for the compliance
//     runner's own Go suite.
//   - compliance/vectors/**/*.yaml — a vector's `requirement: {capability,
//     title}` field counts as covering every scenario under that
//     requirement. Vectors don't encode scenario names, so this is
//     requirement-grained; compliance/cli/corpus_test.go separately enforces
//     that every citation names a real requirement.
//
// Deferred coverage is tracked in scripts/spec-drift-deferred.txt — one
// entry per line, lines starting with `#` are comments. An entry is either:
//   Requirement title
//   Requirement title :: Scenario title
// The first form defers every scenario under the requirement; the second
// defers just that one scenario. As tests (or vectors) land, remove the
// entry in the same PR.
//
// Pre-implementation no-op: if no test files exist yet (typical at v0), the
// script emits an informational message and exits 0.
//
// Exit codes:
//   0 — no drift, or no test files yet
//   1 — at least one non-deferred scenario is not covered
//   1 — the deferred-list cites a requirement or scenario that no longer exists

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SPEC_ROOT = "openspec/specs";
// A "testkit" directory (e.g. @postel/storage-testkit) holds shared
// describe/it scenario bodies that adapter packages parametrize from their
// own *.test.ts files — the scenario names live in the testkit source, not
// in the file that calls it, so it's a coverage source in its own right.
const TEST_SOURCES = [
  {
    root: "typescript/packages",
    re: (p) => /\.test\.(ts|tsx|js|mjs|cjs)$/.test(p) || /\/testkit\/src\/.*\.ts$/.test(p),
  },
  { root: "compliance/cli", re: /_test\.go$/ },
];
const VECTORS_ROOT = "compliance/vectors";
const DEFERRED_FILE = "scripts/spec-drift-deferred.txt";
const REQUIREMENT_RE = /^### Requirement:\s+(.+?)\s*$/gm;
const SCENARIO_RE = /^#### Scenario:\s+(.+?)\s*$/gm;
const VECTOR_REQUIREMENT_RE = /requirement:\s*\n\s*capability:\s*(.+?)\s*\n\s*title:\s*(.+?)\s*\n/;

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

// Collect requirements with their scenarios by slicing spec content between
// consecutive "### Requirement:" headers.
function collectRequirements() {
  const specFiles = walk(SPEC_ROOT, (p) => p.endsWith("/spec.md"));
  const reqs = [];
  for (const f of specFiles) {
    const capability = f.split("/").at(-2);
    const content = readFileSync(f, "utf8");
    const headers = [...content.matchAll(REQUIREMENT_RE)];
    for (let i = 0; i < headers.length; i++) {
      const name = headers[i][1];
      const start = headers[i].index + headers[i][0].length;
      const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
      const body = content.slice(start, end);
      const scenarios = [...body.matchAll(SCENARIO_RE)].map((m) => m[1]);
      reqs.push({ capability, name, file: f, scenarios });
    }
  }
  return reqs;
}

function collectTestContent() {
  const files = TEST_SOURCES.flatMap((s) =>
    walk(s.root, typeof s.re === "function" ? s.re : (p) => s.re.test(p)),
  );
  return {
    files,
    content: files.map((f) => readFileSync(f, "utf8")).join("\n\n"),
  };
}

// Vector corpus coverage: a requirement (by capability + title) is covered
// if any vector cites it. compliance/cli/corpus_test.go enforces that every
// citation names a real requirement, so trusting citations here doesn't open
// a loophole.
function collectVectorCoverage() {
  const files = walk(VECTORS_ROOT, (p) => p.endsWith(".yaml") || p.endsWith(".yml"));
  const covered = new Set();
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    const m = content.match(VECTOR_REQUIREMENT_RE);
    if (m) covered.add(`${m[1]}::${m[2]}`);
  }
  return covered;
}

// A deferred line is `Requirement title` (defers every scenario) or
// `Requirement title :: Scenario title` (defers just that scenario).
function loadDeferred() {
  if (!existsSync(DEFERRED_FILE)) return [];
  const raw = readFileSync(DEFERRED_FILE, "utf8");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+$/, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(" :: ");
    if (sep === -1) out.push({ requirement: trimmed, scenario: null });
    else out.push({ requirement: trimmed.slice(0, sep), scenario: trimmed.slice(sep + 4) });
  }
  return out;
}

function main() {
  const reqs = collectRequirements();
  const tests = collectTestContent();
  const vectorCoverage = collectVectorCoverage();
  const deferred = loadDeferred();

  if (reqs.length === 0) {
    console.log("spec-drift: no requirements found under openspec/specs/. Nothing to check.");
    return 0;
  }

  const reqByName = new Map(reqs.map((r) => [r.name, r]));
  const orphanDeferrals = deferred.filter((d) => {
    const req = reqByName.get(d.requirement);
    if (!req) return true;
    if (d.scenario === null) return false;
    return !req.scenarios.includes(d.scenario);
  });
  if (orphanDeferrals.length > 0) {
    console.error(
      `spec-drift: ${orphanDeferrals.length} entry in ${DEFERRED_FILE} cites a requirement or scenario that no longer exists:`,
    );
    for (const d of orphanDeferrals) {
      console.error(`  - "${d.requirement}${d.scenario ? ` :: ${d.scenario}` : ""}"`);
    }
    console.error("");
    console.error(`Remove the orphaned line(s) from ${DEFERRED_FILE} or restore the requirement/scenario.`);
    return 1;
  }

  if (tests.files.length === 0) {
    console.log(
      `spec-drift: ${reqs.length} requirement(s) waiting for tests; no test files exist yet.`,
    );
    console.log("           Skipping drift check (pre-implementation).");
    console.log(
      `           This step will activate automatically once test files exist.`,
    );
    return 0;
  }

  const fullyDeferred = new Set(deferred.filter((d) => d.scenario === null).map((d) => d.requirement));
  const scenarioDeferred = new Set(
    deferred.filter((d) => d.scenario !== null).map((d) => `${d.requirement}::${d.scenario}`),
  );

  let inScopeCount = 0;
  let deferredCount = 0;
  const drifted = [];
  for (const req of reqs) {
    const vectorCovered = vectorCoverage.has(`${req.capability}::${req.name}`);
    for (const scenario of req.scenarios) {
      if (fullyDeferred.has(req.name) || scenarioDeferred.has(`${req.name}::${scenario}`)) {
        deferredCount++;
        continue;
      }
      inScopeCount++;
      if (vectorCovered || tests.content.includes(scenario)) continue;
      drifted.push({ requirement: req.name, scenario, file: req.file });
    }
  }

  if (drifted.length > 0) {
    console.error(`spec-drift: ${drifted.length} scenario(s) have no matching test:`);
    for (const d of drifted) {
      console.error(`  - "${d.requirement}" :: "${d.scenario}"  (${d.file})`);
    }
    console.error("");
    console.error("Add a test whose description (or a comment) names the scenario verbatim.");
    console.error(`If the scenario is deferred to a later release, add it to ${DEFERRED_FILE} as`);
    console.error(`"Requirement title :: Scenario title" with a rationale comment.`);
    return 1;
  }

  console.log(
    `spec-drift: ok — ${inScopeCount} in-scope scenario(s) covered across ${tests.files.length} test file(s) and ${vectorCoverage.size} vector-covered requirement(s); ${deferredCount} deferred.`,
  );
  return 0;
}

process.exit(main());
