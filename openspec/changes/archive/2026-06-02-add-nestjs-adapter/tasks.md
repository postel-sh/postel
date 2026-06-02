## 1. Package

- [x] 1.1 Create `typescript/packages/frameworks/nestjs/` (package.json, tsconfig, README); deps `@postel/core` + `@postel/http`; peers `@nestjs/common`, `reflect-metadata`, `rxjs`.
- [x] 1.2 `src/index.ts` — `PostelModule.forRoot`, `WebhookGuard(key)` on `@postel/http`, `@Event`/`@WebhookResult`, `createPostelDecorators`. Apply Nest decorators programmatically (no `@`-syntax) so the source parses under TC39-decorator tooling.

## 2. Tests

- [x] 2.1 `test/nestjs-adapter.test.ts` — names *Framework adapters preserve raw bytes*: guard verifies byte-identical input + sets `req.postel`; re-serialized → `HttpException` 400; non-`PostelError` bubbles.

## 3. Spec + docs

- [x] 3.1 `receiver` MODIFIED *Framework adapters preserve raw bytes* (add NestJS + scenario).
- [x] 3.2 `distribution-packaging-typescript` MODIFIED *Package map* (add `@postel/nestjs`).
- [x] 3.3 Docs: frameworks status table + NestJS note; packages reference.

## 4. Verify + archive

- [x] 4.1 `openspec validate add-nestjs-adapter --strict`.
- [x] 4.2 `@postel/nestjs` typecheck + test + build; root `pnpm lint`.
- [x] 4.3 `mise run check:all`.
- [x] 4.4 `openspec archive add-nestjs-adapter -y`.
