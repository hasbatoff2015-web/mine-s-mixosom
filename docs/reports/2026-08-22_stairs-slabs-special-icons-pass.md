# 2026-08-22 Stairs / slabs / special icons pass

## Goal

Continue the SPECIAL BLOCK ITEMS pass on `cursor/minecraft-item-pipeline-rework-935a` after accepted commit `a3925bc` (ladder + door held visuals). Fix stairs and slabs so they are real half/stair geometry (world, collision, selection, held, inventory icons), hide unobtainable `stone_stairs`, add missing wood/brick/stone-brick counterparts plus `stone_pressure_plate`, and make special-item icons match their item models. Do **not** change finalized `GeneratedItemGeometry` or `FIRST_PERSON_SPRITE_POSE`. No GUI/chest/furnace/recipe-book/creative-flight/general performance work. No commit / push / merge.

## Result

Implemented. `npm run check` green (tsc, 189 tests, vite production build). Corner stair joining is in (vanilla neighbor-derived shape, not saved). `stone_stairs` remains in the registry for old saves but is hidden from gameplay. Generic player step-up (already 0.6) walks stairs without a ladder/climb mode.

## Audit (before this pass)

### Plank families that actually exist

Only three wood plank blocks: `oak_planks`, `birch_planks`, `spruce_planks`. No jungle / acacia / dark oak. New stairs/slabs were added only for those three.

### Stairs (before)

| ID | Numeric | renderShape | notes |
| --- | --- | --- | --- |
| `oak_stairs` | 123 | cube | full cube visual + collision |
| `stone_stairs` | 124 | cube | obtainable in Creative + recipe |
| `cobblestone_stairs` | 125 | cube | full cube |

Missing: `birch_stairs`, `spruce_stairs`, `brick_stairs`, `stone_brick_stairs`.

### Slabs (before)

| ID | Numeric | visual | collision |
| --- | --- | --- | --- |
| `oak_slab` | 120 | cube | already 0..0.5 (bottom only, no state) |
| `stone_slab` | 121 | cube | 0..0.5 |
| `cobblestone_slab` | 122 | cube | 0..0.5 |

Missing: birch/spruce wood slabs, `brick_slab`, `stone_brick_slab`. No `slabType`, no top slab, no double merge.

### Other

- `BlockState.half` already existed for **doors**. Stairs now use separate `stairHalf`.
- Pressure plates: only `oak_pressure_plate` (108). Redstone occupancy hardcoded to that ID.
- Icons: `GameUI.itemIcon` used `TextureAtlas.url(definition.texture)` — a 2D PNG. `stone_button` looked like a full stone cube.
- Collision: single `blockCollisionBox`. Player already had generic `STEP_HEIGHT = 0.6`.
- Raycast: any non-air non-liquid cell was a full-cube hit.
- Recipes: loop over oak/stone/cobblestone → 6 slabs, 4 stairs (including `stone_stairs`).

### Blocks without slab/stair counterparts (not invented)

Sandstone, dirt, grass, ores, logs, wool, glass, etc. Only families that already had a stairs/slab story (or obvious brick/stone-brick parity with existing cube blocks) were extended.

## Stairs

**IDs:** `oak_stairs`, `birch_stairs`, `spruce_stairs`, `cobblestone_stairs`, `brick_stairs`, `stone_brick_stairs`. Hidden: `stone_stairs`.

**Geometry:** two (straight) or more (inner/outer corner) cuboids. Straight = full 1×0.5 footprint + 0.5×0.5 upper step. Authoring is east-facing, then Y-rotated. Top half is a Y-flip. UVs come from the source block texture (planks / cobble / bricks / stone bricks) per-face, not a painted cube.

**State stored:** `facing` (N/S/E/W), `stairHalf` (`bottom` | `top`). Missing facing → **north**; missing half → bottom.

**Shape not stored:** `straight` / `inner_left` / `inner_right` / `outer_left` / `outer_right` is derived from neighboring stairs at mesh and collision time (vanilla-like).

**Placement:** look-based facing; clicked top face or local Y > 0.5 → top half. Not a ladder.

**Collision / movement:** `blockCollisionBoxes()` returns the same boxes as the visual. Player iterates **each** box (union AABB would make stairs a full cube and break step-up). Generic step-up 0.6; walking onto east oak stairs is covered by a physics test. Descent / jump / side collision use the same solver.

**Selection / raycast:** outline and DDA hits use the collision boxes. Empty space in the cell (e.g. air above a bottom slab, missing stair corner) is miss-through.

