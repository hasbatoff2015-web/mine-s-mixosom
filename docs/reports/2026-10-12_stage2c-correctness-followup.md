# Stage 2C correctness follow-up

Small fixes to the existing settlement journal. Migration `0006` was not edited. Stage 3 was not started. PR #129 stays draft.

## A. Git

- `origin/main`: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- HEAD before: `c68451a3f67044296a507a53e1677396b1bbfca2`
- Branch: `cursor/admin-antidupe-postgres-foundation-26a8`
- Ahead of main after this follow-up: 28 commits, 0 behind, once the report commit is pushed
- PR #129 remains an open draft

## B. Root causes

### Trade journal order

`TradeService.completeDurable` saved player A's escrow receipt before `settlements.begin`. A crash in that window removed A's offer from the saved inventory and left no journal payload. The journal row is now inserted first, with both original offers and both deliveries. Escrow receipts come after. Recovery of an unpaid `PREPARED` or `ESCROW_DURABLE` row restores a side only when that side's escrow receipt exists. A missing receipt is not a second copy, because `unsavedOfferStacks` is still merged into the saved inventory.

### Offline trade recovery

`recoverTrades` used `runtime.inventory`, which is the online player map. A paid trade could be marked `COMPLETE` when `give` returned early. Recovery now calls `ItemDurability.deliverAll` / `restoreAll`. `WorldInstance` resolves those through `inventoryFor` and `receiptsFor`, which read stored players. `full` and `missing` leave the phase unchanged and do not call `settleNet` again.

### Trade cancellation race

`complete` held `withLocks`, but `cancel`, `disconnect`, and offer edits did not. `session.settling` is set synchronously before the first await. While it is set, `putItem`, `returnItem`, `setMoney`, `ready`, `accept`, `cancel`, and `disconnect` refuse, and the last two do not call `returnOffers`. A failed payment clears an offer slot only when that side's escrow receipt exists, restores through that receipt, and drops the session only after both restores succeed. A `full` or `missing` restore keeps `settling` set.

### Buyer sale failure

`sellDurable` assigned the sold stack back to `tradeSlot` and also called `restore`, which inserts it into the inventory. `durablePlayerRecord` would then merge `tradeSlot` and write a second copy. The failure path now clears `tradeSlot` and restores only through the receipt. If the receipt never landed, the stack goes back to `tradeSlot` alone. Cancel happens only after `restored` or `already`. `full` and `missing` stay open. An escrow save that throws puts the stack back on `tradeSlot` when the receipt was rolled back.

### Auction delivery

`recoverPurchases` ignored `deliver`'s result and could mark `COMPLETE` after `full` or `missing`. `Inventory.add` can keep a remainder. `deliverAll` clones the inventory, inserts every stack into the clone, and copies that clone back only when every add fits. Recovery completes only after `delivered` or `already`, walking legal phases instead of jumping. After money commits, the listing is marked `SOLD` and persisted before the journal insert, so a second buyer does not take it.

### Clan id reservation

`createDurable` read `clan-${nextClanId}` and incremented only in `finishCreate`. Two overlapping creates reserved one id. The id is now incremented, and the clan file counter is saved, before the first await. Recovery raises `nextClanId` from open payloads and uses the payload id. `finishCreate` refuses to replace a clan that belongs to a different settlement. That case becomes `RECOVERY_REQUIRED`.

## C. Durability design

Trade escrow boundary: the `TRADE_SETTLEMENT` row in `PREPARED`, then each player's `trade:<id>:escrowed` receipt in the same player save that omits the offer. Before the receipt, the saved inventory owns the offer. After it, the journal does.

Trade recovery boundary: for a paid trade, `trade:<id>:delivered:<playerId>` plus the saved inventory that contains every incoming stack. `COMPLETE` is after both sides are `delivered` or `already`.

Buyer failure boundary: one of inventory-plus-cancelled-journal, or receipt-plus-open-journal. Not both inventory and `tradeSlot`.

