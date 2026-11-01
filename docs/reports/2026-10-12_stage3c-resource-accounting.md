# Stage 3C — valuable resource quantities

Date: 2026-10-12

## Follow-up: committed crafts, accepted drops, buyer recovery

A crafting result is recorded only when `takeCraftOutput` or `craftOnceByRecipeId` changes the grid or inventory. The record carries the completed count and the item ids that were actually consumed. A Shift-click that finishes two ruby crafts out of five possible ingredients records two crafts. A cursor that cannot take the result records none.

`spawnHarvest` adds a mining credit only when `spawnDroppedStack` returns true. A cancelled `itemDrop` leaves the mine total unchanged.

A durable buyer sale notes the sink with the settlement id when the payout has landed and the escrow receipt exists. `recoverSales` notes the same id if the process stopped before completion. The resource file is loaded before settlement recovery, so that note is not replaced by the old file. A cancelled unpaid escrow restores the stack and does not sink it. The 500-key dedupe cache is still the bound on exactly-once memory; it is not an infinite history.

The disposable PostgreSQL test sold 16 diamonds (one sink, one payout), restored an unpaid escrow of 8, then recovered a paid sale of those 8 after the accounting file had been rewound to the pre-crash sink of 16. The retried write stored sink 24 once. A second restart left the sink, the balance, and the empty inventory unchanged.

Follow-up validation: `tsc` for the repo, client, and server passed, as did import boundaries and `git diff --check`. Client build `dist/assets/index-C_duKjOB.js`, server build, and production smoke passed. Full Vitest with `FC_TEST_DATABASE_URL` unset: 26 failed, 3523 passed, 52 skipped, 393 files. The 26 names match the previous Stage 3C run. The extra skip is the buyer-recovery file, which runs only with the disposable database. That database run passed 58 tests and skipped 1, including the new recovery test, with migrations `0001`–`0006`. `typecheck:sim`, manual QA, and GitHub Actions were not run.

## A. Git

- `origin/main`: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- Feature HEAD before Stage 3C: `7f9cec3c89bffa485202389431c62e2c044d0f6e` (36 ahead, 0 behind)
- Stage 3C implementation: `264451a72043daf816a5541dd6f6b3430039c536`
- Follow-up parent: `dca42c38a03747a7793b84384e22adc64d6508a6` (38 ahead, 0 behind)
- After the committed-craft follow-up, the branch is 39 ahead of `origin/main` and 0 behind
- `origin/main` did not move during this stage
- Draft PR **#129**. Not merged

## B. Why this is not a UUID ledger

Stage 3A ids exist only for the 20 collectible paintings and `god_sword`. Diamonds, ingots, and the other monitored stacks merge, split, and stack to 64. One UUID per diamond would change `maxStack`, merging, and every transfer. A player's inventory gaining 64 diamonds is often the same 64 moving from a drop, a chest, an auction escrow, or another player. Stage 3B already lists unique-item holders. It does not add or subtract stack counts, so it cannot say whether the world's diamond supply changed.

## C. Architecture

`MONITORED_RESOURCE_IDS` in `server/resources/monitored.ts` is the only watch list: `diamond`, `gold_ingot`, `ruby_ingot`, `titanium_ingot`, and `iron_ingot`. Iron is included because the ruby recipe consumes three iron ingots.

`countMonitoredResources` sums those stacks from the Stage 3B holder walk: live players (inventory, armor, offhand, cursor, craft, portal chest, held returns), offline `storedPlayers` only when that id is not live, real chests and furnaces whose `knownBlockId` matches, server drops, holding auction listings, open trade offers, buyer windows, and buyer returns. A live player replaces that player's stored row. Sold, claimed, and relisted listings and settlement payloads are not holders. An unknown block increments unresolved coverage and is not given a fictional count. The walk does not generate chunks.

`ResourceLedger` is observational. The first `observe` with no saved baseline stores the snapshot and does not call it unexplained. After that:

