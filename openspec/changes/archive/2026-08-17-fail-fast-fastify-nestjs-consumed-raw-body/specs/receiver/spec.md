## MODIFIED Requirements

### Requirement: Consumed raw body surfaces a descriptive configuration error [PORT-SPECIFIC]

A framework gate reads the raw request bytes to verify. When those bytes have already been consumed by an upstream body parser (the single most common webhook integration mistake — e.g. a global `express.json()` registered before the webhook route), the gate MUST NOT feed an empty or re-serialized body into verification, because that degrades into a misleading `SIGNATURE_INVALID`. Instead the gate SHALL throw a descriptive `ConfigurationError` that names the likely cause and points at body-parser ordering. Because `ConfigurationError` is outside the `PostelError` hierarchy, it is not mapped to a 4xx by the gate's status table; it bubbles as a 5xx (integrator bug), distinct from a client signature failure.

**Conformance**: PORT-SPECIFIC. The consumed-body hazard is specific to frameworks whose body parsers consume the request stream (Express/Node body-parser ordering, Fastify content-type parsers, NestJS's global body parser); the `ConfigurationError` mechanism is a reference-implementation ergonomic. Other ports guard their own equivalent hazards through their own idioms. The compliance suite does not exercise adopter middleware ordering.

#### Scenario: Body-parser ordering yields a descriptive error, not a signature failure

- **WHEN** an Express app registers a global body parser (`express.json()`) before a gate-protected webhook route, so the gate sees a non-`Buffer` `req.body`
- **THEN** the gate raises a `ConfigurationError` whose message points at body-parser ordering
- **AND** the failure surfaces as a 5xx, not a `SIGNATURE_INVALID` 400

#### Scenario: Fastify manual preHandler without the raw-body plugin

- **WHEN** a Fastify app wires `verifyWebhook` as a preHandler without registering the `fastifyPostel` raw-body plugin, so Fastify's built-in content-type parser hands the gate an already-parsed body
- **THEN** the gate raises a `ConfigurationError` whose message points at the missing raw-body plugin
- **AND** the failure surfaces as a 5xx, not a `SIGNATURE_INVALID` 400

#### Scenario: NestJS WebhookGuard without rawBody enabled

- **WHEN** a NestJS app uses `WebhookGuard` but the Nest app was bootstrapped without `rawBody: true`, so `req.rawBody` is absent and `req.body` is the already-parsed body
- **THEN** the guard raises a `ConfigurationError` whose message points at enabling `rawBody: true`
- **AND** the failure surfaces as an unhandled 5xx, not a `SIGNATURE_INVALID` 400
