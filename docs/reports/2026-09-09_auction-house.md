# 2026-09-09 — Auction House

## Goal

Add a builtin Anarchy Auction House so players can list, search, buy, cancel, relist, and manually reclaim items through the existing EconomyService and inventory-style GUI. Do not add a second currency, a second persistence stack, bidding, fees, or Frontier Cubes menu-card chrome.

## Result

Builtin plugin `auction` + `AuctionService` on `WorldInstance`. Listings persist in `plugin-data/auction/listings.json`. Purchases call `EconomyService.settle(buyer, seller, price, 'AUCTION_PURCHASE', 'AUCTION_SALE', listingId)`. GUI reuses chest/inventory slots, item icons, tooltips, close ×, and E-to-close. Live browser Anarchy QA was **not** run.

## Implemented

1. **AuctionService API.** `createListing`, `buyListing`, `cancelListing`, `relist`, `claimListing`, `queryBrowse`, `queryMine`, `expireDue`, session helpers, `buildMessage`.
2. **Lifecycle.** `ACTIVE` → `SOLD` | `CANCELLED` | `EXPIRED` | `RELISTED` | `CLAIMED`. Returnable = `CANCELLED` | `EXPIRED`. 2-day `expiresAt`. Max 30 `ACTIVE`. Price 10…100 000 000 integer, whole listing.
3. **Commands / permissions.** `/ah`, `/ah sell`, `/ah list`; aliases `/auction`, `/auctionhouse`. Nodes `auction.use|sell|buy|list` and `auction.*`.
4. **Protocol.** Client `auction_action` intents; server paged `auction` snapshots (search, page, page size 27).
5. **Client GUI.** Inventory chrome in `GameUI.renderAuction`. Screens: browse, buy, sell-pick, sell-confirm, mine, manage, relist, claim.

## Changed files

- `server/services/auction.ts`, `server/builtin-plugins/auction.ts`, `server/builtin-plugins/index.ts`, `server/builtin-plugins/context.ts`
- `server/services/economy.ts` (`settle`, `pairId`), `server/services/permissions.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `shared/protocol.ts`
- `src/ui/GameUI.ts`, `src/ui/GameUI` inventory tooltip reuse, `src/style.css`, `src/core/Game.ts`
- `src/inventory/inventory.ts` (`parseSerializedItemStack` export)
- `tests/server/auction.test.ts`, `tests/server/auction-plugin.test.ts`, `tests/server/economy.test.ts`
- `docs/PLUGINS.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/LOCAL_SERVER.md`

## Architecture decisions

- GUI is **not** a `ContainerKind` and does **not** go through `inventory_action` clicks (drag-on-listing would dupe). Visual reuse only.
- Item lives in **either** player inventory **or** a listing. Create extracts the stack first; claim inserts only when the whole stack fits.
- Relist never returns the item to inventory. Old listing becomes `RELISTED` (not claimable) only after the new listing is created.
- Expiration is server-side (`scheduleRepeating(1000)` + load + every action). No auto-return, no ground drop.

## Tests

See `docs/TESTING.md` 2026-09-09 Auction House. Focused: auction 18/18, auction-plugin 5/5, economy 15/15. `test:sim` 65/65. `test:server` 41 files / 410 tests PASS. Four typechecks, boundaries, and `build` PASS. Live browser Anarchy QA was **not** run.

## Visual QA

Live browser Anarchy QA was **not** run.

## Performance

Paged snapshots of 27 listings. Search and page run on the server.

## Known issues

None observed in unit/server tests at handoff.

## Deferred

Auction fee, tax, sorting, categories, bidding, buy orders, mail, global chat notifications.

## Next work

Owner live Anarchy QA of `/ah` browse/sell/buy/list/claim with two clients.

## Git

Feature branch `cursor/auction-house-a8dc` (includes Economy, which is not yet on `main`).
