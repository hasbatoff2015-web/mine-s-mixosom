# Fluids and items feature pass

Date: 2026-08-23  
Branch: `cursor/fluids-and-items-pass-935a`  
HEAD: `4a6cb98`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main` @ `420d31885d8383dfb11765f897d6aac2c548935c`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

## Goal

After worldgen (mountains/caves) landed on `main`, add:

1. Minecraft-like water/lava flow (source + flowing, down then sideways, mix, connected cave lava lakes) without rolling back streaming/lighting/meshing budgets.
2. New gameplay content: flint and steel, cobweb, oak/birch/spruce fences, golden apple, glass bottle, invisibility and regeneration potions, rails, minecart, fire arrow.

## Result

Implemented on a new feature branch from current `main`. Fluids are a budgeted queue, not a full-world rebuild. New blocks reuse `ChunkMesher` / `BLOCK_FAMILIES` / item registry. This cloud environment cannot honestly screenshot WebGL; local QA checklist is below.

## Fluids

### Data model

- Same block IDs: `BlockId.Water` (11), `BlockId.Lava` (12).
- Extra state in `BlockRenderState`: `fluidLevel` (missing → **source 8** for old saves), `fluidFalling`.
- Flowing: levels 1–7. Falling fluid keeps high visual height.

### Tick / update

- Engine: `src/world/fluids.ts`, called from `VoxelWorld.tick()` after scheduled block ticks.
- Water delay 5 ticks, horizontal decay 1 (up to 7 cells).
- Lava delay 30 ticks, decay 2 (shorter reach).
- Downward enter first; if blocked, spread to four horizontal neighbors.
- Unloaded chunks are not treated as air (no flow into the void at the streaming edge).
- Removing a source: flowing cells recompute expected level and become air when unsupported.

### Water / lava interaction

- Mix always converts the **lava cell**:
  - lava source involved → obsidian;
  - otherwise (flowing lava) → cobblestone.
- Isolated flowing lava that would evaporate still mixes if a water neighbor is present.

### Worldgen lava lakes

- Cave scatter (`random01 > 0.94`) removed.
- `lavaLakeMask` + `placeLavaLakes`: noise pockets that require ≥ 2 noise-neighbors, fill cave air from bedrock floor up to a flat surface Y 12 (capped by terrain roof).
- Cells are source lava (no state). Surface oceans/lakes unchanged (`y ≤ SEA_LEVEL`).

### Performance safeguards

- Queue cap **2048**.
- Per tick: **48** updates, **`FLUID_JOB_BUDGET_MS = 1.5`**.
- Writes batched (`applyBlockBatch`, `deferLighting`, `scheduleNeighbors: false`); only fluid neighbors are enqueued.
- Streaming budgets unchanged: `WORLD_JOB_BUDGET_MS = 4`, `WORLD_LIGHT_BUDGET_MS = 2`.
- `npm run benchmark:fluids` — synthetic source flood; queue must stay inside the cap.

Not implemented (on purpose): infinite water springs, water current pushing entities. Flowing UV orientation is deferred if the atlas cannot rotate tiles.

## Fluid surface rendering + streaming regression fix

Date: **2026-08-24**. Parent HEAD before this fix: `7b01c3d`. Draft PR #6 kept. `main` not merged. No force push.

### Goal

Replace the blocky cuboid fluid mesh with a Minecraft-like continuous surface (corner heights, slopes, same-fluid culling) and stop fluid placement from starving chunk streaming. `WORLD_LIGHT_BUDGET_MS = 2` unchanged.

### Exact visual root cause

`ChunkMesher.addFluid` built a uniform cuboid: one `fluidLevel` → one height for all four top vertices (`hNW = hNE = hSW = hSE`). Water/lava have `occludesFaces: false`, so `localFaceCulled` never hid same-fluid vertical faces. The result was a grid of separate translucent platforms / orange slabs (screens 1–2), not one body of liquid (screen 3).

### Fluid mesh

`src/world/fluidSurface.ts` computes **world-space** `fluidCornerHeight(world, cornerX, y, cornerZ, type)` from the four cells that touch that vertical edge. Same fluid above a sample → height 1.0 (full column). Otherwise collect same-fluid surface heights; **any source or falling sample uses max** so source lakes stay flat (~14/16); flowing-only samples average. Simulation `fluidLevel` is not the render height 1:1.

Top face: four vertices at `h00/h10/h01/h11`. No top if the same fluid is above. Shared corners are bit-identical from every adjacent block, including across chunk borders. Water and lava share this path; materials/textures are unchanged. Flowing UV rotation is not in this pass.

### Face culling

Same-fluid neighbors hide the entire shared vertical face (internal grid). Exposed sides vs air use the two edge heights so the wall meets the sloped top. Solid `occludesFaces` still culls. Bottom culls against same fluid or opaque. That is what removes the blue/orange grid, not an epsilon.

### Slopes

A flowing cell next to a higher neighbor gets a high shared edge and a lower outer edge, so the top quad tilts. Adjacent platforms become one ramp.

### Chunk borders

Dirty rule stays boundary-only, plus the **diagonal neighbor at chunk corners** because a world-space corner is shared by four chunks. Corner function does not depend on “current block perspective”, so there is no crack from disagreeing heights.

### Mechanics

Unchanged delays/decay/mix. Horizontal spread now prefers dirs that reach a drop within water 4 / lava 2; otherwise all four dirs (flat ground unchanged). Mix still converts the lava cell and does not requeue no-op writes.

### Streaming root cause

Not the old blocked-head bug. `applyBlockBatch` treated every air→water as `skyChanged` and often `hadBlockLight`, then `queueLight` **merged into one growing AABB**. `processLighting` ran that `pendingLight` region **first** and consumed the 2 ms slice. Unlit wanted chunks waited behind a flood that restarted from the AABB min each frame. HUD: LIGHT ready ~53, oldestCritical ~20 s, MESH blocked, WANTED→VISIBLE ~16 s, mut ~425, dirty ~74, FPS fine.

### What changed for lighting

- `lightingInvalidation`: same sky class + emission + occlusion → **none** (level-only water/lava).
- Air↔water: **local sky column only**, never a region job.
- Air→lava: local sky + `addBlockLightEmitters`.
- Lava/torch removal and opaque swaps: region, leftover budget only.
- `processLighting`: **unlit streaming first**, leftover for region.
- Fluid sim radius: `min(meshRadius, 2)`. Trailing fluids stay queued (`pausedDistant`) and do not compete with the fly ring.
- No-op writes skip setBlock/dirty/light/neighbor schedule. Queue still one pending key per coordinate.

`WORLD_LIGHT_BUDGET_MS` stays **2**. Fluid budget stays 1.5 ms / 48 / cap 2048.

### Equilibrium

Automated: one water source, one lava source, and a 5+5 soak. After settle, 1000 extra ticks: **writes = 0**, mesh/light dirty 0, queue idle. Source removal then 500 extra ticks: no further mutations.

### Tests / HUD

New: `tests/fluid-surface.test.ts`, `tests/fluid-streaming.test.ts`; HUD `FLUID` line and LIGHT origin counts under `?perf=1&chunks=1`.

### Manual QA (short)

1. Water pool from above: one surface, no cell grid.
2. Lava pool from above: not a pile of slabs.
3. Water slope from the side.
4. Lava slope from the side.
5. Waterfall: full column, no thin slab.
6. Chunk-border flow: no crack / duplicate wall.
7. Remove source: drain then idle.
8. Water/lava mix: obsidian / cobblestone.
9. Water then Creative fly: no 10–20 s holes.
10. Lava then Creative fly: same.

This environment cannot screenshot WebGL; geometry tests and headless streaming benches are the automated stand-in.

## Items / blocks / entities

| Content | Behavior |
| --- | --- |
| Flint and steel | Places `fire` on the clicked face or primes TNT. Durability 64. Fire burns out on a scheduled tick. |
| Cobweb | Cross cutout, non-solid. Movement ×0.15 for player/mobs; arrows ×0.25. |
| Oak/birch/spruce fences | One fence per existing plank family. Autoconnect to fences and full cubes. Collision height **1.5**. |
| Golden apple | Food 4/9.6, always edible. Absorption I 2 min (4 extra hearts), Regeneration II 5 s. |
| Glass bottle | Item; returned after drinking a potion. Empty bucket can fill from a **source** liquid. |
| Potion of invisibility | 3 min. Hostile AI `playerTargetable: false`. First-person arms stay visible. |
| Potion of regeneration | Regeneration I, 45 s, heal 1 every 50 ticks (II every 25). |
| Rails | Place on solid support. Autoconnect straight / curve / ascending. |
| Minecart | Place on rails only. Ride (use) / dismount sneak or jump. Slope accel, flat friction. Cap 16. Saved in `minecarts?`. |
| Fire arrow | Shapeless `arrow + lava_bucket`, leftover empty bucket. Bow prefers it. Projectile orange-tinted. Ignites mobs 5 s; primes TNT or places fire on block hit. |

Optional crafts added where cheap: fences, rails, minecart. Brewing stand was not added.

## Assets

Pack tree `assets/minecraft/textures` is absent in this environment. Runtime files live in `public/textures`.

**From the existing pack copy:** `item/golden_apple.png`, `item/arrow.png`, plank textures used by fences, `item/flint.png`.

**Generated fallbacks** (`scripts/generate-missing-textures.mjs`, also called after `assets:import` if mapped pack files are missing):

- `item/flint_and_steel.png`, `item/glass_bottle.png`, `item/potion_invisibility.png`, `item/potion_regeneration.png`
- `item/bucket.png`, `item/water_bucket.png`, `item/lava_bucket.png`
- `item/minecart.png`, `entity/minecart.png`
- `block/cobweb.png`, `block/fire.png`, `block/rail.png`
- `item/fire_arrow.png` — no pack file exists. Icon is a local 16×16 composition (arrow silhouette + fire colors). Projectile uses the shared `entity/arrow` sheet with an orange material tint so the in-flight arrow reads as burning without recoloring normal arrows.

Optional 1.8-style mappings in `import-assets.mjs`: `web.png`, `rail_normal.png`, `fire_layer_0.png`, `flint_and_steel.png`, buckets, `minecart_normal.png`.

## Tests

```text
npm run check → PASS (2026-08-24 surface+streaming fix)
npx tsc --noEmit → PASS
Vitest: 49 files, 424 tests, all passed
Vite build: 103 modules
Size/archive: 1.11 MiB / 180 files
Main JS: 898.65 kB / 248.95 kB gzip
```

New files: `tests/fluids.test.ts`, `tests/content-pass.test.ts`, `tests/fluid-surface.test.ts`, `tests/fluid-streaming.test.ts`.

## Bench / perf notes

- Fluid flood (this fix): water 200 ticks **13.9 ms** total, **max tick 1.88 ms**, peak queue **194**, writes **224**, dedupe **817**, settle tick **25**, late writes **0**. Previous cuboid-flood bench was 7.2 ms / max 1.47 ms / queue 208 — extra cost is local sky columns, still inside the 1.5–2 ms tick band.
- Lava 400 ticks **2.2 ms** total, **max tick 0.69 ms**, peak queue **80**, writes **48**, settle **62**, late writes **0**.
- Fluid-heavy 12×12 pool mesh **12.7 ms / 704 faces** vs dry chunk **7.9 ms / 512 faces** (~1.6×, not a meshing explosion).
- Streaming after water/lava/both + Creative fly (`WORLD_LIGHT_BUDGET_MS = 2`): WANTED→VISIBLE p50 **~3.3 s**, p95 **~5.1 s**, max **~5.2 s**; near-missing max **~6.9–7.0 s**. Same band as the no-fluid radius-6 scheduler test (not 16–20 s holes). Local QA before this fix: WANTED→VISIBLE ~16 s, oldestCritical ~20 s.
- Worldgen 81-chunk batch **545 ms** (same band as the previous worldgen pass ~525–600 ms).
- Streaming scheduler budgets unchanged (`WORLD_JOB_BUDGET_MS = 4`, `WORLD_LIGHT_BUDGET_MS = 2`).
- Lighting initial 9×9 sliced max slice **2.20 ms**.
- Block-break regression still 1 pending mesh / 1 dirty chunk.
- Worldgen lava fill is a per-column loop to Y 12, no fluid simulation during `generate()`.

## Manual QA checklist

### Fluids

1. Place water on a hill: flows down, then spreads.
2. Place water on flat ground: spreads to ~7 cells.
3. Place lava: slower and shorter than water.
4. Remove the block under a stream: flow goes down.
5. Remove the source: extra flowing blocks disappear.
6. Water next to lava: obsidian (source) / cobblestone (flowing).
7. New world caves: lava lakes, not scattered single voxels. Surface water still looks like lakes/ocean.

### Items

1. Creative: pick up every new item; check hotbar icon and in-hand mesh.
2. Flint and steel: fire on a block; ignite TNT.
3. Cobweb: player and a mob get stuck; arrows slow down.
4. Fences: cannot jump over with a normal jump; they connect.
5. Golden apple: absorption + regen.
6. Potions: drink, effects apply, empty bottle returns. Invisibility: mobs stop chasing.
7. Rails + minecart: place, connect, ride, roll downhill, slow on flat, dismount.
8. Fire arrow: craft with lava bucket (bucket remains), shoot a mob (burns), shoot TNT (primes).

## Known issues / deferred

- No infinite water source conversion.
- Flowing texture UV is not rotated to the flow vector yet (geometry/culling first).
- Status effect timers are not saved (absorption amount is).
- Minecart physics is an approximation; no powered rails, no cart-cart coupling.
- Invisibility does not hide first-person hands or worn armor perfectly.
- Generated textures will be replaced automatically if the Faithful tree is imported later.

## Changed files (high level)

- `src/world/fluids.ts`, `src/world/fluidSurface.ts` (new), `World.ts`, `Generator.ts`, `LightEngine.ts`, `worldJobs.ts`, `streamingSim.ts`
- `src/rendering/ChunkMesher.ts`
- `src/debug/chunkStreamingRuntime.ts`, `src/core/Game.ts`
- `scripts/benchmark-fluids.ts`
- `tests/fluids.test.ts`, `tests/fluid-surface.test.ts`, `tests/fluid-streaming.test.ts`
- `src/blocks/*`, `src/items/*`, `src/crafting/*`, `src/survival/SurvivalSystem.ts`
- `src/entities/MinecartManager.ts`, `MobManager.ts`, `src/combat/PlayerArrowManager.ts`
- `src/core/Game.ts`, `constants.ts`
- `src/rendering/ChunkMesher.ts`, `specialBlockGeometry.ts`, `ArrowVisualFactory.ts`, `ItemVisualFactory.ts`
- `scripts/generate-missing-textures.mjs`, `import-assets.mjs`, `benchmark-fluids.ts`
- `public/textures/**` fallbacks, tests, docs

## Git

Feature branch only. Draft PR. Do not merge to `main` until local QA.
