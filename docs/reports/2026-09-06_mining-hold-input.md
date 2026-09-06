# 2026-09-06 — Server mining lock hold + deferred finish

## Goal

Keep the Anarchy server mining lock for the whole START→hold→FINISH action. Live trace showed `input` packets without `mining: true` wiping `miningTarget` (`mine=—`) before finish, then `reason: mining`. Stop the immediate FINISH after resend-start while server progress is still 0.

## Result

Client keeps `mining: true` on the wire while `buttonDown || miningFinishKey || miningLocked`. `sendOnlineIdle` no longer omits mining during an active action. After `reason: mining`, overlay progress resets, a new START is sent, and FINISH waits for the start ack.

## Implemented

1. `shouldHoldServerMining` also holds while `miningLocked` (start sent, not aborted). Bare idle stays omitted.
2. `sendOnlineIdle` uses the same hold helper. Pause aborts + resets the gate, then idle without mining.
3. `noteResendBreakStart` + `miningStartUnacked`: finish is `awaiting-start` until `block_break_start` ack.
4. Game resend path sets `miningProgress = 0` so leftover 1.0 cannot immediately become FINISH.

## Changed files

- `src/net/onlineMining.ts`
- `src/core/Game.ts`
- `tests/online-mining.test.ts`
- `tests/oak-planks-mining-pipeline.test.ts`
- `tests/server/oak-planks-mining.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Omitted `mining` on the server remains a **cancel** (mouse-up). Sending it during an active hold is a client bug. Do not keep `miningTarget` forever: pause/inventory/mouse-up/retarget/disconnect still clear it.

Creative instant break does not set `miningStartUnacked` (only the mining-reject resend path does).

## Tests

See `tests/oak-planks-mining-pipeline.test.ts`, `tests/online-mining.test.ts`, `tests/server/oak-planks-mining.test.ts` (holds 15/60/150 ticks, omitted-mining wipe, resend-then-progress, mouse-up, retarget, A/B).

## Visual QA / Performance / Known issues / Deferred / Next work / Git

Filled after live two-client QA and the required npm checks.
