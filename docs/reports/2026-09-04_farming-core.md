# Farming V1 — final integration report

## Goal

Deliver merge-quality Farming V1 for Wheat, Carrot, Potato, Melon, and Pumpkin while preserving the fixed 20 TPS simulation, canonical world state/persistence, current rendering caches, and authoritative Online Anarchy architecture. Market, currency, advanced farming, weather, and all unrelated networking branches remain out of scope.

## Git

- Farming branch: `codex/farming-core`.
- Original Farming base/main SHA: `4d803e5de22e551e3f71941c0abb03c91e78cf4c`.
- The implementation was temporarily preserved as `stash@{0}: friend-game-updates` when another local workflow switched to a networking branch; it was reapplied without conflicts to `codex/farming-core`.
- `origin/main` still pointed to the exact Farming base at the integration audit. No unmerged networking/server branch was imported.
- Remote Farming branch/PR did not exist at initial audit. Publication/merge fields are completed only after final fetch and all gates.

## Result

Farming V1 uses one shared, Node-safe `FarmingSystem`; existing world state, snapshot, interaction, item/drop, crafting/furnace/food, meshing, and protocol paths are extended rather than duplicated. Old block IDs remain unchanged (`oldIdsChanged=false`).

## Blocks and stable IDs

| ID | Block |
|---:|---|
| 150 | Farmland |
| 151 | Wheat Crop |
| 152 | Carrot Crop |
| 153 | Potato Crop |
| 154 | Melon Stem |
| 155 | Pumpkin Stem |
| 156 | Melon |
| 157 | Pumpkin |

Existing numeric IDs 0–149 were not renumbered. New item keys are append-only strings: `wheat_seeds`, `wheat`, `carrot`, `potato`, `baked_potato`, `melon_seeds`, `melon_slice`, `pumpkin_seeds`, `pumpkin_pie`, `bone`, `bone_meal`, and `wooden_hoe`/`stone_hoe`/`iron_hoe`/`golden_hoe`/`diamond_hoe`.

## Farming architecture and timing

- Kernel order: `world → farming → falling → players → …`; gameplay remains fixed at 20 TPS.
- Hydration pulse: 100 ticks / 5 simulation seconds.
- Growth pulse: 1200 ticks / 60 simulation seconds.
- Per-pulse advancement: Wheat `7/8`, Carrot `7/9`, Potato `0.70`, Melon Stem `0.70`, Pumpkin Stem `0.70`.
- Mature fruit attempt: `1/6` per growth pulse.
- Expected maturity: approximately 8/9/10/10/10 minutes; new mature-stem fruit approximately 6 minutes.
- RNG is injected through the canonical RandomSource adapter. There is no gameplay `Math.random` call outside that adapter, no timer per crop, and no wall clock.

`FarmingSystem` tracks only Farmland/crops/stems in sparse maps keyed by chunk and observes committed block changes. Restored chunk modifications rebuild the index lazily. Water is lazily indexed by loaded chunk for radius queries. Only loaded chunks within the SP mesh radius or a server connected-player active center are visited. An explicit empty server center list visits nothing, so the stale server view center cannot keep crops growing after the last disconnect. Unloaded/disconnected chunks do not grow, and load/restart continues from the stored age without catch-up.

## Farmland and hydration

Hoe secondary-use converts Dirt/Grass to Farmland if the cell above is Air/replaceable. Survival wears the hoe once; Creative follows existing no-wear rules. Farmland is 15/16 high in canonical selection/collision geometry and rendering, with dirt sides/bottom and `farmland`/`farmland_moist` top.

Hydration is binary. Existing Water cells at farmland Y or Y+1 hydrate Chebyshev radius 4 (`abs(dx)<=4 && abs(dz)<=4`), including diagonal corners. Dry farmland remains farmland; planted crop and age remain; only growth pauses. Removing/restoring water changes the visual/state on a bounded 5-second pulse. No moisture 0…7, light requirement, rain, trampling, or dry-to-dirt transition exists.

## Crops, Bone Meal, stems, and harvest

