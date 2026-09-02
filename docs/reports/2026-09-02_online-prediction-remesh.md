# Online Anarchy: local prediction + urgent block remesh

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1`  
Base: `origin/main` `4d803e5`  
**Do not merge main.**

## Goal

Fix the first two Online Anarchy problem classes:

1. Local movement feels floaty / levitating, with a brief air hitch on sprint/jump.
2. Authoritative block collision updates immediately, but visible chunk geometry lags a frame or more.

Also diagnose whether ordinary walk/jump hitches come from server tick spikes > 50 ms.

Constraints: new branch off current main; no plugin work; no SP physics / GRAVITY / JUMP_VELOCITY changes unless proven necessary; no fake client authority; do not raise global mesh/light budgets to mask latency.

## Result

- Local Anarchy movement now predicts on the existing `PlayerController` at 20 TPS and reconciles with `player_state.inputSeq`. The exponential XYZ chase is gone.
- Live `block_update` / `block_batch` still write VoxelWorld immediately; visible remesh uses a dedicated urgent slice (≤3 chunks, 2 ms) that may run while lighting is still pending.
- Ordinary server walk/sprint/jump ticks were measured well under 50 ms. No performance guess-fix was applied.

## Root cause

### Movement (floaty Y / air hitch)

Previous online flow:

```text
Game.tickOnline()
  → send input
  → server PlayerController.tick
  → player_state
  → ingestAuthoritativePosition stores target
  → stepOnlineAuthority() every frame: stepTowardTarget (LOCAL_APPROACH_PER_SECOND = 18)
```

The client did **not** run local physics. Every axis, including Y, exponentially approached the last accepted snapshot. A physically correct server jump arc became a delayed chase of a possibly stale Y. If the next snapshot was late, the client kept sliding toward the old peak/ground pose — levitation and a short freeze in the air.

GRAVITY and JUMP_VELOCITY were already correct on the server. Changing them would have been the wrong fix.

### Block visual latency

```text
block_update / block_batch
  → applyNetworkBlockChanges()          ← VoxelWorld + collision now
  → Chunk.dirty / pendingMesh
  → processWorldJobs() / rebuildDirty()
