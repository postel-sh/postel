# Language impact

This change adds project-meta scaffolding (CLAUDE.md, CI workflow, permission allowlist, spec-drift script) that is currently TypeScript-stack-shaped (npm, node scripts, GitHub Actions on a Node toolchain). It does not change any runtime behavior of the library.

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | No code changes; affected only insofar as CI scripts will run against TS code once it lands |
| typescript-receiver | unchanged | Same |
| go-sender (planned) | unchanged | When the Go port lands, it will need its own `go-` equivalents (e.g., `Makefile`, `golangci-lint` config); the OpenSpec spec/scenario contract is language-agnostic |
| go-receiver (planned) | unchanged | Same |
| python-sender (planned) | unchanged | Same — Python ports will add `pyproject.toml`, `pytest`, etc. |
| python-receiver (planned) | unchanged | Same |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

The spec-drift CI gate enforced by `scripts/check-spec-drift.mjs` is currently TS-test-aware only (looks for the requirement name as a string in `packages/*/test/**/*.test.{ts,js,mjs,tsx}`). When the Go port lands, the script must be extended (or a sibling script added) to also walk Go test files. This is captured as a follow-up: when adding a port, the port's change MUST extend the drift check to cover its test files.
