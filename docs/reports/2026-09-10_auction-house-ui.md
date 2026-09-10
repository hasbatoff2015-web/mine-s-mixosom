# 2026-09-10 — Auction House UI polish

## Goal

Polish the existing Auction House inventory GUI: confirm-button labels, search focus while typing, a browse refresh control, no post-purchase success line, sell-icon amount, and distinct empty vs out-of-range price errors. Do not change listing rules, EconomyService, anti-dupe, or persistence.

## Result

Same plugin and protocol. Browse snapshots patch the listing grid in place. Confirm actions use full-width inventory bezel buttons with `nowrap` labels. `refresh` re-sends the current snapshot (search kept, page clamped). Successful buy returns to browse without a GUI `message`.

## Implemented

1. **Buttons.** `.mc-ah-btn` is no longer a square `mc-slot`. Action rows are a column of full-width bezel buttons; toolbar **Обновить** sits beside search.
2. **Search focus.** If Auction GUI is already open on the same screen, `patchAuctionList` replaces listings/pagination/empty/message only. Focused search value and caret are not overwritten. Full remount is reserved for screen changes.
3. **Refresh.** Client `auction_action.refresh`; server expires due listings and flushes the current session. Search is unchanged; `paginate` clamps the page.
4. **Buy success.** GUI `message` after a successful purchase is omitted. Purchase errors still use `message`. Seller system chat is unchanged.
5. **Sell amount icon.** Snapshot `selected.item.count` equals the chosen `amount`; client `auctionIconStack` paints that count on the slot.
6. **Price errors.** Empty → `Укажите цену этого предмета`. Specified but invalid/out of range → `Доступная цена для выставления на продажу - от 10 до 100 000 000 Мегакоинов`. `parseAuctionPrice` / min 10 / max 100 000 000 unchanged.

## Changed files

- `server/services/auction.ts`, `server/WorldInstance.ts`
- `shared/protocol.ts`
- `src/ui/GameUI.ts`, `src/ui/auctionGui.ts`, `src/style.css`
- `tests/server/auction.test.ts`, `tests/server/auction-plugin.test.ts`, `tests/auction-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/PLUGINS.md`

## Architecture decisions

- Search must not remount the input. Restoring `focus()` after every snapshot would hide the remount bug; in-place patch is the fix.
- `refresh` is an explicit intent even though a no-op browse flush would look similar: the client sends a distinct action, the server expires then rebuilds the snapshot.
- Amount on the icon is server-authoritative (`buildMessage` clones the stack with `count: amount`). The client also overlays `selected.amount` so ± is correct even if a snapshot is stale for one frame.

## Tests

See `docs/TESTING.md` 2026-09-10 Auction House UI polish. Live browser Anarchy QA was **not** run.

## Visual QA

Live browser Anarchy QA was **not** run. Layout was checked against inventory chrome (`mc-panel` / `mc-slot` / bezel buttons) in CSS. Confirm buttons are 20 logical px tall, full width, `white-space: nowrap`.

## Performance

Browse typing still debounces search at 160 ms. List updates no longer tear down the modal.

## Known issues

Live multi-scale GUI QA (desktop / landscape mobile) was not run in this environment.

## Deferred

Auction fee, tax, sorting, categories, bidding, buy orders, mail, global chat notifications.

## Next work

Owner live Anarchy QA of `/ah` browse/search/refresh/sell amount/buy confirm at several UI scales.

## Git

Feature branch `cursor/auction-house-a8dc` (existing PR, not a new one).
