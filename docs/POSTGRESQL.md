# PostgreSQL

PostgreSQL is optional server infrastructure for a later admin panel and anti-duplication work. It is not the voxel world store.

These stay on the current filesystem snapshot, under `dataDir/<worldId>/`:

- chunks and block modifications
- block states
- chests and furnaces
- mobs and dropped items
- player world snapshots
- `world.json`, `players.json`, `meta.json`

Plugin JSON stays in `dataDir/<worldId>/plugin-data/` through `JsonFileStore`. Economy, auction, and trade are unchanged in this change. Economy and auction still use JSON. Trade still keeps offers in memory.

## When it is disabled

If `FC_DATABASE_URL` is missing or blank, the server does not import a pool, does not open a socket, and does not wait on a database. Gameplay, saves, and the existing tests behave as they do without PostgreSQL.

## When it is configured

| Variable | Role |
| --- | --- |
| `FC_DATABASE_URL` | `postgres:` or `postgresql:` URL. Server environment only. |
| `FC_DEPLOYMENT_ID` | Required when the URL is set. Examples: `dev`, `prod`. Not derived from the hostname. |
| `FC_DB_POOL_MAX` | Optional. Default 4. Clamped to 1..8. |

A present URL without `FC_DEPLOYMENT_ID` is a startup error. If the URL is set and the server cannot connect, or a migration fails, or an applied migration checksum does not match this build, startup fails. The world lock is released. The server does not fall back to JSON for that configured database.

PostgreSQL startup runs before the world is loaded. A failure there, or any other failure before canonical world initialization finishes, does not write `meta.json`, `world.json`, or `players.json`. A world that did finish loading is still saved on shutdown, including after a failed port bind.

Dev and prod need separate databases. Audit and idempotency rows also store `deployment_id`, so a shared database still does not mix the two scopes. Do not point a dev process at the prod database.

Three game processes can run at once. The default pool of 4 is 12 connections. The clamp of 8 is 24. Size the database for that, not for one process.

`/status` does not report the host, database name, user, or URL. Logs must not contain the URL or password.

## What the first migration creates

- `schema_migrations` (`version`, `name`, `checksum`, `applied_at`)
- `admin_audit_log`, append-only. Migration `0002` allows more than one row for the same `deployment_id` and `request_id`. `event_id` stays the primary key. `UPDATE`, `DELETE`, and `TRUNCATE` stay rejected.
- `idempotency_requests`

Migrations run once at startup, before the world is ready, on one connection holding a session advisory lock. Anarchy, Survival, and Peaceful can start together. Each pending migration and its `schema_migrations` insert share one transaction. Applied SQL is checksummed with SHA-256. Editing an applied migration fails startup. The runner does not delete history or recreate the schema.

The audit trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE`. A later migration can still change the table by dropping that trigger inside its own migration transaction. Application code has no update or delete method.

Idempotency claims a request, runs the callback, and stores the response in that same transaction. The same deployment, request id, operation, actor, and payload hash returns the stored response and does not run the callback again. A different operation, actor, or payload is a conflict. A thrown callback rolls back, so the request can be retried.

## Release

`build:server` keeps `pg` external, same as `ws`. `pack:release` copies the production dependency closure by reading package manifests. The VPS does not run `npm install`. World directories are not part of the release.

## Backups

Database backups are a later operational task. This document does not change world-directory backups.

## Manual setup

The game server does not install or start PostgreSQL. The database has to be reachable before `FC_DATABASE_URL` is set. The commands below are an example for a later machine. They use placeholder names. Do not commit a real URL or password.

```bash
sudo -u postgres psql -c "CREATE USER megacraft_dev WITH PASSWORD 'replace-me';"
sudo -u postgres psql -c "CREATE DATABASE megacraft_dev OWNER megacraft_dev;"
```

Put the URL in the server environment, for example `/etc/frontier-cubes/anarchy.env`, not in git:

```bash
FC_DATABASE_URL=postgresql://megacraft_dev:replace-me@127.0.0.1:5432/megacraft_dev
FC_DEPLOYMENT_ID=dev
FC_DB_POOL_MAX=4
```

Use a different database and `FC_DEPLOYMENT_ID=prod` for production. Do not add `After=postgresql.service` to the game units: the database may be on another host.

## Tests

`npm test` does not need PostgreSQL. `FC_TEST_DATABASE_URL` runs the optional integration suite in a private schema and drops that schema afterward. Never point it at a production database. A database name containing `prod`, or `template0` / `template1`, is refused.
