# Worldgen V2 — Snowy Plains, Mixed Forests, Cave Deposits

Date: 2026-09-10
Branch: `codex/snowy-biome-cave-deposits`
Base: `origin/main@d1a33d4b3f5e28ccdcbf0bdd1518728ca2a21a2b`

## Goal

Extend the canonical seeded Overworld generator with a real snowy region, deterministic Oak/Birch/Spruce forests, and natural Clay/Gravel cave-surface deposits while preserving terrain shape, ore layout, shared client/server generation, persistence safety and bounded generation cost.

## Result

Worldgen V2 is complete on the feature branch. It adds `snowy_plains`, frozen exposed snowy water, species-specific trees, candidate-column decoration and world-space cave deposits. The old height/cave/ore fields are unchanged. Fresh singleplayer and authoritative Anarchy use the same `TerrainGenerator` through `VoxelWorld`.

## Before

- `Biome` was plains/forest/desert with codes 0/1/2.
- `dryness > 0.24` selected desert; `climate < -0.14` selected forest.
- Forest and plains both ultimately called the Oak-only tree builder.
- Gravel/Clay existed in the registry but had no natural cave generation.
- Natural chunks were reconstructed from seed and modified by sparse deltas; there was no worldgen metadata.

## Implemented

### Biomes and surfaces

- Exact union: `'plains' | 'forest' | 'desert' | 'snowy_plains'`.
- Exact codes: plains 0, forest 1, desert 2, snowy_plains 3.
- Exact selection: desert `dryness > 0.24`; else snowy `climate < -0.36`; else forest `climate < -0.14`; else plains.
- `-0.36` was selected from measured land share, not the initial guessed range. Snowy inherits the old forest detail multiplier 1.05, so its addition is a surface/biome split rather than a new terrain engine.
- Snowy land is `SnowBlock`, then three Dirt cells, then unchanged Stone geology.
- A flooded snowy column writes Ice only at `SEA_LEVEL`; lower layers remain Water. Ice↔Water at biome boundaries is intentional.

### Decoration and trees

- Every chunk has ten deterministic candidates; each candidate consults its own column biome.
- Forest: chance 0.55 after surface validation/grove rule, then Oak/Birch/Spruce exactly 1/3 each.
- Plains: chance 0.10, Oak only. Desert: chance 0.05, cactus. Snowy: chance 0.02, Spruce only.
- Snowy grass, flowers and fern are suppressed.
- One prevalidated `placeTree` abstraction maps the correct logs/leaves and builds distinct bounded shapes: Oak 4–5 with a wide crown, Birch 5–7 with a slim crown, Spruce 6–8 with tiered/conical foliage.

### Cave deposits

- Explicit pipeline: terrain+caves → lava ponds → ores → cave deposits → surface decoration.
- Deposits use a separate `12×10×12` world lattice and seed namespaces 12101–12110. No new calls were inserted into ore RNG namespace `+991`.
- Candidates are natural Stone adjacent to natural cave Air. Largest-component filtering plus a deterministic connected subset yields Gravel target 6–18 and Clay 4–10.
- Write-time guard accepts only remaining Stone, so all ores including Titanium remain untouched. Y14–54 stays above lava-pond surface Y≤12; water/lava adjacency is rejected.
- Gravel requires natural Stone below during planning and solid non-fluid support during placement. No generation-time falling cascade is scheduled.
- Neighbor cells are evaluated across chunk boundaries; output is materialization-order independent and may continue through seams.

### Persistence

- `WORLDGEN_VERSION = 2`; new singleplayer, filesystem server and schematic-import snapshots store additive `worldgenVersion: 2` while `WORLD_SCHEMA_VERSION` stays 1.
- Old snapshots without the field still parse and round-trip; their next normal save records v2.
- This is metadata, not a V1 generator selector.

## Distribution sampling

