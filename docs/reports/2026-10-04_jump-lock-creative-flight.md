# Jump lock vs Creative Flight — 2026-10-04

## Goal

Stop the survival jump latch and Creative Flight from sharing one double-tap, without splitting the timers or turning auto-jump off in creative.

Starting HEAD `97e2206b6ac578a2cfb2ff3f0f4e7dae332866b0`. `origin/main` was `a57dfd9dbb409e4f98265cf6c922bc67366e631c`.

## Root cause

`jumpLockAfterRelease` toggles the latch when the second tap lands within 320 ms. `PlayerController` treats `movement.jump && !jumpHeld` as a Creative Flight edge, and that window is `CREATIVE_FLY_DOUBLE_TAP_TICKS / TICK_RATE` = 7 / 20 s = 350 ms. The second pointerdown makes `touchJumpPressed` true before pointerup runs the latch, so creative can turn flight on and then leave `movement.jump` true from the latch.

`movement.jump` also includes `autoJumpArmed`. That rising edge can arm the same 7-tick window, so one later manual press toggles flight.

## Contract

Survival: one tap jumps, a hold jumps, a double tap latches, the next double tap clears the latch. The button stays `.is-active` with `aria-pressed=true` while latched.

Creative: the same button is only a physical jump. A double tap toggles flight. The latch stays off, so the button does not stay gold.

Desktop Space is `manualJump` and still toggles flight in creative. It does not use the touch latch.

Auto-jump still hops a grounded creative player. It does not arm flight. One manual press after it does not fly. Two manual presses do.

Leaving survival for creative clears the latch, the pending tap time, the active class, and `aria-pressed` immediately. Returning to survival starts from an empty tap, so a creative press is not the first half of a latch.

## Implementation

`setJumpLockAllowed(gamemode !== 'creative')` runs from `syncLocalCreativeFlight` and from session start. `releaseJump` calls `jumpLockAfterPolicy`, which refuses to latch when the policy is off.

`MoveInput.manualJump` is Space or the jump button. `PlayerController` stores that level in `jumpHeld` and feeds only its rising edge to `shouldAcceptFlyToggle`. Locomotion still uses `movement.jump`.

The input packet and `PlayerCommand` carry optional `manualJump`. Prediction resolves it with `manualJumpLevel` and replays that bit. The server copies it through the FIFO. Omitted fields still use `jump`, so older commands keep the previous edge. Compaction keeps a `manualJump` change even when `jump` stays true. The client does not send `isFlying`.

Timing windows were not changed.

## Tests

`tests/jump-lock-flight.test.ts` drives the gesture into `PlayerController`: survival latch, creative flight without a latch, gamemode clears, auto-jump plus one manual tap, two manual taps, desktop/legacy Space, prediction accept, and one replay of a held press. `tests/server/creative-flight-manual-jump.test.ts` runs the same edge through `WorldInstance` applyInput and tick.

## Visual QA

Chrome touch emulation, 844×390, dev server `127.0.0.1:5173`, new worlds:

- Survival: one tap left the jump button idle. A double tap set `is-active` and `aria-pressed=true`. A second double tap cleared both. `elementFromPoint` was the jump button.
- Creative: the same single tap and two double taps left the button idle. `aria-pressed` stayed `false`.

The live view does not expose `isFlying`. Flight on and off was checked through `PlayerController` and `WorldInstance`, not by watching the character in that page.

## Known limitations

A physical jump while riding a cart is still suppressed on the server and still present on the client prediction, which was already true for the `jump` bit. Landing still cancels flight after `flyIgnoreGroundTicks`.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. PR #115 stays draft. Do not merge.
