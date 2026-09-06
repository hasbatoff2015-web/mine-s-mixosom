# Mining lifecycle lock after 100% overlay

## Goal

After crack overlay reaches 100% the block often stays, then **all** subsequent breaking dies for that player (no new overlay, LMB on other blocks does nothing). Find the global mining gate, not another LOS/claims tweak.

## Result

Client `miningFinishKey` + `shouldWaitForInFlightFinish` swallowed every later mining tick while the crosshair stayed on that cell **or air**. Mouse-up refused to abort (server-hold fix) and did not clear the wait flag. A finish `action_result` with `reason: mining` or **no coordinates** left `miningFinishKey` / `miningLocked` set. Pause/inventory cleared `miningTarget` but not the finish gate.

Claims/plugins do not hold a lock between attempts. Place/attack/raycast use other paths.

## Root cause

`src/net/onlineMining.ts` + `src/core/Game.ts` `updateTargetAndActions`.

Sequence:

1. Overlay hits 100% → `breakTarget` → `noteBreakFinishSent` (`finishKey`, `pending`, `clientWaitFinish=true`).
2. `shouldWaitForInFlightFinish` is true for same cell **and missing targetKey (air)**.
3. That branch is an empty `return`: no start, no progress, no abort.
4. Mouse-up: `shouldSendBreakAbort` is false when `finishKey === miningTarget`. `rejectedBlockKey` cleared only. **Wait stays true.**
5. Next LMB on the same block or while looking at air: still wait. No new overlay.
6. Looking at another **solid** could abandon, but air-wait + same-cell wait plus a stuck finishKey made it feel like mining was globally dead.
7. `applyBreakActionResult` returned early on missing coords and on `reason: mining` **before** clearing `miningFinishKey` / `miningLocked`.

Success path (A): `action_result` ok + coords → finishKey cleared → next LMB `start`.
Bug path (B): finishKey still set, `clientWaitFinish` still true → every tick `wait`.

## Why every block died

The wait is **session-global**, not per-voxel. One stuck `miningFinishKey` blocks `resolveOnlineMiningTick` for every later pointerdown until mouse-up clears `clientWaitFinish` (new) or an ack/timeout resets the gate.

## States that were not cleared

| State | Set | Was stuck after 100% fail |
|---|---|---|
| `miningFinishKey` | finish sent | yes (mining reject / no coords / no ack) |
| `clientWaitFinish` | finish sent | yes (mouse-up did not clear) |
| `miningLocked` | start / finish | yes on mining reject |
| `pendingBlockAction` | finish sent | sometimes (cleared on ack without coords) |
| `session.miningTarget` / `miningProgress` | mining ticks | overlay could stay at 0.99 |
| server `player.miningTarget` | beginMining | not the global client lock |

## Fix

- `clientWaitFinish` cleared on mouse-up. Server `input.mining` still held via `miningFinishKey` until ack.
- After mouse-up, same cell → `start`; other cell → `abandon-start`.
- Any finish `action_result` clears finish/lock/wait (including `mining` and missing coords).
- Inventory/pause/`gameplayAllowed=false` calls `resetOnlineMiningGate`.
- `MAX_FINISH_WAIT_TICKS` (40) abandons a stuck wait.
- `[MINING]` traces on start/finish/result/cleanup; rejects always warn; info behind DEV/`?miningTrace=1`.

## Tests

`tests/online-mining.test.ts`: wait only while holding; mouse-up then same/other cell starts; hard reject resets all flags; mining reject unlocks resend; no-coords unlock; timeout abandon.

## Git

Branch `cursor/mining-lifecycle-lock-3f93`.
