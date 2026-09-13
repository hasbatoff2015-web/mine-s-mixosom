# Unified in-game menu + Friends + Trade

## Goal

One inventory-style in-game menu as a UI shell over existing Anarchy systems (`/spawn`, Home, Clans, Claims, Auction House), plus new server-authoritative Friends and player-to-player Trade. HUD Pause / Chat / Menu stack in the top-right. Shared close X+E. No «Топ». No second spawn/home/clan/claim/auction implementations.

## Result

Landed on `cursor/main-menu-social-a8dc`. Client sends `menu_action` intent only. Server `MenuService` / `FriendService` / `TradeService` / `HomeService` own state. Existing `/home`, `/clans`, `/ah`, `/claim`, `/spawn` commands still work.

## Implemented

### HUD

- `#hud-quick`: vertical Pause / Chat / Menu (TAB / T / M), top-right, equal size and gap, `pointer-events: auto`.
- Hidden while `#chat.open`. `#ui-root` `z-index: 10` so touch-look does not eat the buttons.
- TAB still existing pause (`InputManager.togglePause`). T still existing chat. M opens the new menu. Touch uses the same HUD buttons.

### Main menu

- Inventory chrome (`mc-backdrop` / `mc-panel` / `mc-slot` / `mc-close`), not Frontier Cubes cards.
- Spawn text button «Телепортироваться на спавн» → existing `/spawn`. Success closes the menu.
- Icon pages: Дома, Друзья, Кланы, Приваты, Обмен, Аукцион. No Top.
- Close: shared `closeButtonHtml()` (large red ×, small white E inside the square). Nested pages: ← back to the previous screen, not always to main.
- Online-only; singleplayer toasts «Меню доступно в онлайн-игре».

### Homes

- `HomeService` is the only store (`plugin-data/home/homes.json`). Builtin home plugin commands call it.
- Default cap **4** (`HOME_MAX_DEFAULT`). A fifth distinct name is `HOME_LIMIT_ERROR`.
- Menu «Добавить» requires a **unique** name per player: an existing name key returns `HOME_NAME_TAKEN_ERROR` instead of moving that home. `/sethome <name>` keeps its old overwrite behaviour, so commands are unchanged.
- UI: name field + Добавить; list with coords; row click teleports; X → confirm delete.

### Friends

- New `FriendService` (`plugin-data/friends/friends.json`). Cap **50**.
- Requests: exists / not self / not already friends / no duplicate / both sides have room.
- Incoming: Добавить / Отклонить. List: online first (green), then offline (gray), then nick. Teleport button only when the friend is online **and** the server says `teleportAllowed`. Toggle «Телепортация друзей ко мне» is server-owned. Remove is bidirectional after confirm.

### Clans / Claims / Auction

- Clans hub: Мой клан (disabled if none) / Список кланов / Создать клан → existing Clan UI. Ranking ← with `returnTo: 'menu-clans'` returns to the Clans hub, not a full close.
- Claims: list owned claims (max 4, same cap as `/claim create`). Detail: rename via field + «Сохранить» (replace in ClaimStore; `Claim.name` stays readonly; duplicate name is `CLAIM_NAME_TAKEN_ERROR`), PvP flag, members (owner cannot be added), delete confirm. ← back to the list.
- Auction: Open / Mine / Sell → existing `/ah`, `/ah list`, `/ah sell`. Auction House not rewritten.

### Trade

- `TradeService`: 6 escrow slots (2×3), integer money via `EconomyService` (`TRADE_SEND` / `TRADE_RECEIVE`).
- Client: select inventory slot / click offer slot / set money / ready / accept / cancel. No forged stacks.
- Clicking an occupied offer slot merges the same item up to `maxStack`; a full stack returns `TRADE_STACK_ERROR`; a different item withdraws the offer back to inventory.
- Ready resets **both** players on any offer change. Accept is enabled only after both Ready. Commit is atomic: both online, fingerprints unchanged, items and money still valid, **full** receive space or `У <ник> недостаточно места в инвентаре для обмена`. No partial swap.
- Status copy follows the two stages: «Вы готовы / Вы приняли» and «Партнёр не готов / Партнёр готов / Партнёр ещё не принял / Партнёр принял».
- Cancel, X, E, and disconnect return escrow, do not debit money, close both UIs. Offline partner with no inventory → `pendingReturns`, delivered on join.
- Player+session locks. `inventory_action` other than `close` is ignored while a trade session is open.

## Changed files

Shared: `shared/menu.ts`, `shared/friends.ts`, `shared/homes.ts`, `shared/trade.ts`, `shared/protocol.ts` (`menu_action` / `menu`).

