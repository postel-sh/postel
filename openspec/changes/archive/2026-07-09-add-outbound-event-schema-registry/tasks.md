## 1. Core types

- [x] 1.1 Add `OutboundEventRegistry` (`Record<string, StandardSchemaV1<unknown, unknown>>`) and `EventDataOf<E, T>` conditional type to `typescript/packages/core/src/outbound.ts`.
- [x] 1.2 Add `readonly events?: TEvents` to `OutboundConfig`, parameterizing it as `OutboundConfig<TTx = unknown, TEvents extends OutboundEventRegistry = OutboundEventRegistry>`.
- [x] 1.3 Parameterize `OutboundApi`/`OutboundRuntime` over `TEvents` and give `send` two overloads: a registry-driven `send<T extends string>(event: SendEvent<EventDataOf<TEvents, T>> & { type: T }, options?)` tried first, and the existing `send<TData = unknown>(event: SendEvent<TData>, options?)` as the explicit-override/unregistered-type fallback.
- [x] 1.4 Add `EventsOf<OC>` helper in `postel.ts` (mirrors `EventOf<S>`) and thread it through `WithOutbound<C>` so `PostelInstance`'s `outbound.send` picks up the registry from `config.outbound.events`.

## 2. Runtime validation

- [x] 2.1 Thread `config.events` into `SendContext` (`sender/send.ts`) as an optional `events: OutboundEventRegistry` field.
- [x] 2.2 In `sendImpl`, before building the outbox row: if `ctx.events?.[event.type]` exists, call `schema["~standard"].validate(event.data)`; on `issues`, throw `EventValidation(out.issues)` without persisting; on success, use `out.value` as the row's `data`.
- [x] 2.3 Wire `config.events` from `buildOutboundRuntime` into the `SendContext` passed to `sendImpl`.

## 3. Tests

- [x] 3.1 New `typescript/packages/core/test/outbound-schema.test.ts` covering the three `sender` spec scenarios: registered+valid persists normally, registered+invalid throws `EventValidation` and skips persistence, unregistered stays permissive.
- [x] 3.2 Add a "Registered event type is typed and validated" / "Invalid data throws EventValidation" / "Unregistered type stays permissive" type-level + runtime test to `postel-factory.test.ts` alongside the existing "Strongly-typed event" test, confirming `send<OrderCreated>(...)` (explicit override) still compiles and runs unchanged.
- [x] 3.3 Confirm `err.code === 'EVENT_VALIDATION'` and `err.issues` shape match the receiver-side throw (reuse existing `EventValidation` assertions as a template).

## 4. Docs

- [x] 4.1 Add an outbound events-registry example to `docs/content/docs/outbound/` (mirroring the existing inbound schema docs), showing `outbound: { events: { "user.created": schema } }` and the resulting typed/validated `send()`.
- [x] 4.2 Grep `docs/app/(home)/page.tsx` and other outbound docs pages for the canonical `send()` snippet; update if it no longer reflects the new optional `events` registry story.

## 5. Verification

- [x] 5.1 Run `mise run check:all` (spec:validate, spec:schema-validate, check:spec-drift) at the repo root.
- [x] 5.2 Run the `@postel/core` test/lint/typecheck/build chain per `typescript/AGENTS.md`.
- [x] 5.3 Confirm `@postel/compliance` (or equivalent sender-path tests) stay green.
