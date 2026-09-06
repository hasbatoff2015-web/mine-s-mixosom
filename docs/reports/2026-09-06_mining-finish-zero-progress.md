# 2026-09-06 — First FINISH at server progress 0

## Goal

Explain why PR #60 did not stop the live dry first mining cycle (one player, dirt and other ordinary blocks): overlay 0→100%, block stays, overlay restarts, second cycle breaks. Short A→B can fail; long A→B usually works. No overlay-retry / timeout / block-id workaround.

## Result

Root cause: client and server advance mining progress independently. The first FINISH can arrive while `ServerPlayer.miningTarget` is set and `miningProgress === 0` (START accepted, no `advanceMining` yet). `breakBlock` used the same `reason: mining` as a missing lock. The client reset the overlay and sent a second START — the visible dry cycle. PR #60 only stops leftover **idle commands** from wiping the lock; it does not make FINISH wait when progress is still 0.

## Implemented

- `survivalFinishLockReject`: no lock → `mining`; lock + `progress <= 0` → `in_progress`.
- Client: `in_progress` keeps finish wait / overlay; does not resend START. `reason: mining` still resends.
- `awaitingAutoBreak`: do not fire `MAX_FINISH_WAIT_TICKS` after a confirmed progress-0 lock (catch-up would expire 40 client ticks before physics). Mouse-up while awaiting auto-break does abort.
- First START sets `miningStartUnacked` (not only the post-reject path).
- `applyBreakActionResult` requires `kind === 'block_break_finish'` (missing kind is not a finish).
- `tickOnline` omits `mining` via `inputMiningField` (same as idle packets).
- Traces: clientProgress / serverProgress / startCmd / applied / queue / actionSeq / input.mining. Server `FC_DEBUG_MINING=1` logs each advance.

## Changed files