`expected = baseline + minted + transformedOut - transformedIn - sunk`

`unexplained = max(0, current - expected)`

Status is `balanced`, `explained-change`, `unexplained-increase`, or `incomplete-coverage` when unresolved holders are present and the gap is positive. A closed gap drops that item's anomaly. Nothing is deleted, banned, or charged.

Minted sources: accepted survival harvest (`mine:<rewardEventId>:<itemId>`, so a later scan does not credit it again), and only after the drop entity is spawned. `/give` and plugin `grantItems`, Creative cursor replacement, boss loot that actually spawned, a detached-block drop that actually spawned, and an event chest's placed slots keyed by the event id are the other mints. Smelting records one completion. Crafting records the committed input and output counts, including every successful Shift-craft. A durable buyer sale sinks with its settlement id. Ordinary slot, chest, drop, death, trade, and auction moves are not events. The snapshot already sees both sides.

Checkpoints are startup after world restore, world save, and `inspectValuableResources()`. The 20 TPS tick does not scan. Persistence is `plugin-data/resource-accounting.json`. A failed write stays pending and retries at the next checkpoint. An unchanged ledger does not rewrite the file. Caps: 200 anomalies, 100 recent events, 500 source keys.

## D. Source coverage

| Source | Tracked? | Boundary | Limitation |
| --- | --- | --- | --- |
| Diamond ore, correct tool, Survival | Yes | `breakBlock` after the drop is spawned | Creative, a cancelled break, and a wooden pickaxe do not credit |
| Gold ore smelt | Yes | `tickFurnaces` once, when the output slot changes | One completion, not one record per burn tick. Gold ore itself is not a monitored unit |
| Titanium ore smelt | Yes | same | Titanium ore is not a monitored unit |
| Iron ore smelt | Output only | same | Iron ore is not monitored. The ingot is a transformation output |
| Ruby craft | Yes | successful `craft_recipe` / result click | 1 diamond + 3 gold + 3 iron become 1 ruby |
| Diamond / gold / iron block craft | Input only | same recipe path | The block is not a monitored unit and is not reversed |
| Tool and armor craft | Input only | same | The equipment is a sink of the ingot or diamond, not a second unit |
| `/give` and plugin give | Yes | `grantItems`, including overflow drops | Rejected grants are not noted |
| Creative catalog click | Yes | server inventory action after the cursor is replaced | The catalog preview is not a source |
| Mega-zombie loot | Yes | `scatterBossLoot` after a drop is accepted | A cancelled drop event is not credited. A second call would credit again; the boss path clears `rewardPending` first |
| Event chest | Yes | `placeAt` credits `chestSlots` once per event id | Reapplying a vanished chest is not credited again |
| Explosion ore | No | server blasts do not roll ore loot | A blast can remove a container from the count with no sink record |
| Drop despawn / lava burn | No | not hooked | This is a decrease. It does not create an unexplained increase |
| Farming | No | farming drops are not in the watch list | — |

## E. Transfers

Pickup, a manual drop, death drops, chest and portal-chest moves, trade, auction listing and purchase, and `heldReturns` leave the world total unchanged because the snapshot counts the destination. An auction receipt is a state transition, not 64 new diamonds. A failed escrow save that puts the stack in `heldReturns` is the same stack. A buyer sale removes the stack and records a sink. Recovery payloads are not extra holders.

## F. Conservation examples

These numbers come from `tests/server/stage3c-resources.test.ts`.

