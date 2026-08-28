# World height 256 + Anarchy spawn import

Date: 2026-08-28  
Branch: `cursor/spawn-map-import-256-height`  
Base: `6e27b93` (`origin/main`)

## Goal

Raise the world to `Y 0..255` without scaling procedural terrain, then import `frontier_spawn2.schem` into a local Anarchy server world selected from «Играть онлайн».

## Result

World space is `WORLD_HEIGHT = 256`. Generated plains/forest/desert still sit around Y 58–84. Chunk/lighting/fluid/mesh scans skip empty sky via `occupancyTop`. Anarchy is a separate persistent IndexedDB world (`id=anarchy`) that imports a Sponge schematic once.

**The original `frontier_spawn2.schem` is not in this Cloud workspace.** Runtime loads `/maps/frontier_spawn2.schem`. For local QA:

```bash
node scripts/copy-frontier-spawn.mjs "<path-to-frontier_spawn2.schem>"
```

The copy script does not modify the source file. First Anarchy connect without the file shows a clear toast.

## Implemented

### World height

- `MIN_WORLD_Y=0`, `MAX_WORLD_Y=255`, `WORLD_HEIGHT=256`.
- `MAX_GENERATED_SURFACE=84` pins mountains. Ores, bedrock (Y 0–2), stone cap Y=3, caves, diamond `1/3` extra vein unchanged.
- Generator fills only `0..max(height, sea)`; air above stays the zeroed array.
- `Chunk.occupancyTop` / `scanMaxY()` used by sky fill, emitter scan, border absorb, fluid activation, mesher, `surfaceY`.
- Placement toast if the target cell is outside `0..255`.
- New `BlockId.DiamondBlock` for schematic fallback (and Creative).

### Schematic import

- `src/world/import/`: NBT, gzip, Sponge v2/v3 parse, Minecraft→Frontier mapper, batched voxel write.
- Unsupported ids → Diamond Block (never Air), counted per namespaced id.
- States mapped where Frontier has them (stairs/slab/door/rail/torch/lantern/chest/furnace/fluid).
- Entities and block-entity payloads skipped and listed in the report.
- Placement: X=0, Z=0; Y offset keeps lowest ≥ stone cap and highest ≤ 255. No scale/crop. Too tall → `SchematicHeightError`.
- Writes go through `applyBlockBatch` with no per-cell lighting/fluid/support storms; lighting flags reset on affected chunks for the ordinary scheduler.

### Anarchy

- Server row `anarchy-pvp` enables Connect. `survival-pvp` stays disabled mock.
- World id `anarchy`, seed `anarchy-spawn-v1`, `summary.kind=server`. Hidden from singleplayer list.
- `SerializedWorldState.serverWorld.spawnImported` prevents re-import. Player edits persist through existing modification deltas.

## Changed files

- `src/core/constants.ts`, `src/world/Chunk.ts`, `Generator.ts`, `LightEngine.ts`, `fluids.ts`, `World.ts`, `worldgenMetrics.ts`, `src/rendering/ChunkMesher.ts`
- `src/blocks/types.ts`, `registry.ts`, `src/i18n/ru.ts`
- `src/world/import/*`, `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/ui/menuModel.ts`, `src/save/*`
- `scripts/copy-frontier-spawn.mjs`, `scripts/import-assets.mjs`, `scripts/generate-missing-textures.mjs`
- `public/textures/block/diamond_block.png`, `public/maps/.gitkeep`
- tests: `world-height-256`, `schematic-import`, `anarchy-world`, plus worldgen/menu updates
- docs: PROJECT_STATE, ARCHITECTURE, ROADMAP, TESTING, this report

## Architecture decisions

- Raise the **bound**, not the **generator**. Empty sky is occupancy-limited, not “old generator × 3”.
- Do not add a second world format. Anarchy uses the existing save schema plus optional `serverWorld`.
- Importer is a library (`src/world/import`), not a tick-loop special case.
- Diamond Block is a real registry block so unsupported schematic cells are physical voxels.

## Tests

Targeted (this pass): world-height, schematic-import, anarchy, menu, worldgen, world-generation, world-state, glowstone, RU registry — 85/85.

Full `npm run check` numbers are filled after the suite run.

## Visual QA

Not run in Cloud (no `frontier_spawn2.schem`). Manual checklist is in the task report / PR.

## Performance

Generator no longer walks Y=85..255 as solid fill. Sky/light/fluid/mesh use occupancy (~surface+trees). Light budget unchanged at 2 ms. Import batches 8192 writes and defers lighting/mesh to the scheduler.

## Known issues

- Anarchy first-create in this environment cannot import the real spawn until the `.schem` is copied into `public/maps/`.
- Powered/detector/activator rails, fence gates, glass panes, extra wood species, etc. become Diamond Block by spec.
- Chest/sign/entity NBT is skipped, not faked.

## Deferred

- Real multiplayer transport.
- Bundling the large spawn schematic in git (user keeps the original on disk).
- Spawn protection / PvP rules.

## Next work

Local QA with the real schematic: connect Anarchy, confirm structure, lighting, persistence, no single-frame freeze.

## Git

Ordinary commit + push on `cursor/spawn-map-import-256-height`. Draft PR. Do not merge main. No force push.
