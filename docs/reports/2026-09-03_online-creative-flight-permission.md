# 2026-09-03 Online Creative Flight permission

## Goal

Stop the broader prediction-timeline investigation for the stationary Creative Flight Y jitter. Live evidence showed the authoritative server hovering while client prediction applied gravity. Fix the Creative Flight permission/state mismatch so Online matches Singleplayer. Do not change physics constants, Y tolerance, smoothing, or the server input timeline.

## Result

The live dump is a permission bug, not a checkpoint/`extraTicks` bug.

Server applied idle input every tick with `y=71.666 vy=0 fly=true`. Client checkpoint/history/comparable had `fly=false` and gravity (`vy≈-1.57` then `-3.10`, `dy≈0.078`). `PlayerController.tick()` clears `isFlying` when `creativeFlightAllowed` is false. Singleplayer sets that flag every tick from `summary.mode`. Online never did.

## Implemented

1. **Trace.** `[corrDiag]` now prints `FLIGHT:` at the correction tick: `localAllowed`, `scratchAllowed`, `snapshotGamemode`, checkpoint/predicted/snapshot `flying`.
2. **SP vs Online.** Singleplayer `tickPlayers` already did `creativeFlightAllowed = mode === 'creative'`. Online `tickOnline` / `sendOnlineIdle` now call the same helper **before** `predictLocalMove`.
3. **Permission sync.** `syncCreativeFlightAllowed` on startSession (welcome gamemode), snapshot **before** reconcile/resync, inventory, respawn, `setGameMode`. Welcome used to set `summary.mode=creative` without touching the new controller (default `false`). Snapshot only wrote the flag when gamemode **changed**, so it stayed false.
4. **Scratch.** `predictedStateFromCheckpoint` / `predictedStateAfterExtraTicks` always set `creativeFlightAllowed` (not only `PlayerMovementState`). Inspect uses live flag **or** snapshot `gamemode=creative`.
5. **Tests.** Unsynced live tick falls vs server hover; scratch without permission drops fly; hover 200 ticks `corr=0`; flight forward / SHIFT / reconnect / alt-tab; survival walk/jump.

## Changed files

- `src/player/creativeFlight.ts`
- `src/net/localPlayerPrediction.ts`
- `src/net/correctionDiagnostics.ts`
- `src/net/index.ts`
- `src/core/Game.ts`
- `tests/online-creative-flight-prediction.test.ts`
- `tests/creative-flight.test.ts`
- `tests/correction-diag-dump.test.ts`
- `tests/player-main-integration.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Architecture decisions

- Creative Flight permission is **configuration**, not movement state. Copy it onto every prediction scratch.
- Authoritative source is gamemode (`creative` → allowed). Do not force `isFlying=true` every tick; `tick()` still toggles from double-Space and still applies gravity when not flying.
- Sync the live controller before `tick()` and before inspect/replay so history and comparable stay in the flying regime. Scratch-only would let inspect accept a hover while the live player kept falling.
- Did not ignore Y corrections, raise Y tolerance, smooth, disable reconcile, force snapshot accept, or redesign applied-input timeline.

## Tests

```text
npx vitest run tests/online-creative-flight-prediction.test.ts tests/creative-flight.test.ts tests/local-player-prediction.test.ts tests/correction-diag-dump.test.ts tests/player-main-integration.test.ts tests/server/client-server-lockstep.test.ts tests/hidden-tab-motion.test.ts
```

## Visual QA

Not run in this cloud pass (no localhost game tab). Owner: one tab, Creative Online, enable flight, hover in open air, release all keys for 10 s. Expect no rapid Y oscillation, `corr/s=0`, `fly=true`, `vy=0` on both sides. Also flight forward, flight+SHIFT, flight stop, reconnect, alt-tab, walk/sprint/jump.

## Performance

No extra systems. One boolean assign per tick (same as Singleplayer).

## Known issues

Walk/sprint/jump/flight lockstep tests already matched when tests set `creativeFlightAllowed` themselves. The missing Game Online sync was the live gap.

## Deferred

Applied-input `{tick,seq}` replay is still a separate timeline topic. Not this pass.

## Next work

Owner localhost confirmation of stationary Creative Flight. Do not merge main.

## Git

Branch `cursor/online-prediction-remesh-86e1`. PR #37.
