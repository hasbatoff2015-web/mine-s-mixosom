# Block selection raycast and minecart break

Date: 2026-08-25  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

Previous HEAD: `b730acb81b9ed347e229978aa2624c06c3285444`.

HEAD: `f43a587de5aa451ba3ec6c4c27ddaea44e8c9218`.

## Goal

Fix targeting so partial blocks (rail, plates, ladders, …) are only selected when the cursor actually hits their geometry. Allow LMB to break a Minecart into a world drop.

## Exact Root Cause

`World.raycast` DDA correctly walked voxels. For **solid** blocks it already tested `blockCollisionBoxes` (slabs/stairs/doors). For **non-solid** blocks (`solid: false`: rail, torch, lever, plate, ladder, cobweb, fire, plants, …) it returned a hit at **cell entry** with the DDA step normal — occupancy, not geometry.

The selection outline already used `selectionBoxesForBlock()` (low rail AABB, etc.), so the wireframe looked right while interaction used a full 1×1×1 cell. Screenshot: aim at dirt behind a rail, outline/name still said Rail.

## Selection Shape Architecture

Canonical API: `selectionLocalBoxes(block, state, world, x, y, z)` → cell-local AABB[].

- Air / liquid → `[]`
- Ordinary cubes → one full block (`FULL_BLOCK`)
- Specials → one or more AABBs from `renderShape` + block state (rail slope, slab half, fence connections, torch/lever/ladder attachment, door occupied face)

`blockSelectionBoxes` (`src/world/selection.ts`) offsets those into world space via `offsetLocalBoxes`. Collision stays in `blockCollisionBoxes` (rail still has no solid collision; fence collision remains 1.5 high while selection is 1.0). Outline renderer keeps its existing oriented boxes; **target block** is the same `VoxelHit`.

## Raycast

DDA enters a cell → `blockSelectionBoxes` → `rayAabbDistance` on each AABB. Hit only if the ray intersects a box; otherwise continue. Nearest actual intersection wins. Distance and face normal come from that AABB, not voxel entry. Reach is still `PLAYER_REACH` (5) on the intersection distance.

No triangle / Three.js mesh raycasts.

## Blocks Covered

Non-full selection: rail (flat 2/16; ascending = two stepped boxes), pressure plate, torch (floor/wall/ceiling), lever, button, ladder, wire, door, fence (post+arms, connection state), slab, stairs (existing collision decomposition), chest, cactus, cross plants, fire (central volume), cobweb (near-full). Default cubes unchanged.

## Screenshot Regression

Rail at (0,40,0), dirt at (0,40,2). Ray at y=40.5 through the rail cell → Dirt. Ray at y=40.06 → Rail.

## Interaction Consistency

`Game.updateTargetAndActions` uses `world.raycast` for `session.target` (outline + mine + RMB). `resolvePlayerAttackTarget` picks the nearest of block / minecart / mob. If a minecart AABB is closer, outline is cleared and LMB/RMB go to the cart (TNT insert / Flint prime / ride), not the block behind. The currently ridden cart is ignored in player cart raycasts.

## Minecart Break

- LMB attack **edge** (`consumeAttackPressed`) so hold does not spawn extra drops.
- Survival: remove entity, spawn world `ItemDrop` Minecart via `DroppedItemManager`; unprimed TNT cart also drops TNT.
- Creative: remove, **no drop** (same convention as breaking blocks). Pickup of a dropped cart is a Survival check.
- Ridden cart: ignored (own first-person LMB cannot break the cart the player sits in).
- Primed TNT cart: LMB does **not** break/defuse. Flint fuse and Fire Arrow explosion are unchanged.
- Hitbox: normal cart uses `MINECART_HEIGHT` (0.62); TNT variant uses `MINECART_HIT_HEIGHT` (1.15) so the cargo is hittable. Not a 1×2 cube.

## Performance

Analytical AABB tests only; small static local-box constants; no per-frame mesh builds for targeting. `offsetLocalBoxes` allocates a tiny array per occupied DDA cell (typically a handful along reach 5).

## Tests

```text
tsc --noEmit: PASS
Vitest:       52 files, 485 tests, 485 passed
production:   111 modules, 1.14 MiB / 180 files
```

New `tests/block-selection-raycast.test.ts` — 21 tests (screenshot rail, plate, ladder, slabs, stairs, fence, nearest shape, chunk border, normals, shared target, cart break/drop/ridden/TNT/priority/hitbox/pickup, reach).

WebGL/browser screenshot replay was **not** available in this environment. Do not treat visual QA as done.

## Git

Branch `cursor/fluids-and-items-pass-935a`, SHA `f43a587de5aa451ba3ec6c4c27ddaea44e8c9218`, draft PR #6, ordinary push, working tree clean.
