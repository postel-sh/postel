# @postel/cli

> The postel CLI binary — `postel migrate`.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the `@postel/compliance` test suite.

## Usage

```sh
npx @postel/cli migrate --dialect postgres --url "postgres://user:pass@host:5432/db"
npx @postel/cli migrate --dialect sqlite --url "./postel.db"
npx @postel/cli migrate --dialect mysql --url "mysql://user:pass@host:3306/db"
```

`postel migrate` runs the target dialect's canonical forward-only migrations — the same ones its standalone adapter package (`@postel/pg` / `@postel/sqlite` / `@postel/mysql`) runs — and brings the database to the current schema version. It's idempotent: rerunning it against an already-migrated database is a no-op.

For v1, `migrate` is the only verb this CLI ships. See the [`cli` capability spec](../../../openspec/specs/cli/spec.md).

## License

MIT
