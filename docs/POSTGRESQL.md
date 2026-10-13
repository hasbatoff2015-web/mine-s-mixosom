# PostgreSQL

PostgreSQL is optional server infrastructure for a later admin panel and anti-duplication work. It is not the voxel world store.

These stay on the current filesystem snapshot, under `dataDir/<worldId>/`:

- chunks and block modifications
- block states
- chests and furnaces
- mobs and dropped items
- player world snapshots
- `world.json`, `players.json`, `meta.json`

Plugin JSON stays in `dataDir/<worldId>/plugin-data/` through `JsonFileStore`. Auction listings and buyer records still use that JSON. Trade offers stay in memory. In `postgres` mode the Megacoin balance does not. `WorldInstance` builds `MegacoinService` for `config.serverMode` and currency commands call it. See "Megacoin ledger" and "Currency authority" below.

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

`FC_DEPLOYMENT_ID` is the environment (`dev` or `prod`). It is not the game mode. Gameplay Megacoins also store `economy_scope`, which is `ServerConfig.serverMode`: `anarchy`, `survival`, or `peaceful`. The same player in prod therefore has three wallets. A world directory, hostname, port, or display name is not that identity. Resetting the map does not reset the wallet.

Dev and prod need separate databases. Do not point a dev process at the prod database.

Three game processes can run at once. The default pool of 4 is 12 connections. The clamp of 8 is 24. Size the database for that, not for one process.

`/status` does not report the host, database name, user, or URL. Logs must not contain the URL or password.

## What the first migration creates

- `schema_migrations` (`version`, `name`, `checksum`, `applied_at`)
- `admin_audit_log`, append-only. Migration `0002` allows more than one row for the same `deployment_id` and `request_id`. `event_id` stays the primary key. `UPDATE`, `DELETE`, and `TRUNCATE` stay rejected.
- `idempotency_requests`

Migrations run once at startup, before the world is ready, on one connection holding a session advisory lock. Anarchy, Survival, and Peaceful can start together. Each pending migration and its `schema_migrations` insert share one transaction. Applied SQL is checksummed with SHA-256. Editing an applied migration fails startup. The runner does not delete history or recreate the schema.

The audit trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE`. A later migration can still change the table by dropping that trigger inside its own migration transaction. Application code has no update or delete method.

Idempotency claims a request, runs the callback, and stores the response in that same transaction. The same deployment, request id, operation, actor, and payload hash returns the stored response and does not run the callback again. A different operation, actor, or payload is a conflict. A thrown callback rolls back, so the request can be retried.

## Megacoin ledger

Migration `0003` (`megacoin_ledger`) adds three tables. `0001` and `0002` are unchanged. The same advisory lock, checksum, and per-migration transaction apply.

Migration `0004` (`gameplay_economy_scope`) adds `economy_scope` to accounts, operations, and the ledger. `0001`, `0002`, and `0003` are not edited. The column is added `NOT NULL DEFAULT 'legacy_global'` and the default is then dropped, so existing rows stay in `legacy_global` without an `UPDATE` and without minting or deleting money. New gameplay inserts must name `anarchy`, `survival`, or `peaceful`. A gameplay `MegacoinService` refuses `legacy_global`.

Current account identity is `(deployment_id, economy_scope, player_id)`. Source identity is `(deployment_id, economy_scope, source_type, source_id)`. Operation primary key is `(deployment_id, economy_scope, operation_id)`. Ledger legs reference that key and are unique on `(deployment_id, economy_scope, operation_id, leg_index)`. History, rankings, and reconciliation filter by the service scope. A transfer stays inside one scope.

`economy_accounts.balance` is `BIGINT`, from 0 through 999999999. There is no floating-point column.

`economy_operations.kind` is `INITIAL`, `SOURCE`, `TRANSFER`, `SINK`, or `ADJUSTMENT`. `request_id` is indexed and is not unique.

`economy_ledger` checks `balance_after = balance_before + delta` and `delta <> 0`. Triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` on the ledger and on operations. Application code has no method that edits a posted leg. A correction is a new `ADJUSTMENT`.

