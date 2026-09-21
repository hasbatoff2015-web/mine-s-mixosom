# Worldgen V3 — hydrology, wild gourds, playable world border

Date: 2026-09-21
Branch: `cursor/worldgen-v3-water-gourds-border-74e7`
Base: current `origin/main` at start of this pass (`cd8ecf39b06d17773cf35371fc9e319db6bbfacf` after `git pull --ff-only`).

## Goal

Add large deterministic lakes/oceans, natural pumpkin/melon patches, and a playable ±10 000 world border with a translucent red wall and visible scenery beyond it. Existing V2 worlds migrate with policy **A**: the current generator becomes V3; player modifications are kept; V2 geography is not preserved.

## Result

Worldgen V3 is on this feature branch. Hydrology is a negative-only, seed+XZ layer. Climate biomes are unchanged. Wild Pumpkin/Melon use existing block IDs and separate decoration salts. Playable coordinates are `-10000 <= x,z < 10000` with shared AABB collision and a four-plane renderer. The generator itself is not clipped at the border.

## Why V2 had little water

`SEA_LEVEL = 63`, `BASE_HEIGHT = 66`, `MIN_SURFACE = 58`. Hills/mountains are additive. Water fill already ran (`height < SEA_LEVEL` → Water up to sea). There was no large-scale depression, so water was only tiny local lows, typically at most ~5 layers.

Raising `SEA_LEVEL` or lowering `BASE_HEIGHT` globally would have rewritten all land. V3 instead subtracts height only inside hydrology masks.

## Hydrology

Pure helper `hydrologyAt(numericSeed, x, z)` in `src/world/hydrology.ts`. No neighbor chunks, no generation order, no mutable world.

| Field | Scale | Warp | Enter | Core | Classify |
|---|---:|---:|---:|---:|---:|
| ocean | 620 | 100 | 0.24 | 0.38 | 0.28 |
| lake | 130 | 30 | 0.38 | 0.52 | 0.41 |

`columnAt` computes `legacyHeight` with the V2 formula (land clamp `LAND_MIN_SURFACE = 58`), then:

```text
basinFloor = max(WATER_FLOOR_MIN=52, SEA_LEVEL - targetDepth)
height = floor(lerp(legacyHeight, basinFloor, waterMask))
```

When `waterMask = 0`, `height === legacyHeight`. Shore uses `smoothstep` on the field, not a binary cliff. Depth noise keeps basin floors uneven. Ocean target depth ~3.6–11; lake ~2.1–8. `SEA_LEVEL` stays 63.

`ColumnInfo` keeps climate `biome` and adds `hydrologyRegion` (mask, may be dry coast) plus `waterBiome` (wet-only `none | lake | ocean`). Forest+ocean is a forest coast; desert+lake is a desert lake; snowy+lake freezes only exposed `SEA_LEVEL` Ice with Water below. Dry coasts must not report `waterBiome = ocean|lake`. Follow-up audit: `docs/reports/2026-09-21_worldgen-v3-border-migration-harden.md`.

The generator does **not** know about the playable border. Hydrology continues past ±10000.

## Sampling (8 seeds, 2048×2048, step 8)

Command: `npm run sample:worldgen-v3`. Sampled columns: 524 288.

| Metric | Value |
|---|---:|
| Water (`height < 63`) | 17.848% |
| Classified lake | 5.361% |
| Classified ocean | 13.573% |
| Land | 82.152% |
| Shoreline | 3.244% |
| Avg / p95 / max depth | 7.562 / 11 / 11 |
| Largest ocean component | 9878 step-8 cells |
| Largest lake component | 597 step-8 cells |
| Ocean / lake components | 50 / 554 |

Largest ocean ≈ 200–800 blocks across depending on seed (alpha 557 cells, hotel 9878). Largest lake ≈ 200 blocks. Land still dominates; some seeds (foxtrot/hotel) are wetter because a low-frequency ocean sits in the sample window.

Land biome shares after hydrology (above-sea columns):

| Biome | Land % |
|---|---:|
| plains | 51.102 |
| forest | 17.096 |
| desert | 22.789 |
| snowy_plains | 9.012 |

Climate shares did not jump; snowy remains ~9%.

## Gourds

