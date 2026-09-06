# Two-player unbreakable block (intent LOS / claims audit)

## Goal

Re-investigate Anarchy block-break after two client-gate fixes. New reports: Player A cannot break a cell Player B can; reconnect sometimes helps; inside a claim place+break work, outside place works but break does not; appeared around plugin/claims.

## Result

Root cause is **player-specific intent validation**, not a world lock and not claims cancel in wilderness.

Two server gates produced A-fail / B-success on the **same** shared `VoxelWorld` cell:

1. **Same-cell face mismatch (mining).** `validateBlockTargetIntent` required the DDA face to match the clicked face. Place/use need that (the face chooses the neighbor). Mining only needs the voxel. Pose lag and glancing angles make A’s reconstructed ray hit a different face of the *same* block → `los`. B standing square-on matches. Mining now sets `requireMatchingFace: false`; a neighbor cell is still `los`.
2. **Eye inside the target voxel.** Voxel DDA from inside returns the *entry* face (behind the player) while the client captured the clicked face. Distance to the hit point can also trip `reach` (`<= 1e-6`). Skip LOS/face when the eye overlaps the cell; still require the block to exist and not be stale.

Claims cancel is a **separate**, intended A-fail/B-success path when A is untrusted and B is trusted/OP (`reason: cancelled`). Wilderness `overlapping=[]` does not cancel.

## Where the reject happens

Server `beginMining` / `tryBreak.intent` / `validateBlockTargetIntent`, reason **`los`** (sometimes `reach` if the eye sits on the hit point).

Client overlay can complete; the server never calls `setBlock(air)` for A. B’s `setBlock(air)` runs and broadcasts.

## Client or server

**Server.** Both clients see the same block. A’s packet is rejected; B’s is accepted. Previous client `pendingBlockAction` lock is a different bug (failed finish on **that** client only).

## Why A reject / B success for the same cell

A’s reconstructed eye/hit does not pass the old face-strict LOS; B’s does. Reconnect **resume** keeps the intersecting or glancing pose → still `los`. A full join at spawn, then approaching from outside → works.

## Claims / plugin system

Claims **can** produce A-reject/B-success when A is untrusted and B is trusted/OP (`reason: cancelled`, chat `This land is claimed.`). That is intended protection, not a stale Set.

Claims **do not** cancel wilderness (`overlapping=[]` returns without `event.cancel()`). Place-ok + break-fail outside a claim is the intent-LOS path, not `block-place` vs `block-break` flags (both default false, so a real claim would deny both).

- New `BlockBreakEvent` every attempt; `cancelled` does not leak.
- Reload unsubscribes listeners; claims `blockBreak` count stays 1 after reload and a second `enableAll`.
- EventBus does **not** stop after Claims allows: a later listener can still `event.cancel()`. Builtin plugins do not register a second `blockBreak` handler.
- A cancelled break does not mutate the cell; a later trusted/other player can still break it.

## event.cancel

Only when protection denies, or another plugin’s listener cancels. Fresh event per emit. Duplicate claims listeners would still only cancel, not lock the world.

## Stale state

No world/chunk unbreakable Set. Player-specific: pose (eye inside / glancing face), Survival `miningTarget` lock (Creative no longer uses it for a different cell), client session gate from the previous pass.

## Implemented

- Skip LOS/face when eye overlaps the target voxel.
- Mining/break ignores same-cell face mismatch; place/use still require the face.
- Creative ignores Survival miningTarget mismatch.
- Structured reject logs (`server/breakDiagnostics.ts`); claims deny logs overlap/names/trusted; `beginMining` rejects are logged too.
- Tests: inside-eye intent; mining face skip vs neighbor `los`; two-player intersecting vs distant; Ada stale then Bob success; Creative vs Survival mining lock; claims no-leak cancel; no-claim two-player and place-break cycles with plugins loaded; reload + second enableAll listener count; later plugin can cancel after claims.

## Changed files

- `src/gameplay/actionValidation.ts`, `src/gameplay/index.ts`
- `server/WorldInstance.ts`, `server/gameplay.ts`, `server/breakDiagnostics.ts`, `server/builtin-plugins/claims.ts`
- `tests/block-action-intent.test.ts`, `tests/server/player-actions.test.ts`, `tests/server/anarchy-plugins.test.ts`, `tests/server/break-diagnostics.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Tests

See files above.

## Visual QA

Not a layout change. Browser play-test of two clients was not available in this pass.

## Known issues

A geometrically invalid start that hits a **different** cell (true neighbor LOS) still rejects. Claims deny still requires trust/OP.

## Next work

Owner two-client QA: A clips or glances a placed dirt, B breaks it; A places again and breaks without reconnect.

## Git

Branch `cursor/block-break-two-player-3f93`.
