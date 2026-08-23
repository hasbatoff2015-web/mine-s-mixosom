# Worldgen mountains, caves and vegetation density

Date: 2026-08-23  
Branch: `cursor/worldgen-mountains-caves-density`  
Base: `main` @ `5340c5e2155f9797f558396dbc20c5caa35636b7`  
**main was not merged.** **No force push.**

## Goal

Make the compact world more interesting vertically without a second generator or a storage rewrite:

1. Periodic wide mountains about `+10…+20` above local terrain.
2. About `+15` more blocks of underground down to bedrock.
3. Longer, wider, connected cave systems (not short 1–2 block tunnels).
4. Forest trees ~2–3× rarer; desert cactus ~4× rarer.

Keep Plains/Forest/Desert, seeded determinism, lighting/streaming, ores, collision, and old save deltas.

## Result

Implemented in the existing `TerrainGenerator`. `WORLD_HEIGHT` went `80 → 96` because bedrock was already at `Y 0–2`; there was no free space below to lower the floor. Indexing is still `y * 256 + z * 16 + x`, so modification maps do not need a format change.

Headless statistical tests and `npm run benchmark:worldgen` confirm mountains, extra depth, connected caves, and vegetation ratios. This cloud environment cannot honestly screenshot WebGL.

## Vertical world audit

### Old (`main` @ 5340c5e)

| Quantity | Value |
| --- | --- |
| `WORLD_HEIGHT` | 80 (`Y 0..79`) |
| `SEA_LEVEL` | 48 |
| Bedrock | `floor(random01 * 3)` → `Y 0–2` (already world floor) |
| Height formula | `49 + broad*8*biomeScale + detail*2.2 + max(0, ridge-0.7)*13`, clamp `38–68` |
| Measured min / avg / p50 / p95 / max | **43 / 49.35 / 49 / 53 / 57** |
| Typical surface → bedrock | ~47–49 |
| Max generated terrain | 57 (headroom to 79) |
| Cave Y | any stone `y < surface`, 3D value-noise AND (`primary > 0.46 && \|tunnels\| < 0.43`) |
| Cave air vs stone+cave | **7.56%** |
| Ores | coal 18–46, iron 8–40, gold 4–24, redstone 3–15, diamond 3–11 |
| Forest trees / forest chunk | **7.073** (10 attempts) |
| Desert cactus / desert chunk | **2.107** (5 attempts, place if `rng() ≤ 0.72`) |
| Generation | **4.716 ms avg / 5.073 p95 / 12.221 max** per chunk |

Could we only lower bedrock inside 80? **No.** Floor was already `Y 0`. Extra `+15` underground plus `+20` mountains plus build headroom required more vertical cells. Arrays already keyed off `WORLD_HEIGHT`.

### New

| Quantity | Value |
| --- | --- |
| `WORLD_HEIGHT` | **96** (`Y 0..95`) |
| `SEA_LEVEL` | **63** (`48 + 15`) |
| `TERRAIN_HEADROOM` | **12** → generated max `≤ 84` |
| `MIN_SURFACE` / `BASE_HEIGHT` | **58** / **66** |
| Bedrock | unchanged concept, still `Y 0–2`, never carved |
| Height formula | `clamp(66 + broad*4 + detail*1.5*biomeDetail + hills(0–8) + mask*amp(10–20), 58, 84)` |
| QA sample min / avg / p95 / max | **63 / 68.86 / 70.5 / 83** |
| Extra underground | typical surface ~69 vs old ~49 → **~+20** to bedrock (target was +15; sea/stack shift is +15) |
| Max generated | 83–84, **12+ blocks** of build headroom |

`CHUNK_HEIGHT` as a separate constant does not exist; chunk length is `16 * WORLD_HEIGHT * 16`.

## Mountains

- Macro: `mountainMask = smoothstep(0.16, 0.46, fbm2D(..., x/260, z/260))`.
- Amplitude: `10 + (fbm2D(..., x/180) + 1) * 5` → **10–20**.
- Hills: `max(0, hillField - 0.12) * 8` at `/72` (smaller `+3…+8` bumps).
- Frequency: mask is slow; QA elevated share (`mountain ≥ 10`) ≈ **20%** of columns in the 10-seed /260-scale sample. Origin 5×5 windows may be all-plain or all-mountain (`golf`/`juliet` vs `alpha`).
- Biome is **not** a height field. Desert elevated columns still get sand/sandstone.
- Neighbor `|Δh| ≤ 4` in tests, including biome transitions and chunk borders. No per-chunk spikes.

