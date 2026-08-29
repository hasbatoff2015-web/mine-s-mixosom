# 2026-08-29 — Local Anarchy server QA fixes (foundation only)

## Goal

Owner local QA rejected the first authoritative Anarchy pass: missing accepted spawn, rubber-banding, block break (and likely place) broken. Diagnose and fix those foundation bugs. No new features, no plugins, no fluids/mobs/combat, no `.schem` restore, no silent IndexedDB copy.

## Result

Foundation runtime bugs fixed on `cursor/local-authoritative-server-bbb1`. Spawn migration is **documented, not automated**. Draft PR #14 updated. **Do not merge.**

## Root Cause — Missing Spawn

The accepted playtested Anarchy map was never on the server disk.

After the authority split, **Играть онлайн → Анархия PvP** stopped calling `Game.openAnarchyWorld()` (IndexedDB). The Node process creates or loads `server/data/worlds/anarchy/`. An empty folder means a **new procedural world** (`WORLD_SEED` / `anarchy-spawn-v1` + `estimateWorldSpawn`). That is not the IndexedDB spawn the owner already accepted.

Runtime `.schem` import was intentionally disabled and is still disabled.

### Current server world source

Filesystem, process cwd:

```
server/data/worlds/anarchy/
  meta.json
  world.json
  players.json
```

First start: procedural generate + estimated spawn. Later starts: load that folder. Mutations persist there. Not browser IndexedDB.

### Current client IndexedDB source

`SaveService` database `frontier-cubes-saves`, store `worlds`, record id `anarchy` (`SerializedWorldState`). This is the accepted spawn **on the owner’s machine only**. It is not in git and is not read when connecting online. Singleplayer still uses IndexedDB. Online Anarchy does not write IndexedDB (`saveSession` returns early when `session.online`).

## Root Cause — Movement Jitter

Classic dual-authority rubber-band:

1. Client sent `input` and did **not** run `PlayerController.tick` online (correct).
2. Server simulated at 20 TPS (correct).
3. Every `player_state` **hard-set** `session.player.position` to the snapshot.
4. `render()` still lerped `previousPosition → position` with **client physics `alpha`**, which is not snapshot time.
5. Snapshots arriving on the WebSocket mid-frame yanked prev/pos, so the camera jumped forward and back.

Look was not the locomotion jitter source (`applyImmediateRenderLook` already used `this.input`), but mining raycasts used `PlayerController.yaw/pitch`, which stayed at welcome/spawn because `player.tick()` was skipped.

## Movement Fix

Model now:

- Client sends input only (`seq`, axes, jump, sneak, sprint, look). No client position as truth.
- Server stores the latest **newer** `seq` (stale/duplicate seq ignored) and simulates **once per 20 TPS tick** via `PlayerController`.
- `player_state.tick` is monotonic. Client **drops** tick ≤ last applied.
- Local player: last accepted pose is a **target**. Each render frame exponentially chases it (`LOCAL_APPROACH_PER_SECOND = 18`). Hard teleport only if error ≥ 6 blocks.
- Online camera uses the smoothed `player.position` directly (no 20 TPS/physics-alpha lerp).
- Camera yaw/pitch stay on `InputManager`. Snapshots do not overwrite look.
- Remotes: snapshot history + ~80 ms interpolation. Local id is never a `RemotePlayerView`.

Tick rate stays **20 TPS**. No full-world broadcast.

## Root Cause — Block Break

Primary: raycast used stale `PlayerController` look (spawn yaw), while the camera followed the mouse. Break requests hit the wrong block or air; the server rejected or mutated an irrelevant cell. Rejections were silent (no `block_result`).

Secondary: rubber-banding moved the mining target every tick, so survival progress rarely reached 1. Reach used `PLAYER_REACH + 0.75` against a lagged server pose, so valid clicks could fail `reach`.

## Block Interaction Fix

- Each online tick (and each smoothing step) copies `input.yaw/pitch` onto the local controller **before** raycast.
- `break_block` / `place_block` still client-requested; server validates bounds → reach (`PLAYER_NET_REACH = 6.5`) → air/occupied/inventory/gamemode → `world.setBlock` → persist dirty → `block_update` to **all** connected clients (including requester).
- Requester also gets `block_result` `{ ok, action, reason?, x,y,z }`. Rejects `console.warn` on the client; server warns without 20 TPS spam. Opt-in `FC_DEBUG_NET=1` for extra `[server]` net traces (not on the input hot path unless a seq is dropped).
- In-flight break/place is deduped per cell until result/update; a rejected cell is not retried until the target changes.
- Survival place checks inventory **before** commit and consumes one item; creative uses `blockId`.
- Client still does not persist Anarchy voxels to IndexedDB.

## Persistence

Unchanged path: dirty world → `WorldPersistence.save()` (`meta.json` / `world.json` / `players.json`) on interval and shutdown. Restart loads that folder. Independent of IndexedDB.

## Existing Spawn Migration

**Not implemented automatically** (by request).

When the owner can export the accepted IndexedDB world:

1. Export `frontier-cubes-saves` / `worlds` / id `anarchy` as `SerializedWorldState` JSON (includes `modifications`, `blockStates`, spawn in `serverWorld.spawn` or player position).
2. Stop the Anarchy server.
3. `npm run server:import -- path/to/anarchy-idb.json`  
   Use `--force` only to overwrite an existing `server/data/worlds/anarchy/`.
4. Start `npm run dev:server` again.

Do not restore `frontier_spawn2.schem` at runtime. Do not copy arbitrary IndexedDB into the server from the game client.

## Implemented

- `shouldAcceptSnapshot` / `stepTowardTarget` / local chase in `Game`
- Remote `sampleRemotePose` delay interpolation
- `block_result` + `parseServerMessage` (unknown server types are not swallowed)
- Look-sync, online camera path, reach slack, break/place reject reasons
- First-create server log that IndexedDB was not imported
- Regression tests listed below

## Changed files

- `shared/protocol.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`, `server/log.ts`
- `src/net/authoritativeMotion.ts`, `src/net/RemotePlayerView.ts`, `src/net/AnarchyClient.ts`, `src/net/index.ts`
- `src/core/Game.ts`, `src/core/constants.ts`
- `tests/authoritative-motion.test.ts`, `tests/remote-player-view.test.ts`, `tests/server/anarchy-server.test.ts`
- `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, this report

## Architecture decisions

- Foundation local player = **smooth authoritative chase**, not client prediction + correction, and not hard snapshot overwrite.
- Camera authority stays client-side until a later pass needs server look for gameplay.
- Spawn mismatch is a **data migration** problem, not a generation bug.

## Tests

See the Git / Tests section after the verification run.

## Visual QA

Cloud agent: no interactive two-browser Anarchy session in this pass. Owner checklist is in the user request (one client move/look, break, place, two clients, restart persist, no-server toast, singleplayer).

## Performance

Still 20 TPS, snapshot per tick for connected players, chunk interest streaming, modification deltas. Tick rate was not raised to hide jitter.

## Known issues

- Server world is procedural until the owner imports an IndexedDB dump.
- Fluids/mobs/combat/TNT/minecarts remain client-only (offline) / absent online.
- Full inventory authority is still starter-hotbar + place consume.

## Deferred

IndexedDB export UI; VPS; plugins as products; anti-cheat; prediction/replay.

## Next work

Owner QA on the frozen branch. Then explicit spawn import when a dump is available.

## Git

- branch: `cursor/local-authoritative-server-bbb1`
- Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/14
- **Do not merge.**
