# Auction history + menu unread notifications — 2026-09-19

## Goal

Continue PR #96 without merging. Change clan announcement format, add auction deal history, and add server-authoritative unread badges on Friends / Clans / Auction / Trade menu tiles.

## Result

Implemented on `cursor/clan-roles-rating-d1a5`. Existing ClanService / AuctionService / FriendsService / TradeService / GameMenu / JsonFileStore were extended. No second EventBus, overlay stack, or storage framework.

## Implemented

1. **Announcement format** — `clanAnnouncementChat` now returns `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] - ${text}` (no quotes). Color stays `style: announcement` (`#4ecfdc`).
2. **Auction history** — after a confirmed `buyListing` (item delivered, money settled, listing `SOLD`), the server writes a sell row for the seller and a buy row for the buyer. UI: Auction hub button **История сделок** → nested `auction-history` screen. 24h TTL, last 20 newest-first, empty copy `История сделок пуста`.
3. **Unread notifications** — `NotificationService.notify(playerId, category)` is the single increment. Categories: `friends`, `clans`, `auction`, `trade`. Yellow square + black digit on the matching root tile. Opening that tab (`menu_action` `open`) clears the counter on the server.

## Events (exactly +1 each)

| Category | Increment | Not counted |
|---|---|---|
| friends | new incoming friend request | duplicate request, cancel/reject |
| clans | invite, kick, Member→Veteran promote | self join/leave, transfer leadership, ranking |
| auction | seller, after confirmed sale | buyer purchase, create/cancel/claim |
| trade | recipient of a new offer | sender, accept/reject |

Invite still sends the existing chat line and still appears in **Приглашения**. Chat does not increment the badge a second time.

## Persistence

- Auction history: `plugin-data/auction/history.json` (`playerId`, `type` buy/sell, `itemId`, `quantity`, `totalPrice`, `timestamp`).
- Unread counters: `plugin-data/notifications/unread.json`. Missing player/fields = 0.
- Survives reload, reconnect, and server restart. UI caps history at 20; disk is not capped to 20.

## Protocol

- `MenuActionKind`: `auction_history`
- `GameMenuScreenKind`: `auction-history`
- `ServerMenuMessage.notifications?: { friends, clans, auction, trade }`
- `ServerMenuMessage.auctionHistory?: { id, kind, title, ago, timestamp }[]`

Client never reports its own unread counts. Reset is `open` of friends / clans / auction / trade (and `auction-history` maps to auction if opened that way).

## GUI

`.mc-menu-badge` is an absolutely positioned yellow square on `.mc-menu-tile` (`position: relative`). `pointer-events: none`, no layout shift, hidden at 0, `99+` above 99. Nested auction overlay / clan overlay / X / E unchanged (`resetOverlayModal`, `resumeLookIfNoOverlay` does not `enterPlaying`).

## Changed files

- `shared/clans.ts`, `shared/notifications.ts` (new), `shared/auctionHistory.ts` (new), `shared/protocol.ts`, `shared/gameMenu.ts`
- `server/services/notifications.ts` (new), `server/services/auction.ts`, `server/services/friends.ts`, `server/services/trade.ts`, `server/services/clan.ts`, `server/services/gameMenu.ts`, `server/services/gameMenuActions.ts`, `server/WorldInstance.ts`
- `src/ui/gameMenuGui.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `tests/server/menu-notifications-auction-history.test.ts` (new), `tests/game-menu-gui.test.ts`, `tests/server/clan-invites-announce.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/PLUGINS.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Reuse `JsonFileStore`, not a new persistence layer.
- One `notifyUnread` callback from WorldInstance into Friends/Clan/Auction/Trade runtimes. Chat and invite stay separate side effects.
- History is recorded only after listing persist to `SOLD`. Rollback of `settle` creates no row and no seller badge.
- History UI is a GameMenu nested screen, not a second overlay.

## Tests

`vitest run` focused: `tests/server/menu-notifications-auction-history.test.ts`, `tests/game-menu-gui.test.ts`, `tests/server/clan-invites-announce.test.ts`, `tests/server/auction.test.ts`, `tests/server/game-menu.test.ts`, `tests/server/friends.test.ts` — **74/74 PASS** (re-run after live QA).

## Visual QA / Live QA

Live Anarchy (`npm run dev:anarchy`, Vite 4173 + WS 2567). Player **ViewZ** (fresh tab) plus bots ChiefZ / PingL / TraderT / BuyerB. Friends A was verified earlier on **Bob**.

| Case | Result |
|---|---|
| A Friends 3→open→0 then new request→1 | PASS (Bob). Video `friends-unread-badge-3-then-clear.mp4`. |
| B Invite → Кланы [1] → Приглашения Wave2C → accept → badge gone | PASS. Nested overlay / ← / X/E OK. |
| C Kick → Кланы [1] → open → gone | PASS (after creative rescue; spawn death loop otherwise). |
| D Member→Veteran → Кланы [1] → open → gone; card shows Ветеран | PASS. |
| E Seller sale → Аукцион [1]; history `Вы продали 32 Алмаз за 12 000 Мегакоинов` / `меньше часа назад`; buyer no auction badge; buy history also recorded | PASS. |
| F TraderT offer → Обмен [1], sender no badge; open Обмен clears | PASS. |
| G Announcement | PASS. Exact: `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] - Сегодня в 20:00 идём фармить данжи` (no quotes, cyan, КЛАН tab). |

Buyer history live row used starter **dirt** in SellerS slot 0 (`Вы купили 16 Земля за 50 Мегакоинов`); diamond sell row matches the spec example. Persistence files written: `plugin-data/auction/history.json`, `plugin-data/notifications/unread.json`.

Videos: `qa-b-clan-invite-badge.mp4`, `qa-d-promote-badge.mp4`, `qa-e-auction-seller-history.mp4`, `qa-f-trade-badge.mp4`, `qa-g-clan-announcement-format.mp4`.

## Performance

No per-tick work. Notify/history persist only on confirmed domain events. Badge is a CSS square on existing tiles.

## Known issues / Deferred

- Auction listings are still full-stack purchases; history quantity is `listing.item.count` (the actually transferred amount).
- Unread does not auto-clear while the player remains on an already-open tab; a new event after open increments again (as specified).
- Live spawn near Anarchy origin can drop/kill a survival player; HUD/menu QA for kick needed a creative teleport rescue. Not caused by the badge/history change.

## Next work

Owner review of PR #96. Do not merge from this pass.

## Git

Branch `cursor/clan-roles-rating-d1a5`. Do not merge.
