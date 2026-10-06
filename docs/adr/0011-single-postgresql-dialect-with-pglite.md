# 0011: Single PostgreSQL dialect with embedded PGlite on desktop

- Status: Accepted
- Date: 2026-10-06
- Deciders: BaSyx Studio maintainers
- Supersedes: the desktop relational-storage part of
  [ADR 0005](0005-storage-and-observability.md) (SQLite), including the
  corresponding reference in [ADR 0009](0009-declarative-graphical-views.md)
- Requirements: OPS-001, OPS-003, DEP-006, DEP-007, SEC-007, ARCH-002, ARCH-003,
  ARCH-007, ARCH-009

## Context

ADR 0005 chose PostgreSQL for hosted Studio metadata and SQLite for desktop
metadata. The same Studio Service modules run in both variants: infrastructure
configuration, sessions and target credentials, app installations, view
definitions, and audit records. Two SQL dialects would therefore cause:

- two schema definitions (Drizzle uses dialect-specific `pgTable` and
  `sqliteTable` builders) and two migration chains;
- diverging semantics for JSON, timestamps and time zones, booleans, upserts,
  constraints, and locking;
- a doubled repository and migration test matrix, including the N−2 upgrade
  tests required by DEP-007;
- a native SQLite driver that needs install scripts and Electron rebuilds, which
  conflicts with the deny-by-default dependency build policy of ADR 0010.

ORMs that abstract the dialect (Prisma, TypeORM, MikroORM, Kysely dialects) hide
part of the syntax. Migrations, data types, locking, and transaction behavior
still differ and still need testing per dialect, so the risk moves rather than
disappears.

PGlite (`@electric-sql/pglite`) is PostgreSQL compiled to WebAssembly. It runs
in a Node.js process, persists to a directory, needs no native modules or
separate server process, and is supported by Drizzle ORM and drizzle-kit through
a dedicated driver.

## Decision

Use PostgreSQL as the only SQL dialect for Studio metadata.

- **Hosted:** a PostgreSQL server with a Studio-owned database and user
  (unchanged from ADR 0005).
- **Desktop:** PGlite embedded in the local Studio Service process. It persists
  to a Studio-owned directory below Electron's per-user application data path.
- **One schema, one migration chain:** one Drizzle `pgTable` schema. The driver
  (`node-postgres` for hosted, `pglite` for desktop and tests) is selected from
  the deployment mode at startup.
- **One owner process:** exactly one process opens the desktop database, the
  local Studio Service. The Workspace Worker, app runners, and Electron main
  process access metadata only through the Studio Service. Electron enforces a
  single application instance per OS user so that two services never open the
  same data directory.
- **Portable SQL in shared modules:** shared repository code uses PostgreSQL
  features that PGlite supports. Server-only capabilities may be used only in
  hosted-only modules behind an explicit deployment-capability check. Examples
  are cross-process `LISTEN/NOTIFY`, multi-worker `SKIP LOCKED` job queues, and
  extensions PGlite doesn't bundle.
- **Secrets are unchanged:**
  - The database stores no secret values.
  - Desktop keys and secrets live in the OS credential store through Electron
    `safeStorage`; hosted secrets come from the deployment secret store.
  - Token material that must be persisted is encrypted with a key obtained from
    those stores.
- **Testing:**
  - Repository and migration unit tests run against in-memory PGlite.
  - Integration tests against a real PostgreSQL server (see `test-setup/`)
    remain mandatory for hosted behavior.

References to desktop SQLite in ADR 0005 and ADR 0009 are superseded by this
record. All other parts of those ADRs remain in force.

### Qualification gate

Following ARCH-007, adoption of PGlite is confirmed by a time-boxed proof in
phase 0 of MVP-1. The evidence required:

1. **Packaging:** PGlite's WASM and data assets load from the Nitro server build
   inside the packaged Electron app on macOS, Windows, and Linux for the
   supported architectures, without dependency install scripts.
2. **Crash safety:** forced termination during write transactions never leaves
   an unopenable database. Committed transactions survive with the documented
   durability settings.
3. **Footprint:** cold-open time, memory, and installer size increase are
   measured, recorded, and accepted by the maintainers.
4. **Migrations:** the same Drizzle migration chain applies to PostgreSQL 18 and
   PGlite, and the N−2 upgrade test passes on both.
5. **Engine upgrades:** an upgrade of PGlite that changes the embedded
   PostgreSQL major version works through dump and restore (for example with
   `@electric-sql/pglite-tools`), keeping a backup of the previous data
   directory.
6. **Semantics:** the transaction, constraint, and row-locking behavior that
   Studio repositories rely on is identical on both drivers.

**Fallback:** if the gate fails, use `embedded-postgres` instead. It runs
supervised, per-platform PostgreSQL server binaries as a local child process.
The dialect, schema, and migrations stay the same; the costs are heavier
packaging and one more supervised process. Return to SQLite only through a new
ADR if both options fail.

## Consequences

- One schema, one migration chain, and one repository implementation serve
  hosted, desktop, and tests.
- Repository tests run quickly in-process without containers.
- No native database module is installed, which keeps the PNPM build-script
  allowlist unchanged.
- PGlite is pre-1.0 software. Its maturity, durability, and upgrade behavior are
  a monitored dependency risk with a defined fallback.
- PGlite uses one connection. Long transactions in the local Studio Service
  delay other requests, so transactions stay short.
- PGlite's on-disk format is tied to the embedded PostgreSQL major version, and
  upgrades across major versions are part of desktop release testing.
- Desktop backup and export use a dump or a copy of the closed data directory.
- The architecture documents, technology stack, and setup guide refer to PGlite
  instead of SQLite for desktop metadata.

## Alternatives considered

- **SQLite on desktop and PostgreSQL hosted (ADR 0005):** rejected because of
  the dual-dialect schema, migration, and test burden described above.
- **A dialect-abstracting ORM:** rejected because it doesn't remove differences
  in migrations, types, and locking, and some candidates add heavy runtimes
  (for example query-engine binaries) to the desktop package.
- **SQLite everywhere:** rejected because it violates OPS-001, restricts hosted
  Studio to a single instance without shared sessions, and lacks the row-level
  locking planned for PostgreSQL-backed jobs.
- **`embedded-postgres` as the primary desktop engine:** kept as the fallback.
  It is real PostgreSQL, but requires per-platform binaries and process
  supervision.
- **Requiring a user-installed PostgreSQL on desktop:** rejected because it
  contradicts straightforward desktop installation (DEP-006).
