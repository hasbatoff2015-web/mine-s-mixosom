# 2026-08-29 — Local authoritative Anarchy server (foundation)

## Goal

Stand up a localhost Node server that owns the Anarchy world so `Играть онлайн → Анархия PvP` is real multiplayer on one PC, portable to VPS later by config. Foundation only: process, protocol, join, two clients, movement, break/place, persist, plugin/command skeleton. Do not port fluids/mobs/combat/inventory/TNT.

## Result

Implemented. Draft PR only — **do not merge** until the owner QAs localhost two-client + persist.

## Architecture audit (actual `origin/main` `a056e6f`)

1. Networking: none. No Colyseus, WebSocket, or socket.io remnants.
2. Anarchy lived in IndexedDB via `Game.openAnarchyWorld()` / `resolveAnarchyStartup`.
3. Simulation, blocks, chat, commands, inventory were fully client-authoritative.
4. UI already listed Anarchy as connectable and Survival PvP as mock, with copy saying multiplayer was not implemented.

Transport choice: **native `ws` + browser `WebSocket`**, JSON protocol in `shared/protocol.ts`. No second voxel representation: server reuses `VoxelWorld` + save-style modification deltas.

## Implemented

- `server/` Node process, `npm run dev:server`, optional `npm run dev:anarchy`
- Configurable host/port/world path/tick/view radius/max players
- `WorldInstance` lifecycle UNINITIALIZED → INITIALIZING → READY
- Filesystem persist under `server/data/worlds/anarchy/`
- Authoritative player join/input/position, break/place with reach checks
- Chunk interest (`view` / `chunk_data` / `unload_chunk`) + welcome seed+deltas
- Chat via server; command registry (`/help`, `/gamemode`, `/seed`, `/spawn`)
- `PluginManager` + frozen `ServerAPI` + cancellable events
- Client `AnarchyClient`, remote player boxes, online `Game` session (no IDB autosave)
- UI: localhost Anarchy connect; down server → «Сервер недоступен»; live `/status` count
- Explicit `npm run server:import` (never on startup; no `.schem`)

## Changed files

- `shared/config.ts`, `shared/protocol.ts`
- `server/*` (config, WorldInstance, AnarchyServer, plugins, persistence, import)
- `src/net/*`, `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/world/spawn.ts`
- `package.json`, `tsconfig.json`, `.gitignore`, `scripts/dev-anarchy.mjs`
- `docs/LOCAL_SERVER.md`, `PROJECT_STATE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`
- `tests/server/anarchy-server.test.ts`

## Architecture decisions

- One server, one Anarchy world, one process. Room frameworks deferred.
- Client interpolation without prediction/rollback; input is the only locomotion write.
- Online session skips `world.tick` fluids/mobs/redstone on the client so those systems are not silently local-authoritative.
- `openAnarchyWorld()` kept for existing Game-path tests; UI connect does not call it.
- Starter hotbar on the server (dirt/cobble/planks/stone/log/apples) until inventory is ported.

## Current spawn

Accepted playtested spawn exists only in the owner's IndexedDB, not in git. Server first-create uses `estimateWorldSpawn` on seed `anarchy-spawn-v1`. **Missing step:** export IDB `anarchy` JSON → `npm run server:import -- dump.json` → restart server.

## Tests

See report body after the check run.

## Performance

Fixed 20 TPS on the server. Broadcasts player snapshots at tick rate (not per voxel/frame). Dirty-flag persist every 30s + shutdown. Welcome sends modification deltas, not the full 256-high grid.

## Deferred

Fluids, mobs, combat, TNT, minecarts, full inventory/crafting, lighting authority, anti-cheat, accounts, VPS, TLS, Colyseus.

## Next work

Owner QA checklist in the PR / agent final report. Import accepted spawn when the IDB dump is available. Then port additional systems one at a time.

## Git

Filled after commit/push.
