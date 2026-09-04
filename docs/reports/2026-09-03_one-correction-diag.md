# One-correction diagnostic (20/20 positional corr)

Date: 2026-09-03. Branch: `cursor/online-prediction-remesh-86e1`. **Do not merge main.**

## Goal

Owner localhost, one session/socket, healthy rates:

- `sess socks = 1`
- server physics / snapGen / snapSent / client state ≈ 20/s
- still visible jitter
- `corr/s` 5–11, `netPos/s` = `netVel/s` = that count
- `soft speed/onGround/flying = 0`, `snap/s = 0`, `dup/s = 0`

Prove **why** a 20/20 localhost connection still produces **real positional corrections**. Diagnostic only: no prediction, reconcile, tolerance, smoothing, interpolation, TPS, snapshot cadence, or PlayerController physics changes.

## Result

**No movement fix.** The dump and lockstep evidence exist. A live browser `[corrDiag:first]` from owner QA is still required to pick A–G for the 20/20 walk.

What this pass proved:

1. **`physicsTicks` compare path is explicit.** `extra = max(0, physicsTicks - seqGap)`. `physicsTicks=1, seqGap=1` → compare **exactly `history[N]`**. `physicsTicks=2, seqGap=1` → `history[N]` plus one extra tick of the **same** latest input. `physicsTicks=1, seqGap=2` → extra=0, do **not** invent ticks.
2. **PlayerController lockstep is identical** for 1, 2, 3, 10, 20 ticks: stationary, walk, strafe, jump, flight hover, flight+SHIFT. Stationary flight does not free-fall.
3. **WorldInstance `tickConnectedPlayers` vs client `predictLocalMove` matches 1:1** on the Anarchy world for 20 walk ticks — same `VoxelWorld` **and** a frozen collision copy (client never runs `world.tick()`). Idle / strafe / jump / flight hover / flight+SHIFT also produced **zero** corrections in that harness.
4. Therefore the remaining 20/20 jitter is **not** “PlayerController is nondeterministic” and **not** “the server wrapper simulates a different physics step than prediction” on matching input + matching collision.

Category C (same input, same initial state, same world, positions diverge) is **ruled out** for the 1:1 Anarchy harness. Remaining live suspects are the **network phase** (latest-input seq vs physics ticks, queued snapshot overwrite) and **client collision chunks not yet present** (`getBlock(..., false)` → Air).

## Implemented

- `[corrDiag:first]` then a full dump (`SEQ TIMING PHYSICS INPUT CLIENT/SERVER POSE DIFF STATE WORLD CATEGORY`). `?corrDiag=1` keeps every later correction full; without the flag later lines stay compact.
- Dump prints `history[N]` separately from comparable extra-tick pose. Collision AABB is sampled at **history[N]**, not the live (ahead) pose.
- `lastInputSeq` is labeled as latest movement state, **not** a physics tick id. `serverTickNumber` is the checkpoint.
- `/predsim` prints pose tables at t=1,2,3,10,20 for walk/idle/flyHover/flySHIFT.
- WorldInstance lockstep test + coalesce example dump.

## One captured correction (coalesce, not the 20/20 1:1 path)

This is a **real** `[corrDiag]` from Anarchy `WorldInstance` when the client predicted seq 2 **and** 3, and the server simulated **one** latest-input tick of seq 3 (`physicsTicks=1`, `seqGap=2`):

```
[corrDiag] seq=3 lastAck=1 gap=2 tick=10 physicsTicks=1 extra=0 path=history[N] firstDiff=z reject=xz xz=0.2079 walkStep=0.2159
SEQ: snapshot.inputSeq=3 currentClientSeq=3 lastAckedSeq=1 pendingSeqs=[2,3]
PHYSICS: extra=max(0, 1-2)=0  compare exactly history[N]
INPUT: forward=1 right=0 jump=false sneak=false sprint=false descend=false yaw=0
CLIENT history[N]  0.500 69.010 -0.044  v=0 0 -4.158  ground=true
SERVER snapshot    0.500 69.010  0.164  v=0 0 -3.839  ground=true
DIFF: dx=0 dy=0 dz=0.208 distance=0.208  firstDiff=z
WORLD: feet=Воздух below=Дёрн chunk loaded=true visibility=visible mutationMarks=0
CATEGORY: B seqGap>physicsTicks (client predicted more seqs than server simulated)
```