**Held / inventory:** `special_model` via `ItemVisualFactory` + `buildStairCuboids` (bottom, east-facing item pose). Not `GeneratedItemGeometry`.

## Slabs

**IDs:** `oak_slab`, `birch_slab`, `spruce_slab`, `stone_slab`, `cobblestone_slab`, `brick_slab`, `stone_brick_slab`.

**State:** `slabType`: `bottom` | `top` | `double`. Missing → `bottom` (old saves).

**World:** single cuboid 0..0.5 or 0.5..1; double is a full cube (meshed as a cube so neighbor occlusion works). Double occludes faces for meshing; LightEngine still uses static `occludesFaces` (single/double both non-occluding for sky — same as pre-pass slabs).

**Placement:** empty cell uses clicked face + local Y (Minecraft-like). Same numeric ID in the cell merges to `double`. Different materials never merge.

**Break:** double slab drops 2 items.

**Held:** always a **single** bottom slab cuboid, even if the world block is double.

## Stone pressure plate

- Registry: `stone_pressure_plate` = 110 (`BlockIds.StonePressurePlate`).
- Creative + `allObtainableItems`.
- World/held/icon: same thin plate model as oak, stone texture.
- Placement: only on a solid support below (shared with wooden plate).
- Mechanics: same occupancy/power pipeline. `pressurePlateTrigger`: oak = `all` (items included), stone = `living` (player + mobs). Not a second redstone system.

## Item icons

**Was wrong:** every item used the source block PNG in the slot, so buttons/stairs/slabs/plates looked like full cubes.

**Now:** `itemIconDescriptor()` in `src/items/itemIcons.ts` chooses `texture` vs `special_preview`. `ItemIconRenderer` renders the canonical special mesh offscreen with the game WebGLRenderer, caches a data URL. Category isometric angle is shared (`[30, 225, 0]`); padding differs by category (stairs 1.18, slab 1.22, button 2.35, plate 1.42) — not per oak/birch/stone. Ordinary cubes and generated sprites (torch/lever/ladder) stay 2D atlas/item texture. Oak door can use the composited canvas 2d icon when present.

Held mesh and icon share `ItemVisualFactory.createSpecialHeldMesh`.

## Architecture

Canonical path:

`blockFamilies.ts` → registry (`renderShape`, `blockFamily`, `hiddenFromGameplay`) → `specialBlockGeometry` (world + held cuboids) → `ChunkMesher` extra pass → `blockCollisionBoxes` / WorldRenderer selection / `raycastVoxel` → `ItemVisualFactory` → `ItemIconRenderer` / GameUI.

No `OakStairsRenderer`. Adding spruce was family row + registry IDs + recipes from the family list.

Caches: special face geometry is still merged into the chunk BufferGeometry; no per-placed Three.js Mesh. Held/icon meshes are factory-cached by item id.

## Recipes

Vanilla 1.21.8 counts (checked against Minecraft Wiki / 1.21 data):

- Stairs: 6 source in stair pattern → **4** stairs.
- Slabs: 3 source in a row → **6** slabs.
- Stone pressure plate: 2 stone side by side → **1**.
- Wooden pressure plate unchanged (2 planks).
- No recipe for `stone_stairs`.
- Wood slab/stair burn times 150 / 300 added next to plank fuel.

## Save compatibility

- Numeric IDs for oak/stone/cobble slabs and stairs unchanged.
- New IDs 110 (stone plate), 126–129 (extra slabs), 136–139 (extra stairs) are additive.
- Old slab without `slabType` → bottom.
- Old stairs without `facing`/`stairHalf` → north + bottom.
- `stone_stairs` in an old world still loads; it now renders/collides as real stairs but is hidden from Creative/recipes/search.
- `BlockState.half` still means door half; do not reuse for stairs.

## Deferred

- Sandstone (and other non-family blocks) still have no slab/stair.
- Double-slab light occlusion in LightEngine (mesher occlusion is correct).
- GUI / chest / furnace / recipe book / creative flight / general performance (out of scope).
- Ladder climbing still deferred (stairs are **not** a substitute).
- Bed/chest still cube-ish.
- If wooden vs stone plate trigger distinction needs more vanilla fidelity (projectiles, sneaking, etc.), extend `pressurePlateTrigger` rather than a new system.

Corner stairs are **not** deferred — they are implemented.

## Tests

`npm run check` — pass.

- tsc
- 24 files / 189 tests
- vite 78 modules, 0.96 MiB / 165 files

