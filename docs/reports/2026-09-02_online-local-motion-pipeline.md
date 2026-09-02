# Online Anarchy: SP vs Online local-motion pipeline

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

PR #37 prediction-history accept path was logically correct, but localhost QA still showed the same 20 Hz visual stepping (walk / sprint / jump / strafe / creative flight / fly+SHIFT). Stop speculative reconciliation tweaks. Compare the singleplayer and online local-player pipelines, instrument the local player, and fix the measured root cause. Urgent remesh stays.

Do not change GRAVITY, JUMP_VELOCITY, WALK_SPEED, SPRINT_SPEED, FIXED_DT, 20 TPS, or offline `PlayerController` physics.

## 1. Exact root cause

Accepted reconciliation was **not** writing pose. The remaining 20 Hz step was:

1. Client `tickOnline` predicts **every** `input.seq` (20 TPS).
2. Server `applyInput` **replaced** `lastInput`. A 50 ms tick simulated only the latest packet. Phase/WS timing regularly skipped seq N-1.
3. Snapshot `inputSeq = N` was the pose after **one** tick of N. Client `history[N]` was the pose after N-1 **and** N.
4. Error ≈ one walk tick (~0.22 blocks) → `corrected`, not `accepted`.
5. Restore rewound the live player onto the previous tick. That pose **is** `previousPosition`.
6. Render `lerp(previousPosition, position, alpha)` became a no-op → visible 20 Hz / 10 Hz stepping.

Lockstep 1:1 snapshots (identical worlds) accept with **zero** pose writes and match singleplayer render-step stats. Manual QA looked identical to pre-#37 because localhost always coalesced.

Camera was already interpolated local (not the snapshot). Same `Game.render` source lines as singleplayer.

## 2. Call chains

### Singleplayer

```text
InputManager
→ Game.frame / advanceFixedStep (FIXED_DT=0.05, max 4 catch-up)
→ Game.tick → GameplayKernel tickPlayers
→ PlayerController.tick:
     previousPosition.copy(position)   // start of this tick
     position += this tick
→ render(alpha = accumulator / FIXED_DT)
→ interpolatedPlayerPosition = lerp(previousPosition, position, alpha)
→ updatePlayerPresentation(session, interpolatedPlayerPosition)
     cameraPivot = interp feet + eyeHeight
     first person: camera.position.copy(cameraPivot)
```

One `PlayerController.tick` per fixed step. Multi-tick frames keep `previousPosition` from the **latest** tick only (same as online).

### Online local

```text
InputManager
→ Game.frame / advanceFixedStep (same function, same alpha)
→ Game.tick → tickOnline   // shouldRunClientWorldSimulation(true) === false
→ send input.seq
→ predictLocalMove → PlayerController.tick + history[seq] = stateAfter
→ WS player_state (macrotask, not between tick and render)
→ applyOnlinePlayerState
     clientLookAfterSnapshot keeps client yaw/pitch
     reconcilePredictedPlayer vs history[N]
→ render: SAME lerp / cameraPivot lines as singleplayer
```

`stepOnlineAuthority` only copies yaw/pitch. No `stepTowardTarget`. No snapshot-driven camera.

### Pose mutators (local player)

| Site | position | previousPosition | velocity | onGround | isFlying |
| --- | --- | --- | --- | --- | --- |
| `PlayerController.tick` (predict / replay / SP) | yes | yes (start of tick) | yes | yes | yes |
| `applyMovementState` (correction only) | yes | **no** | yes | yes | yes |
| accept path | no | no | no | no | no |
| snap ≥ 6 | yes | yes (copy position) | yes | yes | yes |
| teleport / restore / minecart | yes | yes | yes | — | — |
| explosion knockback | no | no | yes | no | no |

## 3. Diagnostics

DEV F3 (local player only) now includes `motionProbe.formatHud()`:

