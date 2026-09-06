# 2026-09-06 — Server mining lock hold + deferred finish

## Goal

Keep the Anarchy server mining lock for the whole START→hold→FINISH action. Live trace showed `input` packets without `mining: true` wiping `miningTarget` (`mine=—`) before finish, then `reason: mining`. Stop the immediate FINISH after resend-start while server progress is still 0.

## Result

Client keeps `mining: true` on the wire while `buttonDown || miningFinishKey || miningLocked`. `sendOnlineIdle` no longer omits mining during an active action. After `reason: mining`, overlay progress resets, a new START is sent, and FINISH waits for the start ack.

**Automated regression tests cover the confirmed lifecycle. Two-client browser QA did not complete the required 5× oak-planks breaks, so this report does not claim the live bug is fixed.**

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

## Lifecycle before / after

**Before (confirmed live trace):**

```
CLIENT: START → hold → 100% → FINISH
SERVER: beginMining OK
      → input without mining:true (idle/hide/blur)
      → miningTarget cleared (mine=—)
      → FINISH → reason=mining
      → resend START → immediate FINISH at server progress=0
      → second reason=mining
```

**After (intended, covered by tests):**

```
HOLD: buttonDown || miningFinishKey || miningLocked
    → every input + sendOnlineIdle includes mining:true
    → server miningTarget stays until mouse-up / retarget / pause / abort

reason=mining + still holding same cell:
    → miningProgress = 0
    → noteResendBreakStart (miningStartUnacked)
    → new START
    → FINISH blocked (awaiting-start) until start ack
    → only then FINISH (server progress > 0)
```

Why the lock is not wiped by a normal hold packet: protocol still omits `mining` unless it is strictly `true`. The client now sets that field whenever `shouldHoldServerMining` is true, including `sendOnlineIdle`. A packet without `mining` is still a server cancel — mouse-up / pause / inventory must clear the hold flags first.

Why resend no longer FINISH-loops at progress=0: `shouldSendBreakFinish` returns `awaiting-start` while `miningStartUnacked`. Local overlay is reset to 0 so a leftover 1.0 cannot emit FINISH on the same tick as the new START.

## Tests

`tests/server/oak-planks-mining.test.ts` describe `server mining lock hold vs omitted mining`:

1. Long hold with `mining:true` every tick → block breaks.
2. Omitted mining during an active lock is cancel, not valid idle.
3. Oak log 60 ticks.
4. Oak planks 60 ticks.
5. Stone 150 ticks.
6–7. `reason: mining` → resend start → wait progress>0 → finish ok; finish at progress=0 fails.
8. Mouse-up (omitted mining) clears `miningTarget`.
9. Changing target replaces the lock; cell A is not left active.
10. Ada mining X and Bob mining Y stay independent.

Client encoding: `tests/online-mining.test.ts`, `tests/oak-planks-mining-pipeline.test.ts` (`input.mining hold encoding`, resend `awaiting-start`).

Required checks on `b532e30`: `typecheck`, `typecheck:server`, `test:server` (200), `test:sim` (42), `build`.

## Visual QA / live two-client browser

Vite `http://localhost:4173/?miningTrace=1`, Anarchy `ws://127.0.0.1:2567`, two Chrome profiles (CDP 9333 / 9223). SwiftShader, ~4 FPS, TPS 20.

**Done:**

- Player B placed oak planks (`id=22`). First in the dug hole at `0,60,-1`; later on the surface at `10,67,5` then `10,67,4`.
- Player A targeted those cells (`Target Дубовые доски`, F3 `id=22`).
- Server `beginMining` for `id=22` landed (`mine=10,67,5@0.000` / `10,67,4@0.000`).

**Not completed — do not treat as live proof of the fix:**

- A hold LMB on B-placed oak planks to 100% ×5 with `breakBlock mutated=1` / `break OK` finish. Server logs never showed `id=22 mutated=1`.
- A oak log / stone / dirt comparison after this fix (earlier session had dirt/stone/log finishes, including the pre-fix `reason=mining` loop on log).
- A mining X while B mining Y independence in the browser.
- Old scenario: finish/reject then A mines another block without reconnect (not re-run on this revision).

Synthetic canvas `mousedown` and split CDP sessions dropped `input.mining` (`cleanup because=idle` at overlay ~0.13–0.73). OS `xdotool` holds hit the look-zone / moved the player into the pit. B’s client desynced from `/tp` after reload. Failed screen recordings were discarded.

## Performance

Two SwiftShader Chromes: ~4 FPS, 20 TPS. Not a gameplay-tick issue; it made pointer-lock-less QA unreliable.

## Known issues

Agent two-client hold cannot keep a real LMB down for 60+ ticks without blur/look-zone/joystick interference. Owner still needs to do the ×5 plank hold on desktop.

## Deferred / Next work

Owner QA checklist in `docs/ROADMAP.md` (two clients; B places oak planks; A holds to 100% ×5; log/stone/dirt; A-X / B-Y).

## Git

Branch `cursor/mining-hold-input-3f93`. Fix commit `b532e30`.