**Why they differ:** `history[3]` is two walk ticks from the acked pose. The server pose is one walk tick of the same latest input. Distance ≈ one `WALK_SPEED × 0.05` step. Compare path is correct (`history[N]`, extra=0). The snapshot is **not** being compared to the wrong physics point; the two sides did not simulate the same number of ticks of that input.

That is the shape of a **B** correction. It is **not** proof that the owner’s 20/20 run is B. On a 1:1 20/20 lockstep this dump does **not** appear.

## What the owner’s first `[corrDiag:first]` must decide

Run `http://localhost:4173/?corrDiag=1`, **one tab**, quiet flat area, **W for 5 s**. Paste the first dump.

| Dump | Meaning |
|---|---|
| `physicsTicks=1` `seqGap=1` `extra=0` `path=history[N]` and xyz still disagree | Compare point is correct. Not A. Check `chunkLoaded`, INPUT yaw, `firstDiff`. If chunk loaded and input matches → live path outside this harness (queued snapshot / look) |
| `physicsTicks=2` | A: catch-up snapshot. extra must be `max(0, 2-seqGap)` |
| `seqGap>physicsTicks` `xz≈0.22` `firstDiff=x\|z` | B: latest-input coalesce (the dump above) |
| xyz match, only velocity | D: must be soft, not a pose corr |
| `chunkLoaded=false` | E: client collision Air |
| `visibility≠visible` | F |
| stationary `firstDiff=y` | G |

## Changed files

- `src/net/correctionDiagnostics.ts` — full dump, owner categories, collision sample
- `src/net/localPlayerPrediction.ts` — inspect history vs comparable; dump at history pose; extra-tick formula extracted (same math)
- `src/net/localMotionDiagnostics.ts` — world-hint fields
- `src/core/Game.ts` — `resetFirstCorrectionDump` on welcome; visibility/chunkLoaded hint
- `src/player/moveSimCompare.ts` — pose dumps + modes including flight
- `server/WorldInstance.ts` — `/predsim` pose tables
- `tests/correction-diag-dump.test.ts`, `tests/server/client-server-lockstep.test.ts`, `tests/local-player-prediction.test.ts`

## Architecture decisions

- Do not treat `inputSeq` as a physics tick. Two physics ticks may share one seq; `physicsTicks` + `tickNumber` identify the checkpoint.
- Extra ticks only replay the **same** latest input. Never invent ticks when `seqGap > physicsTicks`.
- Collision dump uses `getBlock(..., false)` — the same path as `collision.ts`. Missing chunk = Air.

## Tests

```text
npx vitest run tests/correction-diag-dump.test.ts tests/server/client-server-lockstep.test.ts tests/local-player-prediction.test.ts tests/move-sim-compare.test.ts tests/server-tick-clock.test.ts tests/hidden-tab-motion.test.ts
```

correction-diag **10/10**; client-server-lockstep **6/6**; prediction **29/29**; move-sim **6/6**; tick-clock **6/6**; hidden-tab **9/9**. `typecheck` client/server/sim PASS.

## Visual QA

This environment cannot pointer-lock a live Anarchy session. Owner must run `?corrDiag=1` locally. `/predsim` in Anarchy chat prints the pose tables.

## Performance

Dump is DEV console on correction only. Lockstep tests boot a temp Anarchy world (~200 ms each). No tick/render budget change.

## Known issues

- Live 20/20 positional corr/s=5–11 is **unexplained** until the owner paste. Harness 1:1 does not reproduce it.
- `pendingLocalSnapshot` keeps only the latest `player_state`. If two snapshots land between client ticks, `physicsTicks` on the kept packet is still 1 even if the server simulated two unique seqs. Comparing `history[later]` can still match; if the later seq was **not** predicted yet, that is a live B/A candidate.
- First-session `lastAckedSeq=-1` makes `seqGap` look large; extra-tick math still compares `history[N]`. Classification ignores `lastAcked<0` as B.

## Deferred

- Any prediction/reconcile/physics fix.
- FIFO movement queue.
- Larger accept window / lerp.

## Next work

1. Owner paste of `[corrDiag:first]` from a 20/20 W walk.
2. Classify with the table above.
3. Only then implement **one** correction.

## Git

Branch `cursor/online-prediction-remesh-86e1`. Do not merge main.