```

`WorldRenderer.rebuildDirty` skipped any chunk with `hasPendingLighting` (deferred light region / emitters / `lightPending`). Collision therefore existed while the mesh waited for the lighting scheduler. Place and break shared that wait. Raising `WORLD_JOB_BUDGET_MS` would only hide the skip, and a synchronous remesh inside the WebSocket handler would spike the frame.

### Server tick hitch

`ServerGameplay` already records `tickMs` / `maxTickMs`. A 40-tick walk/sprint/jump probe on a fresh Anarchy world (no `startLoops`, view radius 1) measured:

| sample | mean | max gameplay | max wall |
| --- | --- | --- | --- |
| 40 ticks | ~0.32 ms | ~3.5 ms | ~4.1 ms |

No tick exceeded 50 ms. The air hitch is explained by the client chase, not by `WorldInstance.tick`, mobs, redstone, flushBlockChanges, snapshots, persistence, or plugin dispatch on this path. DEV-only `FC_DEBUG_TICK_MS=1` logs wall ≥ 16 ms; it is not a production profiler.

## What changed: client prediction / reconciliation

Reuse, not a second movement system:

- Same `PlayerController.tick` / `FIXED_DT = 0.05`.
- Same input seq already on the protocol (`ClientInputMessage.seq`, server `lastInputSeq`).
- New helper `src/net/localPlayerPrediction.ts` plus `PlayerController.applyAuthoritativeSimulation` (does not wipe creative flight the way `restore()` does).

Per 20 TPS tick (`Game.tickOnline`):

1. Increment `inputSeq`, send `input`.
2. `pushPredictedMove` (cap 32).
3. `applyPredictedTick` — local pose reacts immediately. No `onDamage`; health stays server-owned.
4. Riding still sets `locomotion: false` to match the server.

On `player_state`:

1. Drop stale `tick` (`shouldAcceptSnapshot`).
2. Keep client yaw/pitch (`clientLookAfterSnapshot`).
3. `reconcilePredictedPlayer`:
   - ack `snapshot.inputSeq`;
   - restore pose / velocity / onGround / sneak / sprint / `jumpHeld` from the last acked input;
   - replay seq > ack on the current client `VoxelWorld`;
   - snap `previousPosition` if the **before vs after** correction ≥ 6 blocks (unacked walk is not treated as a teleport);
   - small residual keeps the in-flight render lerp instead of rewinding Y toward a stale ack pose.
4. Survival/health/gamemode still come from the snapshot.

`stepOnlineAuthority` only copies look. Render lerps `previousPosition → position` like singleplayer (online used to copy the current pose every frame, which stacked with the Y chase).

Reconnect / welcome: `resetPredictionBuffer`; `lastAckedSeq = welcome.you.inputSeq ?? -1`. Server `inputSeqAfterReconnect()` remains `-1`.

Not done: client-authoritative blocks, local fall damage, a second PlayerController, changing SP `Game.tick`.

## What changed: block visuals

- `applyNetworkBlockChanges` returns `meshKeys` (edited chunk + `neighborFluidMeshOffsets` for faces/corners).
- `Game` queues those keys; `drainUrgentMutationMesh` runs from `processWorldJobs` (including tight-budget lighting-only frames), **after** lighting, **not** in the WS handler.
- `WorldRenderer.rebuildDirty({ preferKeys, allowPendingLighting })` remeshes if `lightingReady` even while a deferred light job is pending.
- Urgent budget: `URGENT_MUTATION_MESH_LIMIT = 3`, `URGENT_MUTATION_MESH_BUDGET_MS = 2`.
- Unchanged: `WORLD_JOB_BUDGET_MS = 4`, `WORLD_LIGHT_BUDGET_MS = 2`, streaming scheduler, lighting pipeline. A slightly stale-light mesh can show now; `lightMeshStale` remeshes again when light finishes.
- Place, break, state-only (door/slab/rail/torch/chest/fluid level) share the same dirty + urgent path.

## Server tick latency check

Method: `tests/server/tick-latency.test.ts` constructs a `WorldInstance`, joins one player, applies 40 walk/sprint/jump inputs, and records `performance.now()` around `world.tick()` plus `world.lastTickMs` (gameplay, before `flushBlockChanges`). Wall time includes flush.

Result: mean ~0.3 ms, max wall < 4 ms on this environment. Ordinary movement hitch is **not** a server spike.

Optional live log:

```bash
FC_DEBUG_TICK_MS=1 npm run dev:server
```

Example line: `tick-ms n=… wall=… gameplay=… blocks=… entities=… online=…` (warn, ≥ 16 ms wall).

No production hot-path change was made from this probe.

## Implemented

- `src/net/localPlayerPrediction.ts` — buffer, predict, ack, restore, replay, reconcile.
- `PlayerController.applyAuthoritativeSimulation`.
- `PlayerSnapshot.inputSeq` + `ServerPlayer.snapshot()`.
- `Game.tickOnline` / welcome / `applyOnlinePlayerState` / render lerp / urgent mesh drain.
- `WorldRenderer.rebuildDirty` preferKeys + allowPendingLighting.
- `applyNetworkBlockChanges` meshKeys.
- `WorldInstance` `FC_DEBUG_TICK_MS`.

## Changed files

- `src/net/localPlayerPrediction.ts` (new)
- `src/net/authoritativeMotion.ts` (comment: local player no longer chases)
- `src/net/index.ts`
- `src/core/Game.ts`
- `src/player/PlayerController.ts`
- `src/world/networkBlockUpdates.ts`
- `src/rendering/WorldRenderer.ts`
- `shared/protocol.ts`
- `server/WorldInstance.ts`
- `tests/local-player-prediction.test.ts` (new)
- `tests/urgent-block-mesh.test.ts` (new)
- `tests/server/tick-latency.test.ts` (new)
- `tests/player-main-integration.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/LOCAL_SERVER.md`, `docs/TESTING.md`
- this report

## Architecture decisions

- Predict with **server movement rules** on the same controller (raw sprint, no SP bow 0.2× multiplier, no local fall damage).
- One predicted step per client 20 TPS input. Server still applies **lastInput only** per tick; coalescing desync is replayed away when the snapshot arrives.
- Snap metric is predicted-before vs reconciled-after, not snapshot vs current (that would snap unacked walking).
- Urgent remesh is a small extra slice, not a global budget bump, and not a sync mesh inside the network handler.
- Do not “fix” tick time without a measured hot path. Walk/jump is not that path.

## Tests

Targeted prediction / remesh / session / tick-latency packs plus retained Anarchy/network suites.

Acceptance commands in this pass: `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `smoke:sim`, `smoke:server`, `test:sim`, `test:server`, `build`.

## Visual QA

Automated: prediction jump/landing/stale-Y, urgent dirt/door remesh, Game source contracts.

Not run here (owner device / two-client):

### A. Movement

- ordinary run, sprint
- standing jump, jump series, run+jump
- fall, landing
- jump onto a block placed underfoot
- fast strafe / direction changes
- delayed snapshot / hitch feel (optional `FC_DEBUG_TICK_MS=1` on the server)

### B. Block visual

- place dirt, break dirt
- place underfoot while jumping
- border block between two chunks
- door / slab / rail / torch
- several fast mutations in a row

## Performance

Urgent remesh ≤ 2 ms / 3 chunks on top of existing jobs. Global budgets unchanged. Server ordinary tick ≪ 50 ms in the probe.

## Known issues

- Server still coalesces to last input per tick; extreme client/server tick skew can drop an intermediate input (pre-existing). Replay follows the acked seq.
- Urgent mesh may show pre-relight lighting for a few frames, then `lightMeshStale` corrects it.
- Creative flight is not a snapshot field; prediction keeps local `isFlying`. Survival PvP is unaffected.

## Deferred

- Client-authoritative block ghosts
- Plugin / homes / TPA / economy
- Guess-fixes for unrelated worldgen/mob tick spikes
- Two-client hardware QA

## Next work

Owner manual checklist above. Do not merge main.

## Git

Branch `cursor/online-prediction-remesh-86e1` off `origin/main`. Draft PR. Main untouched.
