# Checkpoint extra=3 while tickGap=1

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1`  
PR: #37 — **do not merge main**  
This pass is **diagnostic**. No physics / tolerance / lerp / FIFO change. Reconcile compare path is unchanged.

## Goal

Owner live dumps:

```
seq=4622 lastAck=4619 gap=3 tick=13774 tickGap=1 physicsTicks=1 extra=3
seq=4630 lastAck=4628 gap=2 tick=13782 tickGap=1 physicsTicks=1 extra=2
```

`extra === seqGap` while `tickGap === 1` and `physicsTicks === 1`. Prove whether the checkpoint path still uses `inputSeq` gap as the simulation count.

## Result — answers A–E

| Hypothesis | Verdict |
|---|---|
| A `lastAckedServerTick` stale | **Yes**, relative to `lastStateTick`. |
| B `extraTicks` populated from seqGap | **No.** Coincidence. |
| C `simTicks` overwritten | **No.** |
| D dump `extra` means something else | **Partially.** The old formula *label* was a lie; the *value* is real and is used for the comparable pose. |
| E hidden seqGap in comparable | **No** on the checkpoint path. |

### Exact assignment (used to build comparable)

Call site: `inspectPredictedPlayer` checkpoint path.

```text
seqGap    = snapshot.inputSeq - buffer.lastAckedSeq          // display only
simTicks  = simulationTicksFromServerTick(lastAckedServerTick, serverTick, physicsTicks)
          = serverTick - lastAckedServerTick   // when tick is known
extraTicks = simTicks                          // THIS is fed to predictedStateFromCheckpoint
```

Owner `extra=3` means the comparable pose is **last accepted state + 3 ticks of the snapshot's latest input**, not 1.

Old formula `max(0, physicsTicks - seqGap) = max(0, 1-3) = 0` is **not** what live extra is. The previous dump line printed that formula next to `extraTicks`, which made `extra=3` look like a seqGap heuristic. It was `simTicks`.

### Why tickGap=1 and extra=3 together

Two clocks:

1. **`online.lastStateTick`** updates on **every received** `player_state` (even ones never reconciled).
2. **`buffer.lastAckedServerTick`** updates only when reconcile **commits** (accept/correct).

Local snapshots are a **latest-only slot**. `applyOnlinePlayerState` overwrites `pendingLocalSnapshot`. `tickOnline` flushes once. If three packets arrive between flushes:

```text
recv tick 13772 → lastStateTick=13772, pending=13772
recv tick 13773 → lastStateTick=13773, pending=13773  (overwrite)
recv tick 13774 → lastStateTick=13774, pending=13774  (overwrite)
flush 13774:
  tickGap  = 13774 - 13773 = 1     // last *received* tick vs this packet
  simTicks = 13774 - 13771 = 3     // last *reconciled* checkpoint
  seqGap   = 4622 - 4619   = 3     // client also predicted ~3 seqs in that window
  extra    = simTicks      = 3
```

`extra === seqGap` because both client seqs and unreconciled server ticks ran ~in lockstep. **seqGap does not assign extra.**

Harness: `tests/checkpoint-extra-source.test.ts` reproduces `physicsTicks=1 tickGap=1 extra=3 extra===simTicks extra!==oldFormula pendingOverwrites=2`.

## Applied-input timeline

Server now records the **actual input applied on each physics tick** (`ServerPlayer.appliedInputTrace`, last 8) and sends it as snapshot `appliedTicks`.

`[corrDiag]` prints:

```text
APPLIED INPUT TIMELINE (server physics ticks, not latest inputSeq only):
  tick=T seq=S f= r= jump= sneak= descend= flySprint= y= vy= fly= ground=
CLIENT PRED TIMELINE (unacked):
  pred=A:seq=Y pred=B:seq=Z
checkpoint y/vy= … comparable y/vy= … server y/vy=
```

Latest `inputSeq` on the snapshot is still only the **last** state used. For `simTicks=3` the server may have applied seq 4620, 4621, 4622. Checkpoint currently replays **4622 × 3**. That is only valid if those three ticks used the same state.

## Stationary creative flight

Hover: `desiredY=0`, `vy` exponential-blends toward 0. Replaying **3 idle ticks** from a checkpoint that still has leftover `vy` (speed 3–6) vs the server doing **1** blend tick produces `firstDiff=y`, y error ~0.05–0.5. Test: leftover `vy=6`, extra=3 vs one server tick → `reject=y`.

This is the same extra=3 timeline, not a gravity/CREATIVE_VERTICAL_SPEED bug. Do not retune flight equations until the comparable pose uses the real per-tick applied input.

If hover keys are all 0 and `appliedTicks` still show `jump=true` or `descend=true` on some ticks, that is sampled input (toggle window / leftover packet), not a physics constant error.

## Architectural question

`lastAcceptedState + latestInput × simTicks` is **only** correct when every skipped server tick used that same input.

Server samples `lastInput` independently per physics tick. Pending-slot collapse makes `simTicks>1` common on localhost (owner samples extra=1,2,3 continuously).

One `appliedInputSeq` cannot reconstruct:

```text
tick 100 -> 450
tick 101 -> 450
tick 102 -> 451
tick 103 -> 452
```

Evaluated compact representations (not implemented this pass):

| Representation | Enough for the example? |
|---|---|
| current `inputSeq` only | No |
| previousSeq + currentSeq | No (3+ distinct seqs) |
| run-length `[{seq, ticks}, …]` | Yes, compact |
| `appliedTicks: {tick, seq}[]` for the interval | Yes; client looks up input **state** by seq in history |
| full input state per tick on the snapshot | Yes; larger |

**Preferred next production fix (not this commit):** snapshot carries the applied `{tick, seq}` span since the previous flush (already prototyped as DEV `appliedTicks` last-8). Client checkpoint replays **that sequence**, looking up each seq's input state in local history (or lastAckedInput if the seq was never predicted). Same latest-input server; not FIFO of unsimulated packets. Replay only ticks the server actually ran.

Do not patch with `min(simTicks, 1)`, larger y tolerance, or ignoring flight corrections.

## Tests

```text
npx vitest run tests/checkpoint-extra-source.test.ts tests/correction-diag-dump.test.ts tests/local-player-prediction.test.ts tests/server/client-server-lockstep.test.ts tests/server/anarchy-server.test.ts
```

`typecheck:client` / `server` / `sim` PASS.

## Visual QA

Not run here. Owner: `?corrDiag=1`, one tab. Walk until extra=3 tickGap=1; confirm `extraAssignSite` contains `simulationTicksFromServerTick`, `pendingSlotOverwrites>=1`, APPLIED INPUT TIMELINE seqs differ across ticks. Then hover creative airborne, no keys; paste one `firstDiff=y` dump with checkpoint/comparable/server y/vy.

## Git

Diagnostic only. Do not merge main.
