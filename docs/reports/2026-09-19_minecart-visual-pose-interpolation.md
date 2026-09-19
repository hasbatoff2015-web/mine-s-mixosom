# 2026-09-19 Minecart visual pose interpolation

## Goal

Stop the minecart hull stepping/rotating at 20 TPS, and pitch the hull along ascending rails instead of rolling sideways. Rider smoothness and 1.5× max speed stay.

## HEAD before

`392927917d6880c9841485ccdd38853a9eef42d9` on `codex/entity-special-visual-fixes`. `main` was not merged.

## Jitter root cause

`interpolateVisuals(alpha)` already lerped `previousPosition → position`. `applyVisualTransform` then used current `cart.pitch` / `cart.yaw`. Position was render-time; rotation was the simulation tick. At `WALK_SPEED * 1.5` a 90° corner is ~41% of a tick, so yaw could jump ~37° every 50 ms while XYZ stayed smooth.

## Slope-roll root cause

ModelMinecart long axis is local **+X** (`floor` 20×16×2 then `rotation.x = π/2`). Gameplay yaw aims local +Z, so `MINECART_VISUAL_YAW_OFFSET = −π/2` is still required. Pitch was written to `rotation.x`, i.e. around the hull length → visual **roll**.

`sampleRail` pitch is `atan2(-tangentY, hypot(xz))` (negative when climbing).

## New mapping

Single helper `minecartVisualEuler(yaw, pitch)`:

- `x = 0`
- `y = yaw + MINECART_VISUAL_YAW_OFFSET`
- `z = -pitch`

Three.js default Euler XYZ: slope around local Z, then yaw around Y. Local +X follows `(tangentX, tangentY, tangentZ)`.

## Interpolation architecture

Each sim tick copies `previousPosition/Yaw/Pitch`, then `stepCart` writes current. Render:

- position: `interpolateVec3`
- yaw/pitch: `lerpAngle` (shortest path through ±π)

Online: `EntityInterpolationBuffer` now lerps optional pitch. `applyInterpolatedRenderPose` sets previous = current so `interpolateVisuals(1)` is temporally identity and still uses the model-axis mapping.

No rail-aware progress sampling. Cartesian lerp was enough after rotation interpolation.

## Speed / rider

Unchanged: `MINECART_MAX_SPEED = WALK_SPEED * 1.5`, `seatedLocalPlayerVisualOrigin(sampled)`.

## Tests

- four ascending shapes: local +X · tangent ≈ 1, side · (tangent × up) ≈ 1, forward.y > 0
- NS/EW stay level, yaw offset kept
- alpha 0.5 curve yaw and slope pitch
- ±π yaw wrap
- reverse alongSpeed does not flip the nose
- focused: tnt-minecart 18/18, rail-corner-path 10/10, player-visual 18/18, entity-snapshot-interpolation 11/11, entity-host 5/5, server tnt-minecart 5/5, anarchy-gameplay PASS, isolated fire-contact W/S PASS
- typecheck ×4, boundaries, build PASS
- full fire-contact file still hangs on this host (baseline)

## Manual QA

Cursor browser on Vite `localhost:4173`:

- `/?qaSpecial=rails&row=slope`: parked carts on N/S/E/W ascending rails; hull pitched along the rail, not rolled 45° sideways.
- `/?qaSpecial=rails&row=tracks`: hulls stay on the rail at 1.5× speed; yaw offset intact. Cartesian corner lerp looked acceptable; no rail-aware sampling added.
- `/?qaSpecial=seated`: rider pose unchanged (upright, hip 90°, legs in cart).

Live third-person generated-world ride and Anarchy observer were not pointer-lock exercised. Online path covered by snapshot interpolator + `applyInterpolatedRenderPose`.

## Git

Feature branch only. No merge to `main`, no rebase, no force push.
