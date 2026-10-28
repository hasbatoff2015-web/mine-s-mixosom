# Stage 2C final gaps

Three localized fixes. Migration `0006` was not edited. Stage 3 was not started. PR #129 stays draft.

## A. Git

- `origin/main`: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- HEAD before: `51172fe499e4c49db00aea77a2447e64c4f43464`
- Branch: `cursor/admin-antidupe-postgres-foundation-26a8`, 28 ahead before this commit, 0 behind

## B. Root cause and fix

### Auction buyer binding

`AuctionService.buyDurable` treated `PREPARED` as "no row yet" and called `economy.settle` before comparing `payload.buyerId`. A second buyer could reach the money call on the first buyer's settlement id. The test halt `purchase-prepared` also inserted that row before the check.

`bindPurchaseBuyer` now runs before any settle and before that halt. It compares buyer, seller, listing, price, and item identity. A different buyer on an open `PREPARED` row is rejected and is not charged. The row stays owned by the first buyer, who can retry it. A `CANCELLED` row is already terminal, so the listing gets a new `economySettlementId` before a later purchase. The seller listing receipt stays on the id that escrowed the item. `COMPLETE` and any in-flight row for another buyer return conflict and are not transitioned illegally.

### Unsaved offer overflow

`WorldInstance.durablePlayerRecord` merged the buyer slot and trade offers with `Inventory.add` and ignored the remainder. A full inventory dropped those stacks from the save. The session is only in RAM, so a restart lost them.

The save now tries the whole pending group on a clone. If every stack fits, the snapshot is unchanged from the old behavior and `heldReturns` is omitted. If any stack does not fit, the saved inventory is left unchanged and the whole group is written to `heldReturns` on the player row. Old saves without the field load as empty. `settlementReceipts` are now kept by the player parser so a full world save does not strip them. On join or the next save, the group moves into the live inventory only when all of it fits. It is not applied partially and it is not written twice.

### Claim and listing save failure

`claimListing` inserted the item, then called `escrow`. A failed player save rolled back the receipt but not the inserted item, so a retry could add another copy. Claims now use `ItemDurability.deliver`, which clones, refuses a partial insert, writes the receipt, saves, and rolls the inventory and receipt back together if the save throws. `CLAIMED` is set only after `delivered` or `already`.

`createListing` removed the seller stack before the listing file and the escrow save were durable. If the listing JSON write throws, the stack is put back and the in-memory row is dropped before escrow. If escrow throws and the receipt is not durable, the stack is restored when the slot is unchanged, or added only when the whole stack fits. The pending row is then removed. A successful create still removes the stack, writes the receipt, and marks the listing `ACTIVE`.

## C. Durable ownership

A pending purchase is owned by the buyer id inside the immutable payload. Money uses that settlement id as the source. Another buyer does not enter that source. After recovery cancels an unpaid `PREPARED` row, the listing can be bought under a new id. The old row stays `CANCELLED`.

An open trade offer or buyer slot is owned by the live window until save. The save owns it either inside the inventory snapshot, when it fits, or in `heldReturns`, when it does not. It is not in both. After restart the window is gone, so `heldReturns` is the only copy until it fits.

A returnable auction item is owned by the listing until `deliver` commits the claim receipt and the inventory together. A failed save leaves the listing returnable and the inventory as it was. A failed listing create leaves the seller stack in the seller inventory and does not leave an `ACTIVE` listing.

## D. Tests

`tests/server/stage2c-final-gaps.test.ts`. Auction identity uses an in-memory settlement journal and an in-memory charge list. The trade, buyer, claim, and listing-save cases use `WorldInstance`, `players.json`, and the real `itemDurability` path. The listing JSON failure uses a `JsonFileStore.save` that throws. All six tests passed.

