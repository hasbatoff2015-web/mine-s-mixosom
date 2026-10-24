# PostgreSQL audit and idempotency foundation

This report is the earlier audit and idempotency pass. Later passes added the Megacoin ledger, the postgres gameplay cutover, and economy scope. Current behavior is `docs/POSTGRESQL.md` and `docs/reports/2026-10-11_megacoin-stage2b-followup.md`.

## Goal

Add a production-safe PostgreSQL layer for a later admin panel and anti-duplication system: pool, config, migrations, transactions, append-only admin audit storage, and reusable idempotency. Do not change gameplay, economy, auction, trade, the client protocol, or world persistence.

## Result

`FC_DATABASE_URL` absent keeps the server on the current filesystem path and opens no database connection. A present URL requires `FC_DEPLOYMENT_ID`. Connection failure, migration failure, and an edited applied checksum abort startup and release `.instance.lock`. There is no JSON fallback.

The first migration creates `schema_migrations`, append-only `admin_audit_log`, and `idempotency_requests`. Migration `0002` lets one `request_id` have several immutable audit attempts. `FC_ADMIN_IDS` enables exactly two equal admins, separate from game operators. `AdminActionService` is not exposed over HTTP. Economy stays on `EconomyService` because its reads and writes are synchronous across gameplay; this pass does not add a PostgreSQL ledger or a dual-write. Inventory and container revisions are in memory. Repeated inventory `requestId`s do not apply twice. A stale revision resyncs and does not ban. `pack:release` copies the `ws` and `pg` runtime dependency closure. The VPS still does not run `npm install`.

## Implemented

- `server/db/`: `Database` (`start`, `close`, `query`, `transaction`), checksummed migrations under a session advisory lock (`FCDB`/`MIG1`), `AdminAuditService`, `IdempotencyService`, canonical JSON SHA-256, secret redaction.
- `WorldInstance.initialize` acquires the world lock, then starts the database, then loads the world. `canonicalWorldLoaded` becomes true only after that load or create finishes. `stop()` writes `meta.json`, `world.json`, and `players.json` only when the flag is set. A configured database that never connects fails before the load, so shutdown does not replace an existing world with the empty in-memory default and does not create those files for a new directory. After a successful load, shutdown still saves, including a failed listen and a later fatal error. A failed save still releases the lock and closes the pool.
- Disabled mode is a no-op implementation. Tests inject a fake database. `new WorldInstance(config)` does not need PostgreSQL.
- Migration `0001` `admin_audit_and_idempotency`. Triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` on `admin_audit_log`.
- Release packaging walks `dependencies` only (not optional, peer, or dev). `packageNameFromSpecifier` ignores prose such as `from '${name}'` in the server bundle.
- `docs/POSTGRESQL.md`. Env templates name `FC_DATABASE_URL`, `FC_DEPLOYMENT_ID`, and `FC_DB_POOL_MAX` as comments only.

## Changed files

`server/db/*`, `server/config.ts`, `server/WorldInstance.ts`, `server/AnarchyServer.ts`, `scripts/release-ops.mjs`, `scripts/build-server.mjs`, `scripts/check-build.mjs`, `scripts/check-import-boundaries.mjs`, `scripts/lib/release-common.sh`, `scripts/server-production-smoke.mjs`, `package.json`, `package-lock.json`, `deploy/systemd/*.env`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/SYSTEMD.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/POSTGRESQL.md`, and the new server tests under `tests/server/`.

## Architecture decisions

- PostgreSQL is server-only and is not the voxel store. `EconomyService`, `AuctionService`, and `TradeService` stay on their current storage.
- One real `BEGIN`/`COMMIT` client per `transaction()`. Pool `query` calls are not treated as a transaction.
- `deployment_id` is explicit. It is not derived from the hostname.
- Migrations are TypeScript string constants so they stay inside `dist/server/index.mjs`. `pg` stays external, same as `ws`.
- The public `/status` body is still `name`, `world`, `mode`, `ready`, `online`, `maxPlayers`, `tickRate`.
- Future authoritative writes are meant to look like `idempotency.execute(request, async (tx) => { ... })`. The database commit is the success point. That pattern is not wired to gameplay in this change.

## Tests

Typecheck (`tsc`, client, server) and import boundaries passed. Client production build is 10.30 MiB. `check:size` passed. `smoke:server:prod` started anarchy, survival, and peaceful with `database: disabled`, `/status` ready, SIGTERM exit 0, and the world lock removed.

Focused Vitest covers config, disabled startup, unreachable-database redaction, lifecycle and world-lock cleanup, migration order and checksums, audit validation, canonical hashing, idempotency, systemd env comments, and the release closure. A failed start before the canonical load leaves existing `meta.json`, `world.json`, and `players.json` byte-for-byte unchanged, and an empty directory does not gain those files. A corrupt save is not replaced. A normal start still creates a new world and a later stop still persists mutations. `git diff --check` is clean.

Full Vitest on this branch: 26 failed, 3393 passed, 12 skipped (368 files). The 11 skipped integration tests were the PostgreSQL suite (`FC_TEST_DATABASE_URL` was unset for that run) plus one pre-existing skip. The same 11 files and the same 26 assertion messages fail on current `origin/main` `2dd09ee` (arrow visuals, combat presentation, fence jump, menu PIL, god-sword texture generator, SFX pack count, remote breaking overlays, UI source string, god-sword mob, pet hit timing, bow draw ticks). They are pre-existing.

Real PostgreSQL 16 integration, database `fc_foundation_test` (name does not contain `prod`), private schema dropped afterward: 11 passed. Bootstrap, rerun no-op, two concurrent migrators, checksum rejection, audit insert, rejected UPDATE/DELETE/TRUNCATE, replay, conflicts, failed-callback retry, concurrent duplicate, and rollback.

Packed release `/tmp/fc-pack-check`: 2.8M. `node --input-type=module` resolved `pg.Pool` and `ws`. Roots are only `pg`, `ws`, and the `pg` runtime dependencies. No `world.json`, `players.json`, `meta.json`, or `.instance.lock`.

## Visual QA

Not applicable. No client UI or protocol change.

## Performance

No database call was added to the 20 TPS tick. Migrations run only in `start()`. Pool max defaults to 4 and clamps to 1..8. Disabled mode does not construct a pool. The packed release is 2.8M: `dist` 1.8M and `node_modules` 1.1M (`ws`, `pg`, and the `pg` runtime dependencies).

## Known issues

- The 26 full-suite failures above exist on current `origin/main` and are not fixed here.
- Database backups and a live PostgreSQL service are not part of this change. The local cluster used for the integration run was started by hand after `policy-rc.d` blocked the package installer.

## Deferred

Admin HTTP and authentication, economy/auction/trade migration, unique items, inventory and container revisions, punishments, privileges, and anti-dupe alerts.

## Next work

Move one authoritative mutation (likely the economy ledger) onto `idempotency.execute` so the database commit is the success point, while filesystem world snapshots stay where they are.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8` from `origin/main` `2dd09ee7e555896b652789408b4ae93a094cef3b`. Draft PR #129. Not merged. `origin/main` had not moved at the end of this pass.
