## 1. Package scaffold

- [x] 1.1 Create `typescript/packages/http/` (package.json, tsconfig.json, tsup.config.ts, README.md) mirroring the framework-adapter template; dependency `@postel/core`; two tsup entries `src/index.ts` + `src/node.ts`; exports map `.` and `./node`.
- [x] 1.2 `pnpm install` so the workspace picks up `@postel/http` (matched by the `packages/*` glob).

## 2. Error→status policy

- [x] 2.1 `src/error-policy.ts` — exhaustive `Record<PostelErrorCode, number>` (`SIGNATURE_INVALID`/`TIMESTAMP_TOO_OLD`/`MALFORMED_HEADER`/`RAW_BYTES_MISMATCH_DETECTED` → 400, `UNKNOWN_KEY_ID` → 401), plus `statusForError` and `errorBody`.

## 3. Inbound pipeline

- [x] 3.1 `src/types.ts` — `WebhookOutcome`, `WebhookHandlerOptions`, `WebhookContext`, `HandlerResponse`, `NormalizedRequest`.
- [x] 3.2 `src/internal/headers.ts` — case-insensitive `webhook-id` reader + `headersToRecord(Headers)`.
- [x] 3.3 `src/handle-inbound.ts` — verify → map (`PostelError` → outcome.error, else rethrow) → verify-then-dedup-ack → `onVerified` → outcome.
- [x] 3.4 `src/fetch-webhook.ts` — `Request` → `handleInbound` → `Response`.
- [x] 3.5 `src/node.ts` — `writeOutcomeToNodeRes(res, outcome)`, `headersFromNode(headers)`.
- [x] 3.6 `src/index.ts` — public exports only.

## 4. Tests (name the requirements verbatim)

- [x] 4.1 `test/error-policy.test.ts` — names *Framework adapters gate verification and map protocol errors to HTTP status*; table per `PostelErrorCode`; `NotImplementedError` is not a `PostelError`.
- [x] 4.2 `test/handle-inbound.test.ts` — verified → 204; custom-response override; non-`PostelError` thrown from `onVerified` propagates.
- [x] 4.3 `test/dedup-ack.test.ts` — names *Framework adapters offer optional dedup-acknowledgement*; first receipt / duplicate / disabled pass-through / dedup-only-after-verify (uses `inMemoryDedupAdapter`).
- [x] 4.4 `test/fetch-webhook.test.ts` — byte-identity: re-serialized body → 400, identical signed body → handler runs.

## 5. ADR + drift bookkeeping

- [x] 5.1 `decisions/0014-framework-adapter-pattern.md`.
- [x] 5.2 Add *Framework adapters share a framework-agnostic HTTP core* to `scripts/spec-drift-deferred.txt` (packaging-policy item, consistent with the other distribution-packaging entries).

## 6. Verify + archive

- [x] 6.1 `openspec validate add-http-package-and-adapter-gate-contract --strict`.
- [x] 6.2 `cd typescript && pnpm --filter @postel/http typecheck && pnpm --filter @postel/http test && pnpm --filter @postel/http build`; root `pnpm lint`.
- [x] 6.3 `mise run check:all`.
- [x] 6.4 `openspec archive add-http-package-and-adapter-gate-contract -y`.
