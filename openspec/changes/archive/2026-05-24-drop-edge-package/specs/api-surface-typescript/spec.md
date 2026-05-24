## MODIFIED Requirements

### Requirement: Conditional optionality of outbound and inbound

The shape of the instance returned by `Postel({...})` SHALL be conditional on which sub-namespace slots were configured. When `outbound` is omitted from the config object, `postel.outbound` MUST NOT exist on the instance type — not merely be `undefined` at runtime. The same applies to `inbound`. TypeScript MUST report a type error if the caller references a sub-namespace they did not configure. Receivers and senders are independent capabilities; a receiver-only consumer SHALL be able to construct `Postel({ inbound: {...} })` without touching any storage adapter or outbound configuration, and vice versa.

#### Scenario: Inbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.outbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.inbound.github.verify(body, headers)` type-checks

#### Scenario: Outbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ outbound: { storage: postelDrizzle(db) } })`
- **THEN** `postel.inbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.outbound.send({ type, data })` type-checks

#### Scenario: Both configured

- **WHEN** a consumer configures both `outbound` and `inbound`
- **THEN** both `postel.outbound` and `postel.inbound` exist on the instance type
- **AND** lifecycle methods (`postel.start`, `postel.stop`, `postel.health`) are present regardless
