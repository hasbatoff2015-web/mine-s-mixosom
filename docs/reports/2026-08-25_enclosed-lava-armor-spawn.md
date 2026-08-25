# Enclosed cave lava, Fire/Lava armor rollback, hostile spawn rebalance

## Goal

Regression/balance pass on draft PR #6 after local QA: ordinary generated cave lava must start as a closed Stone basin (not already spilling into a cave cavity), Fire/Lava must use canonical armor again, and hostile spawning should be about half as dense on the night surface while caves get sparse single encounters.

## Result

Implemented on `cursor/fluids-and-items-pass-935a`. Draft PR #6 stays draft. `main` was not merged. No force push. `WORLD_LIGHT_BUDGET_MS` remains **2**. Diamond `/3` and other ore rules unchanged. Mob hurt flash and lighting flicker fix untouched.

## Exact Root Cause — Open Generated Lava

`pondBasinOk` treated a candidate as enclosed if **≥45%** of footprint *edges* had `!isCave(nx, centerFloor, nz)`.

That missed the screenshot case for three independent reasons:

1. **Wrong Y.** Lava occupies `centerFloor-1` (and below). The shore check ran at `centerFloor` (the original cave-floor Stone that is later replaced with Air). A neighboring cave cavity can be Air at lava Y while still looking like Stone/shore at `centerFloor`.
2. **Partial shore.** 55% of perimeter edges were allowed to be open. A pond on a sloped cave floor next to a larger chamber easily cleared 45% and was still placed.
3. **Footprint vs floor mismatch.** Ellipse columns whose `caveFloorStoneY` differed from the center were skipped during fill, but remaining lava cells were not required to have a solid wall at **every** lava-level neighbor. Open ledges toward a drop survived.

Boundary activation then did the *correct* runtime thing: exposed sources entered `scheduleFluid` and cascaded. Worldgen had handed the fluid system a broken basin.

Chunk borders were not the primary screenshot bug, but the old check also could not see ungenerated neighbor cave air as Air (it never sampled generator terrain at lava Y). Treating “not yet generated” as a wall would have been a second failure mode; enclosure now uses world-coordinate `terrainSolid`.

## Lava Worldgen Fix

Pipeline is still: candidate lattice → irregular ellipse footprint → **validate/shrink a natural depression** → place lava. No artificial Stone box.

- Collect only columns whose cave floor matches the center (flat pocket).
- Require generator-space solid support under the actual lava bottom.
- For every remaining column, every horizontal neighbor at each lava Y must be either another pond column or `terrainSolid`. The rim at `centerFloor` (above the fluid surface) must also be solid.
- Shrink leaking perimeter cells (up to 24 passes) and keep the largest 4-connected component; reject if fewer than 4 columns remain.
- `terrainSolid` is deterministic world-coordinate terrain (`isCave` / column / cap). An unloaded neighbor chunk is **not** a wall.
- Fill still writes only those enclosed columns. Runtime `activateGeneratedFluidBoundaries` is unchanged.

## Lava Metrics

20 seeds × 5×5 chunks (`WORLDGEN_PINHOLE_SEEDS`), same sample as the ore/pond pass:

| | Previous basin pass | This pass |
| --- | ---: | ---: |
| Pond count | 67 | **47** |
| p50 cells | 15 | **15** |
| p95 cells | 60 | **56** |
| max cells | 70 | **66** |
| width max | 9 | **9** |
| depth max | 3 | **3** |
| Initially exposed waterline cells | (not 0 — screenshot) | **0** |
| Unsupported / hanging | 0 | **0** |
| Immediate ordinary-pond flow (queue after neighbor gen) | non-zero on open ledges | **0** |

Pond count dropped (stricter enclosure) but is not near zero. Shape stays small/irregular; no giant sheets.

## Runtime Lava Regression

- Synthetic exposed source still activates and flows (`activates a generated-style exposed lava ledge…`).
- Player shore-break still starts canonical flow, no source multiplication, then settles.
- Cross-chunk x=15/16 activation kept.
- Lighting path / `WORLD_LIGHT_BUDGET_MS = 2` not changed.

## Armor Rollback

