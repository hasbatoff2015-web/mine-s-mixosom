# 2026-08-30 — Phase 5 shared persistence port

## Goal

Unify **gameplay state serialization** for Singleplayer and the Anarchy server, and split it from **storage backends**. Refactor only. No gameplay, protocol, EntityHost, or spawn changes. Do not start Phase 6.

## Result

```text
             WorldSnapshot (schema v1)
                       │
             ┌─────────┴──────────┐
             │                    │
        IdbWorldStore        FsWorldStore
             │                    │
       IndexedDB              filesystem
```

## Before

| Data | Singleplayer | Server | Same? |
|---|---|---|---|
| World id / seed / time | `SerializedWorldState.summary` + `timeOfDay` | `meta.json` + `world.json` | No (two DTOs) |
| Modifications / blockStates / chests / furnaces | snapshot fields | `world.json` | Same voxel blobs, different wrappers |
| Local player | `player: SerializedPlayerState` | — | SP only |
| Multiplayer players | — | `players.json` `StoredPlayer` | Server only |
| Entities | manager `serialize()` on the snapshot | same blobs on `WorldDiskState` | Duplicate wrappers |
| Schema | `schemaVersion: 1` | none | No |

`Game` wrote IndexedDB via `SaveService`. `WorldInstance` wrote `WorldDiskState` through `WorldPersistence`. `server:import` copied dump fields into the three files by hand.

## Shared Snapshot

`WorldSnapshot` in `src/save/types.ts` **is** `SerializedWorldState` (alias). `WORLD_SCHEMA_VERSION = 1`. Independent of network protocol version and schematic `importVersion`.

`parseWorldSnapshot` accepts existing IDB dumps. Unknown future versions throw `PersistenceError` (`unsupported`). Missing optional collections default to empty. Client-only visual fields are never written.

## Player

- SP / IDB dump: `player: SerializedPlayerState` (position, velocity, look, health, hunger, saturation, absorption, slot, spawn, inventory). Unchanged JSON.
- Server roster: `players?: Record<id, SerializedPersistedPlayer>` (id, name, x/y/z, look, health, gamemode, inventory, survival blob, cursor, sessionToken). Same as former `StoredPlayer`.
- Server snapshots still include a synthesized `player` (placeholder at spawn) because the SP field is required. Import still does **not** turn the dump host player into a server account.

## Entity

Existing manager serialize/restore: dropped items, mobs, minecarts, falling blocks, redstone (sources + primed TNT). Not stored: meshes, interpolators, `deathVisualElapsed`, hurt flash, animation mixers.

Mob restart semantics unchanged (`MobManager.restore` already skips `health <= 0`).

## World

`modifications` (chunk deltas), `blockStates`, `chests`, `furnaces`, `timeOfDay`, `summary`, optional `serverWorld` (spawn metadata). Unmodified terrain is still seed generation + deltas.

## Storage Interface

`WorldStore`: `load(worldId)`, `save(snapshot)`, `exists(worldId)`, optional `delete`, optional `list`.

Simulation (`Game`, `WorldInstance`) does not call IndexedDB or `fs.writeFile`.

## IndexedDB

`IdbWorldStore` wraps `SaveService`. Database `frontier-cubes-saves`, store `worlds`, key `summary.id`, IDB version 1 — **unchanged**. Old `schemaVersion: 1` records load. In-memory Map if IndexedDB is missing. `Game` autosave chain unchanged.

## Filesystem

`FsWorldStore` uses `dataDir/<worldId>/`. Mapper: `snapshotToFsRecords` / `fsRecordsToSnapshot`. Low-level IO: `WorldPersistence` (temp file + rename). Save order: `world.json`, `players.json`, then `meta.json`. Concurrent saves queued. `delete` refuses (no silent wipe).

Anarchy path remains `server/data/worlds/anarchy/`. World id `anarchy`. Spawn policy unchanged: load existing; else procedural `estimateWorldSpawn`. No IndexedDB auto-import. No `.schem` at startup.

## Import/Export

`npm run server:import -- dump.json` → `parseWorldSnapshot` → `importWorldDump` → `FsWorldStore.save`. `--force` required to overwrite. Schematic runtime still disabled.

## Versioning

`WORLD_SCHEMA_VERSION = 1` on the snapshot. Not mixed with protocol v1 or `ANARCHY_IMPORT_VERSION`. v1 is identity. v>1 fails parse.

## Compatibility

- Existing SP IndexedDB worlds: same DB/store/key; parser fills optional arrays.
- Existing server folders: same three filenames; `loadRecords` reads old `world.json` without a schema field.
- No destructive migration. No wipe of `server/data/worlds/anarchy`.

## Anarchy

Current world id, directory, and spawn behavior **did not change**. This pass does not migrate the owner’s IndexedDB spawn onto disk.

## Implemented

- `src/save/types.ts`, `snapshot.ts`, `WorldStore.ts`, `IdbWorldStore.ts`, `fsRecords.ts`, `PersistenceError.ts`, `index.ts`
- `server/FsWorldStore.ts`, `importDump.ts`; `persistence.ts` / `WorldInstance.ts` / `importWorld.ts` / `gameplay.ts` persist path
- `Game` uses `IdbWorldStore`
- Tests: `world-snapshot`, `idb-world-store`, `fs-world-store`

## Changed files

See git diff. GameplayKernel, useInteraction, blockGeometry, EntityHost, `shared/protocol.ts`, render/death animation not modified except `Game.ts` save wiring.

## Tests

Targeted: `world-snapshot` 5, `idb-world-store` 3, `fs-world-store` 6, `lighting-height-256` Game paths 24/24 after pointing stubs at `worldStore`. Anarchy persist/restart, kernel, use, geometry, entity-host, death, input, fluids green. `tsc` clean.

Full `npm run check` (pre-stub-fix run): **1153 passed / 11 failed** (authored ENOENT `bucket_empty.png`, 5 minecart 5s timeouts, 4 lighting `game.saves` stubs, + vitest RPC). Lighting stubs fixed in follow-up commit; remaining known baseline is authored ENOENT + minecart timeouts.

Production `npm run build` + size/archive: **3.65 MiB / 221 files** (JS +~4 KiB from snapshot parse on the client save path).

## Performance

Snapshot built only in `saveSession` / `WorldInstance.save` / import. Not per tick or per frame. One extra parse/clone on save. FS writes still three JSON files.

## Remaining duplication

- SP `player` vs server `players` rows stay different shapes (one local avatar vs roster). Mapped, not flattened into one row type, so IDB JSON stays compatible.
- Network `EntitySnapshot` in `shared/protocol.ts` is live replication, not persistence. Intentionally separate.
- Schematic import version stays on `serverWorld`, not `WORLD_SCHEMA_VERSION`.

## Next Phase

Phase 6 only: RNG + lighting adapters. **Not implemented here.**

## Git

Branch `cursor/shared-persistence-port-bbb1` from death-animation `7ae826b`. Implementation `8779aa8`, lighting-test follow-up `41317c3`. Draft PR **#26** stacked on **#25**, not `origin/main`.