Server: `HomeService`, `FriendService`, `TradeService`, `MenuService`; `WorldInstance` wiring (`bindSocialRuntimes`, `handleMenuAction`, join/disconnect escrow); home plugin uses `HomeService`; claims cap 4; clan `returnTo: 'menu-clans'`; economy trade reasons; default `menu.use` / `friend.use` / `trade.use`.

Client: HUD + `GameUI.renderMenu`, `src/ui/menuGui.ts`, `InputManager` KeyM, `Game.openGameMenu`, inventory-style CSS.

Tests: `friends`, `trade`, `homes`, `menu`, `menu-gui`; clan-gui back; crafting-ui clan back `sourceSection`; claim-anchor overlay after deleting claim `2` so the 4-cap does not fail.

Docs: this report, `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, `PLUGINS.md`.

## Architecture decisions

- Menu is a shell: spawn/home/clan/claim/auction keep their stores and commands.
- Friends and Trade are WorldInstance services (JsonFileStore), not a second plugin command surface.
- Claim rename replaces the claim object because `Claim.name` is readonly.
- Trade escrow lives in the session, not a second inventory. Money moves only on successful accept.
- Clan back from ranking/card uses `takeMenuReturn` and flushes the menu without treating clan as fully closed (avoids pointer-lock flicker).

## Tests

Focused:

```text
npx vitest run tests/server/friends.test.ts tests/server/trade.test.ts tests/server/homes.test.ts tests/server/menu.test.ts tests/menu-gui.test.ts tests/clan-gui.test.ts tests/crafting-ui.test.ts tests/server/claim-anchor-blocks.test.ts --maxWorkers=2
```

**8 files / 59 tests PASS** (friends 7, trade 12, homes 3, menu 9, menu-gui 6, clan-gui 7, crafting-ui 7, claim-anchor 8).

Covered per the task checklist:

- Friends — send / accept / reject / remove, 50 cap on both sides, duplicate request, self request, online-first sorting, teleport permission, teleport to a stranger, teleport to a disconnected friend, snapshot reports the friend's own permission (not a client claim), unknown request.
- Homes — create, unique name per player, max 4 with the limit message, delete confirm, teleport, teleport to a missing home.
- Claims — list with the 4 cap, rename, duplicate rename, PvP toggle, add/remove member, owner rejected as member, delete confirm.
- Trade — 6 slots, stack cap, inventory validation, forged slot index, money validation (negative / fractional / over balance), self trade, busy player, Ready, Ready reset on both sides, repeated Ready, Accept, double Accept lock, offer change after Accept, insufficient space (no partial commit), cancel, X/E close through the menu, disconnect escrow.
- UI — HUD stack + M/Tab/T bindings, main menu buttons without Top, nested Back vs X+E, shared close X with inner E, trade 2×3 grids over the real inventory, touch scrolling and input fields.

`npm run test:server`: **50 files / 511 tests PASS**, 1 fail — `tick-load-flight` `setView ... meanMs < 50` (~54 ms). The same test fails on base `main` `70e2afe` in a clean worktree on this VM, so it is a pre-existing perf/VM limit, not a regression. Threshold not loosened.

`typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` PASS. `check:boundaries` PASS. `build` PASS.

## Visual QA

Not run in this cloud agent (no two-client Anarchy browser pass). Owner should check desktop + landscape mobile: HUD stack, M/Tab/T, menu navigation ← vs X+E, homes 4/unique, friends teleport permission, clan ← to hub, claims rename/PvP/members, two-client trade ready-reset/accept/space/disconnect, auction shortcuts, virtual keyboard / list scroll.

## Performance

No new per-frame simulation. Menu/HUD are overlay DOM. Trade locks are per-player, not world-tick.

## Known issues

- `tick-load-flight` misses `< 50 ms` on this VM (~54 ms) both on this branch and on base `main` `70e2afe`. Pre-existing, unrelated to menu/friends/trade.
- `/sethome <name>` still overwrites an existing home of that name (unchanged command behaviour). Only the menu «Добавить» path requires a unique name.
- Premium `home.limit.premium` still allows 5 homes; ordinary players stay at 4.
- Menu is online-only.
- Live browser QA of HUD/menu/trade is still on the owner.

## Deferred

- «Топ» page.
- Friend/trade chat commands.
- Accounts, Colyseus, Survival PvP matchmaking.

## Next work

Do not start the next task from this report. Owner: live Anarchy QA, then merge `--no-ff` into `main` when ready.

## Git

- Branch: `cursor/main-menu-social-a8dc`
- Base: `main` @ `70e2afe`
- Feature commit: `4a74f91` (`feat: unified in-game menu with friends and trade`)
- Follow-up: `4334e23` (`fix: trade stack merge, claim cap, typecheck, and docs`)
- PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/89
