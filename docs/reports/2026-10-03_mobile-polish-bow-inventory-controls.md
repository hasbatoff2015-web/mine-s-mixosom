# Mobile polish: bow, inventory, jump, look — 2026-10-03

## Goal

Point fixes on `cursor/mobile-controls-sky-hud-f726` after the sky pass. Do not redesign the sky, fog, or desktop input. Starting HEAD `1d7bbe69f94e2b7ddbc87b0b720f50b68f53323c`. `origin/main` was `a57dfd9dbb409e4f98265cf6c922bc67366e631c`.

## Result

Cloud drift is exactly four times the previous 0.16 blocks/second. Sun and moon are alpha-cutout, so world fragments cover them even past ~72 blocks, and clouds still draw on top. A mobile bow draw rotates the camera and releases through the live crosshair. Container UI uses one viewport scale. A creative tap places the carried stack on the finger immediately. Jump and crouch sit further right. Grounded auto-jump works in survival and creative. Double-tap on the jump button latches jump. Mobile look is twice the old touch baseline. Pinch and gesture zoom are blocked.

## Root causes

- Cloud speed was `CLOUD_DRIFT_BLOCKS_PER_SECOND = 0.16` in `cloudScrollOffset`. World lock was already `(cameraX + time * speed) / span` and `-cameraZ / span`.
- `createCelestialMaterial` used `transparent: true` with `depthWrite: false`. The disc is ~71.6 blocks away and is drawn in the transparent pass, so a farther tree failed to hide it.
- Bow and food shared `use-hold`. `shouldFollowHoldAim` stored the finger ray, and `sampleLocalAim` prefers that ray over the camera. `releaseBow` and `sendOnlineBowRelease` both sample that aim.
- `.mc-stage { zoom: 0.74 / 0.58 }` ran after `containerUiScaleWithClose`, so a landscape phone scaled the inventory twice. Scale also read `window.innerWidth/innerHeight` instead of `viewportMetrics()`.
- `#cursor-stack` is `position: fixed` and only moved on `pointermove`. A tap created the stack and left it at the default position.
- `shouldArmMobileAutoJump` required `!creative`, and `Game.refreshMobileAutoJump` passed creative mode in. Survival was not behind that gate. The arm is still one sample: movement is read, the arm is cleared, the player ticks, then the next arm is computed.
- The viewport meta had `user-scalable=no` but not `maximum-scale=1`. One-finger input was already `touch-action: none`. Pinch and Safari gesture events were not cancelled.
- `TOUCH_LOOK_SCALE` was `1.35` and applied once on the touch path. Desktop `rotate(dx, dy)` does not use it. The slider was not the limit; the touch multiplier was.

## Implemented

- `CLOUD_DRIFT_BASELINE_BLOCKS_PER_SECOND = 0.16`, `CLOUD_DRIFT_SPEED_MULTIPLIER = 4`, live speed `0.64`.
- Celestial material: `transparent: false`, `alphaTest: 0.5`, `depthWrite: false`, `depthTest: true`. Render order stays -750. Clouds stay transparent at -500.
- Intent `bow-hold`. `heldPointerEffect` rotates and clears `interactionAim`. Mining and `use-hold` (food) still keep the finger ray and do not rotate.
- `containerScale` / `menuScale` call `viewportMetrics()`. The `.mc-stage` zoom rules are gone. `#cursor-stack` defaults to `-9999px`. `pointerdown` remembers the point and `syncCursorStackElement` applies `cursorStackClientPosition` (+18, -36 for touch/pen).
- `--touch-action-right-offset` is 30 / 40 / 36 (was 48 / 58 / 54).
- `mobileAutoJumpArmed` no longer reads gamemode. `isFlying`, sneak, ladder, water, and lava still block it.
- `jumpLockAfterRelease` plus `touchJumpPressed`. `movement().jump` is Space or press or lock or auto-jump. Active style is shared with crouch. `releaseActions` clears the lock (inventory, chat, session end, platform pause).
- `TOUCH_LOOK_BASELINE = 1.35`, `MOBILE_LOOK_MULTIPLIER = 2`, `TOUCH_LOOK_SCALE = 2.70`.
- `bindBrowserZoomLock` cancels gesture events and multi-touch moves. One finger is not cancelled. Viewport meta includes `maximum-scale=1`.
- `setPointerCapture` failure does not skip the jump press.

