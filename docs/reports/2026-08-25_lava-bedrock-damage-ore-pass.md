# Fire overlay, cave lava ponds, bedrock cap, hurt feedback, ore ×2

Date: 2026-08-25  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

Previous HEAD: `11e933883745dd3b6f8f995b8dbc46d61da55167`.  
This pass: `e2c2a89ccd5deff2444f768d7d9ca57db29ff702`.

## Goal

Keep accepted PR #6 systems (fluids, streaming, fire block/arrow, minecart, targeting, chat). Fix five remaining product issues:

1. First-person fire overlay covering almost the whole viewport (SCREEN 1).
2. Cave lava generating giant rectangular sheets / vertical walls (SCREEN 3).
3. Bedrock exposed as cave floor (SCREEN 4).
4. No player hurt flash / camera kick.
5. All ores roughly twice as common, same Y bands and vein size.

## Exact Root Causes

### Fire Overlay

`FirstPersonRenderer` used `SharedFireTexture.createScaledOverlay(1.85, 1.35)` — the same **6-plane 3D fire block** as world Fire (`fireBlockPlanes`), placed at camera-local `(0, -0.22, -0.52)`. That filled ~85–90% of the viewport, including the crosshair. There is no separate lava environment tint to stack with it.

### Cave Lava

Previous `placeLavaLakes` used a large-scale 2D `fbm` mask (`lavaLakeMask`) and filled **all cave air from bedrock+1 up to a flat Y=12**. That produced:

- giant connected sheets (pre-rewrite sample: p95 **2815** cells, max **9956**, width max **80**);
- vertical lava walls (depth max **12**);
- lava surface at the Y=12 platform, often above neighboring cave floor;
- huge source counts that would flood if a wall was broken.

### Bedrock

`bedrockHeight` is Y 0–2 per column. Caves could start at `floor+1`, so a taller bedrock column (Y=2) was visible sideways from a shorter neighbor’s cave. A per-column cap of `bedrockTop+1` was not enough. Baseline exposed faces on the 20-seed grid: **85942**.

### Damage Feedback

No player hurt VFX existed. Canonical hook was already `SurvivalSystem.damage` → `onDamage`. Creative never calls `survival.damage`.

### Ores

Old vein attempts (size unchanged):

| Ore | minY–maxY | size | old veins |
| --- | --- | ---: | ---: |
| Coal | 28–61 | 7 | 12 |
| Iron | 8–52 | 6 | 11 |
| Gold | 4–32 | 5 | 4 |
| Redstone | 3–18 | 5 | 5 |
| Diamond | 3–16 | 4 | 2 |

Baseline (20 `WORLDGEN_PINHOLE_SEEDS` × 5×5 chunks): coal 28455, iron 23080, gold 7080, redstone 8482, diamond 2764.

## Fire Overlay Fix

- `firstPersonFireOverlayLayout()` + `createFirstPersonOverlay()`: **two** lower-corner `PlaneGeometry` billboards (left/right bottom).
- Tops stay below camera center (`maxY ≤ -0.10`); lower ~20–30% of the viewport.
- Shared animated fire strip (UV `offset.y`, no remesh). Cloned material: `transparent`, opacity **0.76**, `depthTest: false`.
- Shown only while `survival.isOnFire` (Fire, lava linger, Fire Arrow burn).
- World Fire mesh and mob overlay still use `createScaledOverlay` / 6 planes.

This cloud environment cannot honestly screenshot WebGL; SCREEN 1 vs SCREEN 2 is a local visual QA item.

## Lava Worldgen

New algorithm in `TerrainGenerator` (same runtime fluid system after edits):

1. **Candidate:** world-space lattice `LAVA_POND_CELL = 16`, ~48% of cells attempt a pond (deterministic hash, not `Math.random`).
2. **Footprint:** ellipse + `valueNoise2D` warp. Size mix ~3–12 across (small/medium/rare larger). Not a rectangle.
3. **Basin first:** `caveFloorStoneY` finds a deep-cave stone floor (`surface-8` and `Y ≤ 12`). Lava fills **below** that floor; the floor cell becomes Air (opening). Shore stone stays at `centerFloor`; lava surface is `centerFloor-1`.
4. **Depth:** 1–3 source layers. Contiguous stone stack only; support under the **actual** bottom required (no hang over air after a short stack).
5. **Validation:** ≥4 columns, ≥75% support, ≥45% shore edges closed. Same decision on both sides of a chunk border.
6. **Sources:** placed as default source lava (no state). **No** `scheduleFluid` at generate time.
7. **Cap:** lava cannot replace `Y ≤ STONE_CAP_TOP_Y` (3).