Creating an account inserts balance 100, one `INITIAL` operation, and one ledger leg of +100 in the same transaction. A repeated or concurrent create in the same scope does not mint another 100. The same player can receive that opening grant once per scope.

`createGameplayEconomy` constructs `MegacoinService` with the database, `FC_DEPLOYMENT_ID`, and `config.serverMode`. Credit, debit, transfer, and `setBalance` each use one transaction. A transfer locks the two player rows in JavaScript string order, so A→B and B→A take the same locks. `setBalance` appends the difference. If the requested balance is already current, it returns success and writes no leg. That no-op does not consume a source id. History is paged (`limit`, `before` or `after`) and is not capped in storage. Reconciliation returns `{ playerId, balance, ledgerTotal, matches }` and does not change rows.

Identities stay separate. `deployment_id` is the environment (`dev` or `prod`). `economy_scope` is the gameplay wallet and source scope (`anarchy`, `survival`, `peaceful`). `request_scope` is the idempotency namespace (`global` for admin, `economy:anarchy` and the matching survival and peaceful names for money commands). `source_id` is one logical economic event inside a wallet scope. `operation_id` is one posted operation. `entry_id` is one ledger leg.

Migration `0005` (`idempotency_request_scope`) adds `request_scope` to `idempotency_requests`. The primary key becomes `(deployment_id, request_scope, request_id)`. Existing rows stay `global`. `0001` through `0004` are not edited. `admin_audit_log` is not changed. `IdempotencyService` takes the namespace in its constructor, and every SQL statement uses that namespace. Admin actions stay on `global`. `createGameplayEconomy` builds `economy:<serverMode>`.

Postgres gameplay commands pass the transaction from `IdempotencyService.executeDetailed` into `MegacoinService`, so the request row and the money move commit together. Once that commit succeeds, the command is a success. The in-memory cache is updated from the balances returned by that commit. A replay of an older request does not copy its historical balance back into the cache. A failed read after commit cannot turn the success into `Экономика временно недоступна.` A failure before commit still fails the action and does not update the cache.

`validateEconomyJsonImport` checks a future import list and writes nothing. No startup path reads `balances.json` into these tables.

Direct calls with the database disabled throw `DatabaseDisabledError`.

## Currency authority

`FC_ECONOMY_BACKEND` is `legacy_json` when unset. That mode keeps the synchronous JSON wallet and does not write Megacoin rows. `postgres` requires `FC_DATABASE_URL` and `FC_DEPLOYMENT_ID`. Startup fails if that database does not become ready. A later query failure does not switch the process back to JSON.

In postgres mode the gameplay port is `PostgresGameplayEconomy`. Rewards, player transfers, `/eco`, buyer sales, auction settlement, trade money, and the clan creation fee post through it. `economy/balances.json` and `economy/transactions.json` are not currency authority and are not rewritten by those operations. Placed-block cells stay in `economy/placed-blocks.json`. Kill counts in this mode stay in `economy/kills.json`.

A mob reward source is `economyInstanceId`, a UUID stored on the mob. Loading an old mob without one generates it once and the next save keeps it. A player-death source is `deathEventId`, created when health reaches 0 and cleared on respawn. A block-break source is a new UUID for that accepted break. Coordinates and `mob-1` are not sources.

Ordinary chat, browse, refresh, pagination, close, selection, and text edits do not need a request id. A client-originated money mutation does. In postgres mode the server rejects a missing or non-UUID `clientRequestId` before money moves for `/pay`, `/eco give`, `/eco take`, `/eco set`, `/eco reset`, buyer sell, auction buy, clan `confirm_create`, and a trade accept that would move money. It does not invent a request id for that packet. A trusted console command gets a new server-owned UUID. Replaying the same client UUID does not move money again. A new UUID is a new intent.

The economic source id is separate. The same mob death still pays once inside one scope if a later request repeats it. The same source id in another scope is a different event.