- online / singleplayer, render FPS, fixed ticks this frame, accumulator alpha
- prediction ticks/s, player_state/s, accept/corr/snap/dup rates
- position / previousPosition / velocity writes/s, acceptMut/s
- current / previous / render pose, \|pos-prev\|
- time since last reconcile / player_state
- `cam=interpolated-local`

`?motionDiag=1` dumps a 2 s frame trace to the console (tick time, position, previousPosition, renderPosition, alpha).

Accepted reconciliation logs `acceptMutated` if pose actually changes (should stay `no` / 0/s).

## 4. Measured SP vs Online (2 s walk, 60 fps client, 20 TPS)

| Run | ticks | mean render step | corr | acceptMut | collapsed lerp |
| --- | --- | --- | --- | --- | --- |
| Singleplayer | 40 | ~0.070 | — | — | 0 |
| Online 1:1 snapshots | 40 | ~0.070 (Δ < 0.002) | 0 | 0 | 0 |
| Legacy lastInput coalesce (10 Hz server) | 40 | — | 20 | 0 | 20 |
| Queued server (phase offset 30 ms) | 40 | ~0.070 | 0 | 0 | 0 |

Prediction is one `PlayerController.tick` per fixed step in both modes. Catch-up (2 ticks in one frame) preserves `previousPosition` from the latest tick, same as SP.

`player_state` is one snapshot per server tick (20 Hz when the loop is healthy). Duplicate `inputSeq` means a held lastInput (packet gap), not a second simulated seq.

## 5. Fixes (not accept-threshold tweaks)

1. **Server input queue.** Packets enqueue in seq order. Each 20 TPS tick simulates **one** queued input. `snapshot.inputSeq` is `simulatedInputSeq`, not the latest received seq. Empty queue holds lastInput (packet gap). Tick rate unchanged.
2. **Render lerp.** Small corrections no longer copy `previousPosition = position`. Only a ≥ 6 block snap collapses the window. Accept path still does not touch pose.

Urgent remesh unchanged.

## 6. Files changed

- `src/net/localMotionDiagnostics.ts` — F3 / `?motionDiag=1` probe
- `src/net/localPlayerPrediction.ts` — accept mutation log, reject reasons, no lerp collapse except snap
- `src/core/Game.ts` — probe on tick/render/player_state; F3 HUD
- `src/net/index.ts`
- `server/WorldInstance.ts` — input queue + `simulatedInputSeq`
- `shared/protocol.ts` — inputSeq comment
- `tests/local-motion-pipeline.test.ts`
- `tests/local-player-prediction.test.ts`
- `tests/server/anarchy-server.test.ts`
- `tests/player-main-integration.test.ts`
- docs

## 7. Tests

```text
npx vitest run tests/local-player-prediction.test.ts tests/local-motion-pipeline.test.ts tests/player-main-integration.test.ts tests/urgent-block-mesh.test.ts tests/server/anarchy-server.test.ts
```

- prediction **24/24** (accept no-touch + `acceptMutated=false`; small lockstep correction keeps `previousPosition`)
- pipeline **5/5** (SP vs Online render steps; coalesce documents lerp collapse; queue = 0 corrections)
- urgent remesh **4/4**
- server **75/75** (queued seq order)
- `typecheck` / `typecheck:sim` / `typecheck:client` / `typecheck:server` / `check:boundaries` PASS
- `test:sim` **42/42** · `test:server` **75/75** · `smoke:sim` / `smoke:server` PASS
- `build` PASS

## 8. Manual QA

F3 in both modes. Quiet localhost walk should show `corr/s=0`, `acceptMut=no`, `ticks` 0 or 1 per frame at 60 fps, `alpha` ramping, `|pos-prev|` ≈ one walk tick while moving, `cam=interpolated-local`.

`?motionDiag=1` — compare 2 s SP vs Online traces; render steps should look like SP.

Then: walk, sprint, jump series, strafe, creative flight, fly+SHIFT descend vs singleplayer. Place/break still immediate.

## Git

Same PR branch. Do not merge main.
