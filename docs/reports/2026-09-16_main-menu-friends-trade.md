# Main Menu + Friends + Trade

## Goal

Unified in-game menu (HUD M / Pause+Chat+Menu buttons) that reuses Home, Clan, Claims and Auction, plus new server-authoritative Friends and player-to-player Trade. Do not roll back Crafting UI (PR #88, already in `main`).

## Result

Implemented on `cursor/main-menu-social-a8dc` from `origin/main` (`70e2afe`). Inventory-style chrome, square X+E close, nested ←, server as source of truth.

## Implemented

- HUD top-right: Pause (TAB), Chat (T), Menu (M). Chat still uses T; Pause still uses TAB/Escape; chat-open Tab still closes chat.
- Main menu pages: Spawn, Homes, Friends, Clans, Claims, Trade, Auction. No "Топ".
- Homes via extracted `HomeService` (default max 4, unique names, yaw/pitch). `/sethome` still reports English `You can only set N home(s).`
- Friends: mutual list (50), requests, delete confirm, `allowFriendTeleport` default off, teleport only when the target is online and has enabled the flag.
- Trade: 6 slots (2×3), items leave inventory while offered, integer Megacoins via `EconomyService` reason `TRADE`, Ready resets if either offer changes, both Ready then both Accept, atomic complete with locks, cancel/X/E/disconnect returns items and transfers no money. Insufficient destination space refuses the whole trade.
- Clan/Auction opened from the menu keep `source: 'menu'`; ← restores that hub page. X/E still closes.

## Changed files

New: `shared/{gameMenu,friends,homes,trade}.ts`, `server/services/{home,friends,trade,gameMenu,gameMenuActions}.ts`, `server/builtin-plugins/{friends,trade,menu}.ts`, `src/ui/{gameMenuGui,tradeGui}.ts`, tests under `tests/` and `tests/server/`.

Touched: protocol (`menu` / `menu_action` / `trade` / `trade_action`), `WorldInstance`, `AnarchyServer`, permissions, economy, teleport `friends`, clan/auction `openedFromMenu`, GameUI/Game/InputManager/CSS, home plugin, docs.

## Architecture decisions

- Menu is a session snapshot; the client sends intent only.
- Home persistence moved from inline plugin JSON helpers into `HomeService` at the same `plugin-data/home/homes.json` path.
- Trade items are escrowed in the session (removed from inventory) so they cannot be spent twice; cancel restores them.
- Nested Clan/Auction UIs are the existing systems, not copies.

## Tests

- `tests/game-menu-gui.test.ts`, `tests/trade-gui.test.ts`, `tests/server/homes.test.ts`
- `tests/server/{friends,trade,game-menu}.test.ts`
- Home limit assertion in `anarchy-plugins` updated for default 4.
- `/claim create` cap 4 via `CLAIM_MAX_OWNED` from `shared/gameMenu.ts`.
- Parallel remote files `shared/menu.ts` / `MenuService` / `menuGui.ts` were dropped on merge so only `gameMenu` remains.
- Gates after merge cleanup: `test:server` **51 files / 497 PASS**; `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` PASS; `check:boundaries` PASS; `build` PASS.

## Visual QA

Not run in a live browser in this pass (headless cloud agent). Layout follows Auction/Craft inventory chrome, HUD corner square buttons, hidden list scrollbars with wheel/touch `pan-y`.

## Performance

No extra per-frame work beyond existing overlay rendering. Menu/trade snapshots are on demand.

## Known issues

- Live visual QA of HUD vs open-chat overlap is CSS-hidden (`#chat.open ~ #hud-corner`) but not screenshot-verified.
- Claim create/limit is the existing claims plugin; `/claim create` now shares `CLAIM_MAX_OWNED` (4) with the menu list.

## Deferred

- "Топ" page.
- Friend/trade slash command surface beyond `/friends`, `/trade`, `/menu`.

## Next work

Playtest HUD + nested Clan/Auction back on desktop and landscape mobile.

## Git

Branch: `cursor/main-menu-social-a8dc` from `origin/main` @ `70e2afe` (Crafting UI merge). Merged existing remote commits on the same branch (`ce9f076`) without rebase/force push, then kept a single menu implementation.
