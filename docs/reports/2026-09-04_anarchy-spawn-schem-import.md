# Anarchy spawn schematic → FsWorldStore

Date: 2026-09-04  
Branch: `cursor/anarchy-spawn-schem-import-3ff8`  
Base: `origin/main` `165f563` (Farming V1 + Networking V2)

## Goal

Load the real Sponge schematic `frontier_spawn2.schem` into canonical Anarchy filesystem persistence so `npm run dev:server` restores that world. Do not import `.schem` on every startup. Do not replace the map with a procedural world or an IndexedDB dump.

## Result

Canonical Anarchy filesystem world is the baked spawn map.

**Source:** uploaded `frontier_spawn2.schem` (gzip Sponge v2, 64816 bytes; Windows FAT origin). Not committed.

| Field | Value |
|---|---|
| Format | Sponge schematic v2, gzip |
| Size | 108×60×141 (913680 cells) |
| Palette | 132 names |
| Non-air in schem | 380150 (380138 after cocoa→air) |
| Placement | `yShift=-28`, offset `(0, 40, 0)`, world Y 40..94 |
| Applied / chunks | 361576 cells / 63 chunks |
| Mapped | 380133; jungle→oak 1191; cocoa→air 12; diamond fallback 5 |
| Canonical spawn | **53.5, 68.01, 70.5** |
| World id / seed | `anarchy` / `anarchy-spawn-v1` |
| Output | `server/data/worlds/anarchy/{meta,world,players}.json` |
| Backup | `server/data/worlds/anarchy.backup-2026-09-04T18-44-32-704Z` |

Without `--force` the CLI refused (`World already exists`). With `--force` it backed up the old procedural world (spawn `0.5, 69.01, 0.5`) and wrote the map. Player roster kept.

Sample persisted blocks: stone at `(0,40,0)`, stone_bricks 2686, glowstone 183, oak_planks 8807, oak_log 4594, black_wool 522, water 6284. After restart a gold/farmland/potato marker at `(55,71,70)` survived (`Farmland=150` hydrated, `PotatoCrop=153` age 4). `fetch` was never called.

Two AnarchyServer starts + websocket join: welcome pose `53.5, 68.01, 70.5`, seed `anarchy-spawn-v1`, `modChunks=63`. Second start did not re-read `.schem`.

## Implemented

- `server/importSchematic.ts` — inspect + bake via `importAnarchySpawn` → `WorldSnapshot` → `WorldStore.save`
- `server/schematicPaths.ts` — `.schem` detection and candidate paths
- `server/backupWorldDir.ts` — recursive copy before destructive replace
- `server/importWorld.ts` — JSON dump **or** schematic; `--schem` searches candidates
- Tests: refuse without `--force`, Y shift −28, player preserve, `WorldInstance` restore without `fetch`, farming IDs 150/153 survive restart

## Changed files

- `server/importWorld.ts`, `server/importSchematic.ts`, `server/schematicPaths.ts`, `server/backupWorldDir.ts`, `server/WorldInstance.ts` (operator log only)
- `tests/server/import-schematic.test.ts`
- `docs/LOCAL_SERVER.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, this report

Not committed: `.schem`, `server/data/worlds/**`.  
Not changed: Farming simulation, Networking V2, restore-only `WorldInstance.initialize`.

## Architecture decisions

- Reuse `importAnarchySpawn` / `importSchematicIntoWorld`. No second mapper.
- Startup stays `FsWorldStore.load` → restore. CLI is the only schematic reader.
- `--force` is required when `dataDir/anarchy` exists.
- Preserve `players` on schematic replace; do not keep procedural mobs from the old world.
- Canonical seed remains `anarchy-spawn-v1`. World height remains `WORLD_HEIGHT = 256`.

## Tests / commands

```
npm run server:import -- <uploaded>.schem            # exit 2, exists
npm run server:import -- <uploaded>.schem --force    # bake
npx vite-node .local/verify-anarchy-import.ts        # restore ×2, fetch=0
npx vite-node .local/join-imported-anarchy.ts        # ws join ×2 on map spawn
npm run typecheck / typecheck:server / test:server / build
```

- `npm run test:server` **125/125**
- `farming-v2-two-client` 2/2; `farming-networking-v2-integration` 10/10

## Visual QA

No browser/WebGL pass in Cloud. Headless: WorldInstance restore + websocket welcome at map spawn, twice, without reading `.schem`.

## Performance

Offline CLI import ~3.6 s for 913k cells. Startup restore only. Welcome encode ~100 ms / 3.7 MiB because 63 modification chunks.

## Known issues

- Find-open-spawn picked a column whose floor is oak leaves at `(53,67,70)`. Existing `findOpenSpawn` rules; not changed in this pass.
- Verification joins added `SpawnProbe` rows to `players.json` (runtime only).

## Deferred

- Bundling `frontier_spawn2.schem` in git (intentionally not done).
- Runtime schematic import (must stay off).

## Next work

Owner localhost: `npm run dev:server` then `Играть онлайн → Анархия PvP` and walk the spawn structure.

## Git

- Branch: `cursor/anarchy-spawn-schem-import-3ff8`
- Base: `main` `165f563`
- PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/46
- Ordinary push. No force push. `.schem` and `server/data/worlds/**` not committed.