1. Survival iron pickaxe breaks one diamond ore. The drop count is 1. Diamond `current` 1, `unexplained` 0, one `mine` event of quantity 1. A second inspect does not add another mine event. Creative break, wooden-pickaxe break, and a cancelled break leave `current` at 1.
2. `/give diamond 64` to Ada, then a completed trade to Bob, then an auction purchase back. Diamond `current` stays 64 and `unexplained` stays 0. There is no mine event. Bob's inventory is 64 after the trade. Ada's inventory is 64 after the purchase. The sold listing is not a second holder.
3. One gold ore and one titanium ore finish a furnace tick from cook time 199. Gold ingot `current` 1, titanium ingot `current` 1, both `unexplained` 0. Then `/give` of 1 diamond, 3 gold ingots, and 3 iron ingots, and recipe `ruby_ingot`. Ruby `current` 1. Diamond `current` 0. Gold `current` 1 because the furnace still holds the smelted ingot and the crafted 3 were consumed. Iron `unexplained` 0. A following `/give diamond 9` and `diamond_block` leaves diamond `current` 0 and one `diamond_block`.
4. `/give diamond 16`, drop, pickup, and death all keep diamond `current` 16. That stack is then the only `heldReturns` entry while the inventory is full of cobblestone: still 16. `/give diamond 4` and a buyer sale remove those 4. Diamond `current` 16, `expected` 16, one sink of quantity 4. The grant count does not grow on the sale. The balance increases. The held stack has no `itemInstanceId`.
5. `/give diamond 64`, then the player-save for the auction escrow is rejected after the original slot has changed. `heldReturns` is one stack of 64 diamonds. `current` 64, `unexplained` 0, one server-grant, balance unchanged, no active listing.
6. A direct `setSlot` of 64 diamonds with no source: `current` 64, `unexplained` 64, status `unexplained-increase`. The stack is still there. Clearing it and `/give diamond 64` makes `unexplained` 0. One extra injected diamond then makes `current` 65 and `unexplained` 1.

An existing 10-diamond save, with the accounting file removed, restarts as baseline 10, status `balanced`. `/give diamond 5` makes `current` 15. A chest at `-480, 70, -496` with 7 diamonds is counted after restart while its chunk stays unloaded: `current` 22. Replacing that block with stone drops the count to 15. An unknown chest at `9100, 70, 9104` with 9 diamonds is not counted and does not generate its chunk. Three extra diamonds in the inventory make status `incomplete-coverage` and `unexplained` 3. Inventory count is 18.

Boss loot of 7 diamonds and 9 gold ingots is `unexplained` 0. The event chest's actual diamond count is added on top of those 7. Cleanup returns diamond `current` to 7.

## G. Tests

`tests/server/stage3c-resources.test.ts`, 11 passed. Assertions are on quantities, source kinds, and anomaly status, not on a hand-incremented counter. The injected stack is not removed. Resource stacks in these tests have no `itemInstanceId`. Money is unchanged for the mine, grant, transfer, and failed-auction cases, and increases on the buyer sale.

A save that throws once for `resource-accounting` does not throw from `inspectValuableResources`. The next inspect writes `minted.diamond` 64. A later unchanged inspect writes the file 0 times. Three further world saves leave the file the same length. A file with 250 anomalies, 150 recent events, and 600 source keys reloads at 200 anomalies, at most 100 recent events, and at most 500 keys.

## H. Performance

No new PostgreSQL query was added on the tick, on an inventory click, on pickup, or on a smelt completion. The quantity walk runs at startup, on world save, and on `inspectValuableResources()`. It walks existing player, container, drop, auction, trade, and buyer records. It does not iterate world coordinates or generate chunks.

Block breaking adds a map of the drops it already spawned, then one in-memory note for a monitored id. Furnace completion calls one in-memory note after the slots change. A normal transfer does not note a source. JSON is written only when the ledger is dirty, the anomaly signature changed, or a previous write failed.

Memory is the five resource totals, at most 100 recent events, 200 anomalies, and 500 dedupe keys. No timings were taken from the performance harness. The statements above are from the call sites, not from a benchmark.

## I. Validation

