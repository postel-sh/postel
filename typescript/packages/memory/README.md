# @postel/memory

In-memory `Storage` adapter for Postel. Deterministic test backend and single-process demo backing.

```ts
import { Postel, InProcess } from "@postel/core";
import { InMemoryStorage } from "@postel/memory";

const storage = InMemoryStorage();
const postel = Postel({
  outbound: { storage, workers: InProcess({ concurrency: 2 }) },
});
```

State is in-process — nothing is persisted to disk. Restarting the process clears everything. The adapter implements every method on the [`Storage`](../core/src/storage/types.ts) interface, with deterministic ordering and the full optional capability set (`notify` / `subscribe` / `transactional` / `streaming`) so the worker scheduler exercises the same code paths it would against a real Postgres adapter.
