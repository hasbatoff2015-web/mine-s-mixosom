# 2026-08-29 — Online blockstates, live fluid remesh, respawn input

## Goal

One integration pass on Anarchy after PR #16 local QA:

1. WASD dies after death/respawn while mouse and chat still work.
2. Directional / attached blocks always place in a default orientation online.
3. Button/door (and other) interactions do not show state changes.
4. Newly spread Water/Lava look like square full-height slabs; fluids loaded from chunk/`blockStates` keep corner slopes.

Do not rewrite the fluid renderer. Do not break interpolation, hurt/death/bow/arrow, 256 height, spawn, lighting budget, or client-authoritative singleplayer.

## Result

Server remains authoritative for placement, interaction, and fluid simulation. Live block packets now carry enough `BlockRenderState` for the existing mesher (`fluidCornerHeight`, doors, torches, etc.). Online respawn restores the same PLAYING input contract as a fresh join.

Browser two-client visual QA was **not** performed in this environment.

## Root Cause — Respawn Input

Online `handleDeath` returns immediately (no death screen, no `enterPlaying`). Server `respawnIfDead` runs in the **same tick** as death and restores health to 20 / `dead: false`. `flushHealth` signatures `{ health: 20, dead: false }` before and after match, so the client often never saw a death packet.

Meanwhile death can still drop pointer lock / fire `window.blur` / leave chat open. Look still renders; `tickOnline` does not run in `BACKGROUND`, or movement is zeroed while chat overlay is open — same class as the PR #16 WASD bug, triggered by respawn instead of tab/chat.

`player_state.restore({ health })` without `dead` also inferred `dead` from `health <= 0`.

## Respawn Fix

- Before respawn, server flushes `health` with `dead: true`, then respawns, clears the signature, flushes alive.
- Clears riding, container window, mining, and held movement on the server player (does not reset `lastInputSeq`).
- Client: `shouldRestoreGameplayAfterRespawn` on `health` and `player_state`. `restoreOnlinePlayingFromRespawn` closes chat/inventory, `clearHeldKeys`, canvas focus, `PLAYING`, pointer lock — same family as `enterPlaying`, not `keys.W = false`.
- Snapshot includes `dead`.

## Root Cause — Directional Placement

`ServerGameplay.applyPlacementState` already resolved facing/attachment from server yaw + `lookHit`. Persistence/`welcome.blockStates` therefore looked correct for **already placed** blocks.

Live `block_update` / `block_batch` were `{ x, y, z, blockId }` only. Client `applyBlockBatch` → `writeBlockRaw` **deletes** `blockStates`. Chests/torches/doors remeshed with defaults (always one facing).

RMB sent `interact` **and** `place_block`. `useHeld` already placed; extra `place_block` could place adjacent to a door/button.

## Block State Fix

- Protocol: optional `state` on `BlockChange` / `block_update` / `block_batch` (PROTOCOL_VERSION still 1).
- `VoxelWorld.onCommittedBlockState` for state-only writes (fluid level, door toggle, button powered).
- `consumeBlockChanges` re-reads live id+state so place-then-orient in one tick is one packet.
- Client `applyNetworkBlockChanges`: batch ids (`scheduleNeighbors: false`, `skipSupport: true`), then `setBlockState`. One later remesh per dirty chunk.
- Online use: **only** `interact`. Server `useHeld` / `placeAt` use canonical raycast (selection geometry, including partial blocks) + look.

## Interaction

`useHeld` already called `pressButton` / `toggleDoor` / lever / containers. Those `setBlockState` calls now enter `blockDelta` and broadcast. Clients remesh powered/open state. No per-block network hacks.

## Root Cause — Live Fluid Visual

Path A (chunk load): `welcome.blockStates` includes `fluidLevel` / `fluidFalling` → `fluidCornerHeight` samples neighbors correctly.

Path B (live): fluid sim `applyFluidWrites` does `applyBlockBatch` (Air→Water, **deletes state**) then `setBlockState({ fluidLevel })`. Only the id went on the wire. Missing `fluidLevel` is treated as **source 8** (`readFluidLevel`) → every live cell is a full-height cube. Level-only updates never left the server at all (`setBlockState` ≠ `onCommittedBlocks`).

## Fluid Fix

Same renderer. Live packets include fluid fields. Neighbor dirtying remains `neighborFluidMeshOffsets` (chunk borders and diagonals). Batch apply then one remesh. `shouldRunClientFluidSimulation(true) === false`; `tickOnline` still does not call `world.tick()`.

## Chunk Border

A live write at x=15 dirties chunk 0 and chunk 1 (and diagonal keys when needed). Corner height at the shared edge is the same function from both cells.

## Server Authority

Placement orientation, interaction outcomes, and fluid sim stay server-side. Client requests `interact` / `place_block` (legacy) / look via `input`. Client displays id+state. No second fluid sim online.

## Tests

- `tests/network-block-state-respawn.test.ts` — respawn lifecycle helpers; no client fluid sim; parse state; path A vs live apply; lava border corners; batch remesh.
- `tests/network-input-recovery.test.ts` — respawn PLAYING contract.
- `tests/server/anarchy-gameplay.test.ts` — WASD after `/kill`; two-client respawn move; chest/furnace facing; wall vs floor torch; ladder/button/door interact; stairs/rails/lantern/chain; live fluid levels; persist door/button/fluid.

Targeted three files **35/35**. `tsc --noEmit` clean. Production `vite build` + `check:size` PASS (3.63 MiB / 221 files). Full `npm run check` **1056 passed / 7 failed**: authored-item-assets ENOENT (`assets/minecraft/textures/items/bucket_empty.png`) and minecart tests timed out at 5s — same pre-existing class as PR #16, not introduced here — plus 1 vitest worker RPC timeout.

## Performance

Server still 20 TPS. Fluid updates still batched. Remesh is dirty-chunk, not full world. `WORLD_LIGHT_BUDGET_MS` unchanged. Network apply skips client fluid/support scheduling.

## Visual QA

Not run here (no two-client browser session). Owner local QA is the acceptance gate.

## Changed files

- `shared/protocol.ts`
- `src/world/World.ts`, `src/world/networkBlockUpdates.ts`, `src/world/blockInteraction.ts`
- `src/core/Game.ts`, `src/core/onlineRespawn.ts`, `src/core/onlineSimulation.ts`
- `server/gameplay.ts`, `server/WorldInstance.ts`
- tests + docs (`PROJECT_STATE`, `ROADMAP`, `ARCHITECTURE`, `LOCAL_SERVER`)

## Architecture decisions

- Optional `state` on existing messages; no protocol version bump.
- Hook `setBlockState` rather than a second fluid renderer or client sim.
- Restore PLAYING as a lifecycle, not WASD key patches.
- Reuse `useHeld` / `applyPlacementState`; do not fork placement rules.

## Deferred

- Wire power visual on live packets (still source-map on server; not in this QA list).
- Chest inventory online UI beyond existing window packets.
- Owner two-client visual QA.

## Next work

Owner localhost QA per the task checklist, then iterate. Do not merge main.

## Git

- Branch: `cursor/online-blockstates-fluid-render-respawn-bbb1` (cloud suffix `-bbb1`; requested name without suffix).
- Base: PR #16 `cursor/entity-interpolation-input-visual-sync-bbb1` @ `76b8f87`, **not** `origin/main` (`a056e6f`).
- Implementation HEAD: `23ff65c`.
- Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/17
- Status: pushed, freeze for owner local QA. Do not merge main.
