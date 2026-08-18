# @postel/storage-helpers

> Zero-DB-dependency helpers shared by every first-party and third-party Postel storage adapter.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. If you're implementing a custom `Storage` adapter (for a backend the first-party adapters don't cover — libSQL, Turso, D1, CockroachDB, …), reach for this instead of hand-rolling the glue: dialect-aware timestamp/JSON/bytes codecs, canonical `capabilities` flag sets, idempotency-key formatting, message/attempt/endpoint/secret row encode-decode, the schema-version constant, and the migration SQL.

```bash
npm install @postel/storage-helpers
```

```ts
import { PG_CODEC, encodeMessageInsert, decodeStoredMessage } from "@postel/storage-helpers";

const row = encodeMessageInsert(message, PG_CODEC);
// ... run your own INSERT with `row` ...
const stored = decodeStoredMessage(fetchedRow, PG_CODEC);
```

Adapters implementing `Storage` from scratch typically also depend on `@postel/storage-testkit`'s `runStorageTests(factory)` conformance battery in their test suite. See [Custom adapters](https://postel.dev/docs/storage/custom-adapters) for the full `Storage` interface and how the two packages fit together.

## License

MIT
