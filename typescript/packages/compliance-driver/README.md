# @postel/compliance-driver

HTTP control-plane shim the `@postel/compliance` suite drives in `--sender-control` mode. The driver wraps a real `Postel({ outbound: { storage } })` instance and exposes six control-plane routes the compliance runner uses to register endpoints, send events, start workers, and advance the clock.

The storage backend is selectable (PORT-SPECIFIC mechanism): `InMemoryStorage` by default, or `@postel/pg` over a real Postgres connection via `--storage pg --pg-url <url>` (or `POSTEL_COMPLIANCE_STORAGE=pg` / `POSTEL_COMPLIANCE_PG_URL=<url>`). `/control/reset` `TRUNCATE`s the real tables instead of rebuilding an in-memory host when pg-backed. `scripts/pg-conformance.mjs` uses this to run the sender corpus against real Postgres (testcontainers) and assert the resulting rows conform to `specs/db-schema/`.

This package is part of the cross-port CONTRACT surface for sender-side compliance (see the compliance capability spec).
