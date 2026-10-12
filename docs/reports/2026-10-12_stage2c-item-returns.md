# Stage 2C item returns

Three item-return gaps. No new tables, no new economy transactions, no migration edits. PR #129 stays draft.

## A. Git

- `origin/main`: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- HEAD before: `4d11ce531c69c4f81c15f481649d95bc326e3147`
- Branch before this commit: 29 ahead, 0 behind

## B. Root cause

`toStored` omitted `heldReturns`. `disconnect` and `sweepDisconnected` both replace the stored player with `toStored`. After the five-minute sweep, a later world save persisted that incomplete record.

`TradeService.returnOffers` called `Inventory.add` and ignored the remainder, then `closeSession` deleted the trade. A full or partially full inventory dropped the rest of the offer.

`restoreUnlistedItem` treated a slot as unchanged without comparing metadata. When the slot had changed and the stack did not fit, it returned without a new owner, and the pending listing was removed.

`toStored` now writes `heldReturns` whenever the list is not empty. Disconnect, sweep, appearance updates, and shutdown all go through that record. A swept player can still resume by session token because join also looks up the stored row. Trade cancel and disconnect place each offer all-or-nothing: into the inventory when the whole stack fits, otherwise into `heldReturns` through `retainStack`. The offer slot is cleared only after that handoff. A settling trade is still not refunded. A failed listing restore uses the same `retainStack` path and compares metadata with `canStacksMerge`. The pending listing is removed only after that handoff succeeds. The listing receipt is not kept when the player save throws.

## C. Item ownership

Disconnect stores the live `heldReturns` on the player row. The five-minute sweep writes that same row again and drops the in-memory player. Reconnect before the sweep uses the same object. Reconnect after the sweep, including after restart, loads the row and absorbs the stacks only when every one fits.

Trade cancel and trade disconnect move each offer into the inventory or into `heldReturns`, then drop the session. The offer is no longer a second owner. A settling trade keeps the offer in the session and does not copy it into `heldReturns`.

A failed listing create puts the extracted stack back into the original slot when that slot is unchanged, including metadata. If the slot changed and the whole stack fits elsewhere, it is added. Otherwise it is appended to `heldReturns`. The other slot is not overwritten. The pending listing is removed only after that handoff. A later save writes `heldReturns`. Freeing a slot and saving moves the stack into the inventory once.

## D. Tests

`tests/server/stage2c-item-return.test.ts`, all 5 passed. World tests use `WorldInstance` and `players.json`. The sweep uses the real `world.tick` path with `disconnectedAt` set past the five-minute threshold. The listing failure holds `savePlayers` and then rejects it.

| Case | Start | Action | After restart | Duplicates | Lost |
| --- | --- | --- | --- | --- | --- |
| heldReturns sweep | Full cobblestone inventory, one sword in `heldReturns` | Disconnect, resume, disconnect, sweep, save | Same player id, sword once. After one free slot, the sword is in the inventory and `heldReturns` is empty. A second sweep and restart stays at one sword | No | No |
| Empty list | Bob has no pending stacks | Save after the sweep | `heldReturns` is absent or empty | No | No |
| Trade cancel | 64 diamonds, 7 gold, and a metadata sword offered. Inventory then has 63 diamonds and is otherwise full | Cancel, cancel again, save | Diamond total stays 127. Gold 7. Sword metadata and durability 12 survive. After three free slots, `heldReturns` is empty and the counts are unchanged on another save | No | No |
| Trade disconnect | 64 diamonds offered, inventory then full of cobblestone | `disconnect`, second disconnect, sweep, save | 64 diamonds once. A settling trade keeps the 64 in the offer, not in `heldReturns`, and cancel/disconnect do not refund it | No | No |
| Listing save fails after the slot changes | Listed sword metadata `listed`. During the held save, slot 0 becomes a sword with metadata `other` and the rest of the inventory is filled | `savePlayers` rejects `disk full` | Two swords, one of each metadata. The `other` sword stays in slot 0. No listing receipt. Browse total 0. After one free slot, both swords are in the inventory. Another restart stays at 2 | No | No |
| Listing JSON write fails | Sword in slot 0 | `save` throws before escrow | Sword remains in slot 0. Escrow is not called. No active listing | No | No |
| Successful listing | Sword in slot 0 | Create | Inventory count 0. One `ACTIVE` listing | No | No |

