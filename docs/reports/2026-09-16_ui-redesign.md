# Unified in-game UI chrome

## Goal

Bring every existing game overlay to one graphite Minecraft-style visual language (reference: attached Friends/Trade screenshots), without rewriting Economy / Auction / Clan / Claims / Homes / Friends / Trade / Buyer / Chat / Crafting / Inventory / hologram / multiplayer logic.

## Result

Shared tokens + `overlayStageStyle()` on all `.mc-stage` windows. Friends/Trade/Homes/Claims HTML matches the reference layout. Inventory, craft, auction, clan, buyer, chat, pause, settings, HUD use the same chrome. No second UI system.

## Implemented

- Tokens in `src/uiTokens.css`: `--mc-text*`, `--mc-btn-*`, `--mc-online` / `--mc-offline`, slot/input faces.
- `.mc-panel` is dark graphite with inner highlight. `.mc-ah-btn` is the shared button (hover/pressed/disabled + `.mc-btn-positive` / `.mc-btn-danger`).
- Close stays `closeButtonHtml()` (red × + inner E). Close/back sprites from `public/ui/menu/` apply to every `.mc-stage`.
- Friends: green/grey nicks, status dots, graphite toggle, **Телепорт** only when `canTeleport`, **Удалить** instead of X.
- Trade lobby: **Рядом** + refresh, 20-block 3D list (`tradeNearby`), keep incoming/outgoing + nick field.
- Homes/Claims: compact rows with coords and explicit action buttons.
- HUD Pause/Chat/Menu buttons 58 logical px (was 44). Hotkeys TAB/T/M unchanged.
- Chat: closed log still overlay-transparent; open log is a graphite panel. Nearby yellow / Clan purple markers kept. System lines are neutral grey.
- Pause uses the same `menu-window` chrome as Settings.

## Changed files

- `src/uiTokens.css`, `src/style.css`
- `src/ui/gameMenuGui.ts`, `src/ui/GameUI.ts`, `src/ui/tradeGui.ts`, `src/ui/containerTheme.ts`
- `shared/protocol.ts`, `shared/trade.ts`
- `server/WorldInstance.ts`, `server/services/gameMenuActions.ts`
- Tests: `tests/game-menu-gui.test.ts`, `tests/crafting-ui.test.ts`, `tests/chat-layout.test.ts`, `tests/ui-visual-contract.test.mjs`, `tests/server/game-menu.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`

## Architecture decisions

- Reuse `gameMenuGui` / `containerTheme` / `closeButtonHtml()`. Sprite URLs go through existing `menuChromeStyle()` wrapped as `overlayStageStyle(scale, width)`.
- Nearby trade list is display + `trade_request` by name. No new TradeService protocol.
- Radius is `NEARBY_CHAT_RADIUS` (20), not a second distance constant with a different meaning.
- Do not rewrite saved block IDs or add BlockId 165.

## Tests

```text
npm test -- tests/game-menu-gui.test.ts tests/trade-gui.test.ts tests/crafting-ui.test.ts tests/chat-layout.test.ts tests/ui-visual-contract.test.mjs tests/clan-gui.test.ts tests/auction-gui.test.ts tests/buyer-gui.test.ts tests/container-ui.test.ts tests/ui-visual-system.test.ts tests/server/game-menu.test.ts tests/server/friends.test.ts tests/server/trade.test.ts tests/chat-channels.test.ts tests/gameplay-ui-entity-polish.test.ts --maxWorkers=2
```

**123 PASS**. `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` / `check:boundaries` / `build` PASS.

## Visual QA

Static HTML of real `menuBodyHtml` + production CSS (Friends/Trade vs attached reference). Inventory/craft/auction inherit `.mc-panel` tokens. Live Anarchy join is not part of this pass.

## Performance

No extra per-frame work. Nearby list is computed only when the trade menu snapshot is built.

## Known issues

- Open chat log is no longer world-transparent (requested dark panel). Closed chat overlay stays transparent.
- Close sprites already contain ×/E; HTML glyphs stay in the DOM and are hidden on `.mc-stage` so `closeButtonHtml()` is unchanged.
- Chat close remains TAB (not E), as before.

## Deferred

Merge to `main`. Pixel-perfect inventory slot atlas (slots are dark wells, not the classic light-grey MC texture).

## Next work

Playtest Friends teleport visibility and Trade nearby refresh on a live Anarchy server.

## Git

Branch `cursor/ui-redesign-a8dc` from `cursor/main-menu-visual-31b4`. No merge to `main`.
