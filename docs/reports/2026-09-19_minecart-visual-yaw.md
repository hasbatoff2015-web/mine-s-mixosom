# 2026-09-19 Minecart visual yaw −π/2

## Goal

Orient the minecart hull along the rails. Rails/path were already correct; the cart mesh sat at 90°.

## Result

Visual-only yaw offset on the feature branch. Topology, UV, `cart.yaw`, seated pose and network unchanged. `main` not merged.

## Root cause

`sampleRail` yaw is `atan2(tangentX, tangentZ)`, which Three.js `rotation.y` maps onto local **+Z**. `MinecartVisualFactory` builds a 20×16×2 floor then `rotation.x = π/2`, so length stays on local **+X**. Applying `cart.yaw` directly put the long axis across the track.

## Fix

`MinecartManager.applyVisualTransform` (used by `syncVisual` and `interpolateVisuals`):

`host.setRotation(visual, pitch, cart.yaw + MINECART_VISUAL_YAW_OFFSET, 0)`

`MINECART_VISUAL_YAW_OFFSET = −π/2` so local +X follows the tangent. `+π/2` would also lie on the rail but face the opposite way.

## Changed files

- `src/entities/MinecartManager.ts`
- `tests/tnt-minecart.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Tests

`tests/tnt-minecart.test.ts` NS/EW hull vs tangent; serialize yaw unchanged. Rail-corner-path and seated tests unchanged.

## Git

Feature branch only. No merge to `main`, no rebase, no force push.
