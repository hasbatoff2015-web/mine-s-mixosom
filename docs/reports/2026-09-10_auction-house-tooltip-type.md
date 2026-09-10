# 2026-09-10 — Auction House tooltip type

## Goal

Make `/ah` listing tooltips easier to read: drop the «Количество» line, enlarge body text slightly, and make name + price larger than seller/remaining. Do not change auction rules.

## Result

Auction listing hover uses structured tooltip rows. Inventory/chest tooltips stay at 12px.

## Type sizes

- Auction body / meta (Продавец, Осталось): **14px** (was 12px, +17%)
- Name and price: **18px**, weight 800
- Claim hint «Заберите этот предмет»: **20px** yellow (was 18px)
- Inventory item tooltip: unchanged **12px**

## Changed files

- `server/services/auction.ts` (`listingTooltip` no longer emits Количество)
- `src/ui/itemTooltip.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/server/auction.test.ts`, `tests/auction-gui.test.ts`

## Tests

Filled after the gate run.

## Visual QA

Live browser Anarchy QA was **not** run.

## Git

Branch `cursor/auction-house-a8dc`, PR #82.
