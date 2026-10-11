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

`src/ui/GameUI.ts`, `src/core/Game.ts`, `src/net/inventoryIntent.ts`, `server/db/migrationManifest.ts`, `server/economy/*`, `tests/inventory-intent-composition.test.ts`, `tests/server/megacoin.test.ts`, `tests/server/megacoin.integration.test.ts`, `tests/server/postgres-foundation.integration.test.ts`, `tests/server/migration-manifest.test.ts`, `docs/ARCHITECTURE.md`, `docs/POSTGRESQL.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`.

## Architecture decisions

- One stamp owner. The open window knows whether a container revision belongs on the message. Regenerating `requestId` in `Game.ts` was the bug.
- Gameplay stays on `server/services/economy.ts`. The PostgreSQL core is not constructed from `WorldInstance`.
- No dual-write. Two authorities would make a failed second write ambiguous.
- Ledger and operations are append-only in the database. Accounts are mutable because the balance is the current total, explained by the ledger.
- A zero-delta set is success with `operation: null`. It is not an economic event.
- Request lookup refuses more than 100 operations for one request id instead of returning a silent prefix.
- Disabled database: `MegacoinService` throws `DatabaseDisabledError`. JSON economy still starts at 100.

## Tests

Measured counts are written into this section after the validation run on this commit.

## Visual QA

Not run. The inventory change is a wire-message composition fix. No new HUD.

## Performance

No database query was added to the 20 TPS tick or to an inventory click. The ledger is queried only when `MegacoinService` is called. History reads one page, not the whole account.

## Known issues

The full Vitest failures that already exist on `origin/main` are unchanged by this pass unless the validation run shows a new one. `typecheck:sim` fails on `origin/main` for the same DOM imports.

## Deferred

Stage 2B: cut gameplay callers over, decide JSON balance import, and compose `IdempotencyService.execute` with `MegacoinService`. Auction, trade, buyer, clans, and PvP rewards stay on JSON until that pass. No admin HTTP.

## Next work

Do not start Stage 2B until this ledger has been audited. Do not merge PR #129.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8`. Draft PR #129. Not merged.
