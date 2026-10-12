# Stage 3B — unique item locations

Date: 2026-10-12

## Goal

Know where each collectible painting and God Sword physically is, notice when the same UUID is in two independent places, and keep evidence. Do not delete items, do not scan every tick, and do not add a database table.

## Result

`WorldInstance.inspectUniqueItems()` rebuilds the index from the current world. A live player is the only row for that player id. `storedPlayers` is used only after the player has left the live map. Sold, claimed, and relisted auction rows are history. Settlement payloads are not read.

A repeated scan updates one incident. The log keeps at most 400 rows in `plugin-data/identity-incidents.json`. A new auction listing, purchase, trade accept, or buyer sale is refused only when a fresh scan still shows a confirmed duplicate or an item-type conflict. The item and the balance stay where they were.

## Physical holders

Counted: inventory, armor, offhand, cursor, craft grid, portal chest, held returns, a real chest, a real furnace, a server drop, a placed collectible painting, an auction listing in `ACTIVE`, `PENDING_ESCROW`, `CANCELLED`, or `EXPIRED`, an open trade offer, a buyer window, and a buyer return stack.

Not counted: the saved copy of a player who is still in memory, an offline inventory cache plus that same stored inventory, `SOLD` / `CLAIMED` / `RELISTED` listings, settlement journal payloads, and client drop replicas. A painting block state on a block that is not a collectible painting is ignored. The scan walks `blockStates`, chest maps, and furnace maps. It does not walk the world volume and does not generate chunks.

`PENDING_ESCROW` and a trade marked `settling` are transitional. Two stable holders of the same item id are `confirmed-duplicate`. The same UUID on two item ids is `identity-type-conflict`. A stack with no UUID is skipped. The scan does not mint one.

## Checkpoints

Startup runs after Stage 2C recovery. A world save runs one scan after the snapshot is written. `inspectUniqueItems()` and the transfer guard run a fresh scan. The game tick does not.

The index covers one `WorldInstance` and stores that `worldId` on every location. It does not compare Anarchy with Survival, and it does not compare two processes.

## Tests

`tests/server/stage3b-item-location.test.ts` uses `WorldInstance` for the player, chest, furnace, drop, painting, auction, trade, buyer, disconnect, sweep, and restart cases. Fixed id `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` is the conflict id. Confirmed cases leave both copies in place and do not move money. A completed trade, a delivered auction, a cancelled-then-claimed listing, and a relist report one holder. After the chest copy is removed, the same UUID can be traded.

## Validation

Stage 3B file: 8 passed. Stage 3A, Stage 2C, auction, trade, buyer, and painting files run with it: 128 passed before the furnace assertion was added; the Stage 3B file was run again after that and passed. `typecheck`, `typecheck:client`, `typecheck:server`, and import boundaries passed. Client build 10.31 MiB, `assets/index-BEH4sKqC.js`. Server build and production smoke passed (anarchy, survival, peaceful, SIGTERM 0). `git diff --check` passed.

Full Vitest without `FC_TEST_DATABASE_URL`: 27 failed, 3504 passed, 51 skipped, 390 files. One failure was `tick-load-flight` mean time 53–59 ms against a 50 ms limit. That file passed when run alone afterward (3 tests). The other 26 failed files match the previous branch run. PostgreSQL integration: first run 55 passed and 1 failed (`economy-join` display name still `Ada`). That test passed on an immediate re-run. Migrations `0001`–`0006` were applied in the passing files.

`typecheck:sim`: NOT RUN. Manual QA: NOT RUN. GitHub Actions: NOT RUN.

## Known limitations

The guard is on the player auction, trade, and buyer actions. It does not wrap settlement recovery, and a direct service call from a plugin can still move an item. Cross-world and cross-process reconciliation is later work. Stage 3C quantity tracking and the admin panel are not in this stage. The accepted Stage 2C crash window is unchanged.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8`. Parent `5e243c4`. `origin/main` remains `2dd09ee`. Draft PR #129. Not merged.
