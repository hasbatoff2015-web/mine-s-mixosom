# Gameplay Megacoin cutover (Stage 2B)

## Goal

Make PostgreSQL the only Megacoin authority when `FC_ECONOMY_BACKEND=postgres`, and fix two Stage 2A audit findings: economic source ids must not be runtime mob counters, and account display names must follow nicknames. Do not dual-write. Do not claim item-plus-money crash atomicity.

## Result

Unset `FC_ECONOMY_BACKEND` stays on the JSON `EconomyService`. `postgres` requires a database and routes rewards, transfers, admin economy commands, buyer sales, auction settlement, trade money, and clan fees through `PostgresGameplayEconomy`. A failed mutation returns a failure and does not update the read cache. JSON balance files are not rewritten in that mode.

## Implemented

- `economyInstanceId` on mobs, persisted, generated once for old snapshots.
- `deathEventId` on survival state for one death, cleared on respawn.
- `rewardEventId` on an accepted player block break.
- `clientRequestId` on chat and on auction, clan, buyer, and trade actions.
- Display-name update with no ledger row.
- Explicit import: `npm run economy:import`.
- Kill counts in postgres mode live in `economy/kills.json`.

## Architecture decisions

- One port, two backends. Legacy methods return results immediately. Postgres methods return promises. The tick does not await them. Commands and UI actions do, or track the promise and publish only after it settles.
- PvP 10% is `transferFraction` inside one transaction after the victim row is locked.
- Request identity and source identity stay separate. Idempotency wraps the money call in the same transaction.
- Zero-share PvP still records the source so a later retry cannot pay.
- Stage 2C still owns crash recovery between an item mutation and a committed transfer.

## Tests

`npm run typecheck`, `typecheck:client`, `typecheck:server`, and `check:boundaries` passed. `typecheck:sim` fails with the same 9 errors as `origin/main` `2dd09ee`.

Client build is 10.31 MiB. `build:server`, `check:size`, and `smoke:server:prod` passed with the database disabled. `git diff --check` was clean.

Real PostgreSQL on `fc_foundation_test`: foundation 12 passed, Megacoin ledger 16 passed, gameplay cutover 12 passed.

Full Vitest without `FC_TEST_DATABASE_URL`: 26 failed, 3443 passed, 41 skipped (379 files). The 26 failed names match the same-machine `origin/main` run (26 failed, 3352 passed, 1 skipped). The extra skips are the three PostgreSQL integration files plus one pre-existing lifecycle skip.

Manual browser QA was not run.

## Known issues

The 26 full-suite failures match current `origin/main`. `typecheck:sim` fails there for the same DOM and Vite virtual-module errors. A crash between an item edit and a committed transfer can still lose or duplicate the item side. That is Stage 2C, not a second currency authority.

## Deferred

Stage 2C: crash-atomic item and money for auction, trade, buyer, and clan creation. No automatic reconciliation repair. No merge.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8`. Draft PR #129.
