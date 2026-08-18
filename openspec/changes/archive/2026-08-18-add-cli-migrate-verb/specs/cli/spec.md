## ADDED Requirements

### Requirement: `postel migrate` is the only v1 CLI verb

The `@postel/cli` package SHALL ship a `postel` binary. For v1, the binary SHALL expose exactly one subcommand, `migrate`; any other subcommand (including the four verbs named in the package's historical description — `sign`, `verify`, `replay`, `simulate`) SHALL be rejected with a non-zero exit and an error naming the unsupported command. Those four verbs stay unspec'd until a future change demands them.

#### Scenario: Unsupported command is rejected

- **WHEN** a user runs `postel <anything other than migrate>`
- **THEN** the process exits non-zero
- **AND** stderr names the unsupported command

### Requirement: `postel migrate` brings a database to the current schema version

`postel migrate` SHALL accept a required `--dialect <postgres|sqlite|mysql>` flag and a required `--url <connection-string>` flag (for `sqlite`, `--url` is a filesystem path or `:memory:`). It SHALL run that dialect's canonical forward-only migrations — the same migrations the matching standalone adapter package (`@postel/pg`, `@postel/sqlite`, or `@postel/mysql`) runs — against the target database, and exit 0 once the database's `_postel_meta.schema_version` is at the adapter's latest version. The command MUST be idempotent: running it again against an already-migrated database exits 0 without reapplying completed migrations.

#### Scenario: Fresh database reaches current schema version

- **WHEN** a user runs `postel migrate --dialect <postgres|sqlite|mysql> --url <connection-string>` against a fresh, empty database
- **THEN** the process exits 0
- **AND** the database's `_postel_meta.schema_version` equals the adapter's latest migration version

#### Scenario: Rerunning migrate is a no-op

- **WHEN** `postel migrate` is run a second time against a database it already migrated
- **THEN** the process exits 0
- **AND** no error is raised for already-applied migrations

#### Scenario: Missing a required flag fails fast

- **WHEN** `postel migrate` is invoked without `--dialect` or without `--url`
- **THEN** the process exits non-zero
- **AND** stderr names the missing flag

#### Scenario: Unsupported dialect fails fast

- **WHEN** `postel migrate` is invoked with a `--dialect` value other than `postgres`, `sqlite`, or `mysql`
- **THEN** the process exits non-zero
- **AND** stderr names the unsupported dialect value