Existing `BlockId.Pumpkin` / `BlockId.Melon`. No new IDs. No wild stems or farmland.

World-space cells of 32 with salts `PUMPKIN_DECORATION_SALT = 81427` and `MELON_DECORATION_SALT = 91541`. Placement only on GrassBlock/Dirt, air above, above sea, not in hydrology water, not desert/snowy.

Owner manual QA found the original frequency too high. `GOURD_PATCH_DENSITY = 0.25` scales the **final** spawn chance (pumpkin biome chance, and melon biome chance **plus** the +0.10 near-water bonus). The 32-block lattice, salts, jitter, `fruitCount`, and fruit offsets are unchanged. Surviving patches are a deterministic subset of the old population. `WORLDGEN_VERSION` stays 3; already-generated chunks keep stored gourds.

Sampler `npm run sample:worldgen-v3` (8 seeds × 2048, same window):

| | Pumpkin before | Pumpkin after | Melon before | Melon after |
|---|---:|---:|---:|---:|
| Planned patches | 7582 | 1896 | 2434 | 610 |
| Planned fruits | 14925 | 3718 | 4954 | 1248 |
| Avg planned size | 1.968 | 1.961 | 2.035 | 2.046 |
| ~patches / suitable chunk | 0.0851 | 0.0213 | 0.0273 | 0.0069 |
| Placed in 13×13×4-seed grid | 75 (69 plains / 6 forest) | 12 (11 plains / 1 forest) | 43 (12 plains / 31 forest) | 18 (4 plains / 14 forest) |
| Underwater | 0 | 0 | 0 | 0 |

Patch-count reduction: pumpkin 7582/1896 ≈ **4.00×**, melon 2434/610 ≈ **3.99×**. Biome mix stays plains-heavy pumpkins and forest-leaning melons.

Decorator runs after sugar cane. Tree/plant/ore RNG namespaces are unchanged. Staged `beginGenerate`/`advanceGenerate` matches `generate()`.

## Migration A

User-chosen policy: do **not** keep V2 geography.

- Load a `worldgenVersion: 2` snapshot → current `TerrainGenerator` is V3.
- Persistent modifications overlay the new natural terrain.
- Next `Game` / `WorldInstance` save writes `WORLDGEN_VERSION = 3`.
- Possible: water next to an old base, shoreline moving under a build. Expected, not a bug.
- No “protect every modification from oceans” island system.

Active world-event edge case: if the loaded save is older than 3, `WorldEventsManager` rebases the transient snapshot from current V3+persistent voxels before overlay re-apply. A `cleaning` journal is expired instead of restoring V2 terrain. Hosts that do not expose `loadedWorldgenVersion` (unit tests) skip rebase.

## World border

Canonical (`src/world/worldBorder.ts`):

- `WORLD_BORDER_MIN = -10000` inclusive
- `WORLD_BORDER_MAX = 10000` exclusive
- Playable blocks: `-10000 <= x < 10000`, same for z
- Planes at X/Z = ±10000
- 20 000 × 20 000 playable blocks

Shared helpers: `isInsidePlayableBlock`, `isInsidePlayablePoint`, `isAabbInsidePlayableWorld`, `isVolumeInsidePlayableWorld`, `clipAabbAxisToWorldBorder`, `clampHorizontalCenterToWorldBorder` / `clampPlayerCenterToWorldBorder`, `relocateStandingPoseInsidePlayableWorld`, `worldBorderOpacity`, `gameplayMayMutateBlock`.

Movement: AABB clip in `PlayerController.moveAxis` and `moveVoxelBody`. Outward component is zeroed; travel along the wall is normal; Y is free. Not a teleport-back. Client prediction and server use the same path.

Guards (gameplay layer, **not** `VoxelWorld.setBlock`):

- break/place (`gameplay.ts`, `useInteraction`, `Game` mining)
- explosions, fluids, fire ticks, farming growth/fruit
- plugin `setBlock`
- claims (full volume) and claim-anchor radius
- clan base volume
- homes set/teleport
- spawn set + login relocate
- RTP bounds (`RTP_MIN`/`RTP_MAX` from the canonical constants)
- teleports
- world-event candidate + template footprint
- natural mob spawn
- minecart on-rail clamp; arrows despawn/ignore outside cells

