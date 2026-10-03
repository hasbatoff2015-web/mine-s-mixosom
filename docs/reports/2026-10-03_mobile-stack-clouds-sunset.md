# 2026-10-03 — vertical actions, hotbar, tileable clouds, directional sunset

## Goal

Replace the diagonal jump/crouch cluster, enlarge the coarse hotbar, make the inventory button read as a backpack, generate a large tileable cloud mask, let clouds cover the sun without covering world geometry, share one visual viewport with the renderer, and focus sunset warmth on the sun direction.

## Result

Jump is directly above crouch. The hotbar is 42px at 844×390 and 40px at 800×360. Inventory stays 20px off the hotbar and shows a pixel backpack. The cloud tile is 256×256, covers 11.71% of the mask, drifts at 0.16 blocks/second, and sits at `cameraY + 96`. Sun and moon do not write depth. Sunset is stronger toward the sun. Fog stays milder than that glow.

## Implemented

### Audit before the edit

1. Jump: `right = max(10px, safe-right)`, `bottom = max(8px, safe-bottom)`, size `--touch-jump` (70 / 60 / 56).
2. Crouch: `right = safe-right + touch-jump - 16px`, `bottom = safe-bottom + touch-jump - 18px`, size `--touch-crouch` (54 / 46 / 44).
3. The diagonal was those two offsets: crouch was intentionally left and up from jump.
4. At 844×390 the coarse slot clamp could have been 40px, but `(max-height: 430px)` forced `--hotbar-slot: 30px`.
5. 800×360 hit the same 30px override.
6. Inventory `left` was already `50% + --hud-hotbar-half-width + 20px`, same bottom as the hotbar.
7. The icon was the text glyph `▦` in `InputManager`, with `aria-label` and no `title`. No backpack texture exists in the UI assets.
8. `cloudMask` walked a 18×18 cell grid, hashed presence, and stamped one of four 9×5 strings.
9. `CLOUD_SHAPES` length was 4.
10. `CELL` was 18.
11. `CLOUD_MASK_SIZE` was 96.
12. World span was `96 * 2 = 192` blocks.
13. `CLOUD_PLANE` 960 / 192 = 5 repeats per axis. 96 is not divisible by 18, so edge stamps were clipped.
14. Clouds: transparent, `depthWrite` false, `depthTest` true, `renderOrder` -500. Sky: depth test off, depth write off, -1000. Sun and moon: default `MeshBasicMaterial`, so `depthWrite` true, `depthTest` true, `renderOrder` 0. The sun could occlude cloud fragments.
15. `Game.resize` used `window.innerWidth/innerHeight` and only listened to `window` resize. `visualViewport` updated CSS variables and did not resize the renderer.

### Buttons

Shared `--touch-action-size` and `--touch-action-gap`.

- Crouch: `right: max(10px, safe-right)`, `bottom: max(8px, safe-bottom)`, size = `--touch-action-size`.
- Jump: same `right` and size, `bottom: safe + size + gap`.

Normal coarse size is 62px with an 8px gap. Under 430px tall it is 58px. Under 360px tall it is 56px. Both buttons use a square shell: dark outer border, light top-left inset, dark bottom-right inset. Jump is a pixel up arrow. Crouch is a pixel down arrow. Crouch `.is-active` stays amber/gold.

Measured DOM rects, coarse pointer, safe area 0:

844×390

| control | left | top | right | bottom | size |
| --- | ---: | ---: | ---: | ---: | --- |
| jump | 776 | 258 | 834 | 316 | 58×58 |
| crouch | 776 | 324 | 834 | 382 | 58×58 |
| hotbar | 225 | 342 | 619 | 384 | 394×42 |
| slot | 225 | 342 | 267 | 384 | 42×42 |
| offhand | 163 | 342 | 205 | 384 | 42×42 |
| inventory | 639 | 342 | 681 | 384 | 42×42 |

Center X is 805 for both buttons. Vertical gap is 8px. Inventory and offhand both sit 20px off the hotbar.

800×360

