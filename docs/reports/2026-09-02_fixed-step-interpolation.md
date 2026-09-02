# Fixed-step interpolation window (SP + Online)

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Manual QA after server catch-up: local movement still hitch-steps while walking, sprinting, jumping, strafing, and creative flight (with or without SHIFT). Stationary is clean. F3 during the hitch: `prd/s=20`, `corr/s=0`, `snap/s=0`, `dup/s=0`, `gap/s>0`. Do **not** change networking, prediction, reconciliation, physics constants, or add smoothing / a second lerp / a larger correction tolerance.

## Result

The hitch is the common `Game.frame` interpolation window after **two (or more) fixed ticks in one render frame**. Online uses the same `advanceFixedStep` → `Game.tick` → `lerp(previousPosition, position, leftover/dt)` path as singleplayer. What differs is **how often** a frame runs `ticks >= 2` (remesh / WebSocket hitch). Flight+SHIFT only makes the same one-tick visual skip larger.

## Timeline (two consecutive ticks, `corr/s=0`)

`FIXED_DT = 0.05`. Walk step ≈ 0.22 blocks. Last frame had leftover `0.049` (alpha `0.98`), `previousPosition = S0`, `position = S1`, render ≈ `S1`.

Hitch frame: leftover `0.049 + 0.055 = 0.104` → `ticks = 2`, leftover `0.004`, alpha `0.08`.

| | Before tick 1 | After tick 1 | After tick 2 (inner) | After restore |
| --- | --- | --- | --- | --- |
| accumulator | 0.104 | 0.054 | 0.004 | 0.004 |
| previousPosition | S0 (stale) | S1 | S2 | **S1** (origin) |
| position | S1 | S2 | S3 | S3 |
| alpha | — | — | 0.08 | 0.08 |
| render `lerp(prev, pos, α)` | — | — | ≈ **S2** | ≈ **S1** |

Naive inner `previousPosition` (last tick copy): render jumps `S1 → S2` in one rAF — one physics step, not a correction.  
Restored origin: render stays near `S1`, then leftover growth on following 0-tick frames interpolates `S1 → S3`. One-tick frames are a no-op (origin already equals that copy). `ticks = 0` does not rewrite `previousPosition`.

Singleplayer uses the same restore. Identical local input and identical `ticksThisFrame` produce the same render pose.

## Implemented

- `restoreInterpolationOrigin` / `interpolationAlpha` / `interpolateAfterFixedTicks` in `src/core/fixedStep.ts`.
- `Game.frame` captures `localSimOrigin` before the tick loop and restores `player.previousPosition` afterward when `ticks >= 1`.
- `PlayerController.tick` still copies `previousPosition` at the start of each tick (fall distance). Render owns the window after the loop.
- No physics constant changes. No extra lerp. Networking / urgent remesh unchanged.

## Changed files

- `src/core/fixedStep.ts`
- `src/core/Game.ts`
- `src/player/PlayerController.ts` (comment)
- `tests/fixed-step.test.ts`
- `tests/local-motion-pipeline.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- `docs/reports/2026-09-02_fixed-step-interpolation.md`

## Architecture decisions

`leftover / dt` is the fraction of **one** unsimulated tick. It is not valid as alpha against the last inner tick when this frame simulated more than one tick. The interpolation origin must be the pose from before the first tick of the frame so the existing `lerp(previousPosition, position, alpha)` stays mathematically aligned with `advanceFixedStep`. Capping to 1 tick/frame would clamp alpha at 1 and snap; dropping extra accumulator would slow gameplay.

`gap/s > 0` with `corr/s = 0` is leftover latest-input seq skipping (server simulates the held state, client accepts). Not this visual bug.

## Tests

- `tests/fixed-step.test.ts` **6/6**: 1-tick no-op, 2-tick naive hitch vs restored origin, ticks=0.
- `tests/local-motion-pipeline.test.ts` **7/7**: SP/Online origin restore; PlayerController hitch + monotonic follow frame; hitchy 60 Hz walk SP=Online with `corrections=0` (two-tick render step < 0.12; 55 ms wall-clock walk may still cover `WALK_SPEED*0.055`).
- prediction **24/24**, remesh **4/4**, player-main+anarchy **27/27**
- `typecheck*` / `check:boundaries` PASS
- `test:sim` **42/42**, `test:server` **83/83**, smokes PASS, `build` PASS

## Visual QA

Not playable with pointer lock in this environment. Owner localhost: walk / sprint / jump / strafe / creative flight / fly+SHIFT; F3 `corr/s=0`; hitch should not teleport; bow / stop / remesh unchanged.

## Performance

One `Vec3.copy` before ticks and one restore after. No extra allocations per frame.

## Known issues

`gap/s > 0` remains a networking seq skip counter; ignored here by request.

## Deferred

Owner localhost QA. Do not merge main.

## Next work

Confirm hitch is gone in Online at 60 Hz with remesh hitch; leave prediction/catch-up as shipped.

## Git

Branch `cursor/online-prediction-remesh-86e1`. Continue PR #37.
