# Anarchy spawn schematic → FsWorldStore

Date: 2026-09-04  
Branch: `cursor/anarchy-spawn-schem-import-3ff8`  
Base: `origin/main` `165f563` (Farming V1 + Networking V2)

## Goal

Load the real Sponge schematic `frontier_spawn2.schem` into canonical Anarchy filesystem persistence so `npm run dev:server` restores that world. Do not import `.schem` on every startup. Do not replace the map with a procedural world or an IndexedDB dump.

## Result

Offline CLI exists and reuses the existing importer:

```bash
npm run server:import -- path/to/frontier_spawn2.schem [--force]
npm run server:import -- --schem [--force]
```

`parseSchematic` + `importAnarchySpawn` (`ANARCHY_SPAWN_Y_SHIFT = -28`) bake into `FsWorldStore` at `loadServerConfig().dataDir` / `anarchy` (`WORLD_PATH` / default `server/data/worlds/anarchy`). Existing worlds require `--force`. `--force` copies the previous directory to `anarchy.backup-<timestamp>` and keeps the player roster.

**The owner schematic was not readable on this Cloud VM.** Checked:

- `C:\Users\миша\Desktop\GAMES\mine123\spawn_map\frontier_spawn2.schem`
- `/mnt/c/Users/миша/Desktop/GAMES/mine123/spawn_map/frontier_spawn2.schem`
- `public/maps/frontier_spawn2.schem` (only `.gitkeep`)
- `./frontier_spawn2.schem`, `./spawn_map/frontier_spawn2.schem`
- `FRONTIER_SPAWN_SCHEM`
- git history (never committed; `public/maps/.gitkeep` only)

No fake `.schem` was generated. `server/data/worlds/anarchy` was **not** overwritten. It remains the previous procedural world (2 chunks / 11 cells, spawn `0.5, 69.01, 0.5`).

Owner bake on a machine that has the file:

```bash
npm run server:import -- "C:\Users\миша\Desktop\GAMES\mine123\spawn_map\frontier_spawn2.schem" --force
npm run dev:server
```

Then restart once to confirm restore-only (no second schematic read).

## Implemented

- `server/importSchematic.ts` — inspect + bake via `importAnarchySpawn` → `WorldSnapshot` → `WorldStore.save`
- `server/schematicPaths.ts` — `.schem` detection and candidate paths (including the owner Desktop path)
- `server/backupWorldDir.ts` — recursive copy before destructive replace
- `server/importWorld.ts` — JSON dump **or** schematic; `--schem` searches candidates
- Tests: refuse without `--force`, Y shift −28, player preserve, `WorldInstance` restore without `fetch`, farming IDs 150/153 survive restart
- Docs: `LOCAL_SERVER.md`, `ARCHITECTURE.md`, `PROJECT_STATE.md`, `ROADMAP.md`

## Changed files

- `server/importWorld.ts`, `server/importSchematic.ts`, `server/schematicPaths.ts`, `server/backupWorldDir.ts`
- `tests/server/import-schematic.test.ts`
- `docs/LOCAL_SERVER.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, this report

Not changed: Farming simulation, Networking V2, `WorldInstance.initialize` restore path, block registry IDs.

## Architecture decisions

- Reuse `importAnarchySpawn` / `importSchematicIntoWorld`. No second mapper.
- Startup stays `FsWorldStore.load` → restore. CLI is the only schematic reader.
- `--force` is required when `dataDir/anarchy` exists. Backup is filesystem copy, gitignored with `server/data/worlds/**`.
- Preserve `players` on schematic replace; do not keep procedural mobs from the old world.
- Canonical seed remains `anarchy-spawn-v1`. World height remains `WORLD_HEIGHT = 256`.
- Do not commit `.schem` or runtime `server/data/worlds/**`.

## Tests

- `tests/server/import-schematic.test.ts` 5/5
- `tests/fs-world-store.test.ts`, `tests/anarchy-world.test.ts`, `tests/schematic-import.test.ts` still pass
- Gates in this pass: `npm run typecheck` PASS; `npm run typecheck:server` PASS; `npm run test:server` **125/125**; `npm run build` PASS; `check:boundaries` OK.
- Extra: `tests/server/import-schematic.test.ts` 5/5; `farming-v2-two-client` 2/2; `farming-networking-v2-integration` 10/10.

## Visual QA

Not run: the real `frontier_spawn2.schem` is not on this VM, so a client cannot spawn on the imported map here.

## Performance

Unchanged. Import is offline/CLI. Startup does not parse NBT.

## Known issues

- Cloud / this checkout cannot see the owner Windows path. CLI exits with the list of paths it tried.
- Current `server/data/worlds/anarchy` is still procedural until the owner runs `--schem --force`.

## Deferred

- Bundling `frontier_spawn2.schem` in git (intentionally not done).
- Runtime schematic import (must stay off).

## Next work

On the owner machine: run `npm run server:import -- --schem --force`, restart Anarchy, confirm spawn on the map, restart again, confirm persistence.

## Git

- Branch: `cursor/anarchy-spawn-schem-import-3ff8`
- Base: `main` `165f563`
- Ordinary push. No force push. `.schem` and `server/data/worlds/**` not committed.
