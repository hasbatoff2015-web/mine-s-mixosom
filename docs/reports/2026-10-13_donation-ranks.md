# Timed donate ranks

## Goal

Add VIP, PREMIUM, BOSS, and TITAN as one active timed rank each, with server-side limits, kit periods, nick styling, and the commands from the spec. Keep homes, claims, auction, kits, portal chests, and player `/tpa`.

## Result

A rank lasts 30 days unless an operator passes another day count. Extension of a live rank adds that length to the current end. An expired rank starts again from the extension moment. Expiry drops the player to `default` immediately and does not delete homes, claims, lots, or items. New objects are refused until the count is back inside the new cap.

## Implemented

| Rank | Homes | Claims | Auction lots | Main kit | Food kit | Extra commands |
| --- | ---: | ---: | ---: | --- | --- | --- |
| default | 3 | 3 | 7 | `start` once | — | — |
| VIP | 4 | 4 | 10 | `vip` / 7d | `food_vip` / 24h | — |
| PREMIUM | 5 | 5 | 15 | `prem` / 7d | `food_prem` / 24h | `/ec`, `/an`, nick color |
| BOSS | 6 | 6 | 20 | `boss` / 7d | `food_boss` / 24h | death `/back` 1 / 24h |
| TITAN | 7 | 7 | 25 | `titan` / 7d | `food_titan` / 24h | `/tp` 1 / 24h, `/invsee` 1 / 24h |

Higher ranks include the lower permission nodes. Nodes do not include `server.*`, `plugins.manage`, or `*`. OP still has every permission and the prefix `[ADMIN]`. `/invseeop` is operator-only.

`/ec` opens the existing personal portal chest. `/an` broadcasts `[ОБЪЯВЛЕНИЕ ОТ ИГРОКА <prefix> <name>] <text>`. The name is the server name. Control characters, `§` / `&` codes, and forged rank prefixes are removed from the text. `/invsee` cannot move the target inventory. `/invseeop` can, and each open and edit is logged. `/tpa <player>` is unchanged. Ranked coordinates moved to `/tp` on 2026-10-18. See `docs/reports/2026-10-18_donate-menu.md`.

Cooldowns are sliding windows from the successful use, stored in `plugin-data/donation/ranks.json` with the grant and nick color. A failed give, teleport, or announcement does not write a use. A nested call on the same channel is rejected. Rank changes do not clear cooldowns. The one-time `start` ledger stays in the kit store.

## Changed files

- `shared/donationRanks.ts`, `shared/homes.ts`, `shared/protocol.ts`
- `server/services/donationRanks.ts`, `coordinateTeleport.ts`, `invsee.ts`, `permissions.ts`, `auction.ts`, `teleport.ts`
- `server/builtin-plugins/donate.ts`, `home.ts`, `claims.ts`, `kit.ts`, `back.ts`, `tpa.ts`, `index.ts`, `context.ts`
- `server/WorldInstance.ts`
- `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `src/chat/ChatLog.ts`, `src/net/RemotePlayerView.ts`, `src/net/onlineContainerSync.ts`
- `src/rendering/player/PlayerNameplate.ts`, `src/inventory/portalChest.ts`, `slotKey.ts`, `inventoryUiAction.ts`
- `tests/server/donation-ranks.test.ts`, `tests/server/claim-anchor-blocks.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

One service owns the rank, the limit, and the cooldown. Plugins call `limit` or `hasPermission`. They do not compare rank names. `PermissionService` reads extra nodes on each check, so expiry does not wait for a tick. Grant replaces the previous rank instead of stacking it. The default duration is `DONATION_RANK_DURATION_MS` (30 days) and is still an argument of `grant` / `extend`.

`/back` counts only a return whose saved reason is `death`. Other `/back` uses keep the old behavior. Default, VIP, and PREMIUM have no death cap. BOSS has 1 and TITAN has 2 per 24 hours. OP is not capped.

The future menu should call `DonationRankService.status()`. That object already lists the rank, expiry, limits, commands, kit cooldowns, and nick colors. The menu must not invent rules.

## Tests

`tests/server/donation-ranks.test.ts` covers the rank table, TITAN inheritance, expiry, extension, restart, home/claim/auction caps, object retention, `/ec`, `/an`, nick color, death `/back`, `/tpa x y z` without breaking player `/tpa`, read-only `/invsee`, OP `/invseeop`, and nested auction/cooldown calls.

`npm run test:server`: 839 passed, 1 skipped, 4 failed. Those four also fail on clean `main` in this environment: God Sword mob spend, two pet `entity_use` timing cases, and the bow-draw FIFO tick. An earlier `tick-latency` sample was 52.5 ms and the rerun stayed under 50 ms. Claim-anchor overlap now grants VIP before the fourth claim, because the default cap is 3.

`tsc --noEmit`, `npm run build`, and `npm run build:server` succeeded.

## Visual QA

Not run in a browser. Chat prefix and nameplate color are rendered from server color ids. The donate menu tab was not built.

## Performance

Rank checks are in-memory map reads. Inventory flushes of a watched player also refresh `/invsee` viewers. No new tick loop.

## Known issues

Superseded on 2026-10-18: `/tp <x> <y> <z>` is the ranked coordinate command. `/tpa` is only a player request. See `docs/reports/2026-10-18_donate-menu.md`.

Operator auction listings keep the old fallback cap of 30 (`AUCTION_MAX_ACTIVE`) when it is higher than the rank. Other players use 7/10/15/20/25.

A corrupt donation file fails closed: no donate nodes and no extra command uses until the file can be read again.

## DEV rank test

`/ranktest` is registered with the donate plugin but does nothing unless `ServerConfig.rankTestEnabled` is true. That flag is true only when `FC_RANK_TEST` is `1` or `true`. It defaults to false. `npm run dev:server` and `dev:server:anarchy|survival|peaceful` set it. `npm run start:server` does not. Only an operator can use the command. It calls `DonationRankService.grant` / `revoke` with source `ranktest`.

## Deferred

The «Донат-привилегии» menu tab, the X/Y/Z form, kit item contents, and any payment shop.

## Next work

Build the menu tab on `DonationRankService.status()` and point the coordinate form at `attemptCoordinateTeleport`.

## Git

Branch `cursor/donation-ranks-fb58`. Draft PR **#131**. Not merged.
