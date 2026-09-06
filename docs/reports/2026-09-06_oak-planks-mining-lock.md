# Oak planks 100% overlay mining lock (after PR #57)

## Goal

Reproduce the two-player oak planks scenario (overlay 100%, block stays, Player A mining dies until Player B breaks that cell). Compare dirt / stone / oak log / oak planks. Do not guess another overlay/LOS/claims workaround.

## Result

Oak planks are **not** a special unbreakable block. They share `wood()` with oak log (hardness 2, 60 ticks / 3s by hand). Dirt is 15 ticks; stone by hand is 150. Client and server use the same `miningProgressPerTick`. ID 22 round-trips. A held Survival mine **does** break oak planks (server auto-break at progress ≥ 1).

The observed lock is a **client finish gate + wiped server mining lock**, made likely by the 3s duration and a second player standing near the cell.

## 1. Why oak planks differ in the mining pipeline

| Field | Dirt | Stone | Oak log | Oak planks |
|---|---|---|---|---|
| ID | 3 | 1 | 16 | **22** |
| helper | `block()` | dedicated | `wood()` | **`wood()`** |
| hardness | 0.5 | 1.5 | 2 | **2** |
| ticks (hand) | 15 | 150 (`/100`) | 60 | **60** |
| tool | shovel | pickaxe + `requiresCorrectTool` | axe, hand harvest | **same as log** |
| solid/opaque/breakable | cube | cube | cube | cube |

Mining-relevant difference vs dirt: **3s vs 0.75s**. Vs oak log: **none**. Oak log was tested before B joined; after B joined the first 3s placed block they tried was planks.

## 2. What happens at 100%

CLIENT: overlay `miningProgress += miningProgressPerTick` (also +1 delta on the start tick). At ≥ 1.0 → `breakTarget` → `noteBreakFinishSent` (`miningFinishKey`, `clientWaitFinish`, `pendingBlockAction`).

Previously finish packet was `{ ...captureBlockBreakFinish(), ...miningIntent }` so **start `commandSeq` overwrote finish pose**.

SERVER (if `input.mining` held the whole time): `advanceMining` reaches 1.0 and `setBlock(air)`. Trace A: dirt/stone/log/planks all succeed.

SERVER (if one `mining:false` packet during the 3s hold): `miningTarget` wiped. Finish → `reason: mining` (`tryBreak.breakBlock`). Cell unchanged. Overlay already at 100%.

SERVER (finish with start `commandSeq` after pose history eviction, lock wiped): `tryBreak.intent` → `stale`.

## 3. Server response

Held path: `action_result` ok + `block_update` air.

Failed path: `action_result` `ok: false`, `reason: mining` or `stale`, coords present, **no** `block_update`. Claims not involved (`overlapping=[]` does not cancel).

## 4. Client state after that

PR #57 clears `miningFinishKey` on any finish ack. Then:

- Local `miningTarget` still the planks, progress ≥ 1 → next tick **progress**, not **start** → another finish. Server still has no lock → infinite `mining` rejects. Overlay stays at 100%.
- If ack never applied / `remoteCloser` skipped the mining tick: `finishWaitTicks` stays 0, timeout never fires, wait swallows LMB on that cell or air.

## 5. Why Player B breaking the cell unlocks A

`Game.handleOnlineMessage` `block_update` / `block_batch` calls `clearOnlineMiningFinish(session, x,y,z)` → `applyAuthoritativeVoxelToMiningGate`. **Only if the key matches** A’s `miningFinishKey` / `miningTarget`. B’s `setBlock(air)` broadcasts that cell. A’s gate drops. Not a shared A/B mining map.

On the server, Ada `advanceMining` seeing Air also clears Ada’s `miningTarget` only.

## 6. Shared / global mining state

None. `ServerPlayer.miningTarget` / `miningProgress` per player. WorldInstance has no mining Map. A and B can mine different cells independently (test D).

## 7. Client/server break-time mismatch

Same module, same formula, same tool/material/mode modifiers. Client adds one delta on the start tick; server `beginMining` does not. With `progress > 0` that is not a reject. Oak planks 1/60 per tick both sides.

## 8. `block_update`

Does **not** globally reset mining. Coordinate-matched clear of finish/wait/pending/`miningTarget`. That matching clear is the B→A unlock. A `block_update` on another cell leaves A’s plank finish gate intact.

## 9. Block ID / serialization

`OakPlanks = 22`. `oak_planks` item `placesBlockId` is 22. JSON action/`block_update` keep 22. No palette collision with log (16). Not stairs/slab unless a different item is used.

## 10. Minimal fix

1. `composeOnlineBreakFinish`: keep start voxel identity; **do not** copy start `commandSeq`.
2. `shouldSkipMiningTickForRemote`: if `miningFinishKey` set, still run the mining tick (timeout / abandon).
3. `reason: mining` → resend `block_break_start` while still looking at that cell (finish-only cannot restore a wiped lock).
4. `applyAuthoritativeVoxelToMiningGate`: also clear `clientWaitFinish` / pending on that cell.

No reconnect, no reset-all-state, no claims disable, no plank special case.

## Implemented

- `src/net/actionIntent.ts` `composeOnlineBreakFinish`
- `src/net/onlineMining.ts` remote skip + voxel gate + resend-start helper
- `src/core/Game.ts` finish compose, remoteCloser, mining-reject start, voxel clear

## Tests

- `tests/oak-planks-mining-pipeline.test.ts` — fields, ID 22, compose commandSeq, B `block_update` unlock, remote skip, resend-start
- `tests/server/oak-planks-mining.test.ts` — A/B/C/D/E traces, wipe→mining reject→next block, pose-eviction stale, Ada fail + Bob break + Ada mines again, independent A/B targets

## Changed files

- `src/net/actionIntent.ts`, `src/net/onlineMining.ts`, `src/core/Game.ts`
- `tests/oak-planks-mining-pipeline.test.ts`, `tests/server/oak-planks-mining.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report

## Architecture decisions

Keep start voxel on finish (no neighbor retarget). Pose must be finish-time. `reason: mining` means no server lock, not “one tick ahead” after the `progress > 0` rule.

## Visual QA

Not a layout change. Two-client browser QA of placed oak planks was not available in this environment.

## Performance

No extra systems. Pose/history bounds unchanged.

## Known issues

A geometrically invalid start (true neighbor LOS) still rejects. Claims deny still requires trust/OP.

## Deferred

Owner two-client QA of B-placed oak planks after this fix.

## Next work

Owner: two Anarchy clients; B places oak planks; if overlay hits 100% and the block stays, release LMB and mine dirt without waiting for B to break the planks.

## Git

Branch `cursor/oak-planks-mining-lock-3f93` from `cursor/mining-lifecycle-lock-3f93`.