Auction delivery boundary: the buyer receipt `auction:<id>:delivered` and a saved inventory that accepted the whole stack. The listing stays `SOLD` to the original buyer while delivery is unfinished.

Clan id boundary: the immutable payload `clanId`, plus `nextClanId` in `clans.json` saved before the debit. The clan record is written only in `finishCreate`.

`WorldInstance.itemDurability` rolls the in-memory inventory and receipt back when `savePlayersCritical` throws. A receipt is not left in memory after a failed player save.

## D. Crash matrix

Reload means a new service, inventories deserialized from the saved player JSON, and the same settlement rows. Players are offline in the trade reload. Results are from `tests/server/stage2c-followup.test.ts`.

| Boundary | Persisted state | Restart | Money | Items | Phase | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Trade after `PREPARED`, before escrow A | Journal only. Saved inventory still has both offers | Unpaid recovery | No transfer | Counts stay 1 and 1 | `CANCELLED` | Pass |
| Trade after escrow A, before escrow B | A's receipt, A's offer absent. B has no receipt and the sword in the save | Unpaid recovery | No transfer | A diamond restored to 1. B sword stays 1 | `CANCELLED` | Pass |
| Trade after both escrows, before money | Both receipts, both offers absent. Phase `ESCROW_DURABLE` | Unpaid recovery | No transfer | Each owner gets their own stack back | `CANCELLED` | Pass |
| Trade after money, before phase advance | Escrow receipts. Phase still `ESCROW_DURABLE`. `settleNet` already called | Paid recovery | Not called again | Sword to A, diamond to B | `COMPLETE` | Pass |
| Trade after money phase, before delivery | Phase `MONEY_COMMITTED`. Both offline | Paid recovery, then again | Not called again | 1 sword and 1 diamond, unchanged on the second pass | `COMPLETE` | Pass |
| Trade after delivery to A | A's delivery receipt and sword. B has no diamond | Paid recovery, then again | Not called again | B gains 1 diamond. A's sword stays 1 | `COMPLETE` | Pass |
| Trade recipient full, then missing | B's inventory is 36 cobblestone stacks, then the inventory is removed | Paid recovery | Not called again | No diamond inserted. Cobblestone stacks unchanged. Phase stays open until one slot is freed, then exactly 1 diamond | Not `COMPLETE`, then `COMPLETE` | Pass |
| Trade cancel and disconnect during `settleNet` | Settlement in flight | In process | One net transfer after release | Totals stay 1 diamond and 1 sword. Mutations while waiting fail | Completes after release | Pass |
| Trade payment `ok: false` | Escrow then restore | Reload | One failed attempt | Original diamond and sword, one each. Session dropped | `CANCELLED` | Pass |
| Buyer credit `ok: false` | Receipt removed after restore | Reload of saved JSON | No credit | 2 diamonds, metadata `origin: sale`, `tradeSlot` null | `CANCELLED` | Pass |
| Buyer credit throws after receipt | Receipt saved, inventory empty | New `BuyerService` plus reloaded JSON | No credit | Restored count 2. Second recovery stays 2 | `CANCELLED` | Pass |
| Buyer after credit, before `COMPLETE` | Receipt, inventory empty | Reload | Not credited again | Count stays 0 | `COMPLETE` | Pass |
| Buyer restore does not fit | Receipt, inventory full of cobblestone | Reload | No second credit | Count stays 0 until one slot is freed, then 2 with metadata | Stays `PREPARED`, then `CANCELLED` | Pass |
| Auction paid, delivery does not fit | Listing `SOLD`. 63 diamonds and no empty slot | Reload | One settle | Stays 63. After one free slot, 65. No partial stack | Not `COMPLETE`, then `COMPLETE` | Pass |
| Auction paid before journal insert | Listing `SOLD`. No settlement row | Reload | One settle. Rival buy does not settle | Buyer receives 2 | `COMPLETE` | Pass |
| Auction delivery saved, before `COMPLETE` | Receipt and 2 diamonds. Phase `DOMAIN_DURABLE` | Reload, then again | No second settle | Stays 2 | `COMPLETE` | Pass |
| Auction partial capacity | 63 diamonds, every other slot full | `deliverAll` of 2 | None | Stays 63. Saved file bytes unchanged. No receipt | n/a | Pass |
| Two clan creates overlapped on withdraw | Two payload ids | Reload of `clans.json` | One debit each | Clans `clan-1` Ada and `clan-2` Bob. Next create is `clan-3` | Both `COMPLETE` | Pass |
| Clan fee committed, clan JSON absent | Payload `clan-1`, phase `MONEY_COMMITTED`, no clan record | Reload | Recovery does not debit. Next create debits once for a new clan | `clan-1` owned by Ada. Next id is `clan-2` | `COMPLETE` | Pass |
| Reserved id already belongs to another clan | Ada owns `clan-1` with no settlement. Bob's journal also says `clan-1` | Recovery twice | No extra debit | Ada remains the only owner | `RECOVERY_REQUIRED` | Pass |

