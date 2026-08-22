# Special item / door / ladder / lever pass

Date: 2026-08-22  
Branch: `cursor/minecraft-item-pipeline-rework-935a`  
Git: **no commit, no push** (per task)

## Goal

Fix held/world visuals for special-shaped block items that were still using a full cube in hand or in the world, without touching the finalized generated/handheld pose or starting climbing / GUI / flight / perf work.

## Result

- Held mesh routing is now `block_cube` | `generated` | `special_model` inside the existing `ItemVisualFactory` / `itemRenderProfiles` path.
- Lever, ladder and oak_door held items are generated sprites (vanilla 1.21.8 item JSON), not cubes.
- Ladder world geometry is a thin plane on a solid side support with N/S/E/W facing and a matching thin selection box. Climbing is deferred.
- Oak door world model is a 3/16 cuboid with upper/lower textures and hinge-mirrored large-face UVs. Open/close gameplay is unchanged.
- Shield stays in the registry and combat code but is hidden from obtainable gameplay.
- `FIRST_PERSON_SPRITE_POSE` and `GeneratedItemGeometry` were not changed.

## Special item audit

Vanilla 1.21.8 Faithful in this repo is **textures only** (no model JSON). Item JSON parents below are from vanilla 1.21.8, mapped onto existing pack files.

| Item ID | Before held | Before world | Full cube? | Expected Minecraft-like held | After | Fix now? | Deferred? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| torch / redstone_torch | generated sprite | `addTorch` cuboid | no | generated (`item/torch`) | unchanged | A already OK | |
| lever | **atlas cube** (generated *pose*) | `addLever` base+handle | no | generated `item/generated` + `block/lever` | generated sprite | **yes held** | placed gameplay kept |
| ladder | atlas cube (block pose) | **full cube** | visual yes | generated `item/generated` + `block/ladder` | generated held + thin world plane | **yes held+world** | **climbing deferred** |
| oak_door | **atlas cube** | thin 2-plane, wrong UV | no | generated `item/oak_door` (missing PNG) | generated composite held + 3/16 cuboid UV | **yes held+world UV** | hinge placement always `left` |
| stone_button | atlas cube (generated pose) | `addButton` | no | block inventory cuboid | `special_model` + block pose | B, same routing | |
| oak_pressure_plate | atlas cube (block pose) | `addPressurePlate` | no | block inventory cuboid | `special_model` | B, same routing | |
| redstone_dust | generated sprite | wire quad | n/a | generated | unchanged | A | |
| chest | cube | cube | yes (placeholder) | chest entity model | unchanged | C | next special-block pass |
| oak/stone/cobble slab | cube | cube (half collision) | visual yes | slab model | unchanged | C | |
| oak/stone/cobble stairs | cube | cube | yes | stairs model | unchanged | C | |
| white_bed | cube | cube | yes | bed item/block | unchanged | C | |
| shield | generated sprite (wrong visual) | n/a | n/a | shield entity | **hidden from gameplay** | hide, do not fix render | rendering later |
| tnt / furnace / crafting_table / wool / ores / logs | cube | cube | yes | cube | unchanged | A | |
| cross plants | no item | cross | n/a | — | — | no item | |

## Lever

**Held:** vanilla 1.21.8 `models/item/lever.json` is `parent: item/generated`, `layer0: block/lever`. Held path now uses `GeneratedItemGeometry` on `block/lever.png` (Faithful 32×32). Not a cube. Shares `FIRST_PERSON_SPRITE_POSE`.

**Placed:** existing `ChunkMesher.addLever` (stone base + pivoted handle, attachment/facing/powered) unchanged. Selection still two oriented boxes.

## Ladder

**Held:** vanilla 1.21.8 `models/item/ladder.json` is `item/generated` + `block/ladder`. Generated sprite, 1/16 thick, readable ladder texture.

**World:** `renderShape: 'ladder'`. Vanilla `block/ladder.json` is a plane at 15.2/16; we place it `LADDER_PLANE = 0.8/16` from the support face. `facing` uses the same clicked-face normal convention as wall torch (support is opposite `facing`). Double-sided quads, south UV u-flipped. Selection depth `LADDER_DEPTH = 1.6/16`.

**Placement:** only a vertical face of a **solid** support. Floor/ceiling rejected. Orientation N/S/E/W from the hit normal.

**Climbing mechanics: DEFERRED.** No climb up/down, fall-speed override, friction, or player ladder state.

## Oak door

**Held:** vanilla item is `item/generated` + `item/oak_door.png`. Pack has no item texture; runtime composites `block/oak_door_upper` over `block/oak_door` into a 32×32 generated sprite (`generated/oak_door_item`). Shares the final sprite pose.

