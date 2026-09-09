# Bow release actual input boundary

## Goal

Fix the live pre-spawn regression where ordinary multiplayer bow releases fired roughly one arrow in ten because a render-frame release was bound to the preceding `use=true` fixed input instead of the first authoritative `use=false` command.

## Result

The client now resolves release `commandSeq` from the last input packet actually sent. A release between fixed ticks immediately sends its captured intent for future command N+1; if the fixed tick already sent N with `use=false`, the action references N. The existing server pending/boundary path handles both orderings without changes to projectile simulation or combat balance.

## Implemented

- Added explicit `lastSentInputSeq` and `lastSentUse` online wire state, updated only after input send in `tickOnline` and `sendOnlineIdle`.
- Added pure `resolveBowReleaseCommandSeq` with diagnostic modes `current-use-false` and `next-after-use-true`.
- Added an explicit boundary-command parameter to `captureBowRelease`; common `ActionSeqSource.inputSeq` is not mutated.
- Captured yaw, pitch and presentation render tick remain render-frame intent and are sent immediately.
- Added F3 diagnostics for last sent seq/use, chosen seq and boundary mode.

## Changed files

- `src/core/Game.ts`
- `src/net/actionIntent.ts`
- `tests/bow-release-intent.test.ts`
- `tests/server/bow-pvp-timeline.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/ROADMAP.md`
- `docs/reports/2026-09-09_bow-release-input-boundary.md`

## Architecture decisions

- Release intent may reference the next input sequence without sending that movement command early. WebSocket order may deliver the action before input; the server already supports that bounded pending state.
- Wire state is not inferred from `this.input.using` or the debug-only `lastOnlineUsing` field.
- Server fallback `receivedBowState` remains available but is no longer the normal production path for between-tick release.
- `MAX_PENDING_BOW_TICKS = 8`, `MAX_PVP_REWIND_TICKS = 5` and `COMBAT_HISTORY_TICKS = 20` are unchanged.
- Projectile physics, historical AABB resolution, catch-up, Claims, HurtResistance, FireArrow, damage, hitboxes and bow tuning are untouched.

## Tests

- Red proof: the five new boundary tests initially failed because `resolveBowReleaseCommandSeq` did not exist.
- Focused intent/server/presentation/use/main integration: 7 files, 49 tests PASS after implementation.
- Deterministic server phase matrix: 20/20 releases spawn exactly one projectile and consume exactly one arrow with draw ticks frozen at 20.
- Expanded bow/arrow/melee/network/server/Claims suite: 13 files, 189 tests PASS.
- Prediction/combat/Claims compatibility suite: 11 files, 166 tests PASS.
- Shared simulation suite: 9 files, 42 tests PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, import boundaries and production build: PASS. Build retains the existing `/sdk.js` and chunk-size warnings.
- `git diff --check`: PASS.

## Visual QA

The local Vite client and isolated temporary Anarchy server booted successfully; the QA player connected and received a Bow plus 64 arrows. The in-app browser denied pointer lock and kept the engagement overlay above the canvas, while the available browser-control API cannot separate right-button down from up. No `bowDiag` press/release was generated, so manual 20/20 fully charged shots are not claimed. This remains an owner/browser gate rather than being replaced with a false PASS.

## Performance

The correction adds two scalar fields and one constant-time branch per release. It creates no per-frame sampling, extra network input or server work beyond the pending path already implemented.

## Known issues

- Real browser 20/20 fully charged air-shot QA still requires a browser that grants pointer lock and supports holding the right mouse button.
- The deterministic 180 FPS matrix validates all timing phases without wall-clock sleeps, but it is not a substitute for subjective live input feel.

## Deferred

Standing/moving/lead-shot live QA follows only after the manual spawn-reliability gate. No projectile or balance work belongs to this correction.

## Next work

Run 20 fully charged and 20 short air releases in a normal browser. Confirm F3 alternates correctly between `next-after-use-true` and `current-use-false`, with 20/20 ordinary charged releases spawning before target-hit QA.

## Git

Branch: `codex/bow-pvp-timeline-v2`. Base HEAD: `289cbf85a3bc8d21138da92074b06115e7c01545`. Corrective commit target: `fix: bind bow release to actual input boundary`. No merge is part of this task.
