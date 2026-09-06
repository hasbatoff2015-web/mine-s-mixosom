# 2026-09-06 — First mining cycle vs command-queue sync

## Goal

Find why the first Anarchy START→FINISH sometimes does not break the block while the second full overlay cycle does, and why neighbors then break on the first cycle if LMB stays down. No symptom workaround.

## Result

Root cause is proven: leftover **pre-START idle commands** in `PlayerCommandQueue` are applied **after** `beginMining` already succeeded and wipe `miningTarget`. PR #59 (`mining: true` on new packets) cannot rewrite commands already queued. Minimal fix: keep (and advance) the lock while `appliedCommandSeq < miningStartCommandSeq`.

## Implemented

- `server/miningLock.ts`: `shouldKeepMiningLock`, `clearMiningLock`.
- `beginMining` stores `miningStartCommandSeq`.
- `tickConnectedPlayers` no longer treats every omitted/`mining:false` packet as cancel if that packet is older than START.
- Those stale ticks still call `advanceMining` so a deep FIFO cannot starve dirt (15 ticks) before FINISH.
- Mouse-up / pause remains: omitted mining with `seq >= start` clears the lock.
- Break diagnostics include `startCmd` / `applied`. Client `?miningTrace=1` logs `startUnacked`, `cmd`, `inputSeq`.

## Changed files

- `server/miningLock.ts` (new)
- `server/gameplay.ts`, `server/WorldInstance.ts`, `server/breakDiagnostics.ts`
- `src/net/onlineMining.ts`, `src/core/Game.ts`
- `tests/server/oak-planks-mining.test.ts`, `tests/server/mining-lock.test.ts`, `tests/server/break-diagnostics.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Evidence: CASE B reproduced without the fix

Regression (ran red on this branch before the lock helper):

```
START #1 accepted { target: {x:8,y:71,z:5}, progress: 0, applied: -1, startSeq: 9 }
leftover idles wiped the lock: { progress: 0, applied: 8, target: undefined }
```

That is the live “first overlay 0→100%, block still there” cycle: client mined locally from START; server spent those ticks applying idle seq 1..8 and had no lock when FINISH arrived (`reason: mining`).

## Sequence (CASE B)

### START #1

Client `tickOnline`: increment `inputSeq` → send `input` (seq N, `mining: true` after PR #59) → `updateTargetAndActions` → `block_break_start` with `commandSeq: N`.

Server: `applyInput` **enqueues** N. `beginMining` runs **now**: `miningTarget` set, `miningProgress = 0`, `miningStartCommandSeq = N`.

Queue still has idle `1 .. N-1` in front of N (client faster than 20 TPS, hitch, or catch-up). `COMMAND_QUEUE_MAX = 32`.

### Between START #1 and FINISH #1

Each physics tick: `takeForTick()` applies one leftover idle (`mining` omitted). **Before the fix** that wiped the lock. Later `mining: true` packets called `advanceMining` with **no target** (no-op). Client overlay still ran a full duration.

Who reached 1.0? **Only the client overlay.** Server progress stayed 0. FINISH did not drive progress; `advanceMining` auto-break never ran.

### FINISH #1

`tryBreak` / `breakBlock`: no matching `miningTarget` or `miningProgress <= 0` → `reason: mining`, `mutated=0`. Cell unchanged.

commandSeq on FINISH is the **finish-time** seq (PR #58), not the start seq. Pose/`stale` is not this bug: the reject is `mining`.

### After FINISH #1 (client)

PR #59 FIX 2: `reason: mining` → local progress 0, `noteResendBreakStart`, wait for start ack. Overlay restarts 0→100%. That is the visible second cycle, not a second hardness.

### START #2 / FINISH #2

LMB still down. Queue is `mining: true`. New START sticks. `advanceMining` runs every tick. FINISH or auto-break at `progress >= 1` succeeds.

### Neighbor B/C/D (LMB held)

Same as cycle #2: no pre-click idles in front of the new START. First overlay succeeds. Not a different blockId.

## CASE A (first cycle already worked)

Queue empty / caught up: next physics tick applies the `mining: true` command that belongs to START. Lock is not wiped. Overlay and server stay aligned. Same block types, same claims, same LOS.

## Input hold (PR #59)

New packets after click can be `mining: true` the whole hold. The dry first cycle does **not** require a `mining: false` between START and FINISH on **new** packets. The wipe was **old** packets. If live traces still show `mining omitted` on a seq ≥ START during hold, that remains a client bug — orthogonal.

## First tick / START ack race

Client overlay starts in the same tick as sending START (`advanceLocalMining` after `sendOnlineBreakStart`), before start ack. That alone does not reject FINISH if the server lock survives. The ack race is real for *visual* lead, but FINISH failed because the lock was wiped, not because START was unacked.

START commandSeq N vs FINISH commandSeq M (M > N) is expected. FINISH is not correlated by copying start seq (that caused `stale` in PR #58). Correlation is `miningTarget` + `miningStartCommandSeq`.

## Why the second cycle works

Concrete state change before START #2:

| | After FINISH #1 (bug) | Before START #2 |
|---|---|---|
| server `miningTarget` | undefined | set again by START #2 |
| server `miningProgress` | 0 | 0, then advances |
| command queue | leftover idles drained; subsequent cmds have `mining: true` | all `mining: true` |
| client overlay | reset to 0 (PR #59) | second 0→100% |
| start ack | new START unacked until result | acked |

Nothing about hardness or blockId changes.

## Two players

Bob joining / standing / mining another cell does not enqueue Ada’s leftover idles. Ada’s own FIFO does. Test: Bob connected, Ada leftover drain, Ada lock survives after the fix. Do not treat “B logged in” as the cause; it can change hitch/timing and make leftover more likely.

## Block matrix (server, leftover = 8)

After the fix, first cycle succeeds for dirt (15), oak log (60), oak planks (60), stone (150). Not block-specific. Longer blocks only make the dry overlay more obvious.

## Architecture decisions

Keep omitted mining as cancel for **current** commands (`seq >= start`). Do not globally ignore omitted mining (that would ignore mouse-up). Do not copy start `commandSeq` onto finish. Do not add a second mining system.

Advancing on stale-after-start is required: skip-wipe alone leaves `progress = 0` until seq N is dequeued. If leftover depth ≥ client duration (dirt 15 vs queue 32), FINISH #1 would still be `reason: mining`.

## Tests

- `tests/server/mining-lock.test.ts` — helper table.
- `tests/server/oak-planks-mining.test.ts` describe `first mining cycle vs queued pre-START idle commands`: leftover drain keeps lock; A then neighbor B; mouse-up `seq >= start`; sticky `lastApplied`; Bob independent; four-block matrix.
- Existing hold / omitted-mining / A+B tests unchanged.

## Visual QA

Two Chrome clients `http://localhost:4173/?miningTrace=1`, Anarchy `ws://127.0.0.1:2567`, `FC_DEBUG_BREAK=1`. SwiftShader ~4 FPS, TPS 20, `inBurst=4` / `pend=9` — leftover FIFO is real in this environment. Player B joined and stayed idle.