Command: `npm run sample:worldgen-v2`. Inputs: 8 fixed seeds (`alpha`…`hotel`), each over a `2048×2048` area at step 8; 514,373 above-sea sampled columns.

| Biome | Columns | Share of sampled land |
|---|---:|---:|
| plains | 258,496 | 50.255% |
| forest | 91,176 | 17.726% |
| desert | 117,875 | 22.916% |
| snowy_plains | 46,826 | 9.104% |

Snowy connected components on the sampled chunk grid: 504 components, median 8 chunks, p95 112, largest 399. This meets the 8–15% target and produces broad regions rather than salt-and-pepper columns.

Forest tree sample: Oak 130, Birch 158, Spruce 152; shares 29.55%, 35.91%, 34.55%; 440 roots over 145.77 equivalent forest chunks = 3.0185 trees/chunk. Per-seed signatures differ.

Targeted snowy sample: 24 Spruce over 147.152 equivalent snowy chunks; 20 over 118 fully interior chunks = 0.1695 tree/interior chunk, within the requested 0.1–0.3 and far below forest.

| Deposit | Blocks | Cave-bearing chunks | Connected deposits | Median | P95 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Gravel | 913 | 102 | 93 | 9 | 18 | 18 |
| Clay | 496 | 88 | 74 | 6 | 10 | 10 |

## Architecture decisions

- Extend the one `TerrainGenerator`; do not create server-only generation or duplicate biome systems.
- Keep base height, minimum surface, sea level, hills, mountains, cave noise, roof depth, lava pond logic and every `ORE_RULES` entry unchanged.
- Use `BIOME_CODES`/`biomeCode` as the exhaustive mapping; `ChunkMesher` handles code 3 with a finite snowy tint.
- Keep deposits bounded through fixed cell ranges, maximum radii, 512 plan cache and 8192 column cache. Non-intersecting jitter centers are rejected before cave sampling.
- Make spawn preference explicit: plains 0, forest 18, snowy 42, desert 80, plus existing mountain and distance terms.

## Changed files

