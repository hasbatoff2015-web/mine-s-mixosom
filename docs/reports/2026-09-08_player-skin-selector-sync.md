# 2026-09-08 — Player skin selector, appearance sync, nameplates

## Goal

Add a main-menu character/skin selector on top of the existing 45 production 64×64 skins, make Online Anarchy appearance server-authoritative (metadata only), persist the last skin per `playerId`, and draw Minecraft-like nameplate + health above remote players.

## Result

Selector, metadata sync and nameplates reuse `PlayerAppearance` / `MinecraftSkinRegistry` / `PlayerSkinGeometryCache` / `PlayerVisual` / `Game.setPlayerAppearance()`. No second player model pipeline, no PNG/base64 on the wire, no Three.js on the server, hologram gameplay entities unchanged.

## Implemented

1. **Catalog.** Data-only `src/player/appearance/builtinSkins.ts` is the whitelist (45 production + DEV UV sheet). `MinecraftSkinRegistry` still owns Three textures.
2. **Main menu.** Existing buttons stay; a right-hand «Персонаж» panel renders the current player with `PlayerAppearancePreview` (canonical `PlayerVisual`).
3. **Selector.** Grid of all 45 skins with 2D portraits from the real PNG; left side is the same 3D `PlayerVisual`. Click = temporary preview. Cancel restores. Confirm calls `Game.setPlayerAppearance()`.
4. **Persistence.** Client: `fc.player.appearance` localStorage. Server: `appearance` on the existing `players.json` row.
5. **Protocol.** Optional `join.appearance`; client `appearance`; server `player_appearance`; welcome/`player_joined` carry metadata. `player_state` ticks do not.
6. **Validation.** Server `sanitizeRegisteredAppearance()` against production ids; texture/png/base64 keys rejected at parse.
7. **Nameplates.** `PlayerNameplate` sprite on `RemotePlayerView` (nickname + `❤ HP`), interpolated with remote feet, Sprite billboard, distance fade (48 blocks), hidden when invisible. Local first/third person has no nameplate. Health comes from authoritative snapshots, text rebuilds only on change.

## Changed files

- `src/player/appearance/builtinSkins.ts` (new)
- `src/player/appearance/PlayerAppearance.ts`
- `src/player/appearance/PlayerSkinSelector.ts` (new)
- `src/net/playerAppearance.ts` (new)
- `src/net/AnarchyClient.ts`
- `src/net/RemotePlayerView.ts`
- `src/rendering/player/MinecraftSkin.ts`
- `src/rendering/player/PlayerAppearancePreview.ts` (new)
- `src/rendering/player/PlayerNameplate.ts` (new)
- `src/rendering/player/SkinPortrait.ts` (new)
- `src/ui/GameUI.ts`
- `src/style.css`
- `src/core/Game.ts`
- `shared/protocol.ts`
- `src/save/types.ts`
- `src/save/snapshot.ts`
- `server/WorldInstance.ts`
- `server/AnarchyServer.ts`
- Tests: `player-skin-selector`, `player-appearance-network`, `player-nameplate`, `server/player-appearance`, plus existing skin/UI/remote updates
- Docs: PROJECT_STATE, ROADMAP, ARCHITECTURE, TESTING, this report

## Architecture decisions

- One appearance contract. Server stores metadata only; Three registry stays client-side.
- Selector session is a pure preview/commit object so Cancel cannot leak into `Game.setPlayerAppearance`.
- Nameplates are player presentation, not plugin holograms and not chunk-attached.
- Local player nameplate stays off in first- and third-person so the camera is not covered.

## Tests

- `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` PASS
- `check:boundaries` PASS
- Focused: player-skin-selector, player-appearance-network, player-nameplate, player-skins, player-skin-assets, remote-player-view, ui-main-integration, player-nickname, player-visual-animation, player-armor-* PASS
- `test:sim` 42/42 PASS
- `test:server` 29 files / 299 tests PASS (includes `player-appearance`)
- `build` PASS (main JS 1.31 MB)

## Visual QA

Automated selector/nameplate/network contracts. Live two-client Anarchy (selector, remote skin change, damage 20→18, heal, invisibility, distance fade) remains owner QA.

## Performance

Appearance is a rare metadata event. Nameplate canvas is rebuilt only when name/health change. Selector thumbnails are 2D blits, not 45 extra WebGL players. Menu preview is one extra `PlayerVisual` + small WebGL context, disposed when leaving the menu.

## Known issues

- Owner two-client visual acceptance is still required.
- Custom PNG import remains deferred.

## Deferred

- IndexedDB custom 64×64 PNG import
- Pause-menu skin change while already in a world (main menu + join/`appearance` cover the requested flow)

## Next work

Owner live QA: main-menu preview, all 45 cards, cancel vs confirm, Anarchy reconnect/restart skin, remote nameplate HP and invisibility.

## Git

Branch `cursor/player-skin-selector-sync-5fe9`
