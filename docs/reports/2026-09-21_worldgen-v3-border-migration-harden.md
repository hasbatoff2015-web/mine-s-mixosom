# Worldgen V3 audit harden — border, minecart, migration

Date: 2026-09-21
Branch: `cursor/worldgen-v3-water-gourds-border-74e7`
PR: #100 (draft)
Base implementation: `c7b73efbb2cd85bdc66d52dd95a51480cce2ce57`
Main at audit: `cd8ecf39b06d17773cf35371fc9e319db6bbfacf`

## Goal

Close independent-audit holes in Worldgen V3 before merge: gameplay mutations beyond the playable border, minecart dismount/enter AABB, V2→V3 world-event journal rebase, one-shot plugin reload, `worldgenVersion` persistence, unambiguous `waterBiome`, submerged floors, and a true main-vs-feature generation comparison.

## Result

The listed bypasses are closed on shared helpers from `src/world/worldBorder.ts`. Hydrology now separates mask region from wet biome. Event migration rebases the same object recovery will use, once per manager instance, and the first persist after a V2 load writes `worldgenVersion: 3`. Visual design of the border wall, hydrology thresholds, and calibrated gourd salts were not changed.

## Implemented

### Border interactions

`VoxelWorld.setBlock` / `applyBlockBatch` stay unguarded so the generator can still write scenery outside ±10000.

- Empty/filled bucket: optional `BucketContext.canMutateBlock`. `performUseHeld` always passes `gameplayMayMutateBlock`. Generic bucket tests omit the callback and stay unrestricted.
- Flint/TNT/fire: `applyFlint` / `igniteCell` reject outside targets without durability wear. Outside carts are not boarded or ignited via use.
- Hoe / seeds / bone meal: `tryFarmingUse` returns false outside; no consume, no wear, no state write.
- Legacy Chest/Furnace/PortalChest/Door/Lever/Button/Bed/Sign: action-aware. Outside hits skip those interactions; FOOD/BOW still start when looking at an outside block.
- `ServerGameplay.beginMining` rejects outside targets before mining progress. Local `Game` targeting clears the same cells.
- `WorldInstance.updateSign` rejects outside OakSign updates.

### Minecart

`findDismountPosition` requires `isPlayerCenterInsidePlayableWorld` (full player AABB, width 0.6). Fallback clamps toward the interior and never returns an outside center. `enterVehicle` / `Game.mountMinecart` / `tryEnterMinecart` reject a cart whose riding pose would place that AABB outside. Legacy outside carts are not deleted.

### World-event migration

When `journal.phase === 'placing'`, the journal event is the recovery authority: its snapshot is rebased, `store.active` is set to that same object, then persist. Otherwise a placed `active` snapshot is rebased. `cleaning` still skips V2 restore. `generatorMigrationHandled` makes rebase one-shot on the same manager (plugin disable→load→enable). `WorldInstance.initialize` marks dirty when loaded version is missing or `< 3`. After rebase, `acknowledgeWorldgenMigration` sets loaded=3 and `persistWorld` writes metadata; `recover()` runs after that so a crash mid-overlay does not save `3` with a still-V2 snapshot.

### Hydrology / seabed

`hydrologyAt` returns `hydrologyRegion`. `waterBiomeAt(height, region)` is wet-only. Sampler reports physical water, mask region, and actual wet ocean/lake/legacy puddle with the integer identity `ocean+lake+legacy === physical`. Submerged tops: desert Sand; plains/forest Dirt/Gravel/Clay/Sand; snowy Dirt/Gravel/Stone. Ice remains exposed `SEA_LEVEL` only. Ore RNG salts are unchanged (`SUBMERGED_SURFACE_SALT = 7129`).

## Changed files

Code: `src/items/bucketInteraction.ts`, `src/gameplay/useInteraction.ts`, `src/entities/MinecartManager.ts`, `src/core/Game.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`, `server/services/worldEvents.ts`, `src/world/hydrology.ts`, `src/world/Generator.ts`, `src/world/gourdDecorations.ts`.

Tests: `tests/world-border-interactions.test.ts`, `tests/minecart-world-border.test.ts`, `tests/server/world-border-authority.test.ts`, `tests/server/world-events-v3-migration.test.ts`, `tests/worldgen-v3.test.ts`, `tests/worldgen-v2.test.ts`, `tests/worldgen-terrain.test.ts`, `tests/fire-contact-sunlight-minecart.test.ts`.