- Planting: Wheat Seeds/Carrot/Potato/Melon Seeds/Pumpkin Seeds create the matching crop/stem at age 0 only above Farmland; Survival consumes exactly one, Creative does not.
- Bone Meal works only on age `<7` over hydrated Farmland, adds a random 2–5 ages clamped to 7, and consumes once only on successful Survival use. Mature stems do not create fruit from Bone Meal.
- Mature stems try N/E/S/W, require Air/replaceable target over Dirt/Grass/Farmland, and refuse a second adjacent matching fruit. Multiple legacy fruits resolve attached direction deterministically N/E/S/W.
- Drops: immature Wheat 1 seed; mature Wheat 1 Wheat + 1–4 seeds; immature Carrot/Potato 1; mature Carrot/Potato 2–5; Melon 3–7 slices; Pumpkin 1; each stem 1 matching seed. Creative manual break produces no Survival drops.
- Crops/stems are fluid-displaceable and use existing support integrity. Detached events retain block state so water/support removal still resolves the correct mature drop exactly once.

## Hoes, food, and recipes

Hoe durability: Wood 59, Stone 131, Iron 250, Gold 32, Diamond 1561. Minecraft-like two-material/two-stick shaped recipes support the project's mirrored semantics.

Food values: Carrot 3/3.6, Potato 1/0.6, Baked Potato 5/6.0, Melon Slice 2/1.2, Bread 5/6.0, Pumpkin Pie 8/4.8 (hunger/saturation). All use the existing food-use and animation path.

Recipes: 3 horizontal Wheat → Bread; Bone → 3 Bone Meal; Melon Slice → Melon Seed; Pumpkin → 4 Pumpkin Seeds; 9 Melon Slices → Melon; Potato furnace recipe → Baked Potato; shapeless Frontier Bread + Pumpkin → Pumpkin Pie. Sugar/Egg and a second furnace input were not added.

## Survival acquisition

- Tall Grass/Fern independently roll Wheat Seeds 12.5%, Pumpkin Seeds 0.5%, and Melon Seeds 0.5%.
- Zombie loot independently rolls Carrot 1.25% and Potato 1.25%; existing Iron remains unchanged.
- Skeleton loot adds Bone 0–2 alongside existing Arrow/Bow entries.
- The rare grass seed bootstrap avoids an impossible Melon/Pumpkin loop without changing TerrainGenerator or existing chunks. No worldgen patches were added.

## State, authority, and networking

Farmland uses canonical `BlockRenderState.hydrated`; all crops/stems use canonical `age` clamped 0…7. `WorldSnapshot`/IndexedDB/filesystem serialization already persists the same block-state map. Protocol state parsing adds only `hydrated` and `age` to ordinary block updates/batches; no farming packet, timer, direction, texture, or parallel save exists.

Singleplayer and Anarchy share `performUseHeld`, loot rules, and `FarmingSystem`. The server supplies RNG, connected-player active centers, plugin permission callbacks, inventory dirtying, canonical drop entities, and coalesced block deltas. Online clients issue existing interaction requests and render authoritative world state. A two-harvester test accepts the first removal, rejects the second as empty, emits one block delta, and creates one canonical set of drops.

## Rendering and assets

Farmland writes to the opaque chunk batch. Crops and stems write quads into one vegetation `BufferGeometry` per chunk—no per-crop Mesh, material, texture load, or per-frame growth calculation. Wheat has eight age textures. Carrot/Potato map ages `0–1→0`, `2–3→1`, `4–6→2`, `7→3`. Stem height follows age; mature attached visuals use the local connected texture and derived direction. Melon/Pumpkin are ordinary batched cubes.

All assets came from the local `assets/minecraft/textures` tree via `scripts/import-assets.mjs`; nothing was downloaded or generated. Key source→runtime naming adaptations: `farmland_dry→farmland`, `farmland_wet→farmland_moist`, `wheat_stage_N→wheat_stageN`, `carrots_stage_N→carrots_stageN`, `potatoes_stage_N→potatoes_stageN`, `*_stem_disconnected→*_stem`, `*_stem_connected→attached_*_stem`, `melon_side→melon`, `pumpkin_side→pumpkin`, `wood_hoe→wooden_hoe`, `gold_hoe→golden_hoe`, `seeds_*→*_seeds`, `potato_baked→baked_potato`, and `dye_powder_white→bone_meal`. The full importer initially refreshed unrelated old textures; those verified side effects were removed before publication.

## Tests

