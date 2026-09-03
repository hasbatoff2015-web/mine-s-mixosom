# Prediction checkpoint (Model B)

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1`  
PR: #37 — **do not merge main**

## Goal

Stop localhost positional corrections whose root cause is treating `inputSeq` as a physics tick. Owner dump:

```
[corrDiag] seq=545 lastAck=543 gap=2 physicsTicks=1 firstDiff=x reject=xz
```

Client predicted seq 544 and 545. Server simulated one latest-input tick of 545. `history[545]` is ~one walk step ahead. Do **not** patch this with seqGap heuristics, larger tolerance, lerp, or ignoring xz.

## Result

Model **B** is the smallest architecture with deterministic parity:

- Client still predicts every local 20 TPS tick (responsive).
- Every `player_state` identifies the authoritative checkpoint with `tick` / `tickNumber`.
- `physicsTicks` is how many latest-input physics ticks this outer update ran.
- `inputSeq` is the latest movement **state** used, not the checkpoint.
- Compare snapshot to `lastAckedState + simTicks` of that latest input.
- Accept = no-op on live pose. Real xz/y mismatch still restores + replays remaining pred ticks.

Timeline simulator reproduces the 545 mismatch on `history[inputSeq]` and shows checkpoint distance = 0.

## Why the new model is deterministic

Server semantics (unchanged, not FIFO): each physics tick uses the current latest input state once. Intermediate packet seqs are not simulated.

If the client predicted ticks C1 (seq 544) and C2 (seq 545) while the server ran one tick of 545 from the last accepted pose:

| Compare point | Pose | vs server |
|---|---|---|
| `history[545]` | two client physics ticks | one walk step ahead → false correct |
| checkpoint | last accepted + **1** tick of state 545 | identical → accept |

`simTicks` comes from `serverTick - lastAckedServerTick` when the tick is known, else packet `physicsTicks`. It does not come from `seqGap`. Relative timer phase can batch packets; it cannot change how many latest-input ticks the server ran, so the checkpoint stays the same pose.

## Evaluated models

| Model | Verdict |
|---|---|
| A — client ticks only when server ticks | Reject: client cannot see the server slot; local motion would wait on snapshot phase |
| **B — predict every local tick; snapshot carries serverTick** | **Chosen.** Matches latest-input server. No FIFO. |
| C — FIFO one server tick per client seq | Rejected (Anarchy movement is state, not a command queue) |

## Implemented

- `src/net/predictionTimeline.ts` — client seq clock vs server latest-input clock, batched deliveries.
- `inspectPredictedPlayer` / `reconcilePredictedPlayer` — checkpoint path (`comparePath: 'checkpoint'`).
- History entries store `predTick`. Accept consumes `simTicks` oldest pred ticks, not `seq <= inputSeq`.
- Game welcome + hidden-tab resync seed `lastAckedState`. Reconcile passes `serverTick: message.tick`.
- Duplicate by `serverTick` when known; seq duplicate remains when tick is omitted (predNoSend / hidden-tab tests).

## Changed files

- `src/net/localPlayerPrediction.ts`
- `src/net/predictionTimeline.ts` (new)
- `src/net/correctionDiagnostics.ts`
- `src/net/hiddenTabMotion.ts`
- `src/net/index.ts`
- `src/core/Game.ts`
- `server/WorldInstance.ts` (comment only)
- `tests/prediction-timeline.test.ts` (new)
- `tests/local-player-prediction.test.ts`
- `tests/server/client-server-lockstep.test.ts`
- `tests/local-motion-pipeline.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/LOCAL_SERVER.md`

## Architecture decisions

- Do not use `history[inputSeq]` as the simulation point.
- Do not add `gap > physicsTicks` / subtract-one-tick / smoothing.
- Keep pose-only accept (speed/onGround/flying remain softReject).
- Keep latest-input server; do not reintroduce FIFO.

## Tests

See `docs/TESTING.md` 2026-09-03 Prediction checkpoint.

Expected:

- Owner gap=2: history would correct (~`WALK_SPEED * 0.05`), checkpoint dist=0.
- 1:1 and phase batches: checkpoint corr=0.
- Flight hover 2-vs-1: checkpoint dist=0 (same timeline issue as walk, not a separate gravity bug).
- Flight+SHIFT 2-vs-1: history y ahead, checkpoint matches.
- Anarchy lockstep 1:1 accepts on `checkpoint`; 2-vs-1 coalesce accepts; catch-up uses `simTicks`.
- Pipeline 10 Hz coalesce: corr=0, no collapsed lerp.

## Visual QA

Not run in this cloud pass (no localhost game tab). Owner: one tab, Normal Online ≈ `predNoState`, `corr/s=0` for walk / sprint / strafe / jump / flight / flight+SHIFT / stationary flight.

## Performance

No extra meshing, workers, or snapshot rate change. Checkpoint replay is N ticks of one input on a scratch `PlayerController` (same cost class as the old extra-tick path).

## Known issues

- If input **changes** between coalesced client seqs, accept leaves the extra client tick in the live pose (client stays one prediction tick ahead with the superseded input). Constant WASD (the 545 dump) is identical on both sides.
- Hidden tab still force-resynces; sticky lastInput while frozen is not solved by the checkpoint alone.

## Deferred

- Model A sampled-input lockstep (would need a visible server tick clock on the client before predict).
- Binding `simTicks` into F3 as a first-class line (dump already prints it).

## Next work

Owner localhost confirmation. Do not merge main.

## Git

Branch `cursor/online-prediction-remesh-86e1`.