| control | left | top | right | bottom | size |
| --- | ---: | ---: | ---: | ---: | --- |
| jump | 734 | 232 | 790 | 288 | 56×56 |
| crouch | 734 | 296 | 790 | 352 | 56×56 |
| hotbar | 212 | 314 | 588 | 354 | 376×40 |
| slot | 212 | 314 | 252 | 354 | 40×40 |
| offhand | 152 | 314 | 192 | 354 | 40×40 |
| inventory | 608 | 314 | 648 | 354 | 40×40 |

Center X is 762. Gap is 8px. Side gaps are 20px. The old 30px slot is gone. Half-width still follows `4.5 * slot + 4 * gap`, so status bars, the selected slot, and the counts stay on the slot size.

### Inventory icon

No existing backpack/bag UI texture. The button keeps the hotbar slot shell and draws a 16×16 SVG of handle, flap, and pack (`shape-rendering="crispEdges"`, leather browns). `aria-label="Инвентарь"` and `title="Инвентарь"`. The tap target is the slot size.

### Viewport

`viewportMetrics()` returns rounded `visualViewport` width and height, or `innerWidth/innerHeight` when that viewport is missing. `#app` uses `--app-width` and `--app-height` from the same helper. `Game.resize` sets the renderer and `camera.aspect` from it. `visualViewport` resize and scroll call `resize()` too, so a collapsing browser bar updates the camera, not only the CSS variable.

A layout viewport of 844×430 with a visual viewport of 844×390 produces renderer size 844×390 and aspect `844/390`.

### Clouds

The old look was a regular 18px grid of four stencils, repeated five times across the plane. Adding more hardcoded shapes would not have changed that.

The new mask is built once from seed `0x51c10d`:

- 256×256 alpha, nearest, no mipmaps, one `DataTexture`.
- 120 centers, toroidal minimum distance 15 texels (30 blocks). A 24–40 group set at these widths covers only a few percent of a 512-block tile, so the count is higher to reach the coverage target without making clouds 50–100 blocks wide.
- Size mix on this seed: 65 small (16–22 blocks wide), 42 medium (24–34), 13 large (36–46). Width:height stays between 1.7 and 3.5.
- Each cloud is a solid horizontal body plus 1–5 overlapping lobes. Lobes that cross `x < 0` or `x >= size` continue on the opposite edge. Cleanup removes 1px spikes and fills single interior holes. No blur.
- Coverage: **11.71%** (`0.1170654296875`).
- World span: `256 * 2 = 512` blocks. The 960 plane repeats the tile `960/512 = 1.875` times per axis.
- Drift: 0.16 blocks/second on +X. About 9.6 blocks per minute.
- Height: `cameraY + 96`. No sky floor.
- `cloudWorldSample` is unchanged in sign: camera X and Z cancel, time moves only U. Tested for +X, -X, +Z, -Z, and a diagonal move.
- One mesh, one draw, geometry is not rebuilt per frame. Per frame: position, UV offset, color, visibility.

### Sun, moon, sunset

Confirmed: the previous sunset band was only `(dir.y - 0.035) * 8.6`, so the warm ring went around the whole horizon.

`uSunDir` comes from the same phase as the sun mesh, `(cos θ, sin θ, 15/70)`. The fragment weight is:

`verticalBand * mix(0.16, 1.0, sunFacing * sunFacing) * uBandStrength`

`sunFacing` is the clamped dot of the horizontal view direction and the horizontal sun direction. The opposite horizon gets the 0.16 side. The sun-facing side gets the full band color.

`skySample` mixes only 28% of the saturated dusk/dawn horizon into the sky horizon, and 16% into the fog color, then still mixes fog 15% toward the zenith. The strongest orange stays in the sky near the sun. `daylightFactor`, ambient `0.14 + daylight * 0.32`, and sun `0.18 + daylight * 1.55` are unchanged.

Sun and moon materials use `depthWrite: false`, `depthTest: true`, `renderOrder` -750. Clouds stay `depthTest: true`, `depthWrite: false`, `renderOrder` -500. The sky dome stays -1000 with depth test off. Opaque world geometry is drawn in the normal pass and still covers the sun and the clouds. Because the sun does not write depth, a later opaque cloud texel can cover the disc.

