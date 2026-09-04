# Incoming local `player_state` side effects

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Owner A/B proved Normal Online jitters while `?predNoState=1` is completely smooth (`send=on state=OFF`). Isolate and remove the incoming local `player_state` side effect without changing physics, fixed timestep, render interpolation, correction distance, prediction architecture, movement speed, gravity, server TPS, or urgent remesh. Do not add another lerp.

## Result

The write that disturbed local movement was **`restoreAuthoritativePlayer` → `PlayerController.applyMovementState`**, reached from `reconcilePredictedPlayer` → `applyCorrection` when `ackRejectReason` returned `speed` / `onGround` / `flying` on an otherwise matching pose.

Example (fly+SHIFT, matching xz/y):

| | before (predicted at seq N) | after incoming `player_state` (old) |
|---|---|---|
| `velocity.y` | `-7.5` (`CREATIVE_VERTICAL_SPEED`) | snapshot `vy` (often `0` or a few percent off) |
| `isFlying` / `onGround` | predicted flags | snapshot flags |
| history | unacked seqs kept | rewind + replay remaining ticks **in the WS callback** (no `LocalPlayerRenderState.pushAfterTick`) |

`predNoState` skipped this path, so movement stayed smooth.

**After the fix:** matching xz/y snapshots only ack history. Soft disagreements are logged (`soft:speed` / `onGround` / `flying`) and do not write the live player. Real xz/y mismatches still correct.

## Implemented

- Pose-only hard reject: `ackRejectReason` returns only `xz` / `y`. `softAckRejectReason` covers speed/onGround/flying.
- `inspectPredictedPlayer` dry-run used by reconcile and by `?predStateObserve=1`.
- Local `player_state` is queued on receive and flushed at the start of `tickOnline` / `sendOnlineIdle`.
- `SurvivalSystem.restore` runs only when health/hunger/dead actually change (stops `hurtResistance.reset()` every snapshot).
- DEV `?predStateObserve=1` (parse + inspect, mutate nothing).
- DEV category skips: reconcile / survival / riding / gamemode / respawn / look / render.
- Per-field mutation log: `[source]`, field, old, new, snapshot `inputSeq`, local predicted seq, timestamp.
- `[firstBadEvent]` includes `soft=`.
- `predNoState` kept.

## Changed files

- `src/net/localPlayerPrediction.ts`
- `src/net/predIsolation.ts`
- `src/net/localPlayerNetTrace.ts`
- `src/net/localMotionDiagnostics.ts`
- `src/net/index.ts`
- `src/core/Game.ts`
- `tests/local-player-prediction.test.ts`
- `tests/pred-isolation-flags.test.ts`
- `tests/pred-isolation-matrix.test.ts`
- `tests/player-main-integration.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/LOCAL_SERVER.md`

## Architecture decisions

- Do not enlarge `PREDICTION_ACCEPT_SPEED` / `PREDICTION_ACCEPT_XZ` / `Y`. The speed threshold was never a visible pose error; using it as a rewind trigger was the bug.
- Do not disable server authority for real xz/y mismatches.
- Do not apply local snapshots in the WebSocket macrotask. Even a true correction belongs on the 20 TPS boundary so render history is not rewritten between samples.
- Observe/skip flags are diagnostic only and ignored in production.

## Tests

- `npx tsc --noEmit` / `typecheck:sim` / `typecheck:client` / `typecheck:server`: PASS
- flags **8/8**, matrix **8/8**, prediction **28/28**, player-main **4/4**
- pipeline **8/8**, render-state **8/8**, remesh **4/4**
- `test:sim` **42/42**; `test:server` **83/83**; `npm run build` PASS
- Full vitest **1346 passed / 8 failed**: same pre-existing Cloud class (`authored-item-assets` ENOENT, minecart 5s timeouts). Not this diff.

## Visual QA

Could not run localhost Online in this environment (no pointer-lock / Anarchy server session). Owner should compare:

1. Normal Online
2. `?predNoState=1`
3. `?predStateObserve=1`

Expected: (1) now matches (2). F3 `corr/s≈0`, `soft speed/s` may be high during fly+SHIFT, `acceptMut/s=0`, no `[firstBadEvent]` on flat walk/flight.

## Performance

No extra lerp, no extra physics ticks on the accept path. Queue holds one latest snapshot.

## Known issues

- Soft velocity disagreement is not corrected. A later xz/y miss still rewinds. If the server pose truly diverges in Y beyond `PREDICTION_ACCEPT_Y`, correction still runs.
- Category skips and observe are DEV-only.

## Deferred

- Do not merge main.
- Owner localhost fly+SHIFT / walk / sprint / jump / strafe confirmation.

## Next work

Owner Normal Online QA vs `predNoState`. If anything still jitters, `[firstBadEvent]` mutations + F3 `mut …` are the next breadcrumb (not prediction/render).

## Git

Branch `cursor/online-prediction-remesh-86e1`. No merge to main.
