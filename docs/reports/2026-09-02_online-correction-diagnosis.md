# Online Anarchy: one-correction diagnosis and 20 TPS catch-up

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Localhost F3 after the FIFO revert still showed rubber-band corrections (~1/s, 0.34 avg / 0.64 max blocks) with `prd/s=20` and `state/s=18`. Instrument one real correction, prove whether PlayerController diverges, measure snapshot rates, then fix the deterministic tick-count mismatch. No lerp/smoothing/tolerance/offline physics changes.

## F3 evidence

- FPS 155, fixed 20 TPS
- pred 20/s, player_state 18/s, reconcile 18/s
- ok 17/s, corr 1/s, snap 0, dup 0
- writes pos/s ≈ 21 (= 20 predict + 1 correction)
- cumulative 734 accepts / 78 corrections, avg 0.340, max 0.642

`writes pos/s` includes prediction ticks, not only corrections.

## Root cause (not PlayerController divergence)

Lockstep: two `PlayerController`s, same flat world, same input, same `FIXED_DT` — **identical** at 1, 2, 5, 10, 20 ticks (walk, sprint, jump). First diverged tick: none. Hypothesis **H is false**.

Latest-input coalesce: 2 client ticks vs 1 server tick of the same held W after warmup → xz ≈ one walk step (`WALK_SPEED * 0.05 ≈ 0.216`). 2 vs 2 ticks → error 0.

F3 `state/s=18` vs `pred/s=20`: Node `setInterval(50)` fires ~18 Hz on a loaded event loop and **does not catch up**. Client `advanceFixedStep` does. Extra predicted steps vs one latest-input server tick → 0.2–0.6 block rewind. That matches corr avg/max.

Not gravity. Not a second interpolator. Not world mutation (clean walk still corrects).

`prd/s=20` / `state/s=18` is generated-on-server ~18, not client drop (`dup/s=0`). Client now counts `snap recv/s`, `dropStale/s`, `dropNoLocal/s`, `gap/s`.

## Fix (still latest-input, no FIFO)

Server loop uses the same catch-up math as the client (`gameplayTicksDue`). If two physics ticks are due, `tickCatchUp` simulates both with current `lastInput` and broadcasts **one** `player_state` (final pose, `inputSeq = lastInputSeq`). Intermediate 1-step snapshots would otherwise rewind `history[N]` against a pose the client already predicted N steps for.

`FIXED_DT`, 20 TPS, GRAVITY, speeds, offline physics, urgent remesh unchanged.

## Diagnostics

Correction (`?corrDiag=1` or `?motionDiag=1`): seq, lastAck, gap, tick gap, history vs snapshot xyz/vel/flags, dx/dv, live pose + previousPosition, pending, latest client/server seq, input vector, feet/below/ahead blocks, ms since block/chunk, ticksThisFrame, hypotheses A–I.

F3: `snap recv/s`, `dropStale/s`, `dropNoLocal/s`, `gap/s`.

Server: `FC_DEBUG_SNAP=1` logs gen/sent/tps. Status line includes `tps` / `snapGen` / `snapSent`.

`/predsim [ticks]`: lockstep + 2-vs-1 coalesce + measured tps.

## Tests

- lockstep 1/2/5/10/20 identical
- 2 vs 1 coalesce ≈ walk step; 2 vs 2 = 0
- catch-up math; `tickCatchUp(2)` = two physics, one snapshot
- `/predsim` command_result
- existing prediction/pipeline/bow/FIFO tests

## Manual QA

Clean flat walk 10 s, no place/break/combat: F3 `corr/s` near 0, `state/s` near 20, `gap/s` near 0. Then sprint, strafe, jump, flight, fly+SHIFT. `?corrDiag=1` if a correction appears. Bow/stop/flight/remesh still immediate.

## Git

Same PR branch. Do not merge main.