New: `tests/stairs-slabs-icons.test.ts`. Extended player physics (stair step-up), recipes, collision, redstone occupancy, GameUI icon test (3D button vs atlas stone). `FIRST_PERSON_SPRITE_POSE` lock and `GeneratedItemGeometry` tests remain green.

## Visual QA

Manual checklist for a normal Creative/Survival session (do not start chest GUI / recipe book / flight work):

### Stairs

- Oak stairs: shape is two boxes, not a cube; plank texture, not a painted cube.
- Another wood species (birch or spruce): same geometry, matching plank texture.
- Cobblestone / brick / stone brick stairs: matching source textures.
- Place facing north, south, east, west — step faces the look direction.
- Bottom vs top half (click upper vs lower part of a side face / underside).
- Series of several stairs walking **up**; series walking **down**.
- Normal WASD walking steps up 0.5 then the next block; no climb/ladder feel; jump on stairs still works.
- Side collision against the tall face; empty corner of an outer stair is walkable/air.
- Two stairs meeting at a corner form inner/outer joins (not two independent straights overlapping as cubes).
- Held item in first person is a stair model, not a cube.
- `stone_stairs` is absent from Creative search and crafting.

### Slabs

- Bottom slab: stand on it at +0.5; selection is half height.
- Top slab: walk under it if there is room; head/side collision at Y 0.5..1.
- Same material twice → double full block (collision, visual, selection).
- Oak slab + cobblestone slab do **not** merge.
- Held item is a single half slab even after placing a double.
- Inventory icon is a half block, not a full cube.

### Pressure plates

- Oak plate: thin wood, place only on top of a solid support.
- Stone plate: thin stone; obtainable in Creative and via 2-stone recipe.
- Icons are plates, not cubes.
- Activation: oak still triggers from items/entities; stone from player/mobs (items should not power stone).

### Icons

- Creative catalog, survival inventory, and hotbar all agree.
- `stone_button` is a small button, not a stone cube.
- Stairs / slabs / both plates use 3D previews; they fit the slot, are readable, not clipped, not pitch-black.
- Ordinary cubes (`stone`, `oak_planks`, `cobblestone`) still use the usual 2D tile.
- Lever / ladder / torch stay sprite-like (generated path); oak door uses the composited door item, not a plank cube.

### Locked baseline

- Held pickaxe/coal/torch still use the accepted generated path and pose `[0.67, -0.29, -0.70]`, `[1, -90, 34]°`, scale `0.60`.

## Performance

No general pass. Stairs/slabs are extra faces in the existing chunk mesh, not unique Geometry/Material per block.

## Known issues

None newly blocking. Icon WebGL preview needs a live `WebGLRenderer` (normal gameplay). Tests that only construct GameUI without a renderer still get atlas fallback for 3D profiles except where `ItemIconRenderer` is injected.

## Next work

Last visual QA on this branch, then prepare merge to main. Do not start chest GUI in the same pass.

## Git

Branch `cursor/minecraft-item-pipeline-rework-935a`. **No commit, no push** (per task). Working tree dirty with this pass.

## Changed files

New:

- `src/blocks/blockFamilies.ts`
- `src/items/itemIcons.ts`
- `src/rendering/ItemIconRenderer.ts`
- `tests/stairs-slabs-icons.test.ts`
- `docs/reports/2026-08-22_stairs-slabs-special-icons-pass.md`

Modified:

- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`
- `scripts/import-assets.mjs`
- `src/blocks/index.ts`, `src/blocks/placement.ts`, `src/blocks/registry.ts`, `src/blocks/types.ts`
- `src/core/Game.ts`
- `src/crafting/recipes.ts`
- `src/entities/voxelPhysics.ts`
- `src/items/index.ts`, `src/items/itemRenderProfiles.ts`, `src/items/registry.ts`
- `src/player/PlayerController.ts`
- `src/redstone/RedstoneSystem.ts`
- `src/rendering/ChunkMesher.ts`, `src/rendering/ItemVisualFactory.ts`, `src/rendering/WorldRenderer.ts`, `src/rendering/specialBlockGeometry.ts`
- `src/ui/GameUI.ts`
- `src/world/World.ts`, `src/world/collision.ts`
- `tests/block-registry.test.ts`, `tests/crafting.test.ts`, `tests/lighting-torch-selection.test.ts`, `tests/player-physics.test.ts`

Not touched: `GeneratedItemGeometry`, `FIRST_PERSON_SPRITE_POSE` values.
