# Cloud field, night sky, larger touch controls — 2026-10-03

## Goal

Replace the stamped cloud bars with a sparse tileable field that reaches the horizon, make the day sky bluer and tick 13000 a real night, and enlarge the coarse joystick and the jump/crouch stack without a longer sprint push. Gameplay daylight stays on the existing formulas.

## Result

The cloud tile is a 512×512 binary field. Coverage is 6.29% across 40 components, and 32 of 64 macro sectors are empty. The plane is 6144 blocks at `cameraY + 128`, so the edge sits 2.39° above the horizon. Visual night is already 1 at tick 13000. Night fog is not darker than the previous baseline. The stick and the action buttons are larger and the stack sits up and to the left, with at least 20 px before the inventory button.

## Implemented

- Deterministic toroidal field in `cloudMask.ts`. Macro weather gates clear sky. Detail noise cuts the edge. A 5×3 pass, hole fill, and a connected-component prune remove specks and 1–2 texel bars. Oversized blobs are split on detail valleys.
- `CloudLayer` plane 6144, height +128, radial fade from 0.86 to 0.98 of the half-extent, world-locked UV, drift 0.16 blocks/second.
- Day palette saturated toward blue. `visualNight` reaches night by sun height −0.22. Fog keeps `smoothstep(0.08, -0.5)`.
- Two star point layers and a weak night haze in `SkyDome`. Moon is a 16×16 billboard. Both custom shaders use `glslVersion: GLSL3`.
- Stick sizes 124 / 116 / 108. Travel cap 36 px. Action sizes 72 / 68 / 64 with shared right and bottom offsets. Effect HUD clears the raised stack.

## Changed files

- `src/rendering/cloudMask.ts`
- `src/rendering/CloudLayer.ts`
- `src/rendering/skyPalette.ts`
- `src/rendering/SkyDome.ts`
- `src/core/Game.ts`
- `src/input/mobileTouch.ts`
- `src/input/InputManager.ts`
- `src/style.css`
- `tests/mobile-controls-sky-hud.test.ts`
- `tests/mobile-layout-rects.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

The old generator started every cloud with a full-width horizontal rectangle and then added lobes. That is why the sky read as dashes even after the four stencil shapes were removed. A minimum distance between centers also spread those dashes evenly. The new mask is a thresholded field, so empty weather cells stay empty and the edge comes from the detail lattice rather than from a bar.

The 960-block plane at +96 ended 11.31° above the horizon. A larger plane does not add triangles: it is still one `PlaneGeometry`. The fade is only in the outer 14%, near that 2.4° edge.

`visualNight` is sky-only. Fog uses the previous night curve and its own colors so the world distance does not darken with the navy zenith. `daylightFactor` is untouched.

`smoothstep(radius, 0, length)` is undefined in GLSL when the first edge is greater than the second. The star core is `1 - smoothstep(0, radius, length)`. The hash avoids `sin` of a large dot product, which collapses in mediump.

## Tests

- Actual mask: deterministic, coverage 5–10%, 20–50 components, no thin bars, aspect ratio > 4 is not the majority, toroidal field, empty macro sectors, camera-invariant world sample, drift only over time.
- Edge elevation of the old 960/+96 plane is about 11.3°. The new plane is under 4° and about 2.39°.
- Tick 13000 `visualNight` and star opacity are above 0.9. Noon zenith is blue. Night fog luminance stays within 5% of the recorded baseline, on the bright side at midnight.
- Source check: ambient `0.14 + daylight * 0.32`, sunlight `0.18 + daylight * 1.55`, `setDaylight(daylight)`, `daylightFactor` body unchanged.
- Headless coarse rects at 844×390 and 800×360: larger stick, vertical stack, shared center X, left/up inset, inventory gap ≥ 20, effect HUD above the stack, no overlap with hotbar, inventory, corner, or play-info.

## Visual QA

Production `SkyDome` and `CloudLayer` were rendered in a minimal scene (flat ground, one column). Noon is a saturated blue with a lighter horizon, irregular cloud groups, and large empty sky. The sheet continues toward the horizon. Tick 13000 is navy, with dark blue-grey clouds and point stars. This is not a full voxel world session.

## Performance

One cloud mesh, one 512×512 `DataTexture` (about 1 MiB, no mipmaps), generated once. Stars and haze are extra math in the existing sky fragment. No cloud shadows, no per-frame texture update.

## Known issues

One component is still large: about 196×146 blocks. The median is 32×32 blocks. It is not a 1 px stripe. A phone pass is still the owner's.

## Deferred

Full survival session screenshots at noon and `/time night`. Real-phone thumb travel.

## Next work

Owner QA listed in the roadmap item.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. Draft PR #115. Not merged.
