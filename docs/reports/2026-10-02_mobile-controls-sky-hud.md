# 2026-10-02 — mobile controls, sky gradient, play-info HUD

## Goal

Make touch play usable without changing desktop controls: a horizontal hotbar, fewer buttons, tap/hold/swipe that become the existing attack/use/mine intents, a cheap day-night sky, and a small online + coordinate readout.

## Result

Touch chrome is coarse-pointer only. The hotbar is a non-wrapping row. Jump is momentary, crouch toggles and highlights, and world touches do not rotate the camera once they are a tap or a hold. The sky is one gradient dome. `#play-info` shows the player count and floored coordinates.

## Root cause

`#hotbar` was `display: grid` with `grid-template-columns: repeat(9, var(--hud-slot-size))`. On `(pointer: coarse)` and also on any viewport `max-width: 900px`, `--hud-scale` became `clamp(0.72, calc(0.52 + 0.03vw), 0.86)`. `0.52 + 0.03vw` is an invalid `calc` (a number plus a length), so the custom property was invalid, the grid tracks were dropped, and the nine `.slot` buttons (`display: grid`, `aspect-ratio: 1`, `min-width: 0`) auto-placed into a single column. Desktop `--hud-scale: 1` stayed valid, which is why the hotbar only failed on phones and narrow windows.

The old touch UI also had separate mine, use, sprint and pause buttons, and the look zone rotated on every `pointermove` with no deadzone. That CSS was shown for the coarse pointer **or** a window under 900px, so a narrow desktop got the phone controls.

Dawn and dusk were one `THREE.Color` lerped in `Game.updateEnvironment` and assigned to `scene.background` and fog. There was no zenith/horizon split.

## Implemented

- `touchGesture.ts`: pending → swipe at 18px, pending → hold at 200ms if still inside 18px. Deadzone is 10px. After swipe, the finger cannot attack. After hold, the finger cannot look.
- `mobileTouch.ts`: stick sprint at deflection 0.82, crouch toggle, tap/hold intent, auto-jump probe, clouds checkbox reader.
- `InputManager`: jump, sneak, inventory only. `interactionLook()` is a parallel aim. `armAutoJump` lasts until the next gameplay `movement()` sample, then `Game` clears it.
- `Game.classifyWorldTouch`: camera ray picks the visible point, then the eye ray uses `PLAYER_REACH` / melee 3. Pets and empty rideable carts are use. Players and hostile mobs are attack. Doors and other `isUseTargetBlock` targets are use. A breakable block holds as mine. Food, bow and sword hold as `use-hold` only when the finger is not on a block.
- Auto-jump probes 0.52 blocks ahead. A box taller than the shared 0.6 step arms `jump` for the next tick. Slabs do not. Creative, sneak, fly, water, lava and ladders do not.
- `SkyDome` + `skySample`. Lighting intensities are unchanged: ambient `0.14 + daylight * 0.32`, sun `0.18 + daylight * 1.55`.
- Clouds live in the sky fragment. Settings checkbox, default on.
- `#play-info`: `Игроков: N` and floored X/Y/Z. Online count is remote players plus the local player.

## Changed files

- `src/input/touchGesture.ts`, `src/input/mobileTouch.ts`, `src/input/InputManager.ts`
- `src/core/Game.ts`, `src/player/localAim.ts`
- `src/rendering/SkyDome.ts`, `src/rendering/skyPalette.ts`
- `src/ui/GameUI.ts`, `src/ui/playInfoHud.ts`, `src/style.css`
- `tests/mobile-controls-sky-hud.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- No protocol field for auto-jump or touch aim. The client still sends `jump` and the existing attack/use/break actions. The server keeps the eye ray.
- Interaction aim does not write `input.yaw`, so a tap does not turn movement.
- One sky draw. No second cloud mesh, no lighting change.
- Portrait stays on the rotate overlay.

## Tests

- `npx vitest run tests/mobile-controls-sky-hud.test.ts tests/ui-visual-contract.test.mjs tests/player-main-integration.test.ts` — pass (24).
- `npm run typecheck:client` — pass.
- `npm run typecheck:server` — pass.
- `npm run check:boundaries` — pass.
- `npm run build` — pass. Vite still warns that the main chunk is over 500 kB; that warning is pre-existing.
- Headless Chrome computed style: desktop 1280×713 hotbar `flex` / `row` / `nowrap`, touch controls `display: none`, nine slots on one row (the selected slot sits 4px higher because of `translateY(-3px)`). Coarse emulation: look zone and actions visible, crouch highlight `rgba(232, 168, 62, 0.92)`, jump 68px, hotbar still one row. Narrow fine pointer 700×400: touch controls hidden, hotbar still one row at the short-landscape 30px slot.

## Visual QA

Not played inside the live world. The CSS check above is the layout proof. In-game sky, mining and combat still need a device pass (checklist below).

## Performance

No frame-time numbers were captured. The sky adds one mesh and one shader draw already in the scene; stars and clouds are extra branches in that fragment, not extra draw calls. The play-info node writes `textContent` only when the string changes, and `refreshHud` is still every second tick. The hotbar no longer depends on a media-query grid rebuild.

## Known issues

- A tap on a plain block is one punch. Breaking starts on the 200ms hold, including tall grass.
- A minecart that cannot be boarded does not break from a tap. Rideable carts are use.
- Auto-jump happens on the tick after the obstacle is seen.
- Landscape windows shorter than 430px, including desktop, use a 30px hotbar slot so the row still fits.

## Deferred

A separate cloud mesh, shadows, or weather. The shader clouds can be turned off if they look noisy.

## Next work

Owner QA on a phone in landscape: hotbar after the browser chrome collapses, tap versus swipe on a player, hold-to-mine, crouch highlight, sky at dawn and night.

## Git

Branch `cursor/mobile-controls-sky-hud-f726` from `origin/main` `a57dfd9dbb409e4f98265cf6c922bc67366e631c`. Not merged.
