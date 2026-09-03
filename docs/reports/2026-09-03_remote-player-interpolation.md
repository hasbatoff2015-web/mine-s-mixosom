# Remote player interpolation v1

Date: 2026-09-03  
Branch: `cursor/remote-player-interpolation-86e1` (from PR #37 `fd02b67`)  
Base for review: stacked on `cursor/online-prediction-remesh-86e1`. Do not merge main.

## Goal

Make remote players look stable under localhost, small jitter, packet batching, and occasional missing/delayed snapshots. The remote must not visually chase packet arrival times. Use a buffered **server-tick** timeline.

## Result

`RemoteInterpolationBuffer` is the Node-safe remote timeline. `RemotePlayerView` is a thin Three wrapper that feeds interpolated pose into existing `PlayerVisual`. Local prediction, reconciliation, `PlayerController`, local render state, server physics, and server TPS were not modified. Entity interpolation still uses arrival-time `EntityInterpolationBuffer` (~80 ms).

## Clock model

```text
clockTick  = latestServerTick + (now - latestReceivedAt) / REMOTE_TICK_MS
renderTick = max(previousRenderTick, clockTick - delayTicks)
```

| Constant | Value | Meaning |
|---|---|---|
| `REMOTE_TICK_MS` | 50 | 20 TPS |
| `REMOTE_INTERP_DELAY_MS` | 100 | 2 ticks of history |
| `REMOTE_EXTRAPOLATION_MS` | 100 | max coast after last snapshot |
| `REMOTE_BUFFER_MAX_SAMPLES` | 8 | bounded ring |

- Sample simulation time = `serverTick` from `player_state.tick`. Never packet arrival.
- `receivedAt` is telemetry and the elapsed term of the **latest** sample only. Jitter on older packets cannot move already-buffered sample times.
- Surrounding snapshots: linear xyz/pitch/velocity; shortest-path yaw; booleans at midpoint (`t < 0.5 ? previous : next`).
- One snapshot: hold. Do not invent a long extrapolation.
- No future sample: extrapolate along latest velocity up to 100 ms, then **hold the capped (already-extrapolated) pose**. Do not snap back to the last snapshot. Do not coast forever.
- Reject duplicate and stale ticks. Render clock never rewinds, so a late packet cannot reorder already-rendered history.

## Implemented

- `src/net/remotePlayerInterpolation.ts` — buffer, clock, lerp, bounded extrapolation, diagnostics counters.
- `src/net/RemotePlayerView.ts` — apply `player_state.tick`; interpolator drives `PlayerVisualAnimator` from interpolated velocity/state; actions remain false/0.
- `src/net/remoteInterpDiagnostics.ts` — F3 HUD formatter; `?remoteDiag=1` 1 Hz timeline log (DEV only).
- `Game.spawnRemotePlayer` resets an existing remote (rejoin) instead of no-op.
- F3 (DEV, online) shows nearest remote: tick, renderTick, mode, buf, snap/s, inter-arrival, jitter, under/s, extrap.

## Changed files

- `src/net/remotePlayerInterpolation.ts` (new)
- `src/net/remoteInterpDiagnostics.ts` (new)
- `src/net/RemotePlayerView.ts`
- `src/net/index.ts` (dropped `sampleRemotePose`)
- `src/core/Game.ts` (spawn reset + F3 line)
- `tests/remote-player-interpolation.test.ts` (new)
- `tests/remote-interp-diagnostics.test.ts` (new)
- `tests/remote-player-view.test.ts`
- `tests/entity-snapshot-interpolation.test.ts` (uncoupled from remote sampling)
- docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, `LOCAL_SERVER.md`, this report

## Architecture decisions

- Dedicated remote pipeline. Do not reuse local prediction or chase-smooth toward the latest snapshot.
- Keep entity interpolation on arrival time. Remotes and mobs are no longer asserted to share one sampler.
- Extrapolation cap holds the pose at the 100 ms coast point, not the last snapshot, so the visual does not pop backward when the budget expires.
- Midpoint discrete states: deterministic, no boolean lerp.

## Tests

```text
npx vitest run tests/remote-player-interpolation.test.ts tests/remote-player-view.test.ts tests/remote-interp-diagnostics.test.ts tests/entity-snapshot-interpolation.test.ts
```

Result: **4 files, 32 passed**.

| Case | Proof |
|---|---|
| A perfect 20 Hz | `renderTick = latest - 2`, x follows serverTick |
| B/L irregular 50/90/35/75/45… | monotonic x; not snapped to newest snapshot |
| Same renderTick vs even spacing | jittered arrivals produce the same pose |
| C batched | one arrival of ticks 100–104 still renders 2 ticks behind |
| D missing 102 | lerp 101→103 at renderTick 102, x=2 |
| E delayed newer tick | accepted |
| F duplicate | rejected, pose unchanged |
| G stale | rejected, timeline does not rewind |
| I 50 ms extra | coasts `v * 0.05` |
| J 100 ms extra | at budget |
| K >100 ms | hold capped pose (not last snapshot, not infinite coast) |
| First snapshot | hold, extrapolationMs=0 |
| Yaw wrap / booleans | shortest path; booleans stay boolean |
| Rejoin reset | history cleared |
| Telemetry | under/s, extrap/s, stale/s |
| View | spawn hold; PlayerVisual; locomotion from interpolated velocity |
| Entities | still 80 ms arrival delay; no `sampleRemotePose` |

Typecheck: `tsconfig.client` / `server` / `sim` PASS.

Not run here: two real browser clients (requires owner). Local prediction suites were smoke-checked unchanged (65 tests across prediction/view/online still green in an earlier pass).

## Visual QA

Not executed in this cloud pass (needs two clients). Use the checklist below.

## Performance

Per remote: 8 samples, O(n) surround scan, no allocations beyond the ring. F3 line is on the existing 7-tick HUD throttle. `?remoteDiag=1` logs at 1 Hz only.

## Known issues

- Clock elapsed uses the latest packet’s receive time, so the **origin** of the 100 ms delay can shift slightly with the newest arrival. Sample timestamps themselves stay on serverTick; tests show jittered vs even spacing match at the same renderTick.
- A skipped `player_left` plus a later `player_state` for the same id will not reset (only `player_joined` / `reset()` does). Normal leave/rejoin is covered.
- Remote actions (attack/mining/bow/eating) remain hardcoded.

## Deferred

- Remote action synchronization (next PR).
- Owner two-client QA.
- Do not merge main. Do not fold this into PR #37.

## Next work

Remote attack / mining / bow / eating / potion presentation on the same interpolated pose. Do not reopen local prediction.

## Manual two-client QA checklist

Setup: `npm run dev:anarchy` (or `dev` + `dev:server`). Two browsers.

Client A (mover): Survival or Creative.  
Client B (observer): `http://localhost:4173/?remoteDiag=1`, F3 on.

- [ ] A stands still → B sees a stable remote, no 20 Hz stepping.
- [ ] A walks / sprints / stops → locomotion is smooth; sprint/stop does not flicker.
- [ ] A strafes and turns through 360° → yaw does not spin the long way.
- [ ] A jumps / falls → vertical motion looks continuous, not packet-stepped.
- [ ] A flies (Creative) → remote does not stutter on hover or fly+SHIFT.
- [ ] Temporarily delay packets (devtools slow 3G / breakpoint) → interpolation, then short extrapolation, then hold. No teleport to a late packet.
- [ ] A leaves and rejoins → no leftover timeline (no snap from old ticks).
- [ ] F3 on B: `serverTick` increasing, `buf` healthy (~2), `under/s` ~0, `extrap` usually 0 on localhost.
- [ ] Local player on A still feels like PR #37 (this PR must not regress prediction).

## Git

Do not merge main. Stacked on PR #37 local-prediction branch.
