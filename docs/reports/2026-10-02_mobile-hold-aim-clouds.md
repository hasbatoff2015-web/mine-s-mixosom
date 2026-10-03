# 2026-10-02 — mobile hold aim, buttons, visible clouds

## Goal

Correct the first mobile/sky/HUD pass without rewriting it. `pointercancel` must not become a tap. A mining hold must follow the finger. Bow, food and milk must hold-use even over a block. Placement must work on an unbreakable face. Creative flight needs a down control. The action buttons must sit clear of pause/chat/menu. Gameplay text must not select. Coordinates are one line. Clouds must read as a block layer.

## Result

Client intent is unchanged in kind: attack, use, mine, and the existing online mining tick. The server still owns the ray result. A cancelled pending touch does nothing. A hold keeps its phase, does not rotate the camera, and moves `interactionAim` with the finger. Clouds are one plane. The sky gradient, stars and light formulas are the previous ones.

## Root cause

`pointerup` and `pointercancel` both called `finishWorldTouch` → `finishTouchTrack`. A pending cancel inside 200ms and 18px returned `tap`, so the browser aborting the gesture could attack, use or place.

`advanceTouchTrack` updates `x/y` after the phase leaves `pending`, but `beginWorldHold` ran only on the pending→hold edge and classified `originX/originY`. Later moves did not call `aimAtClientPoint`. The camera correctly stayed still, so the eye ray stayed on the first block. After that block broke, the same ray continued into the block behind it.

`resolveMobileTouchIntent` checked a breakable block before continuous use, so a bow, food or milk held over a block mined it. `isTapUseItem` included `MilkBucket` even though the registry marks it `kind: 'food'`, `alwaysEdible`, `returnsItem: Bucket`, `clearsEffects`. Placement required `breakableBlock`, so a dirt tap on bedrock was `none`.

`movement.descend` was only the desktop Shift keys. `touchSneak` set `sneak` and not `descend`. `updateFlyVelocity` is the only reader of `descend`, and it runs only while `isFlying`.

`#touch-actions button[data-action="inventory"]` was `position: fixed` in the top-right, on top of `#hud-corner`. Jump and crouch were a column whose height met that column on a short landscape phone.

The sky fragment mixed a faint hash into the sky color and multiplied it by `1 - starOpacity`, so the patches vanished at night and did not read as a cloud layer when looking ahead.

`#play-info` was offset by the hotbar and the status icons, so it sat well above the bottom-left corner. Coordinates were three lines.

## Implemented

- `resolvePointerEnd`: cancel of pending or swipe is `ignore`. Cancel of hold is `hold-end`. `pointerup` still uses `finishTouchTrack`.
- `cancelWorldTouchGesture` clears the timer, the track and the aim. A hold-end calls `endWorldHold` (`miningReleased` / `useReleased` only if those flags were on). No new `attackPressed` or `usePressed`.
- `followHoldAim` runs on `pointermove` while the phase is already `hold` and the committed intent is `mine` or `use-hold`. It writes `interactionAim` and does not press again.
- Hold order: priority held-use (bow, any `kind: 'food'` including milk), then attack, entity use, interactive block, breakable mine, then sword `use-hold`.
- Tap placement uses `hasBlockTarget`, not `breakableBlock`.
- `descend` is Shift or `touchSneak`.
- Coarse grid: inventory / crouch / jump. Jump 68px, crouch 52px, inventory 46px. At `max-height: 430px` landscape coarse: 58 / 48 / 44. At 360px: 56 / 46 / 42. `#hud-corner` is a row. `--hotbar-slot` is also set on `#app`.
- `user-select: none`, `-webkit-touch-callout: none`, `-webkit-user-drag: none` on the canvas, stick and buttons. Chat, `.field input`, `textarea` and `[contenteditable="true"]` restore text selection. `#app` prevents `selectstart`, `contextmenu` and `dragstart` unless the target is one of those fields.
- `formatPlayInfo` is `Игроков: N` plus `X: n  Y: n  Z: n`. Desktop bottom/left is `max(10px, safe-area)`. Mobile sits above the joystick.
- `CloudLayer`: one `PlaneGeometry(720, 720)` at Y=84, `renderOrder` -500, nearest 96×96 mask, alpha-test, no depth write. UV offset is `(cameraX + time * 1.6) / span` and `cameraZ / span`. `setEnabled(false)` sets `visible` false. The sky fragment no longer has `uClouds`.

## Changed files