## Caves

Still one noise carver (`isCave`), not a second worm engine.

| | Before | After |
| --- | --- | --- |
| Method | 2× value-noise AND, scale ~19/28 | ridged `abs(n)` network `/52` + slow field `/78` + optional branch `/34` |
| Frequency | 7.56% cave air | **25.2%** cave air vs stone+cave (not swiss-cheese test cap 28%) |
| Width | ~1–2 tunnels | mean cardinal air-neighbors **3.71** |
| Length / connectivity | tiny blobs | avg component **1848**, p95 **3686**, largest **139423** in a 5×5×height sample |
| Branching | none | extra tunnel when `slow > 0.12` and branch noise `< 0.07` |
| Chambers | none | `slow > 0.50 && main < 0.18` |
| Surface entrances | none | **disabled** (were 1×1 pinholes); underground networks unchanged |
| Chunk borders | world-coord noise already | regression: carve at `x=15` continues at `x=16` |
| Bedrock | theoretically skip surface | explicit `y <= bedrock` never air |

Deep lava in caves uses `random01 > 0.94` (was `> 0.82`) so extra cave volume does not triple emitters and starve the 2 ms light budget.

## Surface cave pinhole fix

Local visual QA accepted mountains, forest density, and cave systems, but reported scattered **1×1 black squares** on grass.

### Root cause

Two carve paths reached the surface:

1. **`isCave` allowed `y < surfaceY`**, so dirt/sandstone directly under grass could become cave air. On a slope, a cell that is “deep” in a tall column is at or above a neighbor’s grass, so the cave opened as a single dark pixel in the hillside/surface.
2. **`isCaveEntrance`** (`random01 > 0.935` plus a weak fBm gate) then **punched `y = height-2 … height`**, including the grass/sand block, whenever cave noise existed ~3 below. That check is **per-column**, so mouths were isolated 1×1 (or a few adjacent 1×1s), never a real 3-wide entrance.

Terrain height math, mountain mask, and vegetation were not the cause.

### New roof rule

- Precompute `18×18` height/biome halo once per chunk (`columnAt` for halo cells, reused for the 16×16 interior).
- `roof = min(3×3 neighbor heights) - CAVE_ROOF_DEPTH` with **`CAVE_ROOF_DEPTH = 4`**.
- Ordinary carve only if `y ≤ roof` (and still never bedrock).
- **Intentional surface mouths are off** this pass. Better zero pinholes than fake 1×1 “entrances”. A later pass can add a real 3×2+ hillside mouth if wanted.
- No post-fill of holes. No per-voxel 9× terrain noise.

Works for plains grass/dirt, forest grass/dirt, desert sand/sandstone, mountain slopes, and seabed (no 1×1 drain).

### Statistical QA (20 seeds × 5×5 chunks)

`WORLDGEN_PINHOLE_SEEDS`: original 10 QA seeds plus kilo…tango.

- Accidental 1×1 openings: **0**
- 1–2 block openings: **0**
- Any surface cave mouth (air/lava/water at intended surface Y): **0**
- Cave air inside the roof cap: **0**
- Hillside exposures at neighbor-surface+1: **0**

### Cave metrics before/after this fix

Same 10 QA seeds, radius 2:

| | After mountains pass | After pinhole fix |
| --- | --- | --- |
| Cave air % | 25.2 | **24.7** |
| Mean width | 3.71 | **3.73** |
| Avg component | 1848 | **4086** (tiny near-surface blobs gone) |
| p95 component | 3686 | **10233** |
| Largest | 139423 | **134377** |
| Trees / forest | 3.127 | 3.109 |
| Cactus / desert | 0.603 | 0.635 |

Underground networks stayed large. Vegetation ratios unchanged in-band.

### Performance

81-chunk batch **576 ms → 525 ms** (roof band skips cave noise). Forest chunk ~6.3 ms vs ~6.7 ms. Halo is one extra ring of `columnAt`, not 9× per stone cell.