## Changed files

- `src/rendering/CloudLayer.ts`
- `src/rendering/SkyDome.ts`
- `src/input/mobileTouch.ts`
- `src/input/touchGesture.ts`
- `src/input/InputManager.ts`
- `src/core/Game.ts`
- `src/ui/GameUI.ts`
- `src/ui/containerTheme.ts`
- `src/ui/browserZoom.ts`
- `src/main.ts`
- `src/style.css`
- `index.html`
- `tests/mobile-polish-contracts.test.ts`
- `tests/mobile-controls-sky-hud.test.ts`
- `tests/mobile-layout-rects.test.ts`
- `tests/celestial-distance-fog.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

Client still owns the aim and the jump bit. `captureBowRelease` and `resolveBowReleaseCommandSeq` are unchanged; they receive the sampled yaw/pitch. The server still spawns the arrow. Auto-jump is a normal `jump` bit on the next input sample, including the online prediction send. Desktop mouse look, the sensitivity slider, and Space are untouched. Mining hold still calls `aimAtClientPoint`.

Jump lock resets when a blocking overlay calls `releaseActions`, so closing the inventory does not start a jump. A physical hold is `touchJumpPressed` and is separate from `jumpLock`.

## Tests

- `tests/mobile-polish-contracts.test.ts`: drift ratio, world lock, cutout material, bow release aim versus mining/food, player-tick auto-jump, jump lock, look multiplier, scale, cursor offset, zoom predicates.
- `tests/mobile-layout-rects.test.ts`: Chrome rects at 844×390, 800×360, and 960×500; creative slot size without zoom; WebGL near/far wall versus blended disc; live `GameUI` creative tap.
- Existing sky, bow sequencing, physics, aim, camera, container, and prediction suites were re-run.

## Visual QA

Chrome touch emulation, dev server `127.0.0.1:5173`, new survival world:

- 844×390 HUD: jump 68px at left 726, crouch same X, inventory at 639, no overlap with the hotbar. `visualViewport.scale` stayed 1.
- Survival inventory: `--mc-ui-scale` 2, slot 36px, stage zoom 1, close button 44px and inside the viewport.
- Double-tap on the jump button set `is-active` and `aria-pressed=true`. The button was gold. A second double-tap cleared both.
- Running modules: drift 0.64, look scale 2.7, sun `transparent false`, `alphaTest 0.5`, depth write false, depth test true, order -750.

Headless WebGL, same Three.js build: a cutout disc is covered by a wall both nearer and farther than the disc. The old `transparent: true` disc still paints over the far wall. Texture corners stay the clear color. A transparent cloud plane at render order -500 covers the disc.

Not seen in the live world: a sun disc measured behind a tree farther than 72 blocks, a fired arrow, creative-mode auto-jump on a wall, pinch zoom on a physical phone, or a subjective sweep of the sensitivity slider.

## Performance

No new meshes, passes, or per-frame raycasts. Cloud motion is the same offset multiplied by 4. The celestial material flags do not add a draw. Jump lock is pointer-event state. The zoom listener is four document events and ignores one-finger moves. Cursor position is written on pointerdown and pointermove, not polled.

## Known limitations

- A swipe that crosses 18px before the 200ms hold still becomes a camera swipe and does not start the bow draw. That is the existing swipe contract.
- The jump-lock / Creative Flight overlap is fixed in `docs/reports/2026-10-04_jump-lock-creative-flight.md`. Auto-jump no longer counts as a flight tap.
- Flight descend no longer stays on after the crouch finger lifts. See `docs/reports/2026-10-04_mobile-flight-descend.md`.
- `setPointerCapture` is best-effort. The press still counts if capture throws.

## Deferred

- Owner pass on a physical phone for distant-tree occlusion, bow drag, pinch zoom, and the feel of the 2× look scale.

## Next work

None in this branch beyond review. Do not merge.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. PR #115 stays draft.