| Command | Result |
| --- | --- |
| `npx vitest run tests/server/stage3c-resources.test.ts` | PASS, 11 tests |
| Stage 3C plus Stage 3B, Stage 3A, Stage 2C return/follow-up/final-gaps/auction-escrow, furnace/crafting, drops, auction, trade, buyer, inventory, mining, fs world store, world events | PASS, 28 files, 269 tests |
| `npx tsc --noEmit` | PASS |
| `npx tsc --noEmit -p tsconfig.client.json` | PASS |
| `npx tsc --noEmit -p tsconfig.server.json` | PASS |
| `node scripts/check-import-boundaries.mjs` | PASS |
| `npm run build` | PASS, `dist/assets/index-DxGPq4U5.js` |
| `npm run build:server` | PASS |
| `npm run smoke:server:prod` | PASS, anarchy, survival, and peaceful |
| `git diff --check` | PASS |
| `npx vitest run` with `FC_TEST_DATABASE_URL` unset | 26 failed, 3520 passed, 51 skipped, 392 files |
| PostgreSQL integration on disposable `fc_foundation_test` | PASS, 57 passed, 1 skipped, 7 files, migrations `0001`–`0006` applied |
| `npm run typecheck:sim` | NOT RUN |
| Manual QA | NOT RUN |
| GitHub Actions | NOT RUN |

The 26 full-suite failures are the existing client and combat files: arrow visuals, classic combat, fence jump, menu screenshot, god-sword texture, SFX pack, remote breaking overlays, ui-main, god-sword mob, pet-hit, and bow draw. `auto-mine` and `tick-load-flight` did not fail in this run. The previous Stage 3B follow-up full run was 27 failed, 3508 passed, 51 skipped, 391 files, and `auto-mine` failed there. That difference is the new 11 tests plus that one previously failing test passing this time. It is not a claim that the flake is fixed.

## J. Limitations

Correctness gaps that remain on purpose: explosion container loss and drop despawn are unrecorded decreases. Reapplying a vanished event chest is not credited again, so a refill can look unexplained. Ore blocks, storage blocks, and equipment are not convertible back into the monitored ingot. Gold, titanium, and iron ore are not themselves counted. A furnace completion is trusted because the server tick is the only caller.

Stage 2C still has the accepted crash window between a filesystem write and process death. This stage does not add a filesystem transaction and does not rerun settlements.

Stage 3B still guards only the WorldInstance auction, trade, and buyer paths. A direct service call is not guarded. The index is one world. Those limits are unchanged. Stage 3C does not copy the UUID transfer block onto stack counts.

Stage 4 admin login, Stage 5 admin UI, and Stage 6 deployment reconciliation are not started.

## K. Verdict

1. The five watched ids live in one list. Yes.
2. An existing save becomes a baseline, not an unexplained mint. Yes.
3. An accepted survival diamond drop is a mine source, and a rejected break is not. Yes.
4. Gold and titanium smelting are one transformation each. Yes.
5. Ruby crafting consumes the inputs and explains the ruby. Yes.
6. `/give`, plugin give, and a Creative click are authorized mints, with no resource UUID. Yes.
7. Slot, cursor, chest, portal chest, drop, pickup, and death moves do not change the world total. Yes.
8. Trade, auction purchase, and a failed escrow return are not mints. A buyer sale is a sink. Yes.
9. An offline player is counted from `storedPlayers` once. Yes.
10. A distant saved chest is counted without generating its chunk. An unknown block is incomplete coverage. Yes.
11. A stack inserted with no source is `unexplained-increase` for that item and quantity. Yes.
12. Explosion loss, despawn, and event-chest reapply are named gaps. Yes.
13. Anomaly rows are capped, and a failed write is retried at the next checkpoint. Yes.
14. The ledger does not remove or rewrite inventories. Yes.
15. The tick does not scan the world and does not add a SQL query. Yes.
16. Stage 3C is ready for an independent read of this branch. It is not a proof that every diamond in history was legitimate. Yes.