## Forest

Old: 10 attempts / forest chunk, almost always place on grass.

New: 10 attempts, keep if `rng() ≤ 0.4`, plus light grove skip (`grove < -0.35 && rng() > 0.5`). Skip water/air surfaces. No trees on desert.

QA: **3.127 trees / forest chunk** (forest-biome columns only) vs old **7.073** → ratio **0.44** (inside 35–50%; ~2.3× rarer).

## Desert

Old: 5 attempts, place if `rng() ≤ 0.72`.

New: 5 attempts, place if `rng() ≤ 0.09` (dry land is more common after the sea shift, so probability is lower than a naive 0.72×0.25).

QA: **0.603 cactus / desert chunk** vs **2.107** → ratio **0.286** (inside 20–30%).

## Ores

Shifted with the +15 stack so the new deep stone is not empty and diamond is not a 3-block sliver.

| Ore | Old Y | New Y | Veins×size |
| --- | --- | --- | --- |
| Coal | 18–46 | **28–61** | 12×7 (was 10-ish; +2 veins for extra volume) |
| Iron | 8–40 | **8–52** | 11×6 |
| Gold | 4–24 | **4–32** | 4×5 |
| Redstone | 3–15 | **3–18** | 5×5 |
| Diamond | 3–11 | **3–16** | 2×4 |

Ores still replace stone after caves, so cave walls can expose veins. No new ore types.

## Save compatibility

- Schema unchanged. `Chunk.index` does not embed `WORLD_HEIGHT`.
- Restore of a modification at e.g. `y=50` still writes `y=50`.
- Saves store **deltas only**. Unmodified generated terrain is **not** snapshotted, so loading an old world regenerates base terrain with the new generator. Player edits remain. **Seams are possible** between a heavily edited old chunk and a newly generated neighbor. No auto-regen of stored chunks.

Use a **new world** for mountain/cave visual QA.

## Performance

CPU generation only (not GPU FPS).

| | Before | After |
| --- | --- | --- |
| Plains chunk avg | 4.716 ms | **7.949 ms** (first-sample JIT inflates p95) |
| Forest chunk avg | — | **6.700 ms** |
| Desert chunk avg | — | **7.909 ms** |
| 81-chunk batch | ~382 ms (81×4.716) | **576 ms** |

About **1.5×** per chunk, explained by `80→96` voxels plus one extra 3D cave sample and mountain fBm. Cave path was cut from 5 noise lookups to 2–3. Streaming budgets / lighting halo / mesh fairness were **not** changed (`WORLD_JOB_BUDGET_MS = 4`, `WORLD_LIGHT_BUDGET_MS = 2`). Instant-light walk/fly mesh fairness still shows `maxNearWantedMissingMs = 0`. Sliced-light radius-6 fly near-hole wait is ~7.8 s in the CPU sim (taller columns + more cave air); still far below the old 20–160 s starvation. Single-chunk generation test contract: average `< 40 ms`.

## Automated QA

Seeds: `alpha bravo charlie delta echo foxtrot golf hotel india juliet` plus `spawn-a/b`, `cave-network`, `ore-depth`, `bedrock-depth`, `save-compat`.

Covered: determinism, height range, mountain share, smoothness, biome seams, bedrock seal + extra depth, cave border continuation + connectivity/width/ratio, tree/cactus ratios, ore bands including deep diamond, spawn on plains, save index, generation budget.

## Browser QA

Not honestly available in this cloud agent (no reliable WebGL screenshot path). Local visual checklist is in the PR / agent final report.

## Tests

`tests/worldgen-terrain.test.ts` (14) plus existing generation/ore/profiler tests. Full `npm run check`: **382 tests / 45 files**, production 100 modules, 1.08 MiB / 167 files.

## Deferred

- Dedicated mountain biome, snow, ravines-as-a-new-system, rivers, structures.
- Migrating old generated terrain.
- Worker generation.

## Next work

Local visual QA on a **new** Creative world: fly, find a mountain, forest spacing, desert cactus, cave entrance, torch in a deep chamber, streaming while flying.

## Git

Ordinary commit + push on `cursor/worldgen-mountains-caves-density`. No merge of `main`. No force push.
