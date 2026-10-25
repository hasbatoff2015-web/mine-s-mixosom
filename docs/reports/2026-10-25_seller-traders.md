# 2026-10-25 — Seller mode on buyer NPCs

## Goal

Let an admin turn the existing trader NPC into a seller. A buyer still pays Megacoins for items. A seller takes Megacoins and gives a configured item from a finite stock. No second wallet, hologram system, or NPC inventory.

## Result

`BuyerRecord.role` is `buyer` or `seller`. Missing role loads as `buyer`, so old `plugin-data/buyers/buyers.json` files keep buying. Seller stock is an integer 0…1 000 000 on the same record. Purchases use `EconomyService.withdraw(..., 'TRADER_PURCHASE')` and the existing `returns` overflow path.

## Implemented

- `/buyer create <name>` still creates a buyer. `/buyer create seller <name>` (or `продавец`) creates a seller and opens the same admin GUI.
- Admin GUI adds Скупщик / Продавец and, for a seller, a quantity field. Item picker, price, hologram editor, save, and delete stay.
- Player seller window shows the item, unit price, stock, quantity, total, and **КУПИТЬ**. Buyer window still uses **ПРОДАТЬ** and the trade slot.
- Server checks trader, item, quantity, price, balance, and inventory room before any charge. It then decrements stock into a `purchases` row, withdraws with `pairId`, and writes the owed stack into `returns` in the same buyers file that drops the row. `restoreOverflow` moves that stack into the inventory.
- Failed withdraw restores stock. Load restores an unpaid reservation and delivers a paid one once. A cleared order ignores a repeated buy. Spoofed price, amount, and stock are ignored.
- Open seller windows on other players refresh when stock changes. Restart keeps role, price, stock, balance, and delivered items.

## Changed files

- `shared/buyers.ts`, `shared/protocol.ts`
- `server/services/buyer.ts`, `server/services/economy.ts` (`withdraw` accepts `pairId`, `findTransactionByPairId`)
- `server/builtin-plugins/buyer.ts`
- `src/ui/buyerGui.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/server/buyer.test.ts`, `tests/server/buyer-plugin.test.ts`, `tests/buyer-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Architecture decisions

- Stock is a number on the NPC, not a chest. Buyers never had an item inventory; adding one would be a second container system.
- The purchase journal lives in `buyers.json` next to stock and `returns`. Economy stays the only Megacoin ledger. `pairId` links the withdraw to the journal row, the same idea as an auction `pairId`.
- Commit point: stock down, withdraw recorded, owed items in `returns`, journal row gone. A crash before that commit is repaired on the next `load()`. A crash after the items are only in memory and `returns` is already clear can lose them, same as any other inventory change that has not reached `players.json` yet.
- Buyer sell path is unchanged: items sit in the session trade slot until deposit or close.

## Tests

`npx vitest run tests/server/buyer.test.ts tests/server/buyer-plugin.test.ts tests/buyer-gui.test.ts tests/server/economy.test.ts --maxWorkers=2`

buyer 26, buyer-plugin 7, buyer-gui 7, economy 16. All passed.

`npx tsc --noEmit -p tsconfig.server.json`, `npx tsc --noEmit -p tsconfig.client.json`, and `node scripts/check-import-boundaries.mjs` passed.

## Visual QA

Seller and buyer markup is covered by `tests/buyer-gui.test.ts` (mode buttons, stock field, «В наличии», «Вы заплатите», КУПИТЬ, and the existing ПРОДАТЬ screen). A live Anarchy click-through in the browser was not run: the window opens only after joining a world and using an NPC.

## Performance

No per-NPC tick. A purchase writes `buyers.json` and the economy files, then broadcasts the existing `buyers` snapshot and refreshes open trader windows. Same cost class as a buyer sale.

## Known issues

- If the process dies after `returns` has been cleared into the live inventory and before the next player save, those items are not on disk. The Megacoins are already withdrawn. That window matches other inventory grants.
- Economy history is trimmed. Recovery treats `phase: paid` as paid even if the matching transaction has already been dropped. A `reserved` row needs the transaction to still be in the file.

## Deferred

- Live browser QA of the seller window at several UI scales.
- Restocking by handing the NPC physical items. Stock is an admin-set number.
- A dedicated totem shop. An admin can stock a totem like any other item.

## Next work

Owner checklist: `/buyer create seller Лавка` → pick an item, price, and stock → player sees stock and unit price → buy until the stock hits 0 → second player cannot buy the same units → restart keeps the remainder → `/buyer create Фермер` still buys pumpkins.

## Git

Branch `cursor/seller-traders-be5e`.