Scripts: `scripts/sample-worldgen-v3.ts`, `scripts/benchmark-worldgen-compare.ts`, `scripts/benchmark-worldgen-phases.ts`.

Docs: `PROJECT_STATE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`, this report, pointer in the original V3 report.

## Architecture decisions

- Guard mutations at the use/gameplay layer, not in `VoxelWorld.setBlock`.
- Player-width AABB (`isPlayerCenterInsidePlayableWorld`) for vehicles, not `x < 10000`.
- Placing journal is source of truth when present; do not rebase `active` A and recover `journal` B.
- Explicit `generatorMigrationHandled` rather than “snapshot looks different”.
- Persist V3 metadata after event snapshot rebase, before overlay recover.
- Separate `hydrologyRegion` vs `waterBiome` instead of overloading one field.

## Tests

New/extended regressions cover empty/filled bucket, flint, TNT, hoe, seeds, bone meal, door/lever/button, chest/furnace/bed/sign, food/bow while looking outside, beginMining, sign_update, east/west/north/south/corner/fallback dismount, outside cart enter, inside cart enter, active-only / placing-only / active+placing / cleaning / plugin reload, worldgenVersion persist, waterBiome identity, seabed floors.

Existing world-events (scheduler/plugin/reconnect), occupancy, fluids, farming, claims, homes, RTP, clan, prediction, interaction, bucket, redstone, sign, server gameplay suites were rerun and passed on this machine.

`tests/worldgen-terrain.test.ts` multi-seed grids now use a 20s timeout (they take ~5.1–5.3s with V3 hydrology). Minecart `platform()` writes stone/air through `chunk.set` so V3 water lighting no longer times out derail tests.

## Visual QA

Not performed in a live game camera in this environment. Do not treat this pass as visual PASS. Owner QA before merge: large lake/ocean, underwater floor, snowy Ice, pumpkins/melons, border distances 100/50/30/10/1, corner two planes, scenery behind the wall.

## Performance

Same Node, seed `alpha`, 81-chunk grids. Isolated main worktree at `cd8ecf3`. Three compare runs; medians:

| Region | MAIN total / avg / p50 / p95 / max (ms) | FEATURE | Δ total |
|---|---|---|---|
| Land origin (−42,−48) | 741 / 9.15 / 8.48 / 12.19 / 18.43 | 756 / 9.34 / 8.69 / 13.26 / 29.39 | +2.1% |
| Wet/ocean grid | 712 / 8.79 / 7.08 / 14.55 / 16.31 | 746 / 9.21 / 8.85 / 12.77 / 15.58 | +4.8% |

FEATURE wet origin is a real V3 ocean (`−48,−48`); MAIN wet origin is a V2-style puddle (`11,−23`). VM noise is large (FEATURE land totals 630 / 756 / 971). Treat ± a few percent as within noise.

Sliced `advanceGenerate` phases (FEATURE, not a single 20ms+ spike):

- heights max 1.51 ms
- columns max 2.41 ms
- lava 0.22 / ores 0.57 / deposits **3.21** / decorate 0.61 / cane 0.20
- **gourds max 1.56 ms** (12-sample max 0.36 ms)

Gourds was left as one slice. `npm run benchmark:worldgen` FEATURE batch81 = 616 ms; sampler batch81 = 549 ms.

## Hydrology sample (8 seeds, 2048×2048, step 8, 524288 columns)

| Metric | Share |
|---|---:|
| Physical water (`height < 63`) | 17.848% |
| Mask ocean / lake | 13.573% / 5.361% |
| Actual ocean water / lake water | 12.416% / 5.005% |
| Legacy puddle | 0.428% |
| Identity `ocean+lake+legacy === physical` | true |

Production Anarchy seed `anarchy-spawn-v1`: physical 16.048%, actual ocean 11.482%, actual lake 4.355%, legacy 0.211%, largest ocean 5810 step-8 cells, largest lake 252.

## Known issues / deferred

- Owner live camera QA.
- GitHub check-runs empty on PR #100 at this pass; local green is not CI PASS.
- Compare totals vary across runs on this VM; sliced phase max is the frame-spike signal.

## Next work

Owner visual QA, then merge (not by this agent). No hydrology threshold retune from the 8-seed average; Anarchy seed water is ~16%.

## Git

No merge, no rebase, no force push. Follow-up commit on `cursor/worldgen-v3-water-gourds-border-74e7`.
