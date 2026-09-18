# 2026-09-10 — Auction House amount row + claimable lots

## Goal

Put sell-confirm `−` / item / `+` on one centered inventory row, and visually mark `CANCELLED` / `EXPIRED` lots in `/ah list` as items to claim. Do not change auction rules.

## Result

Sell amount is only the stack count on the item icon. Claimable cells use a muted red inventory slot plus a larger yellow tooltip line «Заберите этот предмет». Click still opens the existing claim screen.

## Implemented

1. **Amount row.** `mc-ah-amount` is `−` slot, selected item slot, `+` slot; equal `gap`; group centered. No extra amount label.
2. **Claimable cells.** Wrapper class `mc-ah-claimable` when status is `CANCELLED` or `EXPIRED`. Slot background `#8a5454`.
3. **Hover hint.** `data-item-tooltip-hint` rendered as `.mc-item-tooltip-hint` (18px, `#ffff55`). Item name and listing details stay in the body.

## Changed files

- `src/ui/GameUI.ts`, `src/ui/auctionGui.ts`, `src/ui/itemTooltip.ts`, `src/style.css`
- `server/services/auction.ts` (`listingTooltip` no longer repeats «Можно забрать»)
- `tests/auction-gui.test.ts`, `tests/server/auction.test.ts`, `tests/server/auction-plugin.test.ts`
- `docs/PROJECT_STATE.md`, `docs/TESTING.md`, `docs/PLUGINS.md`

## Architecture decisions

- Claimable UI is derived from existing `NetworkAuctionListing.status`. No new protocol field.
- `RELISTED` / `CLAIMED` stay out of `queryMine`; they never get the red cell.

## Tests

Focused: auction **23/23**, auction-plugin **9/9**, auction-gui **5/5**, economy **15/15**. Tooltip suite **24/24**. `npm run test:server` **41 files / 419 tests PASS**. Four typechecks, `check:boundaries`, and `build` PASS. Live browser Anarchy QA was **not** run.

## Visual QA

Live browser Anarchy QA was **not** run.

## Known issues

Live GUI scale/hover QA should confirm the red tint and yellow hint at several `--mc-ui-scale` values.

## Git

Branch `cursor/auction-house-a8dc`, existing PR #82.