- Generator/runtime: `src/world/Generator.ts`, `Chunk.ts`, `worldgenMetrics.ts`, `World.ts` consumers through existing APIs, `src/rendering/ChunkMesher.ts`, `src/core/Game.ts`, `src/core/constants.ts`, `src/main.ts`.
- Persistence/server: `src/save/{types,snapshot,fsRecords}.ts`, `server/WorldInstance.ts`, `server/importSchematic.ts`.
- QA/tooling: `scripts/benchmark-worldgen.ts`, `scripts/sample-worldgen-v2.ts`, `src/dev/VegetationQaHarness.ts`, `src/dev/WorldgenDepositQaHarness.ts`, `package.json`.
- Tests: `tests/worldgen-v2.test.ts`, `tests/world-snapshot.test.ts`, `tests/persistFixture.ts`.
- Documentation: `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, this report.

## Tests

- `tests/worldgen-v2.test.ts`: 5/5 PASS. Covers exhaustive codes/threshold/share/contiguity; SnowBlock/Dirt/Ice/Water; all species/shapes/weights/seed variation; cave material/surface/support/fluid/cap/surface/seam safety; order independence, spawn ordering and tint.
- Worldgen V2 plus fixed Titanium/old-ore digest: 16/16 PASS. The existing byte-stable ore layout assertion passes, proving the ore RNG and placements were not changed before the post-ore Stone-only pass.
- `tests/worldgen-terrain.test.ts --testTimeout=30000`: 14/14 PASS.
- Snapshot tests: 6/6 PASS, including v2 metadata and a legacy snapshot without the field.
- Focused related packs: lighting/chunks 137/137; fluids 91/91; falling/entities 63/63; server/Anarchy/shared 82/82 PASS. Additional broader focused gate reported 61/63 with only the two known default-5s worldgen timeouts; the same file passed 14/14 with its appropriate extended timeout.
- Four typechecks PASS; import boundaries PASS; production build PASS; size/archive checks PASS; `git diff --check` PASS.
- Full `vitest --maxWorkers=2`: 210/217 files and 2025/2046 tests PASS. Parallel-run timeouts in lighting scheduler, FS persistence and schematic restore passed isolated 30/30 without timeout changes. Remaining failures are the established main baseline classes: malformed reference-extractor test source, default-5s worldgen/fire-minecart timeouts and `tick-load-flight` `<80 ms` performance threshold. None of those failing files was changed by this feature.

## Visual QA

Computer-controlled WebGL QA was actually performed against the development build:

- plains: Grass surface, Oak-only tree identity and normal vegetation visible;
- forest: Oak/Birch/Spruce textures and distinct silhouettes visible in the mixed canopy;
- desert: continuous Sand/Sandstone surface, cactus/dead bushes, no border strip artifacts;
- snowy_plains: broad white surface with sparse Spruce and no grass/flowers;
- frozen shore on seed `alpha`, coordinate `2624,-2996`: Ice at the snowy exposed surface with an intentional Ice↔Water biome boundary;
- natural Gravel at `-22,53,-26` and Clay at `8,31,-14`: both rendered on cave surfaces using the real generator/renderer; QA-only inspection torch illuminated the scene; no straight chunk seam or floating gravel was visible;
- browser warn/error console: empty.

Fresh online QA used `FC_WORLD=qa-worldgen-v2`, seed `qa-online-fresh-2026-09-10`. The server created and loaded 81 spawn chunks; the browser connected through `Играть онлайн → Анархия PvP` and displayed the playable world without bad spawn or console errors. Observed one-player server ticks held ~20 TPS; maximum reported tick was 12.75 ms.

## Performance

Same-machine representative benchmark before/after:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| batch 81 chunks | 1467.764 ms | 1544.138 ms | +5.2% |
| plains average | 22.000 ms | 22.832 ms | +3.8% |
| forest average | 16.756 ms | 21.423 ms | +27.8% (small-sample/noise-sensitive) |
| desert average | 18.073 ms | 21.244 ms | +17.5% (small-sample/noise-sensitive) |
| snowy average | n/a | 21.487 ms | new |

Final per-biome p95: plains 36.097, forest 27.362, desert 28.275, snowy 30.925 ms. The 81-chunk aggregate is the preferred comparison; the pass is bounded and did not create a multiple-times slowdown. Production unpacked build is 4.15 MiB / 353 files.

## What happens to an old online world?

The server does not persist full natural chunk arrays. It rebuilds a chunk from the stored seed, then overlays recorded modification deltas and restores containers/entities/state. After this update, unmodified natural cells in chunks materialized again use Worldgen V2, so a previously visited but unmodified area is not guaranteed to retain byte-identical V1 terrain/trees. Player data and recorded voxel edits remain. No existing save is deleted, rewritten in bulk or automatically migrated; `worldgenVersion: 2` documents the generator used after the next save.

## Known issues

- The repository baseline still contains the malformed `minecraft-reference-extractor.test.mjs` source and several default-timeout/performance failures documented above.
- `WORLDGEN_VERSION` is descriptive metadata only; there is no retained V1 generator implementation.
- A mixed-biome lake can naturally show a sharp Ice↔Water boundary by design.

## Deferred

- SnowLayer, weather, dynamic freezing/melting, temperature gameplay, mobs, structures, ice variants, cave biomes and new ores remain explicitly out of scope.
- Frozen V1 natural-chunk preservation or a selectable legacy generator requires a separate migration/versioning task.

## Next work

- Merge only after owner review of this feature branch.
- If release policy requires old natural terrain to stay exact, design a V1/V2 generator-selection or chunk-snapshot migration before deploying to the persistent production world.

## Git

- No rebase, force push or merge into main.
- Intended commit: `feat: add snowy biome and cave deposits`.
- Feature HEAD and remote push are recorded in the final task response after commit.