- `tests/farming.test.ts`: pulses, save restore/no catch-up, interactions, drops, water detach state, geometry/stages.
- `tests/farming-rules-complete.test.ts`: complete till/plant matrix, exact water boundaries, probabilities, inactive/no-player server chunks, Bone Meal edge cases, full harvest table, stems, food, recipes, mirrored hoes.
- `tests/farming-performance.test.ts`: 1024/4096 sparse pulse bounds.
- `tests/farming-rendering.test.ts`: 256 crops in one vegetation geometry; 15/16 Farmland mesh.
- `tests/server/farming-authority.test.ts`: authoritative till/plant/Bone Meal, state delta, server pulse, simultaneous harvest, Creative no-drop.
- Core Farming files: 35/35 PASS. Wider interaction/save/network/render regression gate: 30 files / 267 tests PASS.
- IndexedDB explicitly round-trips Farmland hydration and crop age. A real filesystem `WorldInstance` stop/reinitialize/resume round-trip restores Farmland, Potato age 6, and player inventory.
- `test:sim`: 42/42 PASS. `test:server`: 78/78 PASS.
- All typechecks, import boundaries, shared Node smoke, and headless server smoke PASS.

## Performance

Warm sparse pulse benchmark on this machine:

| Indexed positions | Visited | Duration |
|---:|---:|---:|
| 1024 | 1024 | 6.066 ms |
| 4096 | 4096 | 13.908 ms |

The fixture is dry and therefore writes no states/fruits; it measures sparse index traversal without one-time lazy water indexing. Performance tests also enforce indexed/visited counts and a generous non-catastrophic bound. Block state changes continue through existing coalescing/batch transport.

## Build and visual QA

Typecheck/build passed. Final production result: 3.91 MiB / 326 files; size and archive checks pass. The exact-case local-source/public/dist audit covered 43 required assets (129 files checked), all valid 32×32 PNGs with matching SHA-256 and no missing texture. DEV `?qaFarming=1` was loaded in the in-app Chromium browser and visually inspected: water channels, dry/wet 15/16 soil, all Wheat ages, Carrot/Potato mappings, stems, attached stems, Melon/Pumpkin, five hoes, Bone Meal, and representative farming items render without visible missing textures or opaque vegetation rectangles.

## Full suite and known baseline issues

The exact-main baseline at `4d803e5` with the same command and local asset source reported 113/122 files and 1253/1267 tests passed, 14 failed tests plus one parse-suite, and two worker RPC timeouts. Farming reported 121/127 files and 1291/1303 tests passed, 12 failed tests plus the same parse-suite, and two RPC timeouts. All 36 added tests passed. Farming failures are a strict subset of baseline classes: the existing reference-extractor parse issue and CPU-sensitive lighting/worldgen/fire/minecart/streaming assertions/timeouts under full parallel load. Directed suites, `test:sim`, and `test:server` pass; tests were not weakened to hide the baseline failures.

## Manual QA / limitations

Completed: automated simulation/server authority, persistence contracts, production asset/build checks, and actual WebGL QA fixture. Remaining owner/device QA: native pointer-lock gameplay; real save/reload UI; crafting/furnace screens; F5 and breaking overlay while farming; two visible Online clients for plant/grow/hydrate/fruit/harvest, reconnect, chunk leave/return, and filesystem restart. There is intentionally no light dependency, trampling, rain, moisture levels, offline growth, poisonous potato, worldgen patch, automation, market, or economy.

## Final publication fields

- Integrated main SHA: `4d803e5de22e551e3f71941c0abb03c91e78cf4c` (feature base matched fetched main; no main-to-feature merge required).
- Farming head before publication: `4d803e5de22e551e3f71941c0abb03c91e78cf4c`; the new commit/head is recorded by the branch and PR because a commit cannot embed its own SHA.
- Conflict files: none at initial audit (Farming base equals `origin/main`).
- Missing assets: none (43 required source/public/dist mappings audited).
- PR: pending creation because no prior remote Farming branch/PR existed at audit time.
- Final pre-publication fetch: `origin/main=4d803e5de22e551e3f71941c0abb03c91e78cf4c`; `mainMoved=false`.
- Merge method / merge commit / final `origin/main`: pending gates.
- Final git status: pending publication and post-merge verification.