- `server/miningLock.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`, `server/breakDiagnostics.ts`
- `src/net/onlineMining.ts`, `src/core/Game.ts`, `shared/playerActions.ts`
- `tests/server/mining-lifecycle.test.ts` (new), `tests/server/mining-lock.test.ts`, `tests/server/oak-planks-mining.test.ts`, `tests/server/player-actions.test.ts`, `tests/online-mining.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Sequence (live)

### START

Client `tickOnline`: input seq N (`mining: true` if LMB / lock / finishKey) → `updateTargetAndActions` → `block_break_start` (`commandSeq: N`). `noteBreakStartSent` now sets `miningStartUnacked`.

Server: `beginMining` immediately. `miningTarget` set, `miningProgress = 0`, `miningStartCommandSeq = N`. START ack returns. No progress until the next physics tick's `advanceMining`.

### Client overlay vs server ticks

Both add `miningProgressPerTick` once per 20 TPS tick, but they do not share a clock.

- Lockstep 60 Hz: ~15 client ticks ≈ 750 ms ≈ 15 server ticks. FINISH usually sees `progress > 0` (PR #60 leftover drain still advances). First cycle can already work.
- Catch-up (`MAX_CATCH_UP_TICKS = 4`): dirt's 15 overlay ticks fit in 4 frames. At 120–144 Hz that is &lt; 50 ms → **zero physics ticks**. Overlay 1.0, server still 0.
- Fast A→B: still in burst / leftover queue; B's overlay can also finish before B's first advance.
- Slow A→B / neighbors: catch-up gone, queue is `mining: true`, one overlay matches server ticks.

### FINISH #1 (bug)

`tryBreak` / `breakBlock`: matching lock and `progress <= 0` used to return `reason: mining` (`mutated=0`). Cell unchanged.

Client PR #59: `reason: mining` → `miningProgress = 0`, `noteResendBreakStart`, new START. Overlay restarts. That is cycle #2, not a second hardness.

### FINISH #1 (fix)

Matching lock + `progress <= 0` → `in_progress`. Client keeps `miningFinishKey` / wait / overlay at 100% (`awaitingAutoBreak`). Server ticks `advanceMining` and auto-breaks. Catch-up must not treat `MAX_FINISH_WAIT_TICKS` as stuck. `block_update` clears the gate. First overlay, then air — not a restart from 0. Mouse-up during this wait aborts.

No lock (START never landed, or mouse-up / leftover wipe that PR #60 missed) remains `reason: mining` and still resends START.

### Why PR #60 was insufficient

PR #60: leftover idle `seq < startSeq` must not wipe the lock, and those ticks must `advanceMining`. Tests for that stay green.

It does not change FINISH when **no physics tick has run yet**. `progress` is still 0 with a live target. That is this bug. Agent QA at ~4 FPS could not hit 15 client ticks inside one 50 ms server slot; a 144 Hz catch-up can.

## START ACK / kind

Sequenced `action_result` always includes `kind: message.kind`. Protocol requires `typeof kind === 'string'`. START is not treated as finish.

The `kind === undefined` fallback in `applyBreakActionResult` was still a footgun for tests/malformed payloads; it now requires `block_break_start` / `block_break_finish` explicitly.

## Fast vs slow A→B (state)

Short A: leftover FIFO still deep; abort (only if finish in flight) clears `miningStartCommandSeq`; START B resets server progress to 0; B's overlay can FINISH at 0.

Long A: FIFO is `mining: true`; START B then lockstep advances; first B overlay succeeds.

After the fix both should break B in one cycle (in_progress wait if needed). Mouse-up still aborts (`seq >= start` omitted mining).

## Audit: who clears mining (unchanged except finish wait)

| Site | When | During held LMB? |
|---|---|---|
| `clearMiningLock` / omitted mining `applied >= start` | mouse-up / pause idle | only if hold flags already cleared |
| `abortMining` | abort / retarget abandon | yes, intended |
| `startOnlineMine` | new target | yes, resets **client** progress then START |
| `applyBreakActionResult` finish | ack | yes; **not** for `in_progress` |
| `applyAuthoritativeVoxelToMiningGate` | `block_update` matching cell | yes, after air |
| pause / inventory / `resetOnlineMiningGate` | overlay | intended cancel |
| `selectHotbar` | client progress/target only, no abort | unexpected; not this bug |
| `remoteCloser` / closer mob | client only, no abort | unexpected; not this bug |

## Tests

- `tests/server/mining-lifecycle.test.ts`: C catch-up FINISH at progress 0; C2 50 extra client ticks after in_progress; A vs B retarget duration; F 1-tick retarget; D four blocks; E A→B→C→D; mouse-up including after in_progress.
- `tests/server/mining-lock.test.ts`: `survivalFinishLockReject` table.
- Gate tests: first START unacked; missing kind ≠ finish; `in_progress` keeps wait.
- Existing leftover-idle / hold tests kept.

## Visual QA

One Chrome `http://localhost:4173/?miningTrace=1`, Anarchy, Survival. Pointer already locked. One mousedown hold (do not retrigger click).

Expect `[MINING] start` then `clientProgress` … `1.000` then either FINISH ok / auto-break, or `finish wait because=in_progress` with overlay staying at 100% until air. Must **not** see `start because=resend-after-mining-reject` on the first block.

Repeat dirt, stone, oak log, oak planks. Fast A→B and slow A→B. A→B→C→D while holding. Mouse-up mid-mine must leave the block.

## Architecture decisions

Do not accept FINISH at `progress === 0` (that would instant-break on hitch). Do not retry FINISH on reject. Do not special-case dirt. Keep `progress > 0` finish for the 1-tick client lead. Keep PR #60 leftover lock. Keep mouse-up / pause / inventory cancel.

## Deferred

- `selectHotbar` / closer mob clear client mining without abort.
- Finish still accepts `progress > 0` (&lt; 1), so a hitch with ≥1 server tick can still break early. Out of this symptom.
- Owner live QA on a high-Hz display.

## Git

Branch `cursor/mining-finish-zero-progress-3f93` from `cursor/first-cycle-mining-sync-3f93`.