- `src/input/touchGesture.ts`, `src/input/mobileTouch.ts`, `src/input/touchLayout.ts`, `src/input/InputManager.ts`, `src/input/pointerLock.ts`
- `src/core/Game.ts`
- `src/rendering/SkyDome.ts`, `src/rendering/CloudLayer.ts`, `src/rendering/cloudMask.ts`
- `src/ui/playInfoHud.ts`, `src/style.css`
- `tests/mobile-controls-sky-hud.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Hold follow is only `mine` and `use-hold`. A one-shot attack or door use does not re-fire when the finger slides.
- The committed intent is classified at the hold origin. Later moves do not reclassify the gesture into a swipe or a second press.
- Sword hold on a breakable block still mines. Sword hold on air still blocks. Bow and food win over both.
- `descend = Shift || touchSneak` is safe because flight is the only consumer. Ground stance still reads `sneak`.
- Touch detection stays the primary pointer. A touchscreen laptop with a mouse does not get the stick. Width does not enable it.
- Clouds are a sibling of the sky sphere. The sky follows the camera. The plane follows camera X/Z only and stays at world Y=84. No shadows, no collision, no per-frame geometry.

## Tests

`tests/mobile-controls-sky-hud.test.ts` covers pointercancel, hold retarget (`moveHeldTouch` plus `resolveOnlineMiningTick` start and abandon-start), bow/food/milk, pickaxe mine, unbreakable placement, descend, the one-line HUD, selection CSS, the shared `(pointer: coarse)` query, sky samples, and `CloudLayer.setEnabled`.

Also run: `tests/ui-visual-contract.test.mjs`, `tests/player-main-integration.test.ts`, `tests/online-mining.test.ts`, `tests/pointer-lock.test.ts`, `tests/creative-flight.test.ts`, `tests/mining.test.ts`, `tests/oak-planks-mining-pipeline.test.ts`, `tests/heart-hud.test.ts`, `tests/potion-effects-hud.test.ts`.

## Visual QA

Headless Chrome, software WebGL, emulated `(pointer: coarse)`:

- 960×540: jump 68px bottom-right, crouch 52px to its left, inventory 46px above crouch. No overlap with the hotbar or the top-right row. Play-info sits 6px above the 132px stick.
- 844×390: jump 58, crouch 48, inventory 44. Hotbar one row. Stick 88px. Play-info above the stick.
- 800×360: jump 56, crouch 46, inventory 42. None hidden.
- 700×400 fine pointer: `#touch-actions` and the stick are `display: none`. Play-info bottom is 10px and does not intersect the hotbar.
- Cloud preview of the real `CloudLayer` + `SkyDome`: blocky white groups with gaps when looking slightly up and when looking level (they sit in the upper field of view). Night darkens them and leaves them visible. `clouds=off` removes the plane.

A real phone was not used. Browser chrome resize, iOS callout, and a live mining slide are still owner QA.

## Performance

The mask is built once. Each frame updates the plane position, one UV offset and a color. `visible = false` skips the draw. No CPU mesh rebuild. Clouds ON versus OFF was not timed on a device; do not treat a missing number as a measurement.

## Known issues

- Looking exactly at the horizon puts the clouds in the upper part of the view, not on the center crosshair. That is the flat plane at Y=84.
- A 6px gap between play-info and the stick is tight if the coordinate line wraps. `white-space: pre` keeps it on one line.
- Headless desktop 1280×720 was measured while the loading screen had collapsed `#hud` to 0×0. The narrow fine-pointer window and the CSS `bottom: max(10px, …)` cover that case.

## Deferred

- Real-device pass listed below.
- Clouds ON/OFF frame-time comparison on DEV and a phone.

## Manual QA

Mobile:

1. iPhone landscape.
2. Android landscape.
3. Jump visible bottom-right.
4. Crouch visible beside Jump.
5. Inventory visible and not under TAB/chat/menu.
6. TAB, chat and menu all clickable.
7. No button overlap after the browser bar resizes.
8. Hotbar stays one horizontal row.
9. Joystick stays reachable.
10. No accidental text selection.
11. No long-press context popup on the gameplay surface.
12. Chat input still types.
13. Tap a block.
14. Tap a mob or a player.
15. Swipe rotates the camera only.
16. Hold mines.
17. Mine the first block without releasing.
18. Move the finger right.
19. Mining follows the block to the right.
20. It does not continue along the original ray after the finger moved.
21. Bow hold on a block draws.
22. Bow hold on a player draws.
23. Food hold while aiming at a block eats.
24. Creative fly up and down.
25. Crouch on the ground still toggles.

Desktop:

26. No mobile controls on a fine pointer.
27. Mouse mining unchanged.
28. RMB/use unchanged.
29. Combat unchanged.
30. Hotbar unchanged.
31. A narrow desktop window does not grow a joystick.

Sky:

32. Noon gradient.
33. Pixel clouds are obvious.
34. Looking slightly up, the clouds are obvious.
35. Clouds drift slowly.
36. Clouds OFF removes them.
37. Clouds ON shows them.
38. Dawn.
39. Sunset.
40. Night and stars.

HUD:

41. Desktop bottom-left: player count, coordinates on one line.
42. Mobile HUD above the joystick, no overlap.

## Next work

Owner phone QA for items 1–25 and 32–42. Do not add aim assist, extra reach, or a client-authoritative break.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. Draft PR #115. Not merged.