## E. Durability

`heldReturns` becomes durable on the next player save, critical save, disconnect snapshot, sweep snapshot, or shutdown save. If that save itself throws, the in-memory list is still the owner and the previous player file is unchanged. A trade handoff is durable once that save includes the inventory or `heldReturns` and the offer slot is already clear. A listing return is durable once the following player save contains the stack. The pending listing is removed only after the in-memory handoff. A crash in the gap before that player save still has the previous player file; if that file already contained the stack, restart has one copy. If no earlier save contained it, that crash can lose the stack. This run did not leave the item with no owner in the tested failure path.

## F. Performance

No new per-tick database query. No new query on movement, ordinary clicks, or normal block breaks. `sweepDisconnected` was already called from the tick; it now copies `heldReturns` only for players who are actually removed. Trade cancel and a failed listing create do not add a database call. They do not add a critical save by themselves. The following normal player save persists the pending stacks.

## G. Validation

Local. GitHub Actions was not run. Manual gameplay was not run.

| Command | Result |
| --- | --- |
| `npx vitest run tests/server/stage2c-item-return.test.ts tests/server/stage2c-final-gaps.test.ts tests/server/stage2c-auction-escrow.test.ts tests/server/trade.test.ts tests/server/auction.test.ts` | PASS, 47 |
| `npx tsc --noEmit` | PASS |
| `npm run typecheck:client`, `typecheck:server`, `check:boundaries` | PASS |
| `npm run typecheck:sim` | FAIL, same 9 DOM and virtual-module errors |
| `npx vitest run` with `FC_TEST_DATABASE_URL` unset | PASS for the new tests. 26 failed, 3487 passed, 51 skipped, 388 files. An earlier full run in this session also failed `lighting-scheduler` and `auto-mine`; both passed when run alone, and `auto-mine` passed on the previous commit. The second full run is the one counted here |
| PostgreSQL integration, migration manifest, and buyer tests on `fc_foundation_test` | PASS, 8 files. Logs show migrations `0001`–`0006` |
| `npm run build`, `build:server`, `check:size` | PASS, 10.31 MiB |
| `npm run smoke:server:prod` | PASS, SIGTERM 0 |
| `git diff --check` | PASS |
| Manual gameplay | NOT RUN |
| GitHub Actions | NOT RUN |

The 26 full-suite failures are the same set already recorded against `origin/main` `2dd09ee`. Main was not executed again.

## H. Limitations

A crash after a failed listing handoff and before the next player save can still lose the stack if no earlier player save contained it. The pending listing is removed once the stack is in memory. `recoverPendingListings` still drops a pending listing with no receipt, which is correct when the last durable inventory still has the item. A settling trade is intentionally not refunded. Block rewards remain at-most-once.

## I. Verdict

1. `heldReturns` no longer disappears on disconnect. Tested.
2. `sweepDisconnected` no longer drops deferred items. Tested.
3. Normal trade cancellation no longer loses a stack. Tested.
4. Trade disconnect no longer loses a stack. Tested.
5. A failed listing create no longer loses the item when the original slot changed. Tested.
6. A different metadata stack is not overwritten. Tested.
7. Retries and restarts did not duplicate the returned items. Tested.
8. The new regression file ran, and the second full Vitest run completed.
9. The fix reuses `heldReturns` and the existing player record. No new framework.
10. These three return paths are ready for an independent audit. PR #129 stays draft. Stage 3 has not started.