Removed `'fire'` and `'lava'` from `ARMOR_BYPASS_SOURCES`. Removed the `suppressFoodRegen` hack in `tickHunger`. Ordinary Fire and Lava go through `reduceDamageByArmor` again. Fire Arrow timed burn and Lava `ignite(300)` afterburn unchanged. Ordinary Fire exit still clears `contactFire` immediately.

## Fire / Lava Effective Damage

Same player, 20 ticks, hunger 10 / saturation 0 (no food regen), iron-like armor 15 points:

| | No armor | Armor 15 |
| --- | ---: | ---: |
| Fire | **1.00** | **0.42** |
| Lava | **8.00** | **3.84** |

Lava > Fire with and without armor. Successful mitigated hits still emit canonical `onDamage` (`dealt > 0`). Tiny fully absorbed hits stay ignored (no fake flash).

## Hostile Spawn Root Cause

`tryAutomaticSpawn` picked one disposition, then 8 ring samples, defaulting to **surface Y**. Cave Y was attempted only with probability **0.38**, and a failed cave sample fell back to the surface. At night `combinedLight` on open sky is low enough for hostiles, so almost every cycle landed a surface mob. Caves almost never won.

## Spawn Balance Fix

- Hostile surface night: cycle gate `SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR = 0.5` (test override exists for the ×1 baseline).
- Cave hostiles are a separate candidate: underground, sky ≤ 7, no direct sun, solid floor, 2-block air, not lava/water, min player distance unchanged (14–34).
- Daytime caves can spawn if dark / no sky. Sunlight burn logic unchanged.
- Max **1 new cave hostile per chunk per spawn event**; also at most one cave spawn per event globally so a single 2 s cycle cannot dump a pack.
- Local density: skip if a living hostile is already in that chunk or within **12** blocks. Occupancy, not permanent ownership — after leave/death another can spawn.
- Passive path is a separate function (same 8 attempts, grass, light ≥ 9). Kind mix unchanged. Caps still 20/28/48.

## Spawn Metrics

Uncapped sample, 3 seeds × 48 cycles, solid night vs cave slab:

| | Count |
| --- | ---: |
| Surface night hostiles, factor 1.0 | **27** |
| Surface night hostiles, factor 0.5 | **13** |
| Ratio | **0.48×** (target 0.4–0.6) |
| Day solid (no cave) hostiles | **0** |
| Day cave hostiles | **4** |
| Night cave hostiles | **19** |
| Max new cave hostiles / chunk / event | **1** |
| Global hostile cap | still **28** |

Passive day counts are identical when only the night factor changes.

## Regression

- Mob hurt flash duration/tint/trigger unchanged (`MOB_HURT_FLASH_SECONDS = 0.22`).
- Lighting resumable flood / budget **2** untouched.
- Diamond `veins: 1`, `extraVeinChance: 1/3`; other ores unchanged.
- Boundary activation not removed.

## Tests

Targeted: `tests/lava-bedrock-ore-pass.test.ts`, `tests/fire-contact-sunlight-minecart.test.ts`, `tests/hostile-spawn-balance.test.ts`, `tests/mob-hurt-flash.test.ts`.

`npm run check`: **57 files, 529 tests**, production 117 modules, 1.16 MiB / 180 files. `WORLD_LIGHT_BUDGET_MS = 2`.

## Manual QA

### A. NEW LAVA WORLDGEN
New world. Find ≥5 ponds. Expected: small, irregular, Stone shore, not self-flowing, no open ledges.

### B. OPEN POND MANUALLY
Break one Stone shore. Expected: natural flow, no source explosion, then settle.

### C. LIGHT
After flow: fly/look around. No flicker.

### D. FIRE + ARMOR
No armor: Fire damages; Lava stronger. With armor: both smaller. Leave ordinary Fire: stop immediately. Lava afterburn remains.

### E. MOB SPAWN — NIGHT
Fly the surface at night. Hostiles visually about half of the previous pass.

### F. MOB SPAWN — CAVES
Walk several cave chunks. Hostiles sometimes appear, usually one, not a pile in one room.

## Git

Branch `cursor/fluids-and-items-pass-935a`. Ordinary push. PR #6 remains draft. `main` not merged.