## Changed files

- `src/style.css`
- `src/input/InputManager.ts`
- `src/input/touchIcons.ts`
- `src/ui/visualViewport.ts`
- `src/core/Game.ts`
- `src/rendering/cloudMask.ts`
- `src/rendering/CloudLayer.ts`
- `src/rendering/SkyDome.ts`
- `src/rendering/skyPalette.ts`
- `tests/mobile-controls-sky-hud.test.ts`
- `tests/mobile-layout-rects.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

## Architecture decisions

- One action size instead of separate jump and crouch sizes, so center X matches without a second offset.
- One coarse hotbar clamp. The short-landscape queries no longer override the slot.
- The backpack is an inline SVG, not a new texture pipeline. No bag asset was already in the UI.
- Cloud groups are more than the 24–40 sketch because that count cannot reach 10% coverage inside the width bands on a 512-block tile.
- Viewport size is a pure function so tests can pass a fake `visualViewport` without a browser.
- Sunset direction is a uniform, not a second sky mesh.

## Tests

- Mask: same seed, same alpha; coverage inside 8–22% (actual 11.71%); more than one width; no `CLOUD_SHAPES`; wrapped rect continues on the opposite edge; no single-pixel interior holes.
- Motion: camera +X, -X, +Z, -Z, and diagonal leave `cloudWorldSample` unchanged. Ten seconds of time moves only U by `10 * 0.16 / 512`.
- Height: `cameraY + 40` moves the sheet by 40. No floor.
- Sun/moon materials do not write depth. Render orders are -1000 / -750 / -500.
- Bow: finger yaw 0.6 is what `aimAfterHoldEnd` keeps for both `pointerup` and `pointercancel` hold-end. Camera yaw 0 is not substituted.
- Viewport helper: visual 844×390 beats layout 844×430. Missing visual viewport uses 1280×720.
- DOM rects: headless Chrome, coarse pointer, 844×390 and 800×360. Jump over crouch, shared center X, gap 8px, slot 42 and 40, 20px side gaps, no overlap with hotbar, inventory, offhand, or the corner.

## Visual QA

Headless Chrome measured the HUD geometry above. A full game screenshot of clouds and sunset was not captured in this pass. The owner checklist is below.

## Performance

One cloud draw, one 256×256 RGBA texture (256 KB), built once. No per-frame mask, no extra meshes, no shadow map.

## Known issues

- Headless Chrome 148's content height is 87px shorter than `--window-size`. The layout test compensates. It is not a game bug.
- Cloud count is 120, above the 24–40 sketch, so the sky reads as many separate clouds rather than a few large ones. Coverage is still 11.71%, not a white ceiling.

## Deferred

- Real-phone confirmation of browser-bar collapse, cloud drift over 30–60 seconds, and sunset contrast.
- Menu `containerUiScale` / `menuUiScale` still read `window.innerWidth/innerHeight`. The game canvas and camera do not.

## Next work

Owner QA:

1. 844×390 or a real phone. Jump directly above crouch. Crouch directly below. Not a diagonal.
2. Hotbar clearly larger. Nine slots fit. Inventory on the right with a readable backpack. Offhand on the left.
3. Collapse and expand the browser bars. The canvas and a touch aim point stay on the finger.
4. Stand still 30–60 seconds. Drift is slow. Clouds differ in size. No stamp grid, no big square holes, no obvious tile seam.
5. Run +X, -X, +Z, -Z, and diagonally. The pattern does not follow the player.
6. Fly up. The layer stays about 96 blocks above the camera.
7. A cloud in front of the sun covers the disc. A tree or building in front covers the cloud.
8. Sunset is strong near the sun and weaker on the opposite horizon. Fog does not flatten the distance into one orange.

## Git

Follow-up commit on `cursor/mobile-controls-sky-hud-f726`. PR #115 stays Draft. Not merged.
