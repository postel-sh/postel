# Launch checklist

Tracks what has to be true before the [Show HN draft](./show-hn.md) is submitted. This repo's agents don't submit it — a human does, once every item below is checked.

## Assets (this PR)

- [x] README hero: atomic-outbox demo (asciinema cast + GIF) recorded from the merged `examples/nextjs-prisma` reference app
- [x] Comparison docs page: Postel vs Svix vs Hookdeck Outpost vs Convoy vs DIY-BullMQ, including a "what we deliberately don't do" column consistent with [VISION.md](../../VISION.md#non-goals)
- [x] Show HN draft (title + first comment)

## Hard blocker before submission

- [ ] **`@postel/*` is installable from npm** — [#121](https://github.com/postel-sh/postel/issues/121) (org ownership, `NPM_TOKEN`, pipeline rehearsal) and [#122](https://github.com/postel-sh/postel/issues/122) (cut `compliance/v0.1` and `ts/v0.1.0`, `npm install @postel/core` works for a stranger)

Do not submit the Show HN before both close. The whole pitch is "try it" — a broken `npm install` in the first five minutes is worse than not launching.

## Immediately before submission

- [ ] `npm install @postel/core` (or the quickstart's actual command) works from a clean machine, no workspace tricks
- [ ] README hero renders on GitHub (check the rendered page, not just the source diff)
- [ ] Comparison page and Show HN draft still match reality — package list, pricing, and positioning drift; re-check facts that could have gone stale between merge and submission
- [ ] Docs site (`postel.dev`) is deployed with the comparison page live and linked

## Post-launch (per issue #144's scope note, not part of this PR)

- Newsletters: Node Weekly, Bytes
- Standard Webhooks community
- The awesome-lists the copycat projects already sit on