Zero-money and nonzero trades are both in the trade rows (`delta` 0, 25, 40, and 15/15). Metadata and durability on the iron sword are asserted after restore and after delivery.

## E. Item conservation

Representative totals are inventory counts after deserializing the saved player JSON.

- Unpaid trade before any receipt: Ada diamond 1 and Bob sword 1 before recovery, and the same after. The live offer slots are not added again.
- Escrow only on Ada: saved Ada diamond 0 becomes 1. Saved Bob sword stays 1, not 2.
- Paid trade, both offline: 0 and 0 become Ada sword 1 and Bob diamond 1. The second recovery stays there.
- One delivery already saved: Ada sword stays 1 while Bob diamond goes from 0 to 1.
- Full recipient: Bob diamond stays 0 and every cobblestone stack stays 64. After one empty slot, Bob diamond is 1.
- Failed buyer credit and thrown credit: diamond count is 2, one stack, metadata kept, `tradeSlot` empty.
- Paid buyer credit: diamond count stays 0 across recovery.
- Auction stack of 2 against 63 diamonds and no free slot: 63, then 65 after space exists. That is the original 63 plus one full stack of 2, not two copies of the purchase.
- Auction crash after the delivery receipt: 2 before recovery and 2 after.

No tested path left a stack in both the normal inventory and the trade slot, or in both an offer slot and a restored inventory, after the saved file was reloaded.

## F. Performance

Ordinary tick, movement, and an ordinary inventory click still do not query the economy database. There is no per-tick settlement scan. Zero-reward block breaks are unchanged.

Successful postgres trade: 1 `begin`, 3 `advance` calls (each reads then transitions), 1 `settleNet`, and 4 critical player saves (escrow A, escrow B, delivery A, delivery B).

Successful auction purchase: 1 `settle`, 1 `begin`, 3 `advance` calls, 1 buyer delivery save, and 2 listing JSON writes (sold, then domain).

Successful buyer sale: 1 `begin`, 1 deposit, 2 `advance` calls plus the read before the final advance, and 1 escrow save.

Successful clan create: 1 clan JSON write for the reserved counter, 1 lookup, 1 `begin`, 1 withdraw, 2 `advance` calls, and 1 clan JSON write for the record.

Recovery runs at startup, not on a timer. A full inventory stays unresolved until the next startup recovery. This follow-up does not add a join retry.

## G. Validation

Local only. `gh run list` for this branch returned no GitHub Actions runs.

