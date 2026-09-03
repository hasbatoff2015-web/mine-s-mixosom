# Local-player render state (adjacent sim poses)

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Manual QA after `localSimOrigin → restore previousPosition`: jitter unchanged at ~155 FPS / ~6.45 ms/frame, `corr/s≈0`, no CPU hitch. Stationary is clean. Do **not** assume that restore was correct. Re-prove the 0/1/2/3-tick render timeline, separate simulation state from render state, and keep physics/network rates unchanged.

## Result

Restoring `previousPosition` to the pose **before the whole frame** interpolates a **non-adjacent** pair `(S1, S3)` with `alpha = leftover/dt`. After a high-alpha `S1→S2` frame (render ≈ `S2`), that sample is ≈ `S1` — **backward**. At 155 FPS a 2-tick hitch is also rare (`leftover + 6.45 ms < 0.10`), so that patch could not explain the live symptom.

Correct model: keep a dedicated `LocalPlayerRenderState` of completed sim poses. After every physics tick, push the live pose. Render samples the **last adjacent pair** `(S_{n-1}, S_n)` at `alpha = leftover/dt` (`displayTime = simTime - dt + leftover`). Physics still copies `previousPosition` only for fall distance.

## Timelines (`corr/s=0`, constant +Z step)

`dt = 0.05`. Last completed pair is always the interpolation window.

### 0 ticks

- leftover `0.020 → 0.036`, ticks `0`
- pair unchanged
- render moves **forward** along that pair

### 1 tick

- leftover `0.049`, render ≈ end of `S0→S1`
- elapsed `0.012` → leftover `0.011`, pair becomes `S1→S2`
- render stays near `S1` (continuous)

### 2 ticks

- leftover `0.049` on `S1→S2`, render ≈ `S2`
- elapsed `0.055` → ticks `2`, leftover `0.004`, pair `S3→S4`
- render ≈ `S3` (**forward**)
- wrong `lerp(S1, S4, 0.08)` ≈ `S1` (**backward** vs last render)

### 3 ticks

- same clock; last pair `S_{n-1}→S_n`; signed render delta still ≥ 0

At 60 / 120 / 144 / 165 render FPS with `z += speed * dt` (no WebSocket): **zero** negative render deltas.

## SP vs Online

The same `LocalPlayerRenderState` is used by singleplayer and Online (`Game.frame` pushes after every `Game.tick`, including `tickOnline` / `predictLocalMove`).

At 155 FPS, **no-net** prediction (no snapshots) matches SP render-step stats. Lockstep 1:1 snapshots with `corrections=0` also match. If localhost Online still jitters with `corr/s=0` while `?predNoNet=1` is smooth, snapshots/scheduling still perturb the client; if both jitter, the remaining difference is not the interpolation formula.

## Diagnostics

F3 Motion adds: leftover, sim tick, pair `from→to`, signed `rΔ` min/max, `neg/s`, `big/s`, camera XYZ/Δ and `src=interpolated-local`.

DEV: `?predNoNet=1` on Anarchy skips movement `input` send and ignores local `player_state` (still predicts). `?motionDiag=1` still dumps 2 s traces.

## Changed files

- `src/core/localPlayerRenderState.ts` (new)
- `src/core/fixedStep.ts` (removed restore helpers)
- `src/core/Game.ts`
- `src/player/PlayerController.ts` (comment)
- `src/net/localMotionDiagnostics.ts`, `src/net/index.ts`
- `tests/local-player-render-state.test.ts` (new)
- `tests/local-motion-pipeline.test.ts`, `tests/fixed-step.test.ts`
- docs

## Tests

- render-state **8/8** (0/1/2/3-tick + 60/120/144/165 FPS)
- pipeline **8/8**, prediction **24/24**, remesh **4/4**, player-main **4/4**
- `typecheck*` / `check:boundaries` PASS
- `test:sim` **42/42**, `test:server` **83/83**, smokes PASS, `build` PASS

## Visual QA

Not playable with pointer lock here. Owner: walk/sprint/jump/strafe/flight/fly+SHIFT vs SP; F3 `neg/s` should stay 0 on flat ground; compare Anarchy vs `?predNoNet=1`.

## Known issues

`state/s=17` / `gap/s=3` is still server interval drift. Not touched (no network-rate change).

## Deferred

Owner localhost QA. Do not merge main.