## Lava Metrics

20 seeds × 5×5 chunks, **after** the pond rewrite:

| | Before (mask sheets) | After (basin ponds) |
| --- | ---: | ---: |
| Pond count (sample) | few giant components | **67** |
| p50 cells | hundreds+ | **15** |
| p95 cells | **2815** | **60** |
| max cells | **9956** | **70** |
| width max | **80** | **9** |
| depth max | **12** | **3** |
| min floor support | low / hanging sheets | **1.0** |
| hanging floor cells | many | **0** |
| large-pond fill ratio | ~1.0 rectangles | none with width ≥ 10 |

## Fluid Behavior

- Enclosed generated pond: `fluidQueueSize = 0`, settle writes 0.
- Break one adjacent Stone: bounded flow (`fluidWrites+updates > 0`), then idle again.
- Source count does not increase (no infinite lava sources). New cells are flowing (`fluidLevel < 8`).
- Same `fluids.ts` path as bucket lava. Distant pause / streaming budgets unchanged (`WORLD_LIGHT_BUDGET_MS = 2`).

## Bedrock

- Bedrock still `Y 0–2` (`bedrockHeight`).
- World-wide Stone cap: `STONE_CAP_TOP_Y = 3`, `BEDROCK_COVER_DEPTH = 1`.
- `minCaveY = 4`. Caves, lava, ores cannot remove Y≤3.
- Multi-seed exposed Bedrock count: **0**.

Old saves: no migration. Unexplored / regenerated chunks get the cap.

## Damage Feedback

Canonical: `SurvivalSystem` constructor `onDamage` → `Game.onPlayerDamaged` if `dealt > 0 && !ignored`.

| | Value |
| --- | --- |
| Red flash peak | 0.28 |
| Flash duration | 220 ms (linear decay, time-based) |
| Camera kick | 2.1° (DOT ×0.42), max 3° |
| Kick duration | 180 ms sine envelope |
| Path | `#hurt-flash` overlay + `applyImmediateRenderLook(..., roll)` |

Repeated hits restart the timer; amplitude stays bounded. Authoritative yaw/pitch unchanged.

## Ores

Vein **attempts ×2**, `size` and Y ranges unchanged.

| Ore | old blocks | new blocks | ratio |
| --- | ---: | ---: | ---: |
| Coal | 28455 | 56869 | **2.00×** |
| Iron | 23080 | 46246 | **2.00×** |
| Gold | 7080 | 14100 | **1.99×** |
| Redstone | 8482 | 15888 | **1.87×** |
| Diamond | 2764 | 5035 | **1.82×** |

Redstone/diamond sit slightly under 2.0 because Y=3 is now the non-replaceable cap (`minY` kept as requested). Still inside 1.8–2.2. Same seed → identical chunks. Vein components stay small (not 20-block slabs).

## Worldgen Performance

81-chunk batch (`batch-81`): **518–542 ms** (previous fluids pass **545 ms**, mountains pass **576 ms**). Ore doubling did not double generation cost. Cave air still ~24%. Trees/cactus ratios unchanged. Streaming scheduler / light budget not touched.

## Tests

See Git section. `npm run check`: **55 files, 506 tests**, production 117 modules, 1.15 MiB / 180 files.

New: `tests/fire-overlay-hurt.test.ts` (6), `tests/lava-bedrock-ore-pass.test.ts` (5). Updated content-pass lava clustering to world-space ponds. Fluid streaming fly tests still green.

## Manual QA

A. FIRE: stand in Lava; overlay in the lower ~20–30%; crosshair / center / upper view readable.

B. LAVA WORLDGEN: new world; 3–5 deep caves; ponds small and irregular; no giant fields; break one shore Stone → bounded flow.

C. BEDROCK: deepest caves show Stone floor; Bedrock not exposed.

D. DAMAGE: mob hit, fall, Lava/Fire DOT, TNT — short red flash + small kick; aim stays put.

E. ORES: subjectively about twice as common; veins not giant slabs.

F. STREAMING: Creative fly after lava interaction; no chunk holes.

WebGL visual acceptance is **not** claimed from this cloud agent.

## Git

branch `cursor/fluids-and-items-pass-935a`  
SHA `e2c2a89ccd5deff2444f768d7d9ca57db29ff702`  
working tree clean after this commit  
PR #6 remains **draft**.  
`npm run check`: 55 files, 506 tests, 117 modules, 1.15 MiB / 180 files.
