# Mobile HUD, touch retarget, clouds, sunset — 2026-10-02

## Goal

Fix the real-phone HUD and in-game menus, the hold that keeps mining the broken block, clouds that slide with the player on one axis, and the pale sunset band. Stay on `cursor/mobile-controls-sky-hud-f726`. Do not merge.

## Result

The phone layout was following the layout viewport (`100vh`) and a set of `max-width` / `max-height` rules that rebuild menus. Desktop-request mode skips those rules because its layout viewport is wide and already scaled to the screen. The game root now tracks the visual viewport. Menus keep the desktop structure and only scale. Mining re-aims from the current finger. Cloud UVs are world-locked on both X and Z. The sunset band is a tight warm stripe.

## Implemented

- `#app` is fixed to `--app-height` from `visualViewport`, with `100dvh` before that script runs. Menu shells use `dvh`.
- Play-info sits in the bottom-left corner. The joystick is 50px higher and 40px to the right. Inventory copies the offhand slot: 20px past the hotbar, same bottom, same slot size. Jump and crouch are square buttons in the bottom-right. Crouch stays highlighted while toggled.
- `selectstart`, `contextmenu` and `dragstart` on `#app` no-op unless the coarse layout is active. Chat and text fields stay editable.
- Removed the queries that turned the 4-column menu into 2 columns, stacked the main menu, forced `.menu-window` to `100vh`, and shrank pause buttons. `.mc-stage` uses `zoom` on short or narrow screens. Frontier menus under 520px tall use `--menu-fit` (0.5, or 0.42 under 430px).
- Hold classification uses `track.x` / `track.y`. `refreshHoldAim` runs at the start of the player-action tick and after the camera update on the render frame. Bow release sets `releaseAimPending` and clears the aim only in `consumeReleaseAim`.
- Cloud V offset is `-cameraZ / span`. Drift is 0.35 blocks/second. Altitude is `max(118, cameraY + 64)`. Fog is off. The mask is a handful of small silhouettes at 2 world units per texel.
- Sunset gaussian is `(dir.y - 0.035) * 8.6` with mix cap 0.98. Horizon and band colors are saturated orange. Zenith mix is 0.26 so the top of the sky stays cool.

## Changed files

- `src/ui/visualViewport.ts`
- `src/main.ts`
- `src/style.css`
- `src/input/InputManager.ts`
- `src/core/Game.ts`
- `src/rendering/CloudLayer.ts`
- `src/rendering/cloudMask.ts`
- `src/rendering/SkyDome.ts`
- `src/rendering/skyPalette.ts`
- `tests/mobile-controls-sky-hud.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

## Architecture decisions

- One viewport variable, not a second layout system. Touch controls stay siblings of `#hud`. The hotbar half-width is duplicated on `#app` so the inventory button can mirror the offhand slot.
- Menu fit is `zoom` on `.mc-stage` only. Frontier menus already shrink with `min()` against `100dvh` and keep their grid.
- Mining retarget is still `targetKey` / `resolveOnlineMiningTick`. The new work is feeding those paths a fresh ray.
- Cloud motion stays one plane and one UV offset. The Z sign is required by `rotation.x = -PI/2`. Raising the plane with the camera keeps it out of the world without pinning the pattern to the player.

## Tests

- `npx vitest run tests/mobile-controls-sky-hud.test.ts tests/ui-visual-contract.test.mjs tests/player-main-integration.test.ts tests/online-mining.test.ts tests/bow-release-intent.test.ts tests/bow-player-timeline.test.ts tests/creative-flight.test.ts tests/pointer-lock.test.ts tests/clan-gui.test.ts tests/ui-visual-system.test.ts tests/ui-main-integration.test.ts tests/menu-model.test.ts` — 12 files, 107 tests, PASS.
- `npm run typecheck:client` — PASS.
- `npm run typecheck:server` — PASS.
- `npm run check:boundaries` — PASS.
- `npm run build` — PASS. The existing chunk-size warning and the `/sdk.js` bundle note are unchanged.
- `tests/game-menu-gui.test.ts` still calls `python3` + `PIL` for one icon. This environment has no PIL, so that file fails before any layout assert. Not a regression from this change.
- No GitHub Actions workflow is configured. This is not a CI PASS.

## Visual QA

Headless Chrome, SwiftShader. At 844×390 with a coarse pointer the main menu keeps two columns, all four actions and the footer sit inside the visual viewport (`--menu-fit: 0.42`). Settings stays a two-column form; Apply and Back are both on screen. At 1280×720 with a fine pointer, touch controls are `display: none`, menu zoom is 1, and the center grid is `520px 300px`. Inventory’s left edge is 20px past the hotbar half-width, matching the offhand gap. A physical phone was not available.

## Performance

Clouds are still one transparent draw, mask built once, fog off. The sky change is a tighter gaussian in the existing fragment. `refreshHoldAim` is one raycast while a finger is down.

## Known issues

- Headless emulation is not a phone browser bar. The visual-viewport binding needs a device pass with the bar visible and hidden.
- `.mc-stage { zoom }` is the fit path for the Minecraft panels. Very wide craft panels on a short phone are scaled, not reflowed.

## Deferred

- Real-device confirmation of the checklist below.
- No change to reach, prediction, lighting formulas, or the server mining lifecycle.

## Manual QA

MOBILE LAYOUT

- Real mobile browser, landscape, not desktop-request.
- With the browser bar visible and after it hides.
- HUD stays on the visible bottom.
- Play-info is the bottom-left corner. Text is `Игроков: N` and `X: n  Y: n  Z: n`, including negatives.
- Joystick is above that text and to the right.
- Hotbar is one row. Inventory button is immediately right of it, same gap as the offhand slot on the left.
- Jump and crouch are the bottom-right pair. Crouch stays lit while toggled.
- Pause, chat and menu are a compact row at the top-right.
- Long-press does not select HUD text or show a callout. Chat input still edits.

MOBILE MENU

- Main menu, homes, friends, and another panel.
- Same grid, close, back, fields and toggles as desktop. Only the whole panel may be smaller.

TOUCH

- Hold-mine block A, break it, drag to block B without lifting. Mining continues on B. Repeat online.
- Leave the finger still after the break. The ray may enter the block behind A and must start that block, not keep A's progress.
- Air under the finger stops the old mining target.
- Draw a bow, move the finger, release. The shot uses that last finger aim.
- Hold a food or milk item.

CLOUDS

- Stand still and watch a slow drift.
- Run on X, then turn 90° and run on Z. The layer must not stick to the player on either axis.
- Fly up and look at a tall build. Clouds stay above both.
- The clouds checkbox hides and shows them.

SUNSET

- Sunrise and sunset show a warm band on the horizon and a cooler sky above it, including when not looking at the sun.

## Next work

Owner pass on a real phone using the checklist above.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. PR #115 stays Draft. Not merged.
