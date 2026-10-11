# Megacoin ledger foundation (Stage 2A)

## Goal

Stop the client from stamping one inventory intent twice, and add a PostgreSQL Megacoin account plus an immutable ledger. Do not switch gameplay onto that ledger.

## Result

`GameUI.stampInventorySubmission` is the only production stamp. `Game.sendInventoryAction` forwards the stamped message. A remembered chest revision is not attached to inventory or crafting-table actions.

Migration `0003` creates `economy_accounts`, `economy_operations`, and `economy_ledger`. `MegacoinService` can create an account, credit, debit, transfer, adjust, page history, and reconcile. The synchronous JSON `EconomyService` is still what rewards, auction, trade, clans, the buyer, and `/eco` call. There is no dual-write and no automatic import of JSON balances.

## Implemented

- Inventory composition tests send a crafting-table, inventory, chest, furnace, and portal-chest action through the same callback `Game` uses, with `online.containerRevision` still set.
- `0003` uses the existing advisory-lock runner and checksums. `0001` and `0002` are untouched.
- Accounts use `BIGINT`. The opening balance is 100 and is also an `INITIAL` ledger leg of +100, written once.
- Transfers lock both accounts in player-id code-unit order and post two legs in one transaction.
- `setBalance` appends the difference. A zero-delta set writes no leg and does not consume a source identity.
- The same non-null `(source_type, source_id)` returns the original operation when the player, amount or target, kind, and reason match. A different result is `EconomySourceConflictError`.
- History pages with `limit` and a `before` or `after` cursor. Storage is not truncated. Cursor timestamps keep microsecond text.
- Reconciliation reports `balance`, `ledgerTotal`, and `matches`. It does not repair and does not ban.
- `validateEconomyJsonImport` checks a future import list and does not open a database connection.
- `IdempotencyService` remains the request store. `operation_id` and `entry_id` are different identities. `MegacoinService` accepts the caller's transaction so Stage 2B can commit them together. This pass does not wire that call.

## Changed files

`src/ui/GameUI.ts`, `src/core/Game.ts`, `src/net/inventoryIntent.ts`, `server/db/migrationManifest.ts`, `server/economy/*`, `tests/inventory-intent-composition.test.ts`, `tests/online-gameplay-polish.test.ts`, `tests/server/inventory-hardening.test.ts`, `tests/server/megacoin.test.ts`, `tests/server/megacoin.integration.test.ts`, `tests/server/postgres-foundation.integration.test.ts`, `tests/server/migration-manifest.test.ts`, `docs/ARCHITECTURE.md`, `docs/POSTGRESQL.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`.

## Architecture decisions

- One stamp owner. The open window knows whether a container revision belongs on the message. Regenerating `requestId` in `Game.ts` was the bug.
- Gameplay stays on `server/services/economy.ts`. The PostgreSQL core is not constructed from `WorldInstance`.
- No dual-write. Two authorities would make a failed second write ambiguous.
- Ledger and operations are append-only in the database. Accounts are mutable because the balance is the current total, explained by the ledger.
- A zero-delta set is success with `operation: null`. It is not an economic event.
- Request lookup refuses more than 100 operations for one request id instead of returning a silent prefix.
- Disabled database: `MegacoinService` throws `DatabaseDisabledError`. JSON economy still starts at 100.

## Tests

Focused Vitest, including real PostgreSQL: 30 files, 257 passed. That run covered inventory composition, inventory hardening and revisions, database config, disabled mode, lifecycle, redaction, migration manifest, admin audit, admin actions, idempotency, JSON economy, auction, trade, buyer, clan, and bow PvP timing.

Real PostgreSQL 16, database `fc_foundation_test`, private schema dropped afterward:

- `tests/server/postgres-foundation.integration.test.ts`: 12 passed
- `tests/server/megacoin.integration.test.ts`: 16 passed

The Megacoin run checked migration `0003` apply-once and checksum rejection, the opening 100 and its ledger leg, credit, debit, insufficient rollback, max balance, atomic transfer with two legs, adjustment up and down, zero-delta set, append-only `UPDATE` / `DELETE` / `TRUNCATE`, source replay and conflict, history paging in both cursor directions, concurrent account creation, concurrent withdrawals, concurrent credit and debit, two transfers that share a player, and eight rounds of opposite transfers.

`npm run typecheck`, `typecheck:client`, `typecheck:server`, and `check:boundaries` passed after annotating one test grid as `Array<ItemStack | null>`. `typecheck:sim` fails with the same 9 errors as `origin/main` `2dd09ee` (`document` / canvas in `voxelVisuals.ts` and `TextureAtlas.ts`, plus the Vite skin-hash module).

`npm run build` produced a 10.31 MiB client. `build:server`, `check:size`, and `smoke:server:prod` passed. Anarchy, survival, and peaceful came up without `FC_DATABASE_URL`, answered `/status`, and exited 0 on SIGTERM with the world lock removed. `git diff --check` was clean.

Full Vitest without `FC_TEST_DATABASE_URL`: 26 failed, 3440 passed, 29 skipped (377 files). The 29 skips are 16 Megacoin integration tests, 12 foundation integration tests, and 1 pre-existing lifecycle skip. The 26 failed names are the same 26 as a same-machine run of `origin/main` (3352 passed, 26 failed, 1 skipped, 359 files). A first full run that overlapped the production build also failed `tick-load-flight` at about 51–52 ms against a 50 ms mean. That file passed alone (3 tests) and did not fail in the isolated full run.

## Visual QA

Not run. The inventory change is a wire-message composition fix. No new HUD. The browser was not opened.

## Performance

No database query was added to the 20 TPS tick or to an inventory click. The ledger is queried only when `MegacoinService` is called. History reads one page, not the whole account.

## Known issues

The 26 full-suite failures match current `origin/main` `2dd09ee`. They include arrow visuals, classic combat presentation, fence jump height, the menu screenshot helper (`PIL` is not installed), the god-sword texture generator, the SFX pack count, remote breaking overlays, one UI source string for a click `submitAction` call that `origin/main` also does not contain, god-sword mob spend, pet hit timing, and bow draw ticks. `typecheck:sim` fails on `origin/main` for the same DOM and Vite virtual-module errors. Database backups and a live cutover are not part of this change.

## Deferred

Stage 2B: cut gameplay callers over, decide JSON balance import, and compose `IdempotencyService.execute` with `MegacoinService`. Auction, trade, buyer, clans, and PvP rewards stay on JSON until that pass. No admin HTTP.

## Next work

Do not start Stage 2B until this ledger has been audited. Do not merge PR #129.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8`. Draft PR #129. Not merged.