An auction listing keeps the visible `ah-N` id and a server-owned `economySettlementId` (`crypto.randomUUID()` at create). Relist creates a new listing and a new UUID. An old listing file without the field gets one UUID on load, and that file is saved before a purchase can use it. The purchase source is `AUCTION_PURCHASE` / `economySettlementId`. A refund source is `AUCTION_REFUND` / the same UUID. The buyer id is not part of that source. A second buyer of a listing whose money already committed gets a conflict and does not receive the item. Startup recovery finishes that sale for the buyer recorded by the ledger.

Postgres join prepares the account before the player is published. `preparePlayer` ensures the account, loads the balance, applies the display name, and fills the cache. `playerJoin`, friend presence, buyer overflow, chunk streaming, and the welcome packet run after that. If PostgreSQL is down for that join, the attempt returns a generic temporary error, the player is not left connected, and the process stays up. Already connected players stay connected. Their later money mutations fail closed. No JSON wallet is consulted.

Changing the nickname updates `economy_accounts.display_name` and `updated_at` only, and only in that scope.

`npm run economy:import` requires `--scope anarchy|survival|peaceful`. `--dry-run --file balances.json --scope anarchy` prints deployment, scope, player count, total, min, max, invalid rows, duplicates, and the expected total, and writes nothing. `--apply` also requires `--batch <uuid>` and writes only that scope. The same batch does not apply twice inside the scope. It is not invoked on startup. It does not import into `legacy_global`.

The simulation tick, movement, and inventory clicks do not query PostgreSQL. Admin login does not query it either. Sessions for the private admin listener stay in process memory. Event rewards are tracked promises. `track` consumes a rejection before the promise is stored, so a failed background reward is logged without database text and does not become an unhandled rejection. `WorldInstance.stop()` waits up to five seconds for those promises before closing the pool.

PostgreSQL money and the filesystem cannot share one transaction. Stage 2C keeps a mutable `gameplay_settlements` journal (migration `0006`) plus player `settlementReceipts` in `players.json`. Critical player writes use the same save queue as a full snapshot. Startup recovery runs after the world and plugin JSON load and before the world is READY.

Auction listing create persists a pending row, then the seller inventory removal and receipt, then marks the listing active. A pending row without a receipt is discarded. A purchase uses one `AUCTION_PURCHASE` source. After that source commits, the listing is marked sold before the journal row is inserted, so a second buyer does not take it. A `PREPARED` purchase stays bound to its original buyer. A different buyer is not charged on that row. A `CANCELLED` unpaid attempt is left terminal, and the next purchase uses a new settlement id. The seller listing receipt stays on the id that escrowed the item. Item delivery is all-or-nothing: `full` or `missing` leaves the settlement open and does not insert a partial stack.

Postgres trade writes the `TRADE_SETTLEMENT` payload before either escrow receipt, then one net transfer on `TRADE / settlementId`. Recovery reads stored inventories, including offline players. A missing escrow receipt is not a second copy of that offer. A paid trade is not marked `COMPLETE` until both deliveries are `delivered` or `already`. Once final settlement starts, cancel and disconnect do not return the escrowed items.

A failed buyer credit restores the stack through the inventory receipt only. The trade slot does not keep a second copy. A clan id is reserved and the clan file's counter is saved before the fee debit. Recovery uses that id and does not overwrite a different clan. Contradictory durable state becomes `RECOVERY_REQUIRED` and is not guessed.

A block reward in postgres mode is credited only after a world save that was started for that break. Several breaks share one save. If the process dies before that save, no reward was committed. If the save succeeded and the process dies before the credit, that reward can be lost. That delivery is at-most-once. Ordinary blocks do not enter the barrier. The tick still does not query PostgreSQL.

Unique item instance ids are not part of this stage. Reconciliation stays on demand and does not repair unrelated rows.

## Release

`build:server` keeps `pg` external, same as `ws`. `pack:release` copies the production dependency closure by reading package manifests. The VPS does not run `npm install`. World directories are not part of the release.

## Backups

A consistent copy is `scripts/fc-backup.sh`. It dumps the configured database once with `pg_dump -Fc` while the game units are stopped, and it does not change the schema. World files and the database dump travel in one archive. The env files that hold `FC_DATABASE_URL` stay out of that archive. See `docs/BACKUPS.md`.

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