Visual: `WorldBorderRenderer` — 4 `PlaneGeometry` meshes, `#ff2020`, `MeshBasicMaterial`, `transparent`, `depthWrite: false`, `depthTest: true`, `DoubleSide`. Per-side alpha from camera distance: 0 at ≥50, ~0.10 at 20, ~0.22 at 5, max 0.28 at contact. Far sides `visible = false`.

Streaming: desired chunks follow ordinary render distance. No ±10000 prune. No pre-generated 100-block halo. Scenery outside is generated only because a player inside can see it.

## Performance

`npm run sample:worldgen-v3` on this checkout:

| | ms |
|---|---:|
| Land chunk avg | 7.112 |
| Ocean chunk avg | 7.522 |
| 81-chunk batch | 587.605 |

`npm run benchmark:worldgen`:

| | avg ms | p95 | max |
|---|---:|---:|---:|
| plains chunk | 9.580 | 19.290 | 19.290 |
| forest chunk | 7.180 | 8.013 | 8.013 |
| desert chunk | 7.955 | 13.509 | 13.509 |
| snowy chunk | 7.468 | 9.693 | 9.693 |
| 81-chunk batch | 597.430 | — | — |

Hydrology is a handful of fBm calls per column. Ocean vs land chunk times are effectively the same. Border renderer is 4 meshes and 4 distance updates per frame.

A detached pre-V3 81-chunk number was not re-run from a clean main worktree in this pass.

## Tests

New: `tests/worldgen-v3.test.ts` (16), `tests/world-border.test.ts` (16).
Sampler: `scripts/sample-worldgen-v3.ts` (`npm run sample:worldgen-v3`).

Focused worldgen/border: **57/57 PASS** (`worldgen-v3` 16, `world-border` 16, `worldgen-terrain` 14, `worldgen-v2` 5, `generation-stages` 2, `incremental-mesh` 4).

World-events: **33/33 PASS** after widening `findValidPlusXColumn` so V3 water does not starve the +X shrine search.

Related gameplay (claims/clan/homes/RTP/fluids/farming/ores/caves/prediction/minecart/streaming/snapshot): **226/226 PASS** across 25 files.

`tests/server/anarchy-plugins.test.ts`: 2 failures are **pre-existing on current main** — `listenerCount('blockBreak')` is 4 (claims+wand+worldEvents+autoMine) while the test still expects 2. Not caused by Worldgen V3.

Validation actually run:

- `npm run typecheck` PASS
- `npm run typecheck:server` PASS
- `npm run typecheck:client` PASS
- `npm run typecheck:sim` PASS
- `npm run check:boundaries` PASS
- `npm run build` PASS (`tsc --noEmit && vite build`, 304 modules, 2.41s)
- `git diff --check` PASS
- `npm run sample:worldgen-v3` PASS
- `npm run benchmark:worldgen` PASS

## Architecture decisions

- Negative-only hydrology instead of a global sea/base shift.
- Land biome enum unchanged; water is a parallel field.
- Gourd world-space cells instead of extra `rng()` in the tree stream.
- Border is mathematical planes, not voxels.
- Generator remains infinite; gameplay systems own the playable square.
- Event snapshot rebase on V2→V3 rather than restoring V2 islands.

## Visual QA

OWNER MANUAL QA (owner, before main-sync merge of PR #100):

- Worldgen V3 world generation checked in-game;
- latest reduced pumpkin/melon density (`GOURD_PATCH_DENSITY = 0.25`) checked in-game;
- owner reports the result looks good.

Not claimed: two-client Anarchy border QA, underwater-floor camera pass, fade curve at 100/50/30/10/1, corner two-walls, or other border edge cases.

Automated column/chunk tests cover lakes, oceans, ice surface, gourd biomes, and border opacity/planes.

## Known issues / deferred

- Per-seed water share varies (alpha ~6%, hotel ~31%) because oceans are rare and large.
- Live owner QA of fade curve, corner two-walls, and running along the wall on Anarchy is still open.
- Pets branch not present on main; shared border helpers are ready for later pet teleport.

## Next work

Optional visual gourd/water screenshot pass. Border fade/collision Anarchy QA remains unclaimed.

## Git

See the PR for the commit SHA after push.