**World:** 3/16 cuboid on the occupied face (same occupied-face mapping as collision: closed uses `facing`, open swings by hinge). Lower half → `block/oak_door`, upper → `block/oak_door_upper`. Large faces use full half-texture with U-mirror for hinge left/right; edges use the 3-pixel strip, not a repeated full-cube UV.

**Interaction:** existing open/close of both halves kept. Placement still writes `hinge: 'left'`. Not a door gameplay rewrite.

## Shield

**Strategy:** keep registry entry, combat, FirstPersonRenderer shield pose, inventory off-hand API and historical tests. Mark `hiddenFromGameplay: true`.

Removed from:

- Creative catalog (`obtainableItems()`)
- Crafting recipes (shield recipe deleted)
- Normal obtainable UI lists

Not in mob loot or `HELD_ITEM_POSE_COMPARE_ITEMS`. Old saves that still contain a shield stack can render/use it; new players cannot obtain it.

## Other special items

- **stone_button / oak_pressure_plate:** obvious cube-held bugs; fixed via `special_model` (vanilla `button_inventory` / `pressure_plate_up` cuboids).
- **chest, slabs, stairs, bed:** deferred (need larger model/GUI/state work).
- **torch / redstone_torch / redstone_dust:** already acceptable.

## Architecture

No `ItemVisualFactory2`. Routing lives in `itemHeldMeshKind()`:

1. `generated` — `GeneratedItemGeometry` (tools, resources, torch, lever, ladder, door composite, shield internal)
2. `special_model` — atlas cuboid from vanilla inventory elements (button, plate)
3. `block_cube` — existing 6-face atlas cube

Pose category stays independent (door/lever/ladder still use the shared generated pose; button/plate use the block pose).

World special shapes stay in `ChunkMesher` + `specialBlockGeometry`. Shared helpers: `occupiedDoorFacing`, `doorFaceTextureUv`, `ladderPlaneLocal`, `ladderPlacementFromHit`.

## Texture / model reference

- Pack: Faithful 32×32 1.21.8 textures in `public/textures` (`block/lever.png`, `block/ladder.png`, `block/oak_door.png`, `block/oak_door_upper.png`). No model JSON in repo.
- Vanilla 1.21.8 item JSON: lever/ladder generated from block textures; oak_door generated from missing `item/oak_door`.
- Vanilla 1.21.8 block JSON: `ladder.json` plane 15.2/16; `door_bottom/top_left/right` cuboid 0–3 × 0–16 × 0–16 with hinge UV flip.
- Door item composite is a stand-in for the missing item PNG, not a custom Faithful model.

## Tests

`tests/special-block-items.test.ts` plus updates to item-rendering, block-registry, crafting, lighting-physics.

`npm run check`: typecheck PASS, 23 files / 165 tests PASS, production build 75 modules, 0.94 MiB / 165 files. Main JS 741.32 kB / 200.49 kB gzip.

## Visual QA (local)

Held:

- `?qaItem=lever&qaView=held`
- `?qaItem=ladder&qaView=held`
- `?qaItem=oak_door&qaView=held`

World:

- Place a lever on floor/wall/ceiling; toggle; selection = base + handle, not a cube.
- Place ladders on all four sides of a stone block; thin against the support; selection thin. Walking into them should not climb (deferred).
- Oak door facing N/S/E/W; lower/upper halves; handle not tiled across the panel; open/close still works.
- Creative inventory has no shield; crafting planks+iron does not make a shield.
- Control: `?qaItem=iron_pickaxe&qaView=held` still matches the finalized pose.

## Changed files

- `src/blocks/types.ts`
- `src/blocks/registry.ts`
- `src/blocks/placement.ts`
- `src/items/types.ts`
- `src/items/registry.ts`
- `src/items/itemRenderProfiles.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/world/collision.ts`
- `src/core/Game.ts`
- `src/crafting/recipes.ts`
- `src/ui/GameUI.ts`
- `src/dev/ItemQaHarness.ts`
- `tests/special-block-items.test.ts`
- `tests/item-rendering.test.ts`
- `tests/block-registry.test.ts`
- `tests/crafting.test.ts`
- `tests/lighting-physics-interaction.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/reports/2026-08-22_special-item-door-ladder-lever-pass.md`

## Git

Branch `cursor/minecraft-item-pipeline-rework-935a`. Working tree dirty. **No commit, no push, no merge to main.**

## Deferred / next

- Ladder climbing physics
- Door hinge-from-placement (always left today)
- Chest / slabs / stairs / bed models
- Shield held rendering
- Chest/furnace/crafting GUI, creative flight, performance
