# Postel — agent guide

Postel is a **polyglot** webhooks library backed by solid, executable specs. The TypeScript implementation in this repo ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the compliance test suite. See [VISION.md](VISION.md).

## Source of truth

| Layer | Location |
|---|---|
| Top-level positioning, scope, success criteria | [VISION.md](VISION.md) |
| Capability behaviors (what the lib does) | `openspec/specs/<capability>/spec.md` |
| Wire format | `specs/wire-format/asyncapi.yaml` (AsyncAPI 3.0) |
| DB schema | `specs/db-schema/0001_init.sql` |
| Architectural decisions | `decisions/` |
| Behavioral oracle | `@postel/compliance` (planned package) |

## Workflow rules (non-negotiable)

1. **Spec is the source of truth.** Implement against the spec. If the spec is wrong, ambiguous, or incomplete, *fix it via an OpenSpec change first*, then resume implementation. Never silently work around the spec.

2. **Never edit `openspec/specs/<cap>/spec.md` directly.** All capability-spec changes flow through `npx openspec new change <name>` → author artifacts → `npx openspec archive <name> -y`. The archive command auto-syncs delta specs into main specs.

3. **Tests are scenarios, 1:1.** Every `### Requirement` and `#### Scenario` in a capability spec MUST map to a test that names the requirement. CI fails if a requirement has no matching test (`scripts/check-spec-drift.mjs`). This is mechanical, not creative — the scenarios are already in WHEN/THEN form.

4. **Verification chain before commit:**
   ```
   npm test && npm run typecheck && npm run lint && npm run check:spec-drift
   ```
   (Some scripts are placeholders today; they activate as code lands. Run them anyway.)

5. **Compliance suite is the behavioral gate.** PRs touching the sender/receiver path must keep `@postel/compliance` green. When the package lands, this becomes the deciding signal — not unit tests.

## Per-capability implementation loop

For each capability you implement:

1. Read `openspec/specs/<cap>/spec.md` end-to-end.
2. Translate every `#### Scenario` into a test case at `packages/<pkg>/test/<cap>.test.ts`. The test description should include the requirement title verbatim so the spec-drift check passes.
3. Implement the **simplest** code in `packages/<pkg>/src/` that makes all tests pass. No extras.
4. Run the verification chain. Iterate until green.
5. Open a PR via `gh pr create`. Reference the capability spec.

If you discover the spec is incomplete or wrong: stop, open an OpenSpec change to fix it, archive it, then resume. Don't sneak spec edits into the implementation PR.

## What NOT to do

- Don't over-implement. Add only what scenarios require.
- Don't add features not specified.
- Don't write tests that don't trace back to a scenario.
- Don't bypass the OpenSpec workflow for capability-spec changes.
- Don't add explanatory comments — well-named identifiers handle that. (See the "Don't add comments" guidance from the system rules.)
- Don't push to `main`. PRs only.
- Don't run `npm publish` or any release-side command — those are gated through CI on tagged commits, not the agent.

## Useful commands

```bash
# Discovery
npx openspec list --specs               # show all capabilities + requirement counts
npx openspec show <cap>                 # display a capability spec
npx openspec validate --all             # validate every spec + active change

# Change workflow
npx openspec new change <kebab-name>    # create a new change folder
npx openspec status --change <name>     # check artifact completion
npx openspec validate <name>            # validate a single change
npx openspec archive <name> -y          # archive (auto-syncs to main specs)

# Quality gates
npm run check:spec-drift                # verify every requirement has a test
npm run spec:validate                   # alias for `openspec validate --all`
```

## House conventions

- **Conventional commits** (e.g., `feat:`, `fix:`, `chore:`, `spec:`, `docs:`).
- **One logical change per PR.** Don't bundle unrelated edits.
- **No emojis in code or commit messages** unless the user explicitly asks.
- **Postgres dialect in DDL files**, with SQLite variants commented inline.

## When in doubt

Re-read the relevant capability spec. If the answer isn't there, the spec needs an update — open a change.
