# Main Menu visual restyle

## Goal

Restyle the existing in-game Main Menu (and its nested tabs + HUD chrome) to match the attached dark inventory-style reference: compact central panel, live balance, 4+3 icon grid, graphite Minecraft buttons, pixel-art icons and close/pause/chat/menu/back sprites. Do not rewrite Friends / Trade / Homes / Claims / Clan / Auction logic.

## Result

Visual-only pass on `cursor/main-menu-visual-31b4` from `cursor/main-menu-social-a8dc`. Menu actions, navigation, `closeButtonHtml()`, and server services are unchanged. Live Megacoin balance is read from the existing `EconomyService` and shown on the root page.

## Implemented

- Dark semi-transparent `.mc-menu-panel` sized to content (logical 248×176 on root, max UI scale 3). Not fullscreen.
- Header «Меню», thin rule, coin + `Баланс: N монет` from `economy.getBalance`.
- Root grid: 4 tiles (Спавн / Дома / Друзья / Кланы) then 3 centered same-width tiles (Приваты / Обмен / Аукцион). Portrait/narrow: 2 columns.
- Graphite beveled tiles with large PNG icons from `public/ui/menu/`. Nested pages reuse the same dark chrome and graphite `.mc-ah-btn`.
- Close stays `closeButtonHtml()` (HTML × + inner E). Menu/trade overlay uses the provided close/back sprites as the button face; E remains inside the control.
- HUD Pause/Chat/Menu use pause/chat/menu sprite states. Labels/hotkeys stay in the DOM for a11y/tests.

## Changed files

- New: `public/ui/menu/*.png` (64×64 icons and HUD/close/back states), `docs/reports/2026-09-16_main-menu-visual.md`
- `src/ui/gameMenuGui.ts`, `src/ui/GameUI.ts`, `src/ui/tradeGui.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `shared/gameMenu.ts` (icon filenames), `shared/megacoins.ts` (`formatMegacoinAmount`), `shared/protocol.ts` (`balance` / `balanceLabel`)
- `server/services/economy.ts` (re-export shared formatter), `server/WorldInstance.ts` (attach live balance to menu snapshots)
- Tests: `tests/game-menu-gui.test.ts`, `tests/server/game-menu.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `TESTING.md`, `ARCHITECTURE.md`

## Architecture decisions

- No second menu system. Same `gameMenuGui` / `GameMenuSession` / `menu_action` path.
- Balance is display-only: `WorldInstance.buildMenuMessage` reads `EconomyService.getBalance`. No new economy writes.
- `formatMegacoinAmount` lives in `shared/megacoins.ts` so client chrome and server chat/economy share one grouping helper.
- Close HTML is unchanged; sprite faces are CSS `background-image` on `.mc-menu-stage .mc-close`. Inventory/craft close chrome is untouched.
- Menu scale is capped at 3 (`menuUiScale`) so a 1920×1080 desktop does not stretch the panel to inventory max-4.

## Tests

Focused:

```text
npx vitest run tests/game-menu-gui.test.ts tests/trade-gui.test.ts tests/server/game-menu.test.ts tests/server/friends.test.ts tests/server/trade.test.ts tests/crafting-ui.test.ts tests/container-ui.test.ts --maxWorkers=2
```

Plus typecheck / boundaries / build (recorded after gates).

## Visual QA

Static HTML preview of root + nested chrome (desktop and portrait). Live Anarchy join was not required for this visual pass.

## Performance

PNG pack is ~186 KiB. No extra per-frame work; menu still renders on snapshot.

## Known issues

- Close/back sprites already contain the glyph; HTML ×/E (and ←) stay in the DOM and are visually hidden on the menu stage so `closeButtonHtml()` is unchanged.
- Auction House and Clan overlays opened from the menu keep their existing inventory-grey chrome (those systems were not restyled).

## Deferred

- Restyling Auction House / Clan GUIs themselves.
- Applying close/pause sprites to inventory and chat chrome globally.

## Next work

Playtest nested pages on landscape phone; confirm live balance updates after a trade/economy change while the menu is open (snapshot refresh already happens on `flushMenu`).

## Git

Branch: `cursor/main-menu-visual-31b4` from `cursor/main-menu-social-a8dc`. No merge to `main`.
