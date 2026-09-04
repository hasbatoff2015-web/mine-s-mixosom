# Server tick clock and catch-up snapshot compare

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Owner F3 on Normal Online still jittered with `corr/s=3` / `netPos/s=3` while `predNoState` was smooth. Soft speed/onGround/flying were 0. Find why localhost snapshots disagree with `history[N]` about 3 times per second, without lerp, larger tolerances, or disabling reconcile.

## Result

1. **Source of the 3 corrections/sec:** each catch-up flush simulated **2 physics ticks** with the same `lastInputSeq=N` and sent **one** snapshot. Client `history[N]` is the pose after **one** predicted tick of N. xz error ≈ one walk step (`WALK_SPEED * 0.05 ≈ 0.22`). That matches `corr/s=3`, `mut player_state:corrected=3`, `gap/s=2`.
2. **Server physicsTicks/sec:** catch-up already aimed at **20**. The hole was the **outer loop ~17 Hz**.
3. **snapshotGenerated/sec:** counted per physics tick with players online → ~20 when catch-up works, but **sent** once per outer loop.
4. **snapshotSent/sec:** ~17 (one `player_state` per outer `setTimeout`).
5. **client snapshotReceived/sec:** ~17 (`state/s=17`, `dup/s=0` — not transport loss).
6. **First differing field** on a catch-up vs 1-tick history: **`x` or `z`** (held W), not `vy` / flying / onGround.
7. **`inputSeq` is not sufficient alone.** It names the latest **input state**, not how many physics ticks used it. `physicsTicks` on `player_state` is the honest ack for that. Do not invent a fake seq.
8. Tests below; no pointer-lock play in this environment.

## Implemented

- `scheduleNextTickSlot`: absolute 50 ms slot. Timeout slack shortens the next wait (the old `wait = tickMs - work` drifted to ~17 Hz).
- `gameplayTicksDue` uses `advanceFixedStep` (same drop/clamp as the client) and reports `droppedTicks`.
- `player_state.physicsTicks` + `tickClock` `{ physicsTps, snapGen, snapSent, droppedTicks, elapsedMs, accumulatorMs }`.
- Reconcile comparable pose = `history[N]` + `max(0, physicsTicks - seqGap)` extra ticks of that latest input.
- `[corrDiag]` on every correction (`firstDiff`, `physicsTicks`, pred vs snap).
- F3: `srv phys/s snapGen/s snapSent/s lastPhysΔ catchUp/s`.

## Changed files

- `server/tickScheduler.ts`, `server/WorldInstance.ts`
- `shared/protocol.ts`
- `src/net/localPlayerPrediction.ts`, `src/net/correctionDiagnostics.ts`, `src/net/localMotionDiagnostics.ts`
- `src/core/Game.ts`
- `tests/server-tick-clock.test.ts`, `tests/local-player-prediction.test.ts`, `tests/server/anarchy-server.test.ts`
- docs

## Architecture decisions

- Keep latest-input (no FIFO). One snapshot per outer flush; hitch catch-up still bundles ticks.
- Healthy localhost must run ~20 **outer** loops/s so `physicsTicks=1` is the common case.
- Catch-up snapshots stay comparable via `physicsTicks`; they must not rewind a matching coalesced pose.
- Do not raise `PREDICTION_ACCEPT_XZ` / `Y`.

## Tests

- `npx tsc --noEmit` / sim / client / server typecheck: PASS
- Focused **69/69** (tick-clock, prediction, move-sim, isolation, player-main, pipeline)
- `test:sim` **42/42**; `test:server` **89/89**; `npm run build` PASS

## Visual QA

Could not pointer-lock Online here. Owner: Normal vs `?predNoState=1`. Expect `corr/s=0`, `state/s≈20`, `srv phys/s≈20`.

## Known issues

A hitch that still flushes `physicsTicks=2` with a seq gap of 1 is accepted without writing live pose. Live then predicts the next seq from the 1-tick pose; if WASD is held it realigns on the next client tick. Rare if the outer loop stays at 20 Hz.

## Deferred

Do not merge main. Owner localhost matrix.

## Git

Branch `cursor/online-prediction-remesh-86e1`.
