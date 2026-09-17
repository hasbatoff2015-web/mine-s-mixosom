# Pause overlay + larger HUD/chat/pause buttons

## Goal

Two in-game UI changes on the current feature branch:

1. TAB Pause must overlay the live world (chunks, entities, camera), not the Main Menu photo/scene.
2. Chat channel/side sprites, HUD Pause/Chat/Menu, and pause-menu actions should be about 2× larger without stretching PNGs.

## Result

Done. Pause is a translucent overlay on `#game-canvas`. Simulation still pauses. Buttons are larger with preserved aspect ratios. TAB / T / M / Enter / X / Chat ON-OFF behavior is unchanged.

## Implemented

- `showPause` uses `.screen.pause-overlay` (`data-pause-overlay="world"`). It no longer includes `menu-screen` / `submenu-screen`, which were painting `frontier-menu-background.png` over the canvas.
- Overlay background is `rgba(4, 7, 10, 0.42)` with `backdrop-filter: none` so the live frame stays visible. The renderer already continues in `PAUSED`; only the UI layer was covering it with the menu photo.
- Settings/Controls opened from pause pass `overlayWorld` so they stay on the same overlay instead of swapping to the Main Menu photo.
- Chat faces: side height 52→104 (mobile 44→88), tabs 30→60 (mobile 26→52), still `aspect-ratio` + `background-size: contain`.
- HUD corner sprites: 58→116 square, `contain`.
- Pause actions: `min-height: clamp(64px, 13vh, 96px)` (~2× on desktop).
- DEV `?qaUi=pause` uses a sky/terrain canvas stand-in, not the menu photo, so overlay-over-world is checkable without a WebGL session.

## Changed files

- `src/ui/GameUI.ts`, `src/core/Game.ts`, `src/dev/UiQaHarness.ts`, `src/style.css`
- `tests/pause-overlay.test.ts`, `tests/chat-layout.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Do not hide or replace the WebGL canvas on pause. The bug was the Pause *screen class list* inheriting the Main Menu photo.
- Keep `openingPauseMenuPausesSimulation() === true`. Visual freeze of gameplay ticks is unchanged; the camera/world buffers still render the last in-world frame (and online remotes still interpolate as before).
- Pause actions remain CSS graphite `.game-button` (there is no Continue/Settings/Quit PNG). HUD/chat still use the existing sprites.

## Tests

- Pause overlay: no menu-screen/photo on `showPause`; overlay CSS has no `url(`; simulation still PAUSED.
- Chat layout: 104px side / 60px tabs, `contain`.
- HUD: 116×116 `contain` squares.

## Visual QA

`?qaUi=pause|chat-open|menu-root` desktop and landscape. Portrait still uses the rotate overlay.

## Performance

No tick/mesh/network rate changes. Overlay is a single translucent DOM layer.

## Known issues

Very short landscape still clamps pause button height to 64px so three actions fit.

## Deferred

No dedicated pause-button PNG sheet.

## Next work

None required for these two changes.

## Git

Branch `cursor/ui-redesign-a8dc`. No merge to `main`.