| Case | Before | Failure | Persisted / restored | Result |
| --- | --- | --- | --- | --- |
| A1–A5, A9–A10 | Bea `PREPARED`, no charge | Cara buys the same listing | Cara is not charged. Row stays Bea's `PREPARED`. Bea then pays once, receives 2 diamonds, phase `COMPLETE`. A second buy and Cara's rebinding do not pay or add items | PASS |
| A6–A8 | Same unpaid `PREPARED` | Recovery with no debit | Phase `CANCELLED`, listing stays `ACTIVE`. Cara buys on a new settlement id, one charge, 2 diamonds. Bea's row stays `CANCELLED` and Bea has 0 | PASS |
| B trade, partial, restart | Sword, 2 diamonds, 3 gold ingots in offers. Inventory has 63 diamonds and is otherwise full | Canonical save, stop, resume | File holds the three stacks in `heldReturns` and 63 diamonds in inventory. Totals 65, 1, 3. After three free slots and another save, those stacks are in inventory once and `heldReturns` is empty. A further save stays at 65 / 1 / 3. Sword durability 12 and metadata survive | PASS |
| B buyer and fitting trade | 4 diamonds in the buyer slot, inventory full. A separate sword offer with free space | Save | Buyer file: 0 diamonds in inventory, 4 in `heldReturns`, metadata kept. Sword file: 1 sword in inventory, no `heldReturns` | PASS |
| C1–C8 | Cancelled listing, seller inventory empty, sword metadata | `savePlayers` throws `disk full` | Inventory stays 0, no claim receipt, status `CANCELLED`. After the save works, claim delivers 1 sword. A second claim stays at 1. Resume loads 1 sword, `CLAIMED`, and the receipt | PASS |
| C9, C13–C14 | Seller holds the sword | `savePlayers` throws during escrow | Inventory still has the sword and its metadata. No receipt. No `ACTIVE` or `PENDING_ESCROW` listing. A later create becomes `ACTIVE` and the inventory count is 0 | PASS |
| C10–C12 | Seller holds the sword | Listing `save` throws `listing json` | Escrow is not called. The sword remains in the slot. Browse total is 0 | PASS |

## E. Performance

No new database call on movement, the 20 TPS tick, an ordinary inventory click, or a zero-reward block break. Purchase still does its existing settlement read before money; the identity compare is in memory. Releasing a cancelled attempt writes the listing file once. A full inventory save does not add a player-file write beyond the save that was already happening. Claim and listing create still use one critical player save on the success path.

## F. Validation

Local. `gh` was not asked to wait on Actions. Manual gameplay was not run.

| Command | Result |
| --- | --- |
| `npx vitest run tests/server/stage2c-final-gaps.test.ts` | PASS, 6 |
| `npx tsc --noEmit` | PASS |
| `npm run typecheck:client`, `typecheck:server`, `check:boundaries` | PASS |
| `npm run typecheck:sim` | FAIL, 9 errors, the same DOM and virtual-module set as the previous baseline |
| Related auction, trade, buyer, follow-up, inventory revision, and portal-chest tests | PASS, 89 |
| `npx vitest run` with `FC_TEST_DATABASE_URL` unset | 26 failed, 3482 passed, 51 skipped, 387 files. The previous branch run was 26 failed, 3476 passed, 386 files. The pass count rose by these 6 tests. The 26 failure names are the same set already recorded against `origin/main` `2dd09ee`. Main was not executed again |
| PostgreSQL integration and migration manifest on `fc_foundation_test` | PASS, 56. Logs show migrations `0001`–`0006` |
| `npm run build`, `build:server`, `check:size` | PASS, 10.31 MiB |
| `npm run smoke:server:prod` | PASS, SIGTERM 0 |
| `git diff --check` | PASS |
| Manual gameplay | NOT RUN |
| GitHub Actions | NOT RUN |

The auction identity cases use a memory settlement repository. The save-failure cases throw from the real `WorldInstance` player save or from listing JSON `save`.

## G. Limitations

No new correctness blocker was left in these three paths. Accepted limits that remain: block rewards are at-most-once, PostgreSQL and the player file are not one transaction, and a full inventory keeps `heldReturns` until a later save has room for the whole group. There is no join-time mailbox. A slot that changes during a failed listing escrow is not overwritten; the stack is added only when it fits entirely.

## H. Verdict

1. Buyer B cannot use buyer A's `PREPARED` settlement. Tested.
2. An unpaid `PREPARED` listing is cancelled by recovery and can be bought once under a new id. Tested.
3. Unsaved trade and buyer stacks are not dropped when the saved inventory is full. Tested.
4. A full-inventory restart keeps every pending stack, then returns them once when space exists. Tested.
5. A failed claim save does not create another item. Tested.
6. A failed listing create does not lose or duplicate the seller's item. Tested.
7. Trade, buyer, and claim results were reloaded from `players.json`. The abandoned purchase was reloaded from the listing file.
8. A real `savePlayers` failure and a real listing JSON failure were tested.
9. No per-tick or ordinary-click database work was added.
10. These three gaps are ready for an independent audit. This does not merge PR #129 and does not start Stage 3.