| Command | Result |
| --- | --- |
| `npx vitest run tests/server/stage2c-followup.test.ts tests/server/stage2c-auction-escrow.test.ts tests/server/trade.test.ts tests/server/buyer.test.ts tests/server/clan.test.ts tests/server/auction.test.ts` | PASS, 94 tests, before the final cast-only test edit |
| `npx vitest run tests/server/stage2c-followup.test.ts` | PASS, 22 tests, including the thrown buyer credit |
| `npm run typecheck` | PASS after test ports were cast through `unknown` |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run typecheck:sim` | FAIL, exit 2. Nine errors: `document`, `HTMLCanvasElement`, `HTMLImageElement`, `Image`, `CanvasRenderingContext2D`, `ImportMeta.env`, `virtual:player-skin-content-hashes`. Same set as the previous main baseline. Not changed here |
| `npx vitest run` with `FC_TEST_DATABASE_URL` unset | 26 failed, 3476 passed, 51 skipped, 386 files. Previous follow-up baseline on this branch was 26 failed, 3454 passed, 51 pending, 385 files. Passed count rose by the 22 new tests. The 26 failure names are the same set recorded against `origin/main` `2dd09ee` in `docs/reports/2026-10-12_stage2c-settlement-journal.md`. Main was not executed again in this follow-up |
| PostgreSQL integration files plus the follow-up and migration manifest, against `fc_foundation_test` | PASS, 78 tests, 0 failed. Logs show migrations `0001` through `0006` |
| `npm run build` | PASS. Production build 10.31 MiB |
| `npm run build:server` | PASS |
| `npm run check:size` | PASS, 10.31 MiB |
| `npm run smoke:server:prod` | PASS. Anarchy, survival, and peaceful SIGTERM exit 0 |
| `git diff --check` | PASS |
| Manual gameplay | NOT RUN |
| GitHub Actions | NOT RUN. No workflow runs listed for the branch |

The 26 local failures are arrow visuals, classic combat presentation, fence jump, menu screenshot (`PIL` missing), god-sword texture, SFX pack, remote breaking overlays, UI main routing, god-sword mob, pet hit timing, and bow draw. None are in the settlement files.

## H. Known limitations

Correctness still open, outside the six fixes:

- A player save that fails is rolled back in `WorldInstance.itemDurability`. That rollback was not driven by a throwing filesystem in this run.
- A full inventory stays unresolved until the next process startup. There is no join hook and no tick poll.
- Restart coverage reloads serialized inventories and settlement rows. It does not kill a live server process.

Accepted Stage 2C limits, unchanged:

- A block reward is at-most-once. A crash after the world save and before the credit can drop that payout.
- PostgreSQL and the player file are still not one transaction.
- `RECOVERY_REQUIRED` is sticky. A clan id collision stays unresolved and is reported again on the next startup. It does not overwrite the other clan.
- Startup auction recovery still walks sold listings. A completed sale with a receipt does not insert the stack again.

Later debt, not done here: unique item ids, a mailbox, join-time retry, and a generic inventory transaction layer.

## I. Verdict

1. A trade escrow can no longer lose items by saving a receipt before the journal exists. The journal is first. Tested.
2. Offline trade recovery does not mark `COMPLETE` when delivery is `full` or `missing`. Tested with stored inventories and no online players.
3. Cancel and disconnect during final settlement do not return escrowed items. Tested while `settleNet` was held.
4. A failed or thrown buyer credit does not leave two owners. Tested, including the reloaded JSON.
5. Auction recovery does not complete after `full` or `missing`. Tested.
6. Two overlapped clan creates reserve `clan-1` and `clan-2`. Tested.
7. The crash matrix was executed as serialized reloads and held async gates, not as operating-system process kills.
8. The game tick and ordinary inventory clicks are unchanged. Database work stays on the settlement boundary.
9. The six audited issues are fixed in the existing architecture. Stage 2C is not exactly-once for block rewards, and the player-save rollback path was not integration-tested.
10. Remaining blockers for a merge are an independent audit, the accepted at-most-once block reward, and the untested throwing player save. This follow-up does not start Stage 3 and does not merge.
