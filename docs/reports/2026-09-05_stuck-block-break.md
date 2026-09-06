# Stuck Anarchy block after failed finish

## Goal

Re-investigate Anarchy block-break after the mining-threshold fix. Symptom: player places dirt, crack overlay completes, block stays, holding LMB shows no overlay, the same cell cannot be broken again (including Creative), other blocks still break, reconnect makes that cell breakable.

## Result

Confirmed client per-coordinate gate, not world/chunk lock and not “server broke it, client missed the update”.

## Root cause

1. `breakTarget` set `pendingBlockAction` and `miningFinishKey` when sending `block_break_finish`.
2. Sequenced actions ack with `action_result` only. `pendingBlockAction` was cleared only on `block_update` / `block_result`.
3. A failed finish (`los` / `stale` / `reach`, or a finish whose `commandSeq` eye no longer hits the start face) does not mutate the world, so no `block_update` arrives. Pending stayed set for those coords.
4. Later `breakTarget` returned immediately for that cell. Other cells had different coords, so they still sent finish. Creative uses the same client `breakTarget` gate, so Creative could not break it either.
5. Reconnect allocates a new `OnlineAnarchySession` (no pending / rejected / finishKey). The server still had dirt, so the block was breakable again.

The reverse hypothesis is false: if the server had set air, reconnect would load an empty cell, not a breakable dirt.

Look-drift on finish was a real first-failure mode: finish reused start hit/face but the current `commandSeq` eye. Server re-ran LOS and often returned `los`. That is not a world lock; it is what *filled* the client pending gate. Claims were not involved.

There is no server/world `Set` of unbreakable coordinates. Server `miningTarget` would have blocked *other* blocks, which does not match the report. Reconnect also clears player mining state, but that is not why the specific cell recovered.

## Implemented

- Clear `pendingBlockAction` on `action_result` for `block_break_finish` (success, `mining`, or hard reject).
- Mouse-up / new `break_start` clears `rejectedBlockKey` so the same cell can be retried without looking away.
- Wait for in-flight finish only while the crosshair is still on that cell; a different block aborts and retargets.
- Finish packets keep start `commandSeq`. Server skip LOS when `miningTarget` already matches the cell (still reject empty/stale).
- DEV F3 `lastBlockDiag` includes the break gate; server reject logs include coords, block id, miningTarget.

## Changed files

- `src/net/onlineMining.ts`
- `src/core/Game.ts`
- `server/WorldInstance.ts`
- `server/AnarchyServer.ts`
- `tests/online-mining.test.ts`
- `tests/server/player-actions.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Server stays authoritative. The client does not locally delete the block. Claims unchanged. Creative still goes through `tryBreak`; hardness is already skipped in `breakBlock`. The Creative failure was the client gate, not Survival progress.

## Tests

- Client gate: hard reject → same coords finishable without an empty (reconnect) gate; other blocks never needed that lock; Survival-then-Creative retry.
- Server: look-drift finish with later `commandSeq` still breaks a locked target; Survival and Creative retry after a stale finish without wiping the world / reconnecting.

## Visual QA

Not a layout change. Overlay still holds at 0.99 only while finish is in flight for that cell.

## Performance

No extra per-tick world scans. Reject logs are existing warn path plus opt-in `FC_DEBUG_NET`.

## Known issues

A geometrically invalid start (eye inside the placed cell) can still fail LOS on `break_start` every attempt until the player moves. That is validation, not a leftover Set.

## Deferred

None.

## Next work

Owner QA on a live Anarchy process: place dirt, induce a failed finish, break the same cell in Survival and Creative without reconnect.

## Git

Branch `cursor/stuck-block-break-3f93` from `cursor/claims-chat-holograms-3f93`.