**Dirt `id=3` at `9,65,6` (one canvas mousedown, no retrigger):**

```
CLIENT START cmd=3372 inputSeq=3372 mine=9,65,6 progress=0 button=1
CLIENT start ack ok progress=0.533 (visual lead; lock still mine=9,65,6)
CLIENT progress 100% cmd=3372 progress=1.067
CLIENT FINISH cmd=3387 (finish-time seq, not start seq)
SERVER beginMining OK startCmd=3372 mine=9,65,6@0.000
SERVER auto-broke (advanceMining) before FINISH
SERVER FINISH tryBreak REJECT empty (cell already air) — not reason:mining
```

Target then `9,64,6` stone while LMB still down — neighbor first cycle started. No second overlay on the dirt.

**Oak planks `id=22` at `8,65,6` then neighbor `9,65,6` (LMB held):**

```
START cmd=3964 mine=8,65,6 start ack ok progress=0.133
~3.2s later START neighbor cmd=3992 mine=9,65,6 (first plank gone)
then stone 9,64,6 (second plank gone)
```

One overlay per plank, not dry+real. B idle. Mouse-up → `cleanup because=idle` (expected).

**Stone at spawn `1,51,-3`:** `beginMining` `startCmd=1416`, later same cell `@0.593` (lock not wiped), then cell air, coal underneath. Extra STARTs on that cell were QA `mousedown` retriggers (`attackPressed`), not finish-fail cycles.

Not done: owner ×5 matrix; oak log as a separate hold; A and B mining different cells at the same time. Synthetic CDP hold is still fragile; the dirt/planks oneshot (single mousedown) is the usable live evidence.

## Performance

## Performance

One integer compare per connected player per tick. No extra allocations on the hot path.

## Known issues

If START arrives and **no** later command with `seq >= start` is ever applied (total packet loss after START), sticky pre-START idles keep advancing until auto-break. Real clients keep sending seq N, N+1, … after the click.

## Deferred

Owner live matrix ×5 per block in two Chromes. No homes/TPA/economy.

## Next work

Confirm live traces: START #1 `startCmd=N`, leftover `applied < N` with `mine=` still set, FINISH #1 `mutated=1` or server auto-break. No second overlay.

## Git

Branch `cursor/first-cycle-mining-sync-3f93` off `cursor/mining-hold-input-3f93`.
